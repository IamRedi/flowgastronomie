import { describe, expect, it } from "vitest";

import {
  operationalSourceFromOnlineFulfillment,
  operationalSourceFromTableOrder,
  operationalStatusFromOnlineOrder,
  operationalStatusFromTableOrder,
} from "../src/index.js";

describe("operational order contract", () => {
  it("maps table lifecycle states without changing their persisted lifecycle", () => {
    expect(operationalStatusFromTableOrder("NEW")).toBe("PENDING_CONFIRMATION");
    expect(operationalStatusFromTableOrder("SERVED")).toBe("COMPLETED");
    expect(operationalStatusFromTableOrder("CANCELLED")).toBe("CANCELLED");
  });

  it("keeps online lifecycle states and fulfillment channels explicit", () => {
    expect(operationalStatusFromOnlineOrder("OUT_FOR_DELIVERY")).toBe(
      "OUT_FOR_DELIVERY",
    );
    expect(operationalSourceFromOnlineFulfillment("PICKUP")).toBe(
      "ONLINE_PICKUP",
    );
    expect(operationalSourceFromOnlineFulfillment("DELIVERY")).toBe(
      "ONLINE_DELIVERY",
    );
    expect(operationalSourceFromTableOrder("GUEST_QR")).toBe("TABLE_GUEST_QR");
  });
});
