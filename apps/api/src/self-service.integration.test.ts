import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  prisma,
  staffAuthRepository,
  setPosMenuChannel,
  staffOrderRepository,
  type StaffIdentity,
} from "@flowgastronomie/database";
import { provisionBusinessInTransaction } from "../../../packages/database/src/business-provisioner.js";
import { resolveOrderItems } from "../../../packages/database/src/order-item-resolution.js";
const enabled = process.env.SMART_SETUP_DB_GATE === "true";
const scopes: StaffIdentity[] = [];
async function business(password = "self-service-test-password") {
  const b = await prisma.$transaction(
    (tx) =>
      provisionBusinessInTransaction(
        tx,
        {
          requestKey: randomUUID(),
          organizationName: "Synthetic self service",
          venueName: "Test venue",
          ownerDisplayName: "Test Owner",
          email: `${randomUUID()}@self-service.invalid`,
          password,
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
  const staff = {
    tenantId: b.tenant.id,
    venueId: b.venue.id,
    userId: b.owner.id,
    membershipId: b.membership.id,
    role: "OWNER",
  } as StaffIdentity;
  scopes.push(staff);
  return staff;
}
describe.skipIf(!enabled)(
  "Isolated self-service authentication and channel boundaries",
  () => {
    afterAll(async () => {
      await prisma.$disconnect();
    });
    it("verifies every identity independently; chooses membership only after matching credentials; rechecks revocation/password changes", async () => {
      const a = await business(),
        b = await business("a-different-password");
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: a.userId },
      });
      await prisma.user.update({
        where: { id: b.userId },
        data: { email: user.email },
      });
      const venue = await prisma.venue.create({
        data: {
          tenantId: a.tenantId,
          name: "Second permitted venue",
          slug: `second-${randomUUID()}`,
          currency: "EUR",
        },
      });
      const member = await prisma.membership.create({
        data: {
          tenantId: a.tenantId,
          venueId: venue.id,
          userId: a.userId,
          role: "BAR",
        },
      });
      expect(
        await prisma.staffSession.count({ where: { userId: a.userId } }),
      ).toBe(0);
      const choices = await staffAuthRepository.credentials!({
        email: user.email,
        password: "self-service-test-password",
      });
      expect(choices).toHaveLength(2);
      expect(choices.every((c) => c.userId === a.userId)).toBe(true);
      const selected = await staffAuthRepository.select!(
        choices.find((c) => c.membershipId === member.id)!,
      );
      expect(selected.staff.venueId).toBe(venue.id);
      expect(selected.staff.role).toBe("BAR");
      expect(
        await prisma.staffSession.count({ where: { userId: a.userId } }),
      ).toBe(1);
      const different = await staffAuthRepository.credentials!({
        email: user.email,
        password: "a-different-password",
      });
      expect(different).toHaveLength(1);
      expect(different[0]!.userId).toBe(b.userId);
      await prisma.membership.update({
        where: { id: member.id },
        data: { active: false },
      });
      expect(
        await staffAuthRepository.authenticate(selected.sessionToken),
      ).toBeNull();
      await expect(
        staffAuthRepository.select!(
          choices.find((c) => c.membershipId === member.id)!,
        ),
      ).rejects.toThrow();
      await prisma.user.update({
        where: { id: a.userId },
        data: { passwordHash: "invalidated-proof" },
      });
      await expect(staffAuthRepository.select!(choices[0]!)).rejects.toThrow();
    });
    it("activates Draft products atomically in POS without publishing category/product/website; retry and deactivation preserve channels", async () => {
      const staff = await business();
      const category = await prisma.menuCategory.create({
        data: {
          tenantId: staff.tenantId,
          venueId: staff.venueId,
          published: false,
          translations: {
            create: {
              tenantId: staff.tenantId,
              venueId: staff.venueId,
              locale: "EN",
              name: "Lunch",
            },
          },
        },
      });
      const p = await prisma.product.create({
        data: {
          tenantId: staff.tenantId,
          venueId: staff.venueId,
          categoryId: category.id,
          station: "KITCHEN",
          priceMinor: 650,
          currency: "EUR",
          published: false,
          available: false,
          posEnabled: false,
          translations: {
            create: {
              tenantId: staff.tenantId,
              venueId: staff.venueId,
              locale: "EN",
              name: "Soup",
            },
          },
        },
      });
      await setPosMenuChannel(staff, { productIds: [p.id], enabled: true });
      await setPosMenuChannel(staff, { productIds: [p.id], enabled: true });
      expect(
        (await staffOrderRepository.posMenu(staff, "en")).categories[0]!
          .products[0]!.id,
      ).toBe(p.id);
      const saved = await prisma.product.findUniqueOrThrow({
        where: { id: p.id },
        include: { category: true },
      });
      expect(saved.published).toBe(false);
      expect(saved.category.published).toBe(false);
      expect(saved.posEnabled).toBe(true);
      expect(
        (
          await prisma.venueWebsite.findFirstOrThrow({
            where: { venueId: staff.venueId },
          })
        ).status,
      ).toBe("DRAFT");
      const input = {
        tenantId: staff.tenantId,
        venueId: staff.venueId,
        requestedLocale: "en" as const,
        fallbackLocale: "EN" as const,
        items: [{ productId: p.id, quantity: 2 }],
      };
      await expect(
        prisma.$transaction((tx) => resolveOrderItems(tx, input)),
      ).rejects.toThrow();
      expect(
        (
          await prisma.$transaction((tx) =>
            resolveOrderItems(tx, { ...input, channel: "POS" }),
          )
        )[0]!.unitPriceMinor,
      ).toBe(650);
      const other = await business();
      await expect(
        setPosMenuChannel(other, { productIds: [p.id], enabled: true }),
      ).rejects.toThrow();
      await expect(
        setPosMenuChannel(
          { ...staff, role: "WAITER" },
          { productIds: [p.id], enabled: true },
        ),
      ).rejects.toThrow();
      await expect(
        setPosMenuChannel(staff, {
          productIds: [p.id, "foreign"],
          enabled: false,
        }),
      ).rejects.toThrow();
      expect(
        (await prisma.product.findUniqueOrThrow({ where: { id: p.id } }))
          .posEnabled,
      ).toBe(true);
      await setPosMenuChannel(staff, { productIds: [p.id], enabled: false });
      expect(
        (await staffOrderRepository.posMenu(staff, "en")).categories,
      ).toHaveLength(0);
    });
  },
);
