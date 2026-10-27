import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import Fastify from "fastify";
import {
  prisma,
  businessImportRepository,
  commitBusinessImport,
  revertBusinessImport,
  menuImportRepository,
  setupMediaRepository,
  type StaffIdentity,
} from "@flowgastronomie/database";
import {
  businessImportFieldNames,
  type BusinessReview,
} from "@flowgastronomie/domain";
import { provisionBusinessInTransaction } from "../../../packages/database/src/business-provisioner.js";
import { registerBusinessImportRoutes } from "./business-import-routes.js";
import { registerMenuImportRoutes } from "./menu-import-routes.js";
import {
  controlledWebsiteTransport,
  fixtureOrigin,
} from "../../../tests/import-v2/fixtures.js";
import { inspectMenuSource } from "./menu-import-document-adapter.js";
import {
  controlledMenuPng,
  ControlledMenuExtractor,
} from "../../../tests/setup/fixtures.js";
async function business() {
  const result = await prisma.$transaction(
    (tx) =>
      provisionBusinessInTransaction(
        tx,
        {
          requestKey: randomUUID(),
          organizationName: "Import acceptance",
          venueName: "Original venue",
          ownerDisplayName: "Test Owner",
          email: `${randomUUID()}@example.test`,
          password: "test-import-password",
          locale: "en",
          timezone: "Europe/Berlin",
          currency: "EUR",
          plan: "RESTAURANT_PRO",
          profileId: "RESTAURANT",
          applyCategories: false,
        },
        "REAL",
      ),
    { timeout: 15000 },
  );
  return {
    tenantId: result.tenant.id,
    venueId: result.venue.id,
    userId: result.owner.id,
    membershipId: result.membership.id,
    role: "OWNER",
  } as StaffIdentity;
}
function harness(staff: StaffIdentity, provider?: ControlledMenuExtractor) {
  let identity = staff;
  const app = Fastify();
  registerMenuImportRoutes(app, async () => identity);
  registerBusinessImportRoutes(app, async () => identity, {
    dns: async () => ["93.184.216.34"],
    transport: controlledWebsiteTransport(),
    ...(provider ? { provider } : {}),
  });
  return {
    app,
    identity: (next: StaffIdentity) => {
      identity = next;
    },
  };
}
type View = Awaited<ReturnType<typeof businessImportRepository.get>>;
function approve(view: View): BusinessReview {
  return {
    canonicalRevision: view.canonicalRevision,
    expectedVersion: view.version,
    confirm: true,
    premiumStyleId: "restaurant-2",
    fields: businessImportFieldNames.map((field) => {
      const proposal = view.businessData.fields.find((p) => p.field === field);
      return {
        field,
        proposalId: proposal?.id ?? null,
        value: proposal?.value ?? "",
        decision: proposal && field !== "businessType" ? "APPROVE" : "REJECT",
      };
    }),
    items: view.items.map((row) => ({
      id: row.id,
      item: {
        ...(row.reviewed as unknown as BusinessReview["items"][number]["item"]),
        priceMinor: (row.reviewed as { priceMinor?: number }).priceMinor ?? 700,
        currency: "EUR",
      },
      action: "ADD",
      targetProductId: null,
      approvePrice: true,
      approveConfiguration: true,
    })),
    media: [],
  };
}
async function analyze(
  app: ReturnType<typeof Fastify>,
  staff: StaffIdentity,
  sourceUrl: string | null = fixtureOrigin,
) {
  const created = await app.inject({
    method: "POST",
    url: "/v1/staff/business-imports",
    payload: {
      requestKey: randomUUID(),
      locale: "en",
      url: sourceUrl,
      authorized: true,
    },
  });
  expect(created.statusCode).toBe(200);
  const id = created.json().id as string;
  const response = await app.inject({
    method: "POST",
    url: `/v1/staff/business-imports/${id}/analyze`,
    payload: {
      expectedVersion: created.json().version,
      requestKey: randomUUID(),
    },
  });
  expect(response.statusCode).toBe(202);
  for (let i = 0; i < 250; i++) {
    const view = await businessImportRepository.get(staff, id);
    if (view.businessData.phase === "REVIEW") return view;
    if (view.extractionState === "FAILED")
      throw new Error(`Analysis failed: ${view.errorCode}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Analysis did not finish");
}
describe.skipIf(process.env.SMART_SETUP_DB_GATE !== "true")(
  "Smart Business Import V2 PostgreSQL/API acceptance",
  () => {
    afterAll(() => prisma.$disconnect());
    it("caps simultaneous tenant analysis and counts cancelled attempts in hourly budgets", async () => {
      const staff = await business();
      const create = () =>
        businessImportRepository.create(staff, {
          requestKey: randomUUID(),
          locale: "en",
          url: fixtureOrigin,
          authorized: true,
        });
      let first = await create();
      const second = await create();
      await businessImportRepository.begin(
        staff,
        first.id,
        first.version,
        randomUUID(),
      );
      await expect(
        businessImportRepository.begin(
          staff,
          second.id,
          second.version,
          randomUUID(),
        ),
      ).rejects.toThrow("already analyzing");
      first = await businessImportRepository.get(staff, first.id);
      await businessImportRepository.cancel(staff, first.id, first.version);
      await expect(
        businessImportRepository.begin(
          staff,
          second.id,
          second.version,
          randomUUID(),
          { userPerHour: 1, tenantPerHour: 30 },
        ),
      ).rejects.toThrow();
      await expect(
        businessImportRepository.begin(
          staff,
          second.id,
          second.version,
          randomUUID(),
          { userPerHour: 10, tenantPerHour: 1 },
        ),
      ).rejects.toThrow();
      expect(
        (
          await businessImportRepository.begin(
            staff,
            second.id,
            second.version,
            randomUUID(),
          )
        ).claimed,
      ).toBe(true);
    }, 60_000);
    it("creates immutable explicit public approval for a prior private imported image", async () => {
      const staff = await business();
      const bytes = await controlledMenuPng();
      const origin = {
        sourceUrl: `${fixtureOrigin}/dish.png`,
        importSessionId: randomUUID(),
      };
      const original = await setupMediaRepository.upload(
        staff,
        bytes,
        { source: "UPLOAD", publicUse: "false", confirmed: "true" },
        origin,
      );
      const approved = await setupMediaRepository.upload(
        staff,
        bytes,
        { source: "UPLOAD", publicUse: "true", confirmed: "true" },
        { ...origin, importSessionId: randomUUID() },
      );
      expect(approved.id).not.toBe(original.id);
      expect(approved.provenance).toMatchObject({
        source: "IMPORT",
        originalAssetId: original.id,
        originalContentHash: original.contentHash,
      });
      expect(approved.approvedForPublicUse).toBe(true);
      expect(
        (
          await prisma.mediaAsset.findUniqueOrThrow({
            where: { id: original.id },
          })
        ).approvedForPublicUse,
      ).toBe(false);
      expect(
        Buffer.from(
          (
            await prisma.mediaAsset.findUniqueOrThrow({
              where: { id: approved.id },
            })
          ).bytes,
        ),
      ).toEqual(bytes);
      expect(
        (
          await setupMediaRepository.upload(
            staff,
            bytes,
            { source: "UPLOAD", publicUse: "true", confirmed: "true" },
            origin,
          )
        ).id,
      ).toBe(approved.id);
    }, 60_000);
    it("imports a linked text PDF through the real source repository and commits draft prices", async () => {
      const staff = await business();
      const { app } = harness(staff);
      try {
        let view = await analyze(app, staff, `${fixtureOrigin}/text-pdf`);
        expect(view.items).toHaveLength(2);
        expect(view.items[0]?.original).toMatchObject({
          extractionMethod: "PDF_TEXT",
          verification: "SOURCE_OBSERVED",
        });
        view = await businessImportRepository.review(
          staff,
          view.id,
          approve(view),
        );
        await commitBusinessImport(staff, view.id, view.version, true);
        expect(
          (
            await prisma.product.findMany({
              where: { tenantId: staff.tenantId, venueId: staff.venueId },
              orderBy: { sortOrder: "asc" },
            })
          ).map((p) => p.priceMinor),
        ).toEqual([950, 700]);
      } finally {
        await app.close();
      }
    }, 60_000);
    it("URL → deterministic proposal → correction → media approval → atomic draft → replay → safe restore", async () => {
      const staff = await business();
      const { app } = harness(staff);
      try {
        let view = await analyze(app, staff);
        expect(view.items).toHaveLength(2);
        expect(view.sources).toHaveLength(3);
        expect(
          await prisma.product.count({ where: { venueId: staff.venueId } }),
        ).toBe(0);
        expect(
          (
            await prisma.venue.findUniqueOrThrow({
              where: { id: staff.venueId },
            })
          ).name,
        ).toBe("Original venue");
        const image = view.businessData.images[0]!;
        const forbidden = await app.inject({
          method: "POST",
          url: `/v1/staff/business-imports/${view.id}/images/${image.id}`,
          payload: {
            expectedVersion: view.version,
            rightsConfirmed: false,
            publicUse: true,
          },
        });
        expect(forbidden.statusCode).toBe(400);
        const download = await app.inject({
          method: "POST",
          url: `/v1/staff/business-imports/${view.id}/images/${image.id}`,
          payload: {
            expectedVersion: view.version,
            rightsConfirmed: true,
            publicUse: true,
          },
        });
        expect(download.statusCode, download.body).toBe(200);
        view = await businessImportRepository.get(staff, view.id);
        const assetId = view.businessData.images[0]!.assetId!;
        const asset = await prisma.mediaAsset.findUniqueOrThrow({
          where: { id: assetId },
        });
        expect(Buffer.from(asset.bytes)).toEqual(await controlledMenuPng());
        expect(asset.source).toBe("IMPORT");
        expect(asset.approvedForPublicUse).toBe(true);
        expect(
          await prisma.venueMedia.count({ where: { venueId: staff.venueId } }),
        ).toBe(0);
        const review = approve(view);
        review.fields.find((f) => f.field === "venueName")!.value =
          "Owner corrected garden";
        review.media = [
          {
            candidateId: image.id,
            assetId,
            role: "HERO",
            targetItemId: null,
            rightsConfirmed: true,
          },
        ];
        view = await businessImportRepository.review(staff, view.id, review);
        const version = view.version;
        const committed = await commitBusinessImport(
          staff,
          view.id,
          version,
          true,
        );
        expect(committed.replayed).toBe(false);
        expect(
          (await commitBusinessImport(staff, view.id, version, true)).replayed,
        ).toBe(true);
        const products = await prisma.product.findMany({
          where: { venueId: staff.venueId },
          include: { translations: true },
        });
        expect(products).toHaveLength(2);
        expect(products.every((p) => !p.published && !p.available)).toBe(true);
        expect(products.every((p) => p.translations.length === 4)).toBe(true);
        const website = await prisma.venueWebsite.findUniqueOrThrow({
          where: { venueId: staff.venueId },
        });
        expect(website.status).toBe("DRAFT");
        expect(website.premiumStyleId).toBe("restaurant-2");
        expect(
          (
            await prisma.venue.findUniqueOrThrow({
              where: { id: staff.venueId },
            })
          ).name,
        ).toBe("Owner corrected garden");
        view = await businessImportRepository.get(staff, view.id);
        expect(
          (await revertBusinessImport(staff, view.id, view.version, true))
            .replayed,
        ).toBe(false);
        expect(
          (await revertBusinessImport(staff, view.id, view.version, true))
            .replayed,
        ).toBe(true);
        expect(
          (
            await prisma.product.findMany({ where: { venueId: staff.venueId } })
          ).every((p) => p.archivedAt && !p.published),
        ).toBe(true);
        expect(
          Buffer.from(
            (
              await prisma.mediaAsset.findUniqueOrThrow({
                where: { id: assetId },
              })
            ).bytes,
          ),
        ).toEqual(Buffer.from(asset.bytes));
        expect(
          (
            await prisma.venue.findUniqueOrThrow({
              where: { id: staff.venueId },
            })
          ).name,
        ).toBe("Original venue");
        expect(
          await prisma.auditEvent.count({
            where: {
              venueId: staff.venueId,
              action: "BUSINESS_IMPORT_REVERTED",
            },
          }),
        ).toBe(1);
      } finally {
        await app.close();
      }
    }, 60_000);
    it("rejects cross-tenant/session/source/media access, roles and SI1 commit bypass", async () => {
      const a = await business(),
        b = await business();
      const h = harness(a);
      try {
        const view = await analyze(h.app, a);
        h.identity(b);
        for (const url of [
          `/v1/staff/business-imports/${view.id}`,
          `/v1/staff/menu-imports/${view.id}/sources/${view.sources[0]!.id}`,
        ])
          expect((await h.app.inject({ url })).statusCode).toBe(404);
        expect(
          (
            await h.app.inject({
              method: "POST",
              url: `/v1/staff/business-imports/${view.id}/commit`,
              payload: { expectedVersion: view.version, confirm: true },
            })
          ).statusCode,
        ).toBe(404);
        h.identity({ ...a, role: "WAITER" });
        expect(
          (await h.app.inject({ url: `/v1/staff/business-imports/${view.id}` }))
            .statusCode,
        ).toBe(403);
        h.identity(a);
        expect(
          (
            await h.app.inject({
              method: "POST",
              url: `/v1/staff/menu-imports/${view.id}/import`,
              payload: { expectedVersion: view.version, confirm: true },
            })
          ).statusCode,
        ).toBe(409);
        await expect(
          businessImportRepository.review(a, view.id, {
            ...approve(view),
            media: [
              {
                candidateId: "foreign",
                assetId: "foreign",
                targetItemId: null,
                role: "HERO",
                rightsConfirmed: true,
              },
            ],
          }),
        ).rejects.toThrow();
      } finally {
        await h.app.close();
      }
    }, 60_000);
    it("detects canonical and review conflicts and rolls back all writes after a late failure", async () => {
      const staff = await business();
      const { app } = harness(staff);
      try {
        let view = await analyze(app, staff);
        const review = approve(view);
        await prisma.venue.update({
          where: { id: staff.venueId },
          data: { name: "Concurrent correction" },
        });
        await expect(
          businessImportRepository.review(staff, view.id, review),
        ).rejects.toThrow(/changed/i);
        view = await businessImportRepository.get(staff, view.id);
        const corrected = approve(view);
        corrected.items[1]!.item.name = corrected.items[0]!.item.name;
        view = await businessImportRepository.review(staff, view.id, corrected);
        // The second overlapping product is detected after the first insert, inside the transaction.
        await expect(
          commitBusinessImport(staff, view.id, view.version, true),
        ).rejects.toThrow(/overlapping/i);
        expect(
          await prisma.product.count({ where: { venueId: staff.venueId } }),
        ).toBe(0);
        expect(
          await prisma.menuCategory.count({
            where: { venueId: staff.venueId },
          }),
        ).toBe(0);
        expect(
          (
            await prisma.venue.findUniqueOrThrow({
              where: { id: staff.venueId },
            })
          ).name,
        ).toBe("Concurrent correction");
      } finally {
        await app.close();
      }
    }, 60_000);
    it("updates only the explicitly chosen draft and restores its exact prior configuration", async () => {
      const staff = await business();
      const { app } = harness(staff);
      try {
        let first = await analyze(app, staff);
        first = await businessImportRepository.review(
          staff,
          first.id,
          approve(first),
        );
        await commitBusinessImport(staff, first.id, first.version, true);
        const product = await prisma.product.findFirstOrThrow({
          where: { venueId: staff.venueId },
          include: { translations: true },
        });
        let next = await analyze(app, staff);
        const review = approve(next);
        review.items.forEach((row) => {
          row.action = "SKIP";
        });
        const row = review.items[0]!;
        row.action = "UPDATE";
        row.targetProductId = product.id;
        row.item.name = "Corrected existing dish";
        row.item.priceMinor = 1850;
        row.item.duplicateAcknowledged = true;
        next = await businessImportRepository.review(staff, next.id, review);
        await commitBusinessImport(staff, next.id, next.version, true);
        expect(
          await prisma.product.count({ where: { venueId: staff.venueId } }),
        ).toBe(2);
        expect(
          (
            await prisma.product.findUniqueOrThrow({
              where: { id: product.id },
            })
          ).priceMinor,
        ).toBe(1850);
        next = await businessImportRepository.get(staff, next.id);
        await revertBusinessImport(staff, next.id, next.version, true);
        expect(
          (
            await prisma.product.findUniqueOrThrow({
              where: { id: product.id },
              include: { translations: true },
            })
          ).priceMinor,
        ).toBe(product.priceMinor);
      } finally {
        await app.close();
      }
    }, 60_000);
    it("blocks shared-profile restore when a new tenant venue was created after import", async () => {
      const staff = await business();
      const { app } = harness(staff);
      try {
        let view = await analyze(app, staff);
        const review = approve(view);
        const profile = review.fields.find((f) => f.field === "businessType")!;
        profile.value = "CAFE";
        profile.decision = "APPROVE";
        view = await businessImportRepository.review(staff, view.id, review);
        await commitBusinessImport(staff, view.id, view.version, true);
        view = await businessImportRepository.get(staff, view.id);
        await prisma.venue.create({
          data: {
            tenantId: staff.tenantId,
            name: "New synthetic venue",
            slug: "new-test-venue",
          },
        });
        await expect(
          revertBusinessImport(staff, view.id, view.version, true),
        ).rejects.toThrow("changed or was used");
        expect(
          (
            await prisma.tenant.findUniqueOrThrow({
              where: { id: staff.tenantId },
            })
          ).businessProfileId,
        ).toBe("CAFE");
        expect(
          (await businessImportRepository.get(staff, view.id)).businessData
            .phase,
        ).toBe("COMMITTED");
      } finally {
        await app.close();
      }
    }, 60_000);
    it("blocks restore after subsequent owner edits and keeps the import receipt", async () => {
      const staff = await business();
      const { app } = harness(staff);
      try {
        let view = await analyze(app, staff);
        view = await businessImportRepository.review(
          staff,
          view.id,
          approve(view),
        );
        await commitBusinessImport(staff, view.id, view.version, true);
        view = await businessImportRepository.get(staff, view.id);
        await prisma.product.update({
          where: { id: view.canonical.products[0]!.id },
          data: { priceMinor: 999 },
        });
        await expect(
          revertBusinessImport(staff, view.id, view.version, true),
        ).rejects.toThrow(/changed/i);
        expect(
          (
            await prisma.importSession.findUniqueOrThrow({
              where: { id: view.id },
            })
          ).businessReceipt,
        ).not.toBeNull();
      } finally {
        await app.close();
      }
    }, 60_000);
    it("resumes interrupted analysis and rejects stale completion/cancellation", async () => {
      const staff = await business();
      let view = await businessImportRepository.create(staff, {
        requestKey: randomUUID(),
        locale: "en",
        url: fixtureOrigin,
        authorized: true,
      });
      const key = randomUUID();
      const first = await businessImportRepository.begin(
        staff,
        view.id,
        view.version,
        key,
      );
      expect(first.claimed).toBe(true);
      expect(
        (
          await businessImportRepository.begin(
            staff,
            view.id,
            view.version,
            key,
          )
        ).claimed,
      ).toBe(false);
      await prisma.importSession.update({
        where: { id: view.id },
        data: { extractionStartedAt: new Date(Date.now() - 300_000) },
      });
      view = await businessImportRepository.get(staff, view.id);
      expect(view.businessData.phase).toBe("SOURCES");
      expect(view.errorCode).toBe("INTERRUPTED");
      await expect(
        businessImportRepository.finish(staff, view.id, key, {
          fields: [],
          images: [],
          menu: { schemaVersion: 1, categories: [], items: [] },
          warnings: [],
          provenance: {},
        }),
      ).rejects.toThrow();
      await businessImportRepository.begin(
        staff,
        view.id,
        view.version,
        randomUUID(),
      );
      view = await businessImportRepository.get(staff, view.id);
      await businessImportRepository.cancel(staff, view.id, view.version);
      expect(
        (await businessImportRepository.get(staff, view.id)).businessData.phase,
      ).toBe("SOURCES");
    }, 60_000);
    it("reuses SI1 photo input/provider validation and supports manual additions without a provider", async () => {
      const staff = await business();
      const provider = new ControlledMenuExtractor();
      const { app } = harness(staff, provider);
      try {
        let view = await businessImportRepository.create(staff, {
          requestKey: randomUUID(),
          locale: "en",
          url: null,
          authorized: true,
        });
        await menuImportRepository.upload(
          staff,
          view.id,
          view.version,
          await inspectMenuSource(
            await controlledMenuPng(),
            "menu.png",
            "image/png",
          ),
        );
        view = await businessImportRepository.get(staff, view.id);
        const response = await app.inject({
          method: "POST",
          url: `/v1/staff/business-imports/${view.id}/analyze`,
          payload: { expectedVersion: view.version, requestKey: randomUUID() },
        });
        expect(response.statusCode).toBe(202);
        for (let i = 0; i < 200; i++) {
          view = await businessImportRepository.get(staff, view.id);
          if (view.businessData.phase === "REVIEW") break;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(view.items.length).toBeGreaterThan(0);
        expect(view.items[0]?.original).toMatchObject({
          extractionMethod: "AI",
          verification: "UNVERIFIED",
        });
        const key = randomUUID();
        const item = approve(view).items[0]!.item;
        const savedReview = approve(view);
        savedReview.confirm = false;
        savedReview.fields.find((f) => f.field === "venueName")!.value =
          "Saved owner correction";
        savedReview.fields.find((f) => f.field === "venueName")!.decision =
          "APPROVE";
        view = await businessImportRepository.review(
          staff,
          view.id,
          savedReview,
        );
        view = await businessImportRepository.addManual(
          staff,
          view.id,
          view.version,
          key,
          item,
        );
        const count = view.items.length;
        expect(
          view.businessData.review?.fields.find((f) => f.field === "venueName")
            ?.value,
        ).toBe("Saved owner correction");
        view = await businessImportRepository.addManual(
          staff,
          view.id,
          view.version - 1,
          key,
          item,
        );
        expect(view.items).toHaveLength(count);
      } finally {
        await app.close();
      }
    }, 60_000);
  },
);
