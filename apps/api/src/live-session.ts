import type { StaffIdentity } from "@flowgastronomie/database";

export function retainsLiveStaffScope(
  original: StaffIdentity,
  current: StaffIdentity | null,
): current is StaffIdentity {
  return Boolean(
    current &&
    current.tenantId === original.tenantId &&
    current.venueId === original.venueId &&
    current.membershipId === original.membershipId,
  );
}
