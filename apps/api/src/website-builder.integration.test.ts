import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  prisma,
  staffMenuRepository,
  venueWebsiteRepository as sites,
  websiteDraftHistory,
  canonicalMediaRepository,
  storeCanonicalMedia,
  normalizeCanonicalImage,
  type StaffIdentity,
} from "@flowgastronomie/database";
import {
  legacyWebsiteDocument,
  websiteTemplate,
  PLATFORM_LOCALES,
  type WebsitePlan,
  replaceWebsiteSectionCopy,
} from "@flowgastronomie/domain";
import { provisionBusiness } from "../../../packages/database/src/business-provisioner.js";
import { proposeWebsiteAi } from "./website-ai-service.js";

describe.skipIf(process.env.PREMIUM_DB_GATE !== "true")(
  "universal website draft and publication boundary",
  () => {
    afterAll(() => prisma.$disconnect());
    async function business(profileId: "PIZZERIA" | "CAFE") {
      const b = await provisionBusiness({
        requestKey: randomUUID(),
        organizationName: "Synthetic content",
        venueName: `Synthetic ${profileId}`,
        ownerDisplayName: "Owner",
        email: `${randomUUID()}@content.test`,
        password: "synthetic-content-password",
        locale: "en",
        timezone: "Europe/Berlin",
        currency: "EUR",
        plan: "RESTAURANT_PRO",
        profileId,
        applyCategories: false,
      });
      return {
        tenantId: b.tenant.id,
        venueId: b.venue.id,
        userId: b.owner.id,
        membershipId: b.membership.id,
        role: "OWNER",
      } as StaffIdentity;
    }
    async function photo(staff: StaffIdentity, color: string) {
      const image = await normalizeCanonicalImage(
        await sharp({
          create: { width: 120, height: 90, channels: 3, background: color },
        })
          .webp()
          .toBuffer(),
      );
      return prisma.$transaction((tx) =>
        storeCanonicalMedia(tx, staff, {
          image,
          sourceKey: `test:${image.contentHash}`,
          provenance: { source: "UPLOAD", description: "Synthetic test image" },
          confirmed: true,
          approvedForPublicUse: true,
        }),
      );
    }
    it("isolates two profiles, preserves published snapshots through edits/restores and protects draft media", async () => {
      const staff = await business("PIZZERIA"),
        other = await business("CAFE");
      const original = await sites.getEditor(staff);
      const translations = PLATFORM_LOCALES.map((locale) => ({
        locale,
        heroTitle: "Synthetic venue",
        heroSubtitle: "A test description",
        storyTitle: "About",
        storyBody: "Verified text",
        seoTitle: "Synthetic venue",
        seoDescription: "A test description",
      }));
      const document = legacyWebsiteDocument(translations);
      const first = await photo(staff, "red"),
        second = await photo(staff, "blue"),
        foreign = await photo(other, "green");
      document.sections[0]!.media = [
        { assetId: first.id, alt: "Fixture", x: 50, y: 50 },
      ];
      let saved = await sites.update({
        staff,
        website: {
          ...original,
          translations,
          document,
          expectedUpdatedAt: original.updatedAt,
        },
      });
      expect(await canonicalMediaRepository.content(first.id)).toBeNull();
      const otherBefore = await sites.getEditor(other);
      await expect(
        sites.update({
          staff: other,
          website: {
            ...otherBefore,
            document,
            expectedUpdatedAt: otherBefore.updatedAt,
          },
        }),
      ).rejects.toThrow();
      await expect(
        sites.update({ staff: { ...staff, role: "WAITER" }, website: saved }),
      ).rejects.toThrow();
      saved = await sites.publish(staff);
      const published = await sites.findPublic(saved.publicSlug, "en");
      expect(published?.document?.sections[0]!.media[0]!.assetId).toBe(
        first.id,
      );
      expect((await canonicalMediaRepository.content(first.id))?.id).toBe(
        first.id,
      );
      const next = structuredClone(document);
      next.sections[0]!.media[0]!.assetId = second.id;
      next.sections[1]!.content[0]!.body = "A changed draft";
      saved = await sites.update({
        staff,
        website: {
          ...saved,
          document: next,
          expectedUpdatedAt: saved.updatedAt,
        },
      });
      expect(await sites.findPublic(saved.publicSlug, "en")).toEqual(published);
      expect(await canonicalMediaRepository.content(second.id)).toBeNull();
      expect(
        await canonicalMediaRepository.content(foreign.id, staff),
      ).toBeNull();
      await expect(
        sites.update({
          staff,
          website: { ...saved, expectedUpdatedAt: original.updatedAt },
        }),
      ).rejects.toThrow();
      const history = await websiteDraftHistory.list(staff);
      saved = await websiteDraftHistory.revert(staff, {
        revisionId: history[0]!.id,
        expectedUpdatedAt: saved.updatedAt,
        confirmed: true,
      });
      expect(saved.document).toEqual(document);
      expect(await sites.findPublic(saved.publicSlug, "en")).toEqual(published);
      expect(await sites.getEditor(other)).toEqual(otherBefore);
      expect(
        await prisma.product.count({ where: { tenantId: staff.tenantId } }),
      ).toBe(0);
      expect(
        await prisma.order.count({ where: { tenantId: staff.tenantId } }),
      ).toBe(0);
    });
    it("records reviewable plans with replay, version checks and granular localized changes", async () => {
      const staff = await business("CAFE");
      let website = await sites.getEditor(staff);
      website = await sites.update({
        staff,
        website: {
          ...website,
          document: legacyWebsiteDocument(website.translations),
          expectedUpdatedAt: website.updatedAt,
        },
      });
      const plan: WebsitePlan = {
        styleId: "cafe-1",
        typography: "SERIF",
        sections: website.document!.sections.map((s) => ({
          type: s.type,
          layout: s.layout,
          content: s.content.map((c) => ({
            ...c,
            title: `${s.type} title`,
            body: "Verified test copy",
          })),
        })),
        seo: PLATFORM_LOCALES.map((locale) => ({
          locale,
          title: "Synthetic cafe",
          description: "Synthetic test",
        })),
      };
      let calls = 0;
      const provider = {
        provider: "controlled",
        model: "website-test",
        propose: async () => {
          calls++;
          return {
            title: "Cafe",
            description: "Verified text",
            plan,
            inputTokens: 20,
            outputTokens: 40,
          };
        },
      };
      const input = {
        requestKey: randomUUID(),
        expectedUpdatedAt: website.updatedAt,
        locale: "en",
        operation: "SITE",
        instruction: "Warm editorial style",
        description: "A synthetic cafe",
      };
      const proposal = await proposeWebsiteAi(
        staff,
        { ...input, designOnly: true },
        provider,
      );
      expect(proposal.designOnly).toBe(true);
      const retained = await prisma.auditEvent.findUniqueOrThrow({
        where: { id: proposal.id },
      });
      expect((retained.metadata as { designOnly: boolean }).designOnly).toBe(
        true,
      );
      expect(calls).toBe(1);
      expect((await sites.getEditor(staff)).document).toEqual(website.document);
      const changed = replaceWebsiteSectionCopy(
        website.document!,
        "about",
        "de",
        { title: "Cafe", body: "Verified text" },
        {
          proposalId: proposal.id,
          provider: proposal.provider,
          model: proposal.model,
          approved: true,
        },
      );
      const before = website.document;
      website = await sites.update({
        staff,
        website: {
          ...website,
          document: changed,
          sourceProposalId: proposal.id,
          expectedUpdatedAt: website.updatedAt,
        },
      });
      expect(website.document!.sections[0]).toEqual(before!.sections[0]);
      expect(
        await proposeWebsiteAi(staff, { ...input, designOnly: true }, provider),
      ).toEqual(proposal);
      expect(calls).toBe(1);
      await expect(
        proposeWebsiteAi(
          staff,
          { ...input, instruction: "Changed request" },
          provider,
        ),
      ).rejects.toThrow();
      const forged = structuredClone(changed);
      forged.sections[1]!.generation!.model = "forged";
      await expect(
        sites.update({
          staff,
          website: {
            ...website,
            document: forged,
            expectedUpdatedAt: website.updatedAt,
          },
        }),
      ).rejects.toThrow();
    });
    it("versions presentation independently and rejects stale or cross-tenant canonical product edits", async () => {
      const staff = await business("CAFE"),
        other = await business("PIZZERIA");
      let website = await sites.getEditor(staff);
      const template = websiteTemplate({
        profileId: "CAFE",
        styleId: "cafe-1",
        venueName: "Synthetic cafe",
        translations: website.translations,
      });
      website = await sites.update({
        staff,
        website: {
          ...website,
          document: template.document,
          designVersion: 2,
          translations: PLATFORM_LOCALES.map((locale) => ({
            locale,
            heroTitle: "Synthetic",
            heroSubtitle: "Selection",
            storyTitle: "Welcome",
            storyBody: "Selection",
            seoTitle: "Synthetic",
            seoDescription: "Selection",
          })),
        },
      });
      expect(website.designVersion).toBe(2);
      website = await sites.publish(staff, website.updatedAt);
      const published = await sites.findPublic(website.publicSlug, "en");
      expect(published?.designVersion).toBe(2);
      const category = await staffMenuRepository.createCategory({
        staff,
        published: false,
        sortOrder: 0,
        translations: PLATFORM_LOCALES.map((locale) => ({
          locale,
          name: "Synthetic",
        })),
      });
      const product = await staffMenuRepository.createProduct({
        staff,
        categoryId: category.id,
        published: false,
        available: true,
        sortOrder: 0,
        station: "KITCHEN",
        priceMinor: 300,
        translations: PLATFORM_LOCALES.map((locale) => ({
          locale,
          name: "Synthetic",
          description: null,
        })),
      });
      const input = {
        categoryId: product.categoryId,
        priceMinor: product.priceMinor,
        sortOrder: product.sortOrder,
        available: product.available,
        published: product.published,
        station: product.station,
        translations: product.translations,
      };
      await staffMenuRepository.updateProduct({
        ...input,
        staff,
        productId: product.id,
        priceMinor: 350,
        expectedRevision: product.revision,
      });
      await expect(
        staffMenuRepository.updateProduct({
          ...input,
          staff,
          productId: product.id,
          priceMinor: 400,
          expectedRevision: product.revision,
        }),
      ).rejects.toThrow("changed");
      await expect(
        staffMenuRepository.updateProduct({
          ...input,
          staff: other,
          productId: product.id,
        }),
      ).rejects.toThrow();
      expect(
        (await prisma.product.findUniqueOrThrow({ where: { id: product.id } }))
          .priceMinor,
      ).toBe(350);
      expect(await sites.findPublic(website.publicSlug, "en")).toEqual(
        published,
      );
    });
    it("keeps a published legacy site identical until an explicit new publication", async () => {
      const staff = await business("PIZZERIA");
      const original = await sites.getEditor(staff);
      const translations = PLATFORM_LOCALES.map((locale) => ({
        locale,
        heroTitle: "Legacy venue",
        heroSubtitle: "Original subtitle",
        storyTitle: "Original story",
        storyBody: "Original description",
        seoTitle: "Legacy venue",
        seoDescription: "Original description",
      }));
      let website = await sites.update({
        staff,
        website: {
          ...original,
          translations,
          contactEmail: "synthetic@example.invalid",
          expectedUpdatedAt: original.updatedAt,
        },
      });
      website = await sites.publish(staff);
      const published = await sites.findPublic(website.publicSlug, "en");
      expect(published?.document).toBeNull();
      const oldVersion = website.updatedAt;
      website = await sites.update({
        staff,
        website: {
          ...website,
          document: legacyWebsiteDocument(translations),
          designVersion: 2,
          expectedUpdatedAt: website.updatedAt,
        },
      });
      expect(await sites.findPublic(website.publicSlug, "en")).toEqual(
        published,
      );
      await expect(sites.publish(staff, oldVersion)).rejects.toThrow();
      website = await sites.publish(staff, website.updatedAt);
      expect(
        (await sites.findPublic(website.publicSlug, "en"))?.document?.version,
      ).toBe(1);
      expect(
        (await sites.findPublic(website.publicSlug, "en"))?.designVersion,
      ).toBe(2);
      const beforeRestore = await sites.findPublic(website.publicSlug, "en");
      const history = await websiteDraftHistory.list(staff);
      const restored = await websiteDraftHistory.revert(staff, {
        revisionId: history[0]!.id,
        expectedUpdatedAt: website.updatedAt,
        confirmed: true,
      });
      expect(restored.document).toBeNull();
      expect(await sites.findPublic(website.publicSlug, "en")).toEqual(
        beforeRestore,
      );
    });
  },
);
