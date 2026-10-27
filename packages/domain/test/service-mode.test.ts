import { describe, expect, it } from "vitest";

import { resolveServiceMode, SERVICE_MODE_CAPABILITIES } from "../src/index.js";

describe("resolveServiceMode", () => {
  it("uses an active table override before other configuration", () => {
    expect(
      resolveServiceMode({
        venueDefault: "MENU_ONLY",
        areaOverride: { active: true, mode: "CALL_AND_REQUEST" },
        tableOverride: { active: true, mode: "ORDER_AND_CONFIRM" },
      }),
    ).toBe("ORDER_AND_CONFIRM");
  });

  it("falls back through inactive overrides to the venue default", () => {
    expect(
      resolveServiceMode({
        venueDefault: "MENU_ONLY",
        areaOverride: { active: false, mode: "SELF_ORDER" },
      }),
    ).toBe("MENU_ONLY");
  });
});

describe("service mode capabilities", () => {
  it("prevents ordering in menu-only mode", () => {
    expect(SERVICE_MODE_CAPABILITIES.MENU_ONLY.canOrder).toBe(false);
  });

  it("requires staff confirmation for order-and-confirm mode", () => {
    expect(
      SERVICE_MODE_CAPABILITIES.ORDER_AND_CONFIRM.requiresConfirmation,
    ).toBe(true);
  });
});
