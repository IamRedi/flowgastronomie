import { describe, expect, it } from "vitest";

import {
  canActivateWebsiteDomain,
  isSupportedWebsiteAsset,
  isValidWebsiteDomain,
  normalizeWebsiteDomain,
  websiteDomainVerificationRecord,
} from "../src/website-domain";

describe("website domain lifecycle", () => {
  it("normalizes and accepts public hostnames", () => {
    expect(normalizeWebsiteDomain(" WWW.RestaurantOlive.DE. ")).toBe(
      "www.restaurantolive.de",
    );
    expect(isValidWebsiteDomain("restaurantolive.de")).toBe(true);
    expect(isValidWebsiteDomain("www.restaurant-olive.al")).toBe(true);
  });

  it("rejects unsafe and FlowGastronomie-owned hostnames", () => {
    for (const domain of [
      "https://restaurantolive.de",
      "localhost",
      "127.0.0.1",
      "*.restaurantolive.de",
      "restaurantolive.de/menu",
      "demo.restaurantflow.site",
      "demo.flowgastronomie.site",
      "-invalid.de",
    ]) {
      expect(isValidWebsiteDomain(domain)).toBe(false);
    }
  });

  it("builds an exact TXT verification record", () => {
    expect(
      websiteDomainVerificationRecord("RestaurantOlive.DE", "token-1"),
    ).toEqual({
      type: "TXT",
      name: "_flowgastronomie.restaurantolive.de",
      value: "flowgastronomie-verification=token-1",
    });
  });

  it("activates only verified domains and constrains image uploads", () => {
    expect(canActivateWebsiteDomain("VERIFIED")).toBe(true);
    expect(canActivateWebsiteDomain("PENDING")).toBe(false);
    expect(isSupportedWebsiteAsset("image/webp", 1024)).toBe(true);
    expect(isSupportedWebsiteAsset("image/svg+xml", 1024)).toBe(false);
    expect(isSupportedWebsiteAsset("image/png", 6 * 1024 * 1024)).toBe(false);
  });
});
