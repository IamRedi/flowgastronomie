import { afterAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  BusinessProvisionConflict,
  type BusinessProvisionInput,
} from "@flowgastronomie/domain";
import { prisma } from "./client.js";
import { provisionBusiness } from "./business-provisioner.js";
import { trialRegistrationRepository } from "./trial-registration-repository.js";
const input: BusinessProvisionInput = {
  requestKey: "foundation-bf1-registration",
  organizationName: "Fresh restaurant",
  venueName: "Fresh venue",
  ownerDisplayName: "Fresh Owner",
  email: "fresh@example.test",
  password: "fresh-test-password",
  locale: "de",
  timezone: "Europe/Tirane",
  currency: "ALL",
  plan: "WEBSITE",
  profileId: "PIZZERIA",
  applyCategories: true,
};
describe.skipIf(process.env.FOUNDATION_DB_GATE !== "true")(
  "BF1 clean canonical provisioning",
  () => {
    afterAll(() => prisma.$disconnect());
    it("retries concurrently without cloning operational data", async () => {
      const [a, b] = await Promise.all([
        provisionBusiness(input),
        provisionBusiness(input),
      ]);
      expect(a.tenant.id).toBe(b.tenant.id);
      expect([a.created, b.created].sort()).toEqual([false, true]);
      expect(a.tenant.kind).toBe("REAL");
      expect(a.venue.defaultServiceMode).toBe("MENU_ONLY");
      expect(a.venue.onlinePickupEnabled).toBe(false);
      expect(a.venue).toMatchObject({
        timezone: "Europe/Tirane",
        currency: "ALL",
      });
      const scope = { tenantId: a.tenant.id };
      expect(await prisma.menuCategory.count({ where: scope })).toBe(5);
      const drinks = await prisma.menuCategory.findFirstOrThrow({
        where: { ...scope, sortOrder: 4 },
        include: { translations: true },
      });
      expect(
        Object.fromEntries(
          drinks.translations.map((translation) => [
            translation.locale,
            translation.name,
          ]),
        ),
      ).toEqual({
        EN: "Drinks",
        DE: "Getränke",
        IT: "Bevande",
        SQ: "Pije",
      });
      expect(
        await prisma.menuCategory.count({
          where: { ...scope, published: true },
        }),
      ).toBe(0);
      const counts = await Promise.all([
        prisma.order.count({ where: scope }),
        prisma.onlineOrder.count({ where: scope }),
        prisma.staffSession.count({ where: scope }),
        prisma.product.count({ where: scope }),
      ]);
      expect(counts).toEqual([0, 0, 0, 0]);
      const website = await prisma.venueWebsite.findUniqueOrThrow({
        where: { venueId: a.venue.id },
      });
      expect(website.status).toBe("DRAFT");
      expect(website.openingHours).toEqual([]);
      await expect(
        provisionBusiness({ ...input, venueName: "Other venue" }),
      ).rejects.toBeInstanceOf(BusinessProvisionConflict);
      for (const regionalChange of [
        { timezone: "Europe/Berlin" },
        { currency: "EUR" },
      ]) {
        await expect(
          provisionBusiness({ ...input, ...regionalChange }),
        ).rejects.toBeInstanceOf(BusinessProvisionConflict);
      }
      await expect(
        provisionBusiness({ ...input, password: "wrong-password" }),
      ).rejects.toBeInstanceOf(BusinessProvisionConflict);
      const other = await provisionBusiness({
        ...input,
        requestKey: "foundation-bf1-second-business",
        applyCategories: false,
      });
      expect(other.tenant.id).not.toBe(a.tenant.id);
      expect(other.owner.id).not.toBe(a.owner.id);
      expect(other.venue.id).not.toBe(a.venue.id);
      expect(
        await prisma.menuCategory.count({
          where: { tenantId: other.tenant.id },
        }),
      ).toBe(0);
      await expect(
        prisma.businessProvision.update({
          where: { tenantId: other.tenant.id },
          data: { venueId: a.venue.id },
        }),
      ).rejects.toThrow();
    });
    it("upgrades legacy creation receipts only after explicit matching region and credentials", async () => {
      const legacyInput = {
        ...input,
        requestKey: "foundation-bf1-legacy-region",
      };
      const business = await provisionBusiness(legacyInput);
      const {
        requestKey: _requestKey,
        password: _password,
        timezone: _timezone,
        currency: _currency,
        ...legacyDetails
      } = legacyInput;
      const legacyFingerprint = createHash("sha256")
        .update(JSON.stringify({ ...legacyDetails, kind: "REAL" }))
        .digest("hex");
      await prisma.businessProvision.update({
        where: { tenantId: business.tenant.id },
        data: { fingerprint: legacyFingerprint },
      });
      for (const mismatch of [
        { timezone: "Europe/Berlin" },
        { currency: "EUR" },
        { password: "different-password" },
      ]) {
        await expect(
          provisionBusiness({ ...legacyInput, ...mismatch }),
        ).rejects.toBeInstanceOf(BusinessProvisionConflict);
      }
      const retry = await provisionBusiness(legacyInput);
      expect(retry.created).toBe(false);
      expect(retry.tenant.id).toBe(business.tenant.id);
      const receipt = await prisma.businessProvision.findUniqueOrThrow({
        where: { tenantId: business.tenant.id },
      });
      expect(receipt.fingerprint).not.toBe(legacyFingerprint);
      expect((await provisionBusiness(legacyInput)).created).toBe(false);
    });
    it("public signup uses the same provisioner and issues a fresh session on retry", async () => {
      const signup = {
        ...input,
        requestKey: "foundation-bf1-public-signup",
        email: "signup@example.test",
      };
      const a = await trialRegistrationRepository.register(signup);
      const b = await trialRegistrationRepository.register(signup);
      expect(a.staff.tenantId).toBe(b.staff.tenantId);
      expect(a.sessionToken).not.toBe(b.sessionToken);
      expect(JSON.stringify(a)).not.toContain("passwordHash");
      expect(
        await prisma.auditEvent.count({
          where: { tenantId: a.staff.tenantId, action: "BUSINESS_PROVISIONED" },
        }),
      ).toBe(1);
    });
  },
);
