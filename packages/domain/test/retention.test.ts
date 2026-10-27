import { describe, expect, it } from "vitest";

import {
  operationalRetentionCutoffs,
  OPERATIONAL_RETENTION_DAYS,
} from "../src/index.js";

describe("operational retention", () => {
  it("derives fixed UTC cutoffs from one job timestamp", () => {
    expect(OPERATIONAL_RETENTION_DAYS).toMatchObject({
      guestContact: 90,
      guestMessage: 30,
    });
    expect(
      operationalRetentionCutoffs(new Date("2026-08-11T12:00:00.000Z")),
    ).toEqual({
      guestContact: new Date("2026-05-13T12:00:00.000Z"),
      guestMessage: new Date("2026-07-12T12:00:00.000Z"),
      guestToken: new Date("2026-07-12T12:00:00.000Z"),
      staffSession: new Date("2026-07-12T12:00:00.000Z"),
    });
  });

  it("rejects an invalid job timestamp", () => {
    expect(() => operationalRetentionCutoffs(new Date("invalid"))).toThrow(
      RangeError,
    );
  });
});
