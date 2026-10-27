import { describe, expect, it } from "vitest";

import type { StaffIdentity } from "@flowgastronomie/database";

import { retainsLiveStaffScope } from "./live-session.js";

const original: StaffIdentity = {
  sessionId: "session-1",
  userId: "user-1",
  membershipId: "membership-1",
  displayName: "Demo Manager",
  email: "manager@example.com",
  tenantId: "tenant-1",
  tenantSlug: "tenant-one",
  venueId: "venue-1",
  venueName: "Venue One",
  venueSlug: "venue-one",
  role: "MANAGER",
};

describe("live staff session scope", () => {
  it("retains a refreshed identity only inside the original tenant and venue", () => {
    expect(
      retainsLiveStaffScope(original, { ...original, role: "WAITER" }),
    ).toBe(true);
    expect(
      retainsLiveStaffScope(original, {
        ...original,
        tenantId: "tenant-2",
      }),
    ).toBe(false);
    expect(
      retainsLiveStaffScope(original, {
        ...original,
        venueId: "venue-2",
      }),
    ).toBe(false);
    expect(
      retainsLiveStaffScope(original, {
        ...original,
        membershipId: "membership-2",
      }),
    ).toBe(false);
    expect(retainsLiveStaffScope(original, null)).toBe(false);
  });
});
