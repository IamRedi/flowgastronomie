import { describe, expect, it } from "vitest";

import {
  addWorkspaceSlugSuffix,
  createWorkspaceSlug,
  initialServiceModeForPlan,
} from "../src/onboarding.js";

describe("workspace onboarding slugs", () => {
  it("creates a readable, URL-safe slug", () => {
    expect(createWorkspaceSlug("  Restorant Çajupi & Bar  ")).toBe(
      "restorant-cajupi-bar",
    );
  });

  it("uses a safe fallback when the name has no URL-safe characters", () => {
    expect(createWorkspaceSlug("---")).toBe("restaurant");
  });

  it("adds a collision suffix without exceeding the maximum length", () => {
    const slug = addWorkspaceSlugSuffix("A".repeat(100), "B7_X!");
    expect(slug).toHaveLength(60);
    expect(slug.endsWith("-b7x")).toBe(true);
  });

  it("starts each plan in its safest useful service mode", () => {
    expect(initialServiceModeForPlan("WEBSITE")).toBe("MENU_ONLY");
    expect(initialServiceModeForPlan("SMART_SERVICE")).toBe("CALL_AND_REQUEST");
    expect(initialServiceModeForPlan("RESTAURANT_PRO")).toBe(
      "ORDER_AND_CONFIRM",
    );
  });
});
