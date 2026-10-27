import { describe, expect, it } from "vitest";

import { canLaunchVenue, incompleteLaunchChecks } from "../src/index.js";

const ready = {
  subscriptionActive: true,
  organizationProfileComplete: true,
  websitePublished: true,
  menuPublished: true,
  tableManagementEnabled: true,
  tableQrReady: true,
  staffShiftsEnabled: true,
  teamReady: true,
  serviceRadarEnabled: true,
  serviceRehearsalComplete: true,
  operationalRetentionEnabled: true,
  retentionHealthy: true,
};

describe("venue launch readiness", () => {
  it("launches when every enabled module is ready", () => {
    expect(incompleteLaunchChecks(ready)).toEqual([]);
    expect(canLaunchVenue(ready)).toBe(true);
  });

  it("returns exact blocking checks", () => {
    expect(
      incompleteLaunchChecks({
        ...ready,
        websitePublished: false,
        tableQrReady: false,
        serviceRehearsalComplete: false,
        retentionHealthy: false,
      }),
    ).toEqual([
      "WEBSITE_PUBLISHED",
      "TABLE_QR_READY",
      "SERVICE_REHEARSAL",
      "RETENTION_HEALTH",
    ]);
  });

  it("does not require disabled operational modules", () => {
    expect(
      canLaunchVenue({
        ...ready,
        tableManagementEnabled: false,
        tableQrReady: false,
        staffShiftsEnabled: false,
        teamReady: false,
        serviceRadarEnabled: false,
        serviceRehearsalComplete: false,
        operationalRetentionEnabled: false,
        retentionHealthy: false,
      }),
    ).toBe(true);
  });
});
