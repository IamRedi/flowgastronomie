import {
  assertLegalHoldSchedule,
  assertStaffPermission,
  type LegalHoldTarget,
} from "@flowgastronomie/domain";
import { prisma } from "./client.js";
import { subscriptionRepository } from "./subscription-repository.js";
import type { StaffIdentity } from "./staff-auth-repository.js";

function scope(staff: StaffIdentity) {
  assertStaffPermission(staff.role, "LEGAL_HOLD_MANAGE");
  return { tenantId: staff.tenantId, venueId: staff.venueId };
}

export const legalHoldRepository = {
  list(staff: StaffIdentity) {
    return subscriptionRepository
      .assertFeature(staff.tenantId, "OPERATIONAL_RETENTION")
      .then(() =>
        prisma.retentionLegalHold.findMany({
          where: scope(staff),
          orderBy: { expiresAt: "asc" },
        }),
      );
  },
  async create(input: {
    staff: StaffIdentity;
    target: LegalHoldTarget;
    targetId: string;
    reason: string;
    reviewAt: Date;
    expiresAt: Date;
  }) {
    const scoped = scope(input.staff);
    await subscriptionRepository.assertFeature(
      input.staff.tenantId,
      "OPERATIONAL_RETENTION",
    );
    assertLegalHoldSchedule({ ...input, now: new Date() });
    const exists = await (input.target === "ONLINE_ORDER"
      ? prisma.onlineOrder.findFirst({
          where: { id: input.targetId, ...scoped },
        })
      : input.target === "RESERVATION"
        ? prisma.reservation.findFirst({
            where: { id: input.targetId, ...scoped },
          })
        : prisma.customerProfile.findFirst({
            where: { id: input.targetId, ...scoped },
          }));
    if (!exists) throw new Error("LEGAL_HOLD_TARGET_NOT_FOUND");
    return prisma.retentionLegalHold.create({
      data: {
        ...scoped,
        target: input.target,
        targetId: input.targetId,
        reason: input.reason.trim(),
        reviewAt: input.reviewAt,
        expiresAt: input.expiresAt,
        createdByUserId: input.staff.userId,
        createdByMembershipId: input.staff.membershipId,
      },
    });
  },
  async release(input: { staff: StaffIdentity; holdId: string }) {
    const scoped = scope(input.staff);
    await subscriptionRepository.assertFeature(
      input.staff.tenantId,
      "OPERATIONAL_RETENTION",
    );
    const hold = await prisma.retentionLegalHold.findFirst({
      where: { id: input.holdId, ...scoped, releasedAt: null },
    });
    if (!hold) throw new Error("LEGAL_HOLD_NOT_FOUND");
    return prisma.retentionLegalHold.update({
      where: { id: hold.id },
      data: {
        releasedAt: new Date(),
        releasedByUserId: input.staff.userId,
        releasedByMembershipId: input.staff.membershipId,
      },
    });
  },
};
export type LegalHoldRepository = typeof legalHoldRepository;
