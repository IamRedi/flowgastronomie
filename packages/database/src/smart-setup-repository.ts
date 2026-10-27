import type { Prisma } from "@prisma/client";
import {
  assertStaffPermission,
  businessProfileCatalog,
  businessProfileDefaults,
  businessProfileIds,
  smartSetupTransition,
  SetupImportError,
  type BusinessProfileId,
  type SmartSetupUpdate,
} from "@flowgastronomie/domain";
import { prisma } from "./client.js";
import type { StaffIdentity } from "./staff-auth-repository.js";
import { applyBusinessProfileCategories } from "./business-profile-application.js";
export type SetupStaff = Pick<
  StaffIdentity,
  "tenantId" | "venueId" | "userId" | "membershipId" | "role"
>;
export const setupScope = (staff: SetupStaff) => ({
  tenantId: staff.tenantId,
  venueId: staff.venueId,
});
export async function lockSetup(
  tx: Prisma.TransactionClient,
  staff: SetupStaff,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`smart-setup:${staff.tenantId}:${staff.venueId}`}, 0))`;
}
export async function ensureSmartSetup(
  tx: Prisma.TransactionClient,
  staff: SetupStaff,
) {
  assertStaffPermission(staff.role, "VENUE_SETUP_MANAGE");
  const scope = setupScope(staff);
  if (
    !(await tx.membership.findFirst({
      where: {
        ...scope,
        id: staff.membershipId,
        userId: staff.userId,
        active: true,
        role: { in: ["OWNER", "MANAGER"] },
        venue: { tenant: { retiredAt: null } },
      },
      select: { id: true },
    }))
  )
    throw new SetupImportError("NOT_FOUND");
  const venue = await tx.venue.findFirst({
    where: { tenantId: staff.tenantId, id: staff.venueId },
    include: { tenant: true },
  });
  if (!venue) throw new SetupImportError("NOT_FOUND");
  const profileId = businessProfileIds.includes(
    venue.tenant.businessProfileId as BusinessProfileId,
  )
    ? (venue.tenant.businessProfileId as BusinessProfileId)
    : "GENERIC";
  return tx.smartSetup.upsert({
    where: { tenantId_venueId: scope },
    update: {},
    create: {
      ...scope,
      profileId,
      profileVersion: businessProfileDefaults(profileId).version,
      updatedBy: staff.userId,
    },
  });
}
export const smartSetupRepository = {
  async get(staff: SetupStaff) {
    assertStaffPermission(staff.role, "VENUE_SETUP_MANAGE");
    return prisma.$transaction(async (tx) => {
      await lockSetup(tx, staff);
      const progress = await ensureSmartSetup(tx, staff);
      const venue = await tx.venue.findFirstOrThrow({
        where: { tenantId: staff.tenantId, id: staff.venueId },
        select: {
          id: true,
          name: true,
          currency: true,
          timezone: true,
          defaultLocale: true,
          tenant: { select: { kind: true } },
        },
      });
      return { progress, venue, profiles: businessProfileCatalog() };
    });
  },
  async update(staff: SetupStaff, input: SmartSetupUpdate) {
    assertStaffPermission(staff.role, "VENUE_SETUP_MANAGE");
    return prisma.$transaction(async (tx) => {
      await lockSetup(tx, staff);
      const current = await ensureSmartSetup(tx, staff);
      if (current.version !== input.expectedVersion)
        throw new SetupImportError(
          "CONFLICT",
          "Setup changed. Reload your saved progress.",
        );
      const imported = await tx.importSession.count({
        where: { ...setupScope(staff), status: "IMPORTED" },
      });
      const next = smartSetupTransition(input, imported > 0);
      const applicationKey = `${next.profileId}:${next.profileVersion}`;
      const apply =
        input.applyCategories &&
        !current.appliedProfiles.includes(applicationKey);
      if (apply)
        await applyBusinessProfileCategories(
          tx,
          setupScope(staff),
          businessProfileDefaults(input.profileId),
        );
      await tx.tenant.update({
        where: { id: staff.tenantId },
        data: {
          businessProfileId: next.profileId,
          businessProfileVersion: next.profileVersion,
        },
      });
      const progress = await tx.smartSetup.update({
        where: { id: current.id },
        data: {
          ...next,
          appliedProfiles: apply
            ? [...current.appliedProfiles, applicationKey]
            : current.appliedProfiles,
          version: { increment: 1 },
          updatedBy: staff.userId,
        },
      });
      await tx.auditEvent.create({
        data: {
          ...setupScope(staff),
          actorUserId: staff.userId,
          actorMembershipId: staff.membershipId,
          action: input.complete ? "SMART_SETUP_READY" : "SMART_SETUP_SAVED",
          entityType: "SmartSetup",
          entityId: current.id,
          metadata: {
            profileId: next.profileId,
            step: next.step,
            skipped: next.skipped,
            applyCategories: input.applyCategories,
          },
        },
      });
      return progress;
    });
  },
};
