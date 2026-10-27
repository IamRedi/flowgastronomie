import { describe, expect, it } from "vitest";
import { resolveProductImage } from "./pilot-product-images";

const scope = {
  tenantId: "demo-tenant",
  venueId: "demo-venue",
  productId: "pilot-product-pizza-1",
  demo: true,
};
describe("POS photography presentation", () => {
  it("uses demo photographs only for explicitly enabled, known local products", () => {
    expect(resolveProductImage(scope)).toEqual({
      src: "/pilot/demo-food/margherita.webp",
      kind: "demo",
    });
    expect(resolveProductImage({ ...scope, demo: false })).toBeUndefined();
    expect(
      resolveProductImage({ ...scope, productId: "unpictured-product" }),
    ).toBeUndefined();
  });
  it("never transfers demo photographs to another tenant or venue", () => {
    expect(
      resolveProductImage({ ...scope, tenantId: "customer" }),
    ).toBeUndefined();
    expect(
      resolveProductImage({ ...scope, venueId: "customer" }),
    ).toBeUndefined();
  });
  it("prefers approved photography and scopes it to the exact product ownership", () => {
    const approved = {
      "demo-tenant/demo-venue/pilot-product-pizza-1":
        "/approved/margherita.avif",
    };
    expect(resolveProductImage({ ...scope, demo: false }, approved)).toEqual({
      src: "/approved/margherita.avif",
      kind: "approved",
    });
    expect(resolveProductImage(scope, approved)?.kind).toBe("approved");
    expect(
      resolveProductImage({ ...scope, tenantId: "customer" }, approved),
    ).toBeUndefined();
  });
});
