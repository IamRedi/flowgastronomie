import { afterAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { prisma } from "./client.js";
import { provisionCanonicalFixture } from "../../../tests/foundation/canonical-fixture.js";
import { staffAuthRepository } from "./staff-auth-repository.js";
import { staffOrderRepository } from "./staff-order-repository.js";
import { canonicalMediaRepository } from "./canonical-media-repository.js";
import { deriveDemoLogo } from "./demo-logo.js";
const env = {
  ...process.env,
  NODE_ENV: "development",
  FOUNDATION_LOCAL_ENABLE: "1",
  CI: undefined,
};
describe.skipIf(process.env.FOUNDATION_DB_GATE !== "true")(
  "BF4 canonical Synthetic Pizza Fixture",
  () => {
    afterAll(() => prisma.$disconnect());
    it("provisions independent identity/menu/media and refuses CI/production", async () => {
      const input = {
        ownerPassword: "fixture-owner-local-test",
        managerPassword: "fixture-manager-local-test",
        logo: await readFile("../../tests/foundation/synthetic-logo.jpg"),
        margheritaDemoImage: await readFile(
          "../../apps/web/public/pilot/demo-food/margherita.webp",
        ),
      };
      const a = await provisionCanonicalFixture(input, env);
      const b = await provisionCanonicalFixture(input, env);
      expect(a.tenantId).toBe(b.tenantId);
      expect(a.tenantId).not.toBe("demo-tenant");
      expect(b.created).toBe(false);
      const venue = await prisma.venue.findUniqueOrThrow({
        where: { id: a.venueId },
        include: {
          website: true,
          tenant: true,
          products: {
            include: {
              translations: true,
              media: { include: { asset: true } },
            },
          },
        },
      });
      expect(venue.tenant.kind).toBe("DEMO");
      expect(venue.name).toBe("Synthetic Pizza Fixture");
      expect(venue.city).toBe("Sample City");
      expect(venue).toMatchObject({
        timezone: "Europe/Berlin",
        currency: "EUR",
      });
      expect(venue.website?.address).toBe(
        "Sample Street 1, 12345 Sample City, Germany",
      );
      expect(venue.website?.phone).toBe("+49 30 000000");
      expect(venue.website?.status).toBe("DRAFT");
      const margherita = venue.products[0]!;
      expect(margherita.translations[0]?.name).toBe("Margherita");
      expect(margherita.priceMinor).toBe(950);
      expect(margherita.currency).toBe("EUR");
      expect(margherita.dataProvenance).toMatchObject({
        priceSource: "DEMO_FIXTURE",
        reviewOnly: true,
      });
      expect(margherita.media[0]?.asset.source).toBe("DEMO");
      const login = await staffAuthRepository.login({
        ...a,
        email: "owner@fixture.example",
        password: input.ownerPassword,
      });
      expect(login.staff.venueName).toBe("Synthetic Pizza Fixture");
      expect(login.staff.venueLogoUrl).toContain("/v1/media/");
      const menu = await staffOrderRepository.posMenu(login.staff, "de");
      const media = await canonicalMediaRepository.resolve(a);
      const originalLogoId = media.venue.find((row) => row.role === "LOGO")!
        .media.id;
      const originalLogo = await prisma.mediaAsset.findUniqueOrThrow({
        where: { id: originalLogoId },
      });
      const derivative = await deriveDemoLogo(
        login.staff,
        originalLogoId,
        input.logo,
        env,
      );
      expect(derivative.mimeType).toBe("image/png");
      expect(derivative.approvedForPublicUse).toBe(false);
      expect(derivative.provenance).toMatchObject({
        originalAssetId: originalLogoId,
        originalContentHash: originalLogo.contentHash,
        transformation: "EDGE_CONNECTED_BLACK_TO_ALPHA_V1",
      });
      expect(
        (await canonicalMediaRepository.resolve(a)).venue.find(
          (row) => row.role === "LOGO",
        )?.media.id,
      ).toBe(derivative.id);
      expect(
        (await deriveDemoLogo(login.staff, originalLogoId, input.logo, env)).id,
      ).toBe(derivative.id);
      expect(
        await prisma.mediaAsset.findUniqueOrThrow({
          where: { id: originalLogoId },
        }),
      ).toEqual(originalLogo);
      await expect(
        deriveDemoLogo(login.staff, originalLogoId, input.logo, {
          ...env,
          NODE_ENV: "production",
        }),
      ).rejects.toThrow();
      await expect(
        deriveDemoLogo(
          { ...login.staff, tenantId: "foreign" },
          originalLogoId,
          input.logo,
          env,
        ),
      ).rejects.toThrow();
      expect(menu.categories[0]?.products[0]).toMatchObject({
        id: margherita.id,
        priceMinor: 950,
        media: media.products[0]?.media,
      });
      expect(
        await prisma.onlineOrder.count({ where: { tenantId: a.tenantId } }),
      ).toBe(0);
      await expect(
        provisionCanonicalFixture(input, { ...env, CI: "true" }),
      ).rejects.toThrow();
      await expect(
        provisionCanonicalFixture(input, { ...env, NODE_ENV: "production" }),
      ).rejects.toThrow();
    });
  },
);
