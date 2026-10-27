import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import {
  prisma,
  creativeScope,
  beginCreativeJob,
  type StaffIdentity,
  creativeRepository,
  setTenantImageLimit,
  tenantImageUsage,
} from "@flowgastronomie/database";
import { createDesign } from "@flowgastronomie/domain";
import { provisionBusinessInTransaction } from "../../../packages/database/src/business-provisioner.js";
import {
  generateProductImage,
  productImageHistory,
  approveProductImage,
} from "./product-ai-image-service.js";
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
    data: { published: false },
  });
  const product = await prisma.product.create({
    data: {
      tenantId: staff.tenantId,
      venueId: staff.venueId,
      categoryId: category.id,
      station: "KITCHEN",
      priceMinor: 950,
      currency: "ALL",
      published: false,
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

describe.skipIf(process.env.CREATIVE_DB_GATE !== "true")(
  "Product AI durable jobs",
  () => {
    afterAll(() => prisma.$disconnect());
    it("uses one call, recovers the same asset, requires approval, isolates tenants and enforces shared daily quota", async () => {
      const a = await business("REAL"),
        b = await business("REAL");
      const bytes = await sharp({
        create: {
          width: 1024,
          height: 1024,
          channels: 3,
          background: "#224433",
        },
      })
        .png()
        .toBuffer();
      const provider = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: [{ b64_json: bytes.toString("base64") }],
              usage: { input_tokens: 1, output_tokens: 1 },
            }),
            { status: 200 },
          ),
      );
      vi.stubGlobal("fetch", provider);
      vi.stubEnv("CREATIVE_OPENAI_API_KEY", "controlled-fixture-not-a-key");
      try {
        const input = {
          prompt: "Pizza Margherita",
          requestKey: randomUUID(),
          locale: "en" as const,
        };
        const asset = await generateProductImage(a.staff, a.product.id, input);
        expect(asset).toMatchObject({
          source: "GENERATED",
          approvedForPublicUse: false,
          provenance: { catalog: { kind: "PRODUCT", productId: a.product.id } },
        });
        expect(
          await prisma.productMedia.count({
            where: { productId: a.product.id },
          }),
        ).toBe(0);
        const replay = await generateProductImage(a.staff, a.product.id, input);
        expect(replay.id).toBe(asset.id);
        expect(provider).toHaveBeenCalledTimes(1);
        const history = await productImageHistory(a.staff, a.product.id);
        expect(history.jobs[0]).toMatchObject({
          state: "SUCCEEDED",
          resultId: asset.id,
        });
        await expect(
          productImageHistory(b.staff, a.product.id),
        ).rejects.toThrow("NOT_FOUND");
        await expect(
          generateProductImage(b.staff, a.product.id, input),
        ).rejects.toThrow("NOT_FOUND");
        await expect(
          approveProductImage(b.staff, b.product.id, asset.id),
        ).rejects.toThrow("NOT_FOUND");
        const media = await approveProductImage(
          a.staff,
          a.product.id,
          asset.id,
        );
        expect(media).toMatchObject({
          source: "GENERATED",
          approvedForPublicUse: true,
        });
        expect(
          (await approveProductImage(a.staff, a.product.id, asset.id)).id,
        ).toBe(media.id);
        const stored = await prisma.mediaAsset.findUniqueOrThrow({
          where: { id: media.id },
        });
        expect(stored.provenance).toMatchObject({
          provider: "openai",
          generatedAt: expect.any(String),
          promptHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        });
        const job = await prisma.creativeJob.findUniqueOrThrow({
          where: { id: history.jobs[0]!.id },
        });
        await prisma.creativeJob.createMany({
          data: Array.from({ length: 9 }, () => ({
            ...creativeScope(a.staff),
            projectId: job.projectId,
            requestKey: randomUUID(),
            category: "IMAGE",
            provider: "openai",
            model: "gpt-image-2.5-flare",
            state: "FAILED",
            usage: {},
            createdBy: a.staff.userId,
            createdAt: new Date(Date.now() - 120_000),
          })),
        });
        await expect(
          beginCreativeJob(
            a.staff,
            job.projectId,
            randomUUID(),
            "IMAGE",
            "openai",
            "gpt-image-2.5-flare",
          ),
        ).rejects.toThrow("Daily AI limit");
        expect(
          (await generateProductImage(a.staff, a.product.id, input)).id,
        ).toBe(asset.id);
        expect(provider).toHaveBeenCalledTimes(1);
        expect(
          await prisma.product.count({ where: { ...creativeScope(a.staff) } }),
        ).toBe(1);
      } finally {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
      }
    }, 30000);
    it("reserves a changed tenant limit atomically across parallel projects and isolates businesses", async () => {
      const a = await business("REAL"),
        b = await business("REAL");
      const document = createDesign("SQUARE", "en");
      const [first, second, other] = await Promise.all([
        creativeRepository.create(a.staff, "A one", document),
        creativeRepository.create(a.staff, "A two", document),
        creativeRepository.create(b.staff, "B", document),
      ]);
      await setTenantImageLimit(
        a.staff.tenantId,
        "meta",
        1,
        true,
        "platform-test",
      );
      const requests = await Promise.allSettled([
        beginCreativeJob(
          a.staff,
          first.id,
          randomUUID(),
          "IMAGE",
          "meta",
          "muse-image-1.0",
          randomUUID(),
        ),
        beginCreativeJob(
          a.staff,
          second.id,
          randomUUID(),
          "IMAGE",
          "meta",
          "muse-image-1.0",
          randomUUID(),
        ),
      ]);
      expect(requests.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(requests.filter((r) => r.status === "rejected")).toHaveLength(1);
      expect(
        await prisma.creativeJob.count({
          where: {
            tenantId: a.staff.tenantId,
            category: "IMAGE",
            provider: "meta",
          },
        }),
      ).toBe(1);
      expect(
        (await tenantImageUsage(a.staff.tenantId)).providers.find(
          (p) => p.provider === "meta",
        ),
      ).toMatchObject({ used: 1, limit: 1 });
      expect(
        (
          await beginCreativeJob(
            b.staff,
            other.id,
            randomUUID(),
            "IMAGE",
            "meta",
            "muse-image-1.0",
            randomUUID(),
          )
        ).existing,
      ).toBe(false);
      await setTenantImageLimit(
        a.staff.tenantId,
        "meta",
        0,
        false,
        "platform-test",
      );
      expect(
        (await tenantImageUsage(a.staff.tenantId)).providers.find(
          (p) => p.provider === "meta",
        ),
      ).toMatchObject({ limit: 0, enabled: false });
    }, 30000);
  },
);
