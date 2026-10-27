import { afterAll, describe, expect, it } from "vitest";
import { provisionBusiness } from "./business-provisioner.js";
import { prisma } from "./client.js";
import { smartSetupRepository } from "./smart-setup-repository.js";
describe.skipIf(process.env.SMART_SETUP_DB_GATE !== "true")(
  "SI0 canonical provisioning and resumable setup",
  () => {
    afterAll(() => prisma.$disconnect());
    it("reuses templates and provisioning, persists skip/resume, and cannot activate or cross scope", async () => {
      const input = {
        requestKey: "si0-canonical-provisioning",
        organizationName: "SI0 Business",
        venueName: "SI0 Venue",
        ownerDisplayName: "Owner",
        email: "si0@example.test",
        password: "test-password-si0",
        locale: "sq" as const,
        timezone: "Europe/Tirane",
        currency: "ALL",
        plan: "WEBSITE" as const,
        profileId: "GENERIC" as const,
        applyCategories: false,
      };
      const a = await provisionBusiness(input);
      expect((await provisionBusiness(input)).tenant.id).toBe(a.tenant.id);
      const staff = {
        tenantId: a.tenant.id,
        venueId: a.venue.id,
        userId: a.owner.id,
        membershipId: a.membership.id,
        role: "OWNER" as const,
      };
      const first = await smartSetupRepository.get(staff);
      expect(first.profiles).toHaveLength(10);
      expect(first.venue).toMatchObject({
        timezone: "Europe/Tirane",
        currency: "ALL",
      });
      const change = {
        expectedVersion: 0,
        profileId: "PIZZERIA" as const,
        step: 2,
        applyCategories: true,
        skipped: [],
        complete: false,
      };
      const saved = await smartSetupRepository.update(staff, change);
      expect((await smartSetupRepository.get(staff)).progress).toEqual(saved);
      expect(
        await prisma.menuCategory.count({
          where: { tenantId: staff.tenantId },
        }),
      ).toBe(5);
      const category = await prisma.menuCategory.findFirstOrThrow({
        where: { tenantId: staff.tenantId },
        include: { translations: true },
      });
      await prisma.menuCategoryTranslation.update({
        where: { id: category.translations[0]!.id },
        data: { name: "Owner custom category" },
      });
      const repeated = await smartSetupRepository.update(staff, {
        ...change,
        expectedVersion: saved.version,
      });
      expect(
        await prisma.menuCategory.count({
          where: { tenantId: staff.tenantId },
        }),
      ).toBe(5);
      await expect(smartSetupRepository.update(staff, change)).rejects.toThrow(
        "Reload",
      );
      const ready = await smartSetupRepository.update(
        { ...staff, role: "MANAGER" },
        {
          ...change,
          expectedVersion: repeated.version,
          step: 4,
          complete: true,
          skipped: ["MENU"],
        },
      );
      expect(ready.status).toBe("READY");
      expect(ready.mediaStatus).toBe("PENDING");
      expect(ready.skipped).toEqual(["MENU"]);
      expect((await smartSetupRepository.get(staff)).progress.skipped).toEqual([
        "MENU",
      ]);
      const current = await prisma.venue.findUniqueOrThrow({
        where: { id: staff.venueId },
        include: { website: true, launch: true },
      });
      expect(current).toMatchObject({
        defaultServiceMode: "MENU_ONLY",
        onlinePickupEnabled: false,
        onlineDeliveryEnabled: false,
        onlineCateringEnabled: false,
        website: { status: "DRAFT" },
      });
      expect(current.launch?.launchedAt ?? null).toBeNull();
      expect(
        await prisma.product.count({ where: { tenantId: staff.tenantId } }),
      ).toBe(0);
      await expect(
        smartSetupRepository.get({ ...staff, role: "WAITER" }),
      ).rejects.toThrow("permission");
      await expect(
        smartSetupRepository.get({ ...staff, tenantId: "foreign" }),
      ).rejects.toThrow("NOT_FOUND");
    });
  },
);
