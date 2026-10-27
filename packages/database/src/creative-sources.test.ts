import { vi, it, expect, beforeEach } from "vitest";
import type { CreativeScope, CreativeBinding } from "@flowgastronomie/domain";
const db = vi.hoisted(() => ({
  venue: { findFirst: vi.fn() },
  product: { findFirst: vi.fn() },
  diningTable: { findFirst: vi.fn() },
}));
vi.mock("./client.js", () => ({ prisma: db }));
import { resolveCreativeBinding } from "./creative-sources.js";
const staff: CreativeScope = {
  tenantId: "t1",
  venueId: "v1",
  userId: "u1",
  role: "MANAGER",
};
const binding: CreativeBinding = {
  id: "b1",
  sourceType: "PRODUCT",
  sourceId: "p1",
  field: "price",
  version: "",
  value: "0.00",
};
beforeEach(() => {
  vi.resetAllMocks();
  db.venue.findFirst.mockResolvedValue({ defaultLocale: "EN", name: "Venue" });
});
it("re-resolves current price in the authenticated scope and changes the version", async () => {
  db.product.findFirst.mockResolvedValue({
    priceMinor: 1050,
    currency: "EUR",
    variants: [],
    translations: [],
  });
  const first = await resolveCreativeBinding(staff, binding, "en");
  db.product.findFirst.mockResolvedValue({
    priceMinor: 1100,
    currency: "EUR",
    variants: [],
    translations: [],
  });
  const next = await resolveCreativeBinding(staff, first, "en");
  expect(first.value).toBe("€10.50");
  expect(next.value).toBe("€11.00");
  expect(first.version).not.toBe(next.version);
  expect(db.product.findFirst.mock.calls[0]![0].where).toMatchObject({
    tenantId: "t1",
    venueId: "v1",
    id: "p1",
    published: true,
  });
});
it("blocks missing/foreign/unpublished products and revoked QR codes", async () => {
  await expect(resolveCreativeBinding(staff, binding, "en")).rejects.toThrow(
    "unavailable",
  );
  await expect(
    resolveCreativeBinding(
      staff,
      {
        ...binding,
        sourceType: "TABLE_QR",
        field: "destination",
        value: "https://evil.test/table",
      },
      "en",
    ),
  ).rejects.toThrow("unavailable");
});
