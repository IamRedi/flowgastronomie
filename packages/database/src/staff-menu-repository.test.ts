import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({
  menuCategory: { findFirst: vi.fn() },
  venue: { findFirstOrThrow: vi.fn() },
  product: { create: vi.fn() },
}));
vi.mock("./client.js", () => ({ prisma: db }));
import { staffMenuRepository } from "./staff-menu-repository.js";
const staff = {
  tenantId: "al-tenant",
  venueId: "al-venue",
  userId: "owner-al",
  membershipId: "owner-al-member",
  role: "OWNER" as const,
};
const input = {
  staff,
  categoryId: "al-category",
  priceMinor: 80000,
  sortOrder: 0,
  available: true,
  published: true,
  station: "KITCHEN" as const,
  translations: [{ locale: "sq" as const, name: "TEST ONLY" }],
};
describe("canonical menu currency", () => {
  beforeEach(() => vi.resetAllMocks());
  it("creates products in the authenticated venue currency instead of the EUR DB default", async () => {
    db.menuCategory.findFirst.mockResolvedValue({ id: "al-category" });
    db.venue.findFirstOrThrow.mockResolvedValue({ currency: "ALL" });
    db.product.create.mockResolvedValue({
      id: "product",
      categoryId: "al-category",
      priceMinor: 80000,
      currency: "ALL",
      sortOrder: 0,
      available: true,
      published: true,
      station: "KITCHEN",
      translations: [],
      allergens: [],
      _count: { variants: 0, modifierGroups: 0 },
    });
    expect((await staffMenuRepository.createProduct(input)).currency).toBe(
      "ALL",
    );
    expect(db.venue.findFirstOrThrow).toHaveBeenCalledWith({
      where: { id: "al-venue", tenantId: "al-tenant" },
      select: { currency: true },
    });
    expect(db.product.create.mock.calls[0]![0].data).toMatchObject({
      currency: "ALL",
      tenantId: "al-tenant",
      venueId: "al-venue",
    });
  });
  it("rejects a foreign category before any product or venue write", async () => {
    db.menuCategory.findFirst.mockResolvedValue(null);
    await expect(staffMenuRepository.createProduct(input)).rejects.toThrow();
    expect(db.product.create).not.toHaveBeenCalled();
    expect(db.venue.findFirstOrThrow).not.toHaveBeenCalled();
  });
});
