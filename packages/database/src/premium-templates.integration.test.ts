import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  premiumCatalog,
  BusinessProvisionConflict,
} from "@flowgastronomie/domain";
import { prisma } from "./client.js";
import { provisionBusiness } from "./business-provisioner.js";
import { canonicalMediaRepository } from "./canonical-media-repository.js";
import { venueWebsiteRepository } from "./venue-website-repository.js";
import { websiteDraftHistory } from "./website-draft-history.js";
import type { StaffIdentity } from "./staff-auth-repository.js";

describe.skipIf(process.env.PREMIUM_DB_GATE !== "true")(
  "premium canonical provisioning",
  () => {
    afterAll(() => prisma.$disconnect());
    const makeInput = (
      profileId: ReturnType<typeof premiumCatalog>[number]["profileId"],
      styleId: string,
      includeSampleMenu = true,
    ) => ({
      requestKey: `premium-gate:${randomUUID()}`,
      organizationName: "Owner business",
      venueName: "Owner venue",
      ownerDisplayName: "Owner",
      email: `owner-${randomUUID()}@premium.test`,
      password: "premium-acceptance-password",
      locale: "sq" as const,
      countryCode: "DE",
      timezone: "Europe/Berlin",
      currency: "EUR",
      plan: "RESTAURANT_PRO" as const,
      profileId,
      applyCategories: false,
      premiumTemplate: {
        styleId,
        version: 1 as const,
        confirmed: true as const,
        includeSampleMenu,
      },
    });
    const actor = (b: Awaited<ReturnType<typeof provisionBusiness>>) =>
      ({
        tenantId: b.tenant.id,
        venueId: b.venue.id,
        userId: b.owner.id,
        membershipId: b.membership.id,
        role: "OWNER",
      }) as StaffIdentity;
    it("creates all 30 styles as fresh scoped drafts, with four translations and no operational records", async () => {
      for (const pack of premiumCatalog())
        for (const style of pack.styles) {
          const input = makeInput(pack.profileId, style.id);
          const created = await provisionBusiness(input);
          const scope = {
            tenantId: created.tenant.id,
            venueId: created.venue.id,
          };
          expect(created.venue).toMatchObject({
            countryCode: "DE",
            name: "Owner venue",
            defaultServiceMode: "MENU_ONLY",
            onlinePickupEnabled: false,
          });
          const website = await prisma.venueWebsite.findFirstOrThrow({
            where: scope,
            include: { translations: true },
          });
          expect(website).toMatchObject({
            status: "DRAFT",
            premiumStyleId: style.id,
            phone: null,
            address: null,
            contactEmail: null,
          });
          expect(website.translations).toHaveLength(4);
          const products = await prisma.product.findMany({
            where: scope,
            include: { translations: true },
          });
          expect(products).toHaveLength(
            pack.categories.reduce((n, c) => n + c.products.length, 0),
          );
          for (const p of products) {
            expect(p.published).toBe(false);
            expect(p.available).toBe(false);
            expect(p.translations).toHaveLength(4);
            expect(
              p.translations.every((t) => t.name.startsWith("SAMPLE ·")),
            ).toBe(true);
          }
          expect(await prisma.order.count({ where: scope })).toBe(0);
          expect(await prisma.onlineOrder.count({ where: scope })).toBe(0);
          expect(await prisma.diningTable.count({ where: scope })).toBe(0);
          const media = await canonicalMediaRepository.resolve(actor(created));
          expect(media.products).toHaveLength(
            pack.categories.flatMap((c) => c.products).filter((p) => p.photoKey)
              .length,
          );
          for (const photo of media.products) {
            expect(photo.media.source).toBe("DEMO");
            expect(photo.media.approvedForPublicUse).toBe(false);
            expect(
              await canonicalMediaRepository.content(photo.media.id),
            ).toBeNull();
            expect(products.some((p) => p.id === photo.productId)).toBe(true);
          }
          expect(media.venue).toHaveLength(
            pack.profileId === "GENERIC" ? 0 : 1,
          );
          if (media.venue[0]) {
            expect(media.venue[0].media.source).toBe("DEMO");
            expect(media.venue[0].media.approvedForPublicUse).toBe(false);
            expect(
              await canonicalMediaRepository.content(media.venue[0].media.id),
            ).toBeNull();
          }
          expect((await provisionBusiness(input)).tenant.id).toBe(
            created.tenant.id,
          );
          await expect(
            provisionBusiness({ ...input, venueName: "Changed" }),
          ).rejects.toBeInstanceOf(BusinessProvisionConflict);
        }
    }, 120000);
    it("supports empty starts, preserves owner edits on retries, denies cross-tenant history/media, and restores drafts with optimistic conflict checks", async () => {
      const input = makeInput("CAFE", "cafe-1", false);
      const a = await provisionBusiness(input);
      const b = await provisionBusiness(makeInput("BAR", "bar-1"));
      const staff = actor(a);
      const other = actor(b);
      expect(
        await prisma.product.count({ where: { tenantId: a.tenant.id } }),
      ).toBe(0);
      const original = await venueWebsiteRepository.getEditor(staff);
      await venueWebsiteRepository.update({
        staff,
        website: {
          ...original,
          expectedUpdatedAt: original.updatedAt,
          primaryColor: "#112233",
        },
      });
      expect((await provisionBusiness(input)).created).toBe(false);
      expect((await venueWebsiteRepository.getEditor(staff)).primaryColor).toBe(
        "#112233",
      );
      await expect(
        venueWebsiteRepository.update({
          staff,
          website: { ...original, expectedUpdatedAt: original.updatedAt },
        }),
      ).rejects.toThrow("changed");
      const [revision] = await websiteDraftHistory.list(staff);
      const current = await venueWebsiteRepository.getEditor(staff);
      await expect(
        websiteDraftHistory.revert(other, {
          revisionId: revision!.id,
          expectedUpdatedAt: current.updatedAt,
          confirmed: true,
        }),
      ).rejects.toThrow();
      const restored = await websiteDraftHistory.revert(staff, {
        revisionId: revision!.id,
        expectedUpdatedAt: current.updatedAt,
        confirmed: true,
      });
      expect(restored.primaryColor).toBe(original.primaryColor);
      expect(restored.status).toBe("DRAFT");
      const media = await canonicalMediaRepository.resolve(staff);
      expect(
        await canonicalMediaRepository.content(media.venue[0]!.media.id, other),
      ).toBeNull();
      await expect(
        provisionBusiness({ ...makeInput("CAFE", "bar-1") }),
      ).rejects.toThrow();
      await expect(
        provisionBusiness({ ...makeInput("CAFE", "cafe-1"), currency: "ALL" }),
      ).rejects.toThrow();
      expect(
        (
          await provisionBusiness({
            ...makeInput("CAFE", "cafe-1", false),
            currency: "ALL",
          })
        ).venue.currency,
      ).toBe("ALL");
    }, 30000);
  },
);
