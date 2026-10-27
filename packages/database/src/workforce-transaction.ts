import { Prisma } from "@prisma/client";
import { StaffPermissionDeniedError } from "@flowgastronomie/domain";
import type { StaffIdentity } from "./staff-auth-repository.js";
type Tx = Prisma.TransactionClient;
export async function lockWorkforceTenant(tx: Tx, s: StaffIdentity) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`workforce:${s.tenantId}`},0))`;
}
export async function requireWorkforceActor(tx: Tx, s: StaffIdentity) {
  const members = await tx.$queryRaw<
    { role: StaffIdentity["role"] }[]
  >`SELECT m.role FROM "Membership" m JOIN "User" u ON u.id=m."userId" AND u."tenantId"=m."tenantId" WHERE m."tenantId"=${s.tenantId} AND m."venueId"=${s.venueId} AND m.id=${s.membershipId} AND m."userId"=${s.userId} AND m.active=true AND u.active=true FOR SHARE OF m,u`;
  if (members[0]?.role !== s.role)
    throw new StaffPermissionDeniedError(s.role, "SCHEDULE_VIEW");
}

export async function appendWorkforceAudit(
  tx: Tx,
  s: StaffIdentity,
  action: string,
  id: string,
  now: Date,
  metadata: Prisma.InputJsonValue = { schemaVersion: 1 },
  entityType = "WORKFORCE_OPERATIONS",
) {
  return tx.auditEvent.create({
    data: {
      tenantId: s.tenantId,
      venueId: s.venueId,
      actorUserId: s.userId,
      actorMembershipId: s.membershipId,
      action,
      entityType,
      entityId: id,
      metadata,
      createdAt: now,
    },
  });
}
