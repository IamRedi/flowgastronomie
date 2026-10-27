import { randomBytes } from "node:crypto";

import {
  assertStaffPermission,
  type PlatformLocale,
  type StaffRole,
} from "@flowgastronomie/domain";

import { prisma } from "./client.js";
import { hashPassword } from "./password.js";
import { hashOpaqueToken } from "./public-menu-repository.js";
import type { StaffIdentity } from "./staff-auth-repository.js";

const invitationLifetimeMilliseconds = 7 * 24 * 60 * 60 * 1_000;

export class TeamResourceNotFoundError extends Error {
  constructor(resource: string) {
    super(`${resource} was not found in this venue`);
    this.name = "TeamResourceNotFoundError";
  }
}

export class TeamConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TeamConflictError";
  }
}

export type TeamOverview = Awaited<ReturnType<typeof staffTeamRepository.list>>;

export type StaffTeamRepository = {
  list(staff: StaffIdentity): Promise<{
    members: unknown[];
    tables: unknown[];
    pendingInvitations: unknown[];
    recentShifts: unknown[];
  }>;
  invite(input: {
    staff: StaffIdentity;
    email: string;
    role: StaffRole;
    preferredLocale: PlatformLocale;
  }): Promise<{ invitationToken: string; invitation: unknown }>;
  acceptInvitation(input: {
    token: string;
    displayName: string;
    password: string;
  }): Promise<{ tenantSlug: string; venueSlug: string; email: string }>;
  updateMember(input: {
    staff: StaffIdentity;
    membershipId: string;
    role?: StaffRole;
    active?: boolean;
    preferredLocale?: PlatformLocale;
  }): Promise<unknown>;
  assignTable(input: {
    staff: StaffIdentity;
    membershipId: string;
    tableId: string;
  }): Promise<unknown>;
  endAssignment(input: {
    staff: StaffIdentity;
    assignmentId: string;
  }): Promise<void>;
};

export const staffTeamRepository: StaffTeamRepository = {
  async list(staff) {
    assertStaffPermission(staff.role, "TEAM_VIEW");
    const [memberships, tables, invitations, shifts] = await Promise.all([
      prisma.membership.findMany({
        where: { tenantId: staff.tenantId, venueId: staff.venueId },
        orderBy: [{ active: "desc" }, { user: { displayName: "asc" } }],
        include: {
          user: { select: { displayName: true, email: true } },
          staffProfile: {
            select: { preferredLocale: true, employeeRef: true },
          },
          staffShifts: {
            where: { status: "OPEN" },
            take: 1,
            include: {
              assignments: {
                where: { endedAt: null },
                include: { table: { select: { id: true, label: true } } },
              },
            },
          },
        },
      }),
      prisma.diningTable.findMany({
        where: { tenantId: staff.tenantId, venueId: staff.venueId },
        orderBy: { label: "asc" },
        include: {
          assignments: {
            where: { endedAt: null },
            take: 1,
            include: {
              shift: {
                include: {
                  membership: {
                    include: { user: { select: { displayName: true } } },
                  },
                },
              },
            },
          },
        },
      }),
      prisma.staffInvitation.findMany({
        where: {
          tenantId: staff.tenantId,
          venueId: staff.venueId,
          acceptedAt: null,
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          email: true,
          role: true,
          preferredLocale: true,
          expiresAt: true,
          createdAt: true,
        },
      }),
      prisma.staffShift.findMany({
        where: { tenantId: staff.tenantId, venueId: staff.venueId },
        orderBy: { startedAt: "desc" },
        take: 20,
        include: {
          membership: {
            include: { user: { select: { displayName: true } } },
          },
          recordedPayments: {
            where: { status: "RECORDED" },
            select: { amountMinor: true },
          },
        },
      }),
    ]);

    return {
      members: memberships.map((membership) => ({
        id: membership.id,
        displayName: membership.user.displayName,
        email: membership.user.email,
        role: membership.role,
        active: membership.active,
        preferredLocale: membership.staffProfile?.preferredLocale ?? "SQ",
        employeeRef: membership.staffProfile?.employeeRef ?? null,
        currentShift: membership.staffShifts[0]
          ? {
              id: membership.staffShifts[0].id,
              startedAt: membership.staffShifts[0].startedAt,
              assignments: membership.staffShifts[0].assignments.map(
                (assignment) => ({
                  id: assignment.id,
                  tableId: assignment.table.id,
                  tableLabel: assignment.table.label,
                }),
              ),
            }
          : null,
      })),
      tables: tables.map((table) => ({
        id: table.id,
        label: table.label,
        assignment: table.assignments[0]
          ? {
              id: table.assignments[0].id,
              membershipId: table.assignments[0].shift.membershipId,
              displayName:
                table.assignments[0].shift.membership.user.displayName,
            }
          : null,
      })),
      pendingInvitations: invitations,
      recentShifts: shifts.map((shift) => ({
        id: shift.id,
        membershipId: shift.membershipId,
        displayName: shift.membership.user.displayName,
        role: shift.membership.role,
        status: shift.status,
        startedAt: shift.startedAt,
        endedAt: shift.endedAt,
        paymentTotalMinor: shift.recordedPayments.reduce(
          (total, payment) => total + payment.amountMinor,
          0,
        ),
      })),
    };
  },

  async invite(input) {
    assertStaffPermission(input.staff.role, "TEAM_MANAGE");
    if (input.staff.role === "MANAGER" && input.role === "OWNER") {
      throw new TeamConflictError("Only an owner can invite another owner");
    }
    const email = input.email.trim().toLowerCase();
    const existingMembership = await prisma.membership.findFirst({
      where: {
        tenantId: input.staff.tenantId,
        venueId: input.staff.venueId,
        user: { email },
      },
    });
    if (existingMembership) {
      throw new TeamConflictError("This person is already a venue member");
    }

    const invitationToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + invitationLifetimeMilliseconds);
    const invitation = await prisma.$transaction(async (transaction) => {
      await transaction.staffInvitation.deleteMany({
        where: {
          tenantId: input.staff.tenantId,
          venueId: input.staff.venueId,
          email,
          acceptedAt: null,
        },
      });
      const created = await transaction.staffInvitation.create({
        data: {
          tenantId: input.staff.tenantId,
          venueId: input.staff.venueId,
          email,
          role: input.role,
          preferredLocale: input.preferredLocale.toUpperCase() as
            "EN" | "DE" | "IT" | "SQ",
          tokenHash: hashOpaqueToken(invitationToken),
          invitedByUserId: input.staff.userId,
          expiresAt,
        },
        select: {
          id: true,
          email: true,
          role: true,
          preferredLocale: true,
          expiresAt: true,
          createdAt: true,
        },
      });
      await transaction.auditEvent.create({
        data: {
          tenantId: input.staff.tenantId,
          venueId: input.staff.venueId,
          actorUserId: input.staff.userId,
          actorMembershipId: input.staff.membershipId,
          action: "STAFF_INVITED",
          entityType: "StaffInvitation",
          entityId: created.id,
          metadata: { email, role: input.role },
        },
      });
      return created;
    });
    return { invitationToken, invitation };
  },

  async acceptInvitation(input) {
    const tokenHash = hashOpaqueToken(input.token);
    const passwordHash = await hashPassword(input.password);
    return prisma.$transaction(async (transaction) => {
      const invitation = await transaction.staffInvitation.findFirst({
        where: { tokenHash, acceptedAt: null, expiresAt: { gt: new Date() } },
        include: { tenant: true, venue: true },
      });
      if (!invitation) throw new TeamResourceNotFoundError("Invitation");

      const user = await transaction.user.upsert({
        where: {
          tenantId_email: {
            tenantId: invitation.tenantId,
            email: invitation.email,
          },
        },
        create: {
          tenantId: invitation.tenantId,
          email: invitation.email,
          displayName: input.displayName.trim(),
          passwordHash,
        },
        update: {
          displayName: input.displayName.trim(),
          passwordHash,
          active: true,
        },
      });
      const membership = await transaction.membership.upsert({
        where: {
          venueId_userId: { venueId: invitation.venueId, userId: user.id },
        },
        create: {
          tenantId: invitation.tenantId,
          venueId: invitation.venueId,
          userId: user.id,
          role: invitation.role,
        },
        update: { role: invitation.role, active: true },
      });
      await transaction.staffProfile.upsert({
        where: { membershipId: membership.id },
        create: {
          tenantId: invitation.tenantId,
          venueId: invitation.venueId,
          userId: user.id,
          membershipId: membership.id,
          preferredLocale: invitation.preferredLocale,
        },
        update: { preferredLocale: invitation.preferredLocale },
      });
      await transaction.staffInvitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      });
      return {
        tenantSlug: invitation.tenant.slug,
        venueSlug: invitation.venue.slug,
        email: invitation.email,
      };
    });
  },

  async updateMember(input) {
    assertStaffPermission(input.staff.role, "TEAM_MANAGE");
    if (
      input.membershipId === input.staff.membershipId &&
      (input.role !== undefined || input.active === false)
    ) {
      throw new TeamConflictError("You cannot change or disable your own role");
    }
    const member = await prisma.membership.findFirst({
      where: {
        id: input.membershipId,
        tenantId: input.staff.tenantId,
        venueId: input.staff.venueId,
      },
    });
    if (!member) throw new TeamResourceNotFoundError("Team member");
    if (
      input.staff.role === "MANAGER" &&
      (member.role === "OWNER" || input.role === "OWNER")
    ) {
      throw new TeamConflictError("A manager cannot change an owner role");
    }

    return prisma.$transaction(async (transaction) => {
      const updated = await transaction.membership.update({
        where: { id: member.id },
        data: {
          ...(input.role ? { role: input.role } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
        },
        include: { user: { select: { displayName: true, email: true } } },
      });
      if (input.active === false) {
        await transaction.staffSession.updateMany({
          where: { membershipId: member.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await transaction.tableAssignment.updateMany({
          where: {
            endedAt: null,
            shift: { membershipId: member.id, status: "OPEN" },
          },
          data: { endedAt: new Date(), activeTableKey: null },
        });
        await transaction.serviceSignal.updateMany({
          where: {
            assignedMembershipId: member.id,
            acknowledgedAt: null,
          },
          data: {
            assignedMembershipId: null,
            assignedUserId: null,
            assignedShiftId: null,
            assignedByUserId: null,
            claimedAt: null,
          },
        });
        await transaction.staffShift.updateMany({
          where: { membershipId: member.id, status: "OPEN" },
          data: { status: "CLOSED", activeShiftKey: null, endedAt: new Date() },
        });
      }
      if (input.preferredLocale) {
        await transaction.staffProfile.upsert({
          where: { membershipId: member.id },
          create: {
            tenantId: input.staff.tenantId,
            venueId: input.staff.venueId,
            userId: member.userId,
            membershipId: member.id,
            preferredLocale: input.preferredLocale.toUpperCase() as
              "EN" | "DE" | "IT" | "SQ",
          },
          update: {
            preferredLocale: input.preferredLocale.toUpperCase() as
              "EN" | "DE" | "IT" | "SQ",
          },
        });
      }
      await transaction.auditEvent.create({
        data: {
          tenantId: input.staff.tenantId,
          venueId: input.staff.venueId,
          actorUserId: input.staff.userId,
          actorMembershipId: input.staff.membershipId,
          action: "STAFF_UPDATED",
          entityType: "Membership",
          entityId: member.id,
          metadata: {
            role: input.role ?? member.role,
            active: input.active ?? member.active,
          },
        },
      });
      return updated;
    });
  },

  async assignTable(input) {
    assertStaffPermission(input.staff.role, "TABLE_ASSIGN");
    const [member, table, shift] = await Promise.all([
      prisma.membership.findFirst({
        where: {
          id: input.membershipId,
          tenantId: input.staff.tenantId,
          venueId: input.staff.venueId,
          active: true,
        },
      }),
      prisma.diningTable.findFirst({
        where: {
          id: input.tableId,
          tenantId: input.staff.tenantId,
          venueId: input.staff.venueId,
        },
      }),
      prisma.staffShift.findFirst({
        where: {
          membershipId: input.membershipId,
          venueId: input.staff.venueId,
          status: "OPEN",
        },
      }),
    ]);
    if (!member) throw new TeamResourceNotFoundError("Team member");
    if (!table) throw new TeamResourceNotFoundError("Table");
    if (!shift)
      throw new TeamConflictError("The selected worker has no active shift");

    return prisma.$transaction(async (transaction) => {
      await transaction.tableAssignment.updateMany({
        where: { tableId: table.id, endedAt: null },
        data: { endedAt: new Date(), activeTableKey: null },
      });
      const assignment = await transaction.tableAssignment.create({
        data: {
          tenantId: input.staff.tenantId,
          venueId: input.staff.venueId,
          tableId: table.id,
          shiftId: shift.id,
          activeTableKey: table.id,
        },
      });
      await transaction.auditEvent.create({
        data: {
          tenantId: input.staff.tenantId,
          venueId: input.staff.venueId,
          actorUserId: input.staff.userId,
          actorMembershipId: input.staff.membershipId,
          action: "TABLE_ASSIGNED",
          entityType: "TableAssignment",
          entityId: assignment.id,
          metadata: { tableId: table.id, membershipId: member.id },
        },
      });
      return assignment;
    });
  },

  async endAssignment(input) {
    assertStaffPermission(input.staff.role, "TABLE_ASSIGN");
    const result = await prisma.tableAssignment.updateMany({
      where: {
        id: input.assignmentId,
        tenantId: input.staff.tenantId,
        venueId: input.staff.venueId,
        endedAt: null,
      },
      data: { endedAt: new Date(), activeTableKey: null },
    });
    if (!result.count) throw new TeamResourceNotFoundError("Assignment");
  },
};
