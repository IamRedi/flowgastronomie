import { randomUUID, createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import Fastify from "fastify";
import sharp from "sharp";
import {
  prisma,
  setupMediaRepository,
  canonicalMediaRepository,
  creativeSourceCatalog,
  type StaffIdentity,
} from "@flowgastronomie/database";
import { provisionBusinessInTransaction } from "../../../packages/database/src/business-provisioner.js";
import { registerSetupMediaRoutes } from "./setup-media-routes.js";
import {
  assignCanonicalMedia,
  storeCanonicalMedia,
} from "../../../packages/database/src/canonical-media-repository.js";
import { normalizeCanonicalImage } from "../../../packages/database/src/media-storage-adapter.js";
import { staffOrderRepository } from "../../../packages/database/src/staff-order-repository.js";

async function business(kind: "DEMO" | "REAL") {
  const b = await prisma.$transaction(
    (tx) =>
      provisionBusinessInTransaction(
        tx,
        {
          requestKey: randomUUID(),
          organizationName:
            kind === "DEMO"
              ? "Pizzeria Aurora · DEMO"
              : "Synthetic Pizza Fixture",
          venueName:
            kind === "DEMO"
              ? "Pizzeria Aurora · DEMO"
              : "Synthetic Pizza Fixture",
          ownerDisplayName: "Owner",
          email: `${randomUUID()}@media.test`,
          password: "setup-media-password",
          locale: "en",
          timezone: "Europe/Tirane",
          currency: "ALL",
          plan: "RESTAURANT_PRO",
          profileId: "PIZZERIA",
          applyCategories: true,
        },
        kind,
      ),
    { timeout: 15000 },
  );
  const staff = {
    tenantId: b.tenant.id,
    venueId: b.venue.id,
    userId: b.owner.id,
    membershipId: b.membership.id,
    role: "OWNER",
  } as StaffIdentity;
  const category = await prisma.menuCategory.findFirstOrThrow({
    where: { tenantId: staff.tenantId },
  });
  await prisma.menuCategory.update({
    where: { id: category.id },
    data: { published: true },
  });
  const product = await prisma.product.create({
    data: {
      tenantId: staff.tenantId,
      venueId: staff.venueId,
      categoryId: category.id,
      station: "KITCHEN",
      priceMinor: 950,
      currency: "ALL",
      published: true,
      translations: {
        create: {
          tenantId: staff.tenantId,
          venueId: staff.venueId,
          locale: "EN",
          name: "Margherita",
        },
      },
    },
  });
  return { staff, product };
}
const image = (color: string) =>
  sharp({ create: { width: 240, height: 180, channels: 3, background: color } })
    .png()
    .toBuffer();
describe.skipIf(process.env.SMART_SETUP_DB_GATE !== "true")(
  "SI2 canonical media onboarding",
  () => {
    afterAll(() => prisma.$disconnect());
    for (const kind of ["REAL", "DEMO"] as const) {
      it(`${kind}: explicit review, original bytes, shared consumers, replace/history, role and scope`, async () => {
        const a = await business(kind),
          b = await business("DEMO");
        if (kind === "REAL") {
          await prisma.membership.update({
            where: { id: a.staff.membershipId },
            data: { role: "MANAGER" },
          });
          a.staff.role = "MANAGER";
        }
        let identity = a.staff;
        const app = Fastify();
        registerSetupMediaRoutes(app, async () => identity);
        const base = "/v1/staff/setup-media";
        const upload = async (bytes: Buffer, publicUse = false) =>
          app.inject({
            method: "POST",
            url: `${base}/uploads?source=${kind === "DEMO" ? "DEMO" : "UPLOAD"}&publicUse=${publicUse}&confirmed=true`,
            headers: { "Content-Type": "image/png" },
            payload: bytes,
          });
        try {
          let workspace = (
            await app.inject({ method: "GET", url: base })
          ).json();
          expect(
            workspace.products.some(
              (p: { id: string }) => p.id === a.product.id,
            ),
          ).toBe(true);
          const bytes = await image("red");
          const response = await upload(bytes);
          expect(response.statusCode).toBe(200);
          const asset = response.json();
          expect(asset.bytes).toBeUndefined();
          expect(asset.approvedForPublicUse).toBe(false);
          expect((await upload(bytes)).json().id).toBe(asset.id);
          expect(
            Buffer.from(
              (await canonicalMediaRepository.content(asset.id, a.staff))!
                .bytes,
            ).equals(bytes),
          ).toBe(true);
          expect(asset.contentHash).toBe(
            createHash("sha256").update(bytes).digest("hex"),
          );
          expect(
            (await canonicalMediaRepository.resolve(a.staff)).products,
          ).toHaveLength(0);
          let update = await app.inject({
            method: "PUT",
            url: base,
            payload: {
              expectedVersion: workspace.progress.version,
              step: 3,
              assignments: [
                {
                  assetId: asset.id,
                  productId: null,
                  role: "LOGO",
                  sortOrder: 0,
                },
                {
                  assetId: asset.id,
                  productId: a.product.id,
                  role: "PRIMARY",
                  sortOrder: 0,
                },
              ],
            },
          });
          expect(update.statusCode).toBe(200);
          workspace = update.json();
          expect((await setupMediaRepository.get(a.staff)).assignments).toEqual(
            workspace.assignments,
          );
          expect(
            (await canonicalMediaRepository.resolve(a.staff)).products,
          ).toHaveLength(0);
          expect(
            (
              await app.inject({
                method: "POST",
                url: `${base}/save`,
                payload: {
                  expectedVersion: workspace.progress.version,
                  confirm: true,
                },
              })
            ).statusCode,
          ).toBe(400);
          update = await app.inject({
            method: "PUT",
            url: base,
            payload: {
              expectedVersion: workspace.progress.version,
              step: 4,
              assignments: workspace.assignments,
            },
          });
          workspace = update.json();
          expect(
            (
              await app.inject({
                method: "POST",
                url: `${base}/save`,
                payload: {
                  expectedVersion: workspace.progress.version,
                  confirm: false,
                },
              })
            ).statusCode,
          ).toBe(400);
          const saved = await app.inject({
            method: "POST",
            url: `${base}/save`,
            payload: {
              expectedVersion: workspace.progress.version,
              confirm: true,
            },
          });
          expect(saved.statusCode).toBe(200);
          workspace = saved.json();
          expect(workspace.progress.status).toBe("COMPLETE");
          expect(
            (await canonicalMediaRepository.resolve(a.staff)).products[0]?.media
              .id,
          ).toBe(asset.id);
          expect(
            (await creativeSourceCatalog(a.staff, "en")).media.products[0]
              ?.media.id,
          ).toBe(asset.id);
          const pos = await staffOrderRepository.posMenu(a.staff, "en");
          expect(
            pos.categories
              .flatMap((c) => c.products)
              .find((p) => p.id === a.product.id)?.media?.id,
          ).toBe(asset.id);
          const replacement = (await upload(await image("blue"))).json();
          workspace = await setupMediaRepository.update(a.staff, {
            expectedVersion: workspace.progress.version,
            step: 4,
            assignments: workspace.assignments.map(
              (r: { productId: string | null }) =>
                r.productId ? { ...r, assetId: replacement.id } : r,
            ),
          });
          await setupMediaRepository.finish(
            a.staff,
            workspace.progress.version,
            "SAVE",
          );
          expect(
            (await canonicalMediaRepository.resolve(a.staff)).products[0]?.media
              .id,
          ).toBe(replacement.id);
          expect(
            Buffer.from(
              (await canonicalMediaRepository.content(asset.id, a.staff))!
                .bytes,
            ).equals(bytes),
          ).toBe(true);
          await expect(
            prisma.mediaAsset.update({
              where: { id: asset.id },
              data: { bytes: Buffer.from("rewrite") },
            }),
          ).rejects.toThrow("immutable");
          expect(
            await canonicalMediaRepository.content(asset.id, b.staff),
          ).toBeNull();
          identity = b.staff;
          const foreign = (
            await app.inject({ method: "GET", url: base })
          ).json();
          expect(
            foreign.assets.some((r: { id: string }) => r.id === asset.id),
          ).toBe(false);
          expect(
            (
              await app.inject({
                method: "PUT",
                url: base,
                payload: {
                  expectedVersion: foreign.progress.version,
                  step: 2,
                  assignments: [
                    {
                      assetId: asset.id,
                      productId: b.product.id,
                      role: "PRIMARY",
                      sortOrder: 0,
                    },
                  ],
                },
              })
            ).statusCode,
          ).toBe(404);
          identity = { ...a.staff, role: "WAITER" };
          expect(
            (await app.inject({ method: "GET", url: base })).statusCode,
          ).toBe(403);
          expect((await upload(bytes)).statusCode).toBe(403);
          identity = a.staff;
          const approval = await upload(await image("green"), true);
          expect(approval.statusCode).toBe(kind === "DEMO" ? 400 : 200);
          if (kind === "REAL")
            expect(approval.json().approvedForPublicUse).toBe(true);
          const venue = await prisma.venue.findUniqueOrThrow({
            where: { id: a.staff.venueId },
            include: { website: true, launch: true },
          });
          expect(venue.website?.status).toBe("DRAFT");
          expect(venue.onlinePickupEnabled).toBe(false);
          expect(venue.launch?.launchedAt ?? null).toBeNull();
        } finally {
          await app.close();
        }
      });
    }
    it("rejects stale drafts, preserves gallery order, supports explicit skip and retains generated provenance", async () => {
      const { staff, product } = await business("REAL");
      const bytes = await image("orange");
      const generated = await prisma.$transaction(async (tx) =>
        storeCanonicalMedia(tx, staff, {
          image: await normalizeCanonicalImage(bytes),
          sourceKey: "generated-test",
          provenance: {
            source: "GENERATED",
            description: "AI-generated / not actual food",
            provider: "mock",
            model: "fixture",
            originalAssetId: "original-generated",
          },
          approvedForPublicUse: false,
          confirmed: true,
        }),
      );
      const repeated = await setupMediaRepository.upload(staff, bytes, {
        source: "UPLOAD",
        publicUse: "true",
        confirmed: "true",
      });
      expect(repeated.id).toBe(generated.id);
      expect(repeated.source).toBe("GENERATED");
      expect(repeated.approvedForPublicUse).toBe(false);
      const unpromoted = await image("purple");
      await prisma.creativeAsset.create({
        data: {
          tenantId: staff.tenantId,
          venueId: staff.venueId,
          name: "Generated fixture",
          source: "GENERATED",
          mimeType: "image/png",
          width: 240,
          height: 180,
          contentHash: createHash("sha256").update(unpromoted).digest("hex"),
          storageKey: "test-only-no-file",
          provenance: { provider: "mock", model: "fixture" },
          createdBy: staff.userId,
        },
      });
      await expect(
        setupMediaRepository.upload(staff, unpromoted, {
          source: "UPLOAD",
          publicUse: "true",
          confirmed: "true",
        }),
      ).rejects.toThrow("promotion flow");
      let workspace = await setupMediaRepository.get(staff);
      workspace = await setupMediaRepository.update(staff, {
        expectedVersion: workspace.progress.version,
        step: 4,
        assignments: [
          {
            assetId: generated.id,
            productId: product.id,
            role: "GALLERY",
            sortOrder: 0,
          },
        ],
      });
      await prisma.$transaction((tx) =>
        assignCanonicalMedia(tx, staff, generated.id, { venueRole: "HERO" }),
      );
      await expect(
        setupMediaRepository.finish(staff, workspace.progress.version, "SAVE"),
      ).rejects.toThrow("another workspace");
      workspace = await setupMediaRepository.finish(
        staff,
        workspace.progress.version,
        "RESET",
      );
      workspace = await setupMediaRepository.finish(
        staff,
        workspace.progress.version,
        "SKIP",
      );
      const progress = await prisma.smartSetup.findUniqueOrThrow({
        where: {
          tenantId_venueId: {
            tenantId: staff.tenantId,
            venueId: staff.venueId,
          },
        },
      });
      expect(progress.skipped).toEqual(["MEDIA"]);
      expect(workspace.progress.status).toBe("SKIPPED");
      expect(
        (await canonicalMediaRepository.resolve(staff)).products,
      ).toHaveLength(0);
    });
  },
);
