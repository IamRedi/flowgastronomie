import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import Fastify from "fastify";
import {
  prisma,
  venueWebsiteRepository,
  websiteImportProposals,
  type StaffIdentity,
} from "@flowgastronomie/database";
import { provisionBusiness } from "../../../packages/database/src/business-provisioner.js";
import { proposeWebsiteAi } from "./website-ai-service.js";
import { registerWebsiteImportRoutes } from "./website-import-routes.js";

describe.skipIf(process.env.PREMIUM_DB_GATE !== "true")(
  "reviewed website proposals",
  () => {
    afterAll(() => prisma.$disconnect());
    async function business() {
      const b = await provisionBusiness({
        requestKey: randomUUID(),
        organizationName: "Copy review",
        venueName: "Copy review",
        ownerDisplayName: "Owner",
        email: `${randomUUID()}@copy.test`,
        password: "copy-review-password",
        locale: "en",
        timezone: "Europe/Berlin",
        currency: "EUR",
        plan: "WEBSITE",
        profileId: "GENERIC",
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
    it("bounds AI requests and deduplicates retries, retaining drafts and reviewed provenance", async () => {
      const staff = await business();
      const other = await business();
      const original = await venueWebsiteRepository.getEditor(staff);
      // Empty provisioned sites still have an editable translation set.
      let calls = 0;
      const provider = {
        provider: "controlled",
        model: "acceptance",
        propose: async () => {
          calls++;
          return {
            title: "Reviewed title",
            description: "Reviewed description",
            inputTokens: 12,
            outputTokens: 8,
          };
        },
      };
      const input = {
        requestKey: randomUUID(),
        instruction: "Shorten the heading",
        locale: "en",
        expectedUpdatedAt: original.updatedAt,
      };
      const first = await proposeWebsiteAi(staff, input, provider);
      expect(await proposeWebsiteAi(staff, input, provider)).toEqual(first);
      expect(calls).toBe(1);
      expect(
        (await venueWebsiteRepository.getEditor(staff)).translations,
      ).toEqual(original.translations);
      const otherSite = await venueWebsiteRepository.getEditor(other);
      await expect(
        venueWebsiteRepository.update({
          staff: other,
          website: {
            ...otherSite,
            expectedUpdatedAt: otherSite.updatedAt,
            sourceProposalId: first.id,
          },
        }),
      ).rejects.toThrow();
      await venueWebsiteRepository.update({
        staff,
        website: {
          ...original,
          expectedUpdatedAt: original.updatedAt,
          sourceProposalId: first.id,
          translations: original.translations.map((t) =>
            t.locale === "en"
              ? {
                  ...t,
                  heroTitle: first.title,
                  heroSubtitle: first.description,
                }
              : t,
          ),
        },
      });
      const saved = await venueWebsiteRepository.getEditor(staff);
      expect(saved.status).toBe("DRAFT");
      expect(saved.translations.find((t) => t.locale === "en")?.heroTitle).toBe(
        first.title,
      );
      for (let i = 0; i < 9; i++)
        await proposeWebsiteAi(
          staff,
          {
            ...input,
            requestKey: randomUUID(),
            expectedUpdatedAt: saved.updatedAt,
          },
          provider,
        );
      await expect(
        proposeWebsiteAi(
          staff,
          {
            ...input,
            requestKey: randomUUID(),
            expectedUpdatedAt: saved.updatedAt,
          },
          provider,
        ),
      ).rejects.toThrow("daily");
      expect(calls).toBe(10);
    }, 30000);
    it("requires active scoped leadership, records source evidence and returns a proposal without writing canonical copy", async () => {
      const staff = await business();
      let calls = 0;
      const proposal = {
        sourceUrl: "https://example.com/",
        title: "Proposed",
        description: "Source description",
        fetchedAt: new Date().toISOString(),
        contentHash: "a".repeat(64),
        confidence: "UNVERIFIED" as const,
      };
      const app = Fastify();
      registerWebsiteImportRoutes(
        app,
        async () => staff,
        async () => {
          calls++;
          return proposal;
        },
      );
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/v1/staff/website-import/propose",
            payload: { url: "https://example.com", authorized: false },
          })
        ).statusCode,
      ).toBe(400);
      expect(calls).toBe(0);
      const response = await app.inject({
        method: "POST",
        url: "/v1/staff/website-import/propose",
        payload: { url: "https://example.com", authorized: true },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject(proposal);
      expect(
        (await venueWebsiteRepository.getEditor(staff)).translations.every(
          (t) => !t.heroTitle,
        ),
      ).toBe(true);
      await expect(
        websiteImportProposals.authorize({ ...staff, membershipId: "other" }),
      ).rejects.toThrow();
      await expect(
        websiteImportProposals.authorize({ ...staff, role: "WAITER" }),
      ).rejects.toThrow();
      await app.close();
    });
  },
);
