import {
  assertNoOverlappingScheduleAssignments,
  assertStaffPermission,
  InvalidScheduleAssignmentError,
  type ScheduleAssignmentInput,
  type StaffRole,
} from "@flowgastronomie/domain";

import { workforceRepository } from "./workforce-repository.js";
import { workforceLocal } from "@flowgastronomie/domain";
import { randomUUID } from "node:crypto";
import { prisma } from "./client.js";
import { Prisma } from "@prisma/client";
import type { StaffIdentity } from "./staff-auth-repository.js";

export class ScheduleResourceNotFoundError extends Error {
  constructor(resource: string) {
    super(`${resource} was not found in this venue`);
    this.name = "ScheduleResourceNotFoundError";
  }
}

export class ScheduleConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScheduleConflictError";
  }
}

type ScheduleInput = {
  weekStartsOn: Date;
  status: "DRAFT" | "PUBLISHED";
  assignments: (ScheduleAssignmentInput & { id?: string | undefined })[];
  expectedVersion?: number | undefined;
};

function sameScope(staff: StaffIdentity) {
  return { tenantId: staff.tenantId, venueId: staff.venueId };
}

async function assertMembership(membershipId: string, staff: StaffIdentity) {
  const membership = await prisma.membership.findFirst({
    where: { id: membershipId, ...sameScope(staff), active: true },
    select: { id: true },
  });
  if (!membership) throw new ScheduleResourceNotFoundError("Staff member");
}

async function assertTaskScope(
  scope: "VENUE" | "SHIFT" | "TABLE" | "ORDER",
  scopeId: string | null,
  staff: StaffIdentity,
) {
  if (scope === "VENUE") {
    if (scopeId)
      throw new ScheduleConflictError(
        "Venue tasks cannot reference another resource",
      );
    return;
  }
  if (!scopeId)
    throw new ScheduleConflictError(
      "This task scope requires a venue resource",
    );
  const where = { id: scopeId, ...sameScope(staff) };
  const resource =
    scope === "SHIFT"
      ? await prisma.staffShift.findFirst({ where, select: { id: true } })
      : scope === "TABLE"
        ? await prisma.diningTable.findFirst({ where, select: { id: true } })
        : await prisma.order.findFirst({ where, select: { id: true } });
  if (!resource)
    throw new ScheduleResourceNotFoundError(
      `${scope.toLowerCase()} task resource`,
    );
}

export type StaffScheduleRepository = {
  list(input: { staff: StaffIdentity; weekStartsOn: Date }): Promise<unknown>;
  save(input: { staff: StaffIdentity } & ScheduleInput): Promise<unknown>;
  addAvailability(input: {
    staff: StaffIdentity;
    membershipId: string;
    startsAt: Date;
    endsAt: Date;
    note: string;
  }): Promise<unknown>;
  createTask(input: {
    staff: StaffIdentity;
    scope: "VENUE" | "SHIFT" | "TABLE" | "ORDER";
    scopeId: string | null;
    title: string;
    dueAt: Date | null;
    priority: "LOW" | "NORMAL" | "HIGH";
    assigneeMembershipId: string | null;
  }): Promise<unknown>;
  completeTask(input: {
    staff: StaffIdentity;
    taskId: string;
  }): Promise<unknown>;
  addHandover(input: {
    staff: StaffIdentity;
    shiftId: string | null;
    body: string;
  }): Promise<unknown>;
};

export const staffScheduleRepository: StaffScheduleRepository = {
  async list({ staff, weekStartsOn }) {
    assertStaffPermission(staff.role, "SCHEDULE_VIEW");
    assertStaffPermission(staff.role, "TASK_VIEW");
    const leadership = staff.role === "OWNER" || staff.role === "MANAGER";
    const scope = sameScope(staff);
    const [schedule, availability, tasks, handovers, members] =
      await Promise.all([
        prisma.venueSchedule.findFirst({
          where: {
            ...scope,
            weekStartsOn,
            ...(leadership
              ? {}
              : { publishedSnapshot: { not: Prisma.JsonNull } }),
          },
          include: {
            assignments: {
              orderBy: { startsAt: "asc" },
              include: {
                membership: {
                  include: { user: { select: { displayName: true } } },
                },
              },
            },
          },
        }),
        prisma.staffAvailabilityNote.findMany({
          where: {
            ...scope,
            ...(leadership ? {} : { membershipId: staff.membershipId }),
          },
          orderBy: { startsAt: "asc" },
        }),
        prisma.operationalTask.findMany({
          where: {
            ...scope,
            ...(leadership ? {} : { assigneeMembershipId: staff.membershipId }),
          },
          orderBy: [
            { completedAt: "asc" },
            { dueAt: "asc" },
            { createdAt: "desc" },
          ],
          take: 100,
        }),
        prisma.shiftHandoverNote.findMany({
          where: scope,
          orderBy: { createdAt: "desc" },
          take: 30,
        }),
        leadership
          ? prisma.membership.findMany({
              where: { ...scope, active: true },
              include: { user: { select: { displayName: true } } },
              orderBy: { user: { displayName: "asc" } },
            })
          : Promise.resolve([]),
      ]);
    const canonical = (
      await workforceRepository.workspace(
        staff,
        weekStartsOn.toISOString().slice(0, 10),
        weekStartsOn.toISOString().slice(0, 10),
      )
    ).schedules.find((a) => a.week === weekStartsOn.toISOString().slice(0, 10));
    return {
      viewer: { membershipId: staff.membershipId, role: staff.role },
      schedule: canonical
        ? {
            id: canonical.id,
            weekStartsOn,
            status: canonical.status,
            version: canonical.version,
            assignments: canonical.snapshot.assignments,
          }
        : null,
      members: members.map((member) => ({
        id: member.id,
        displayName: member.user.displayName,
        role: member.role,
      })),
      availability,
      tasks,
      handovers,
    };
  },

  async save({ staff, weekStartsOn, status, assignments, expectedVersion }) {
    assertStaffPermission(staff.role, "SCHEDULE_MANAGE");
    assertNoOverlappingScheduleAssignments(assignments);
    const venue = await prisma.venue.findFirstOrThrow({
      where: { id: staff.venueId, tenantId: staff.tenantId },
      select: { timezone: true },
    });
    await workforceRepository.saveSchedule(staff, {
      week: weekStartsOn.toISOString().slice(0, 10),
      expectedVersion: expectedVersion ?? 0,
      status,
      reviewConfirmed: status === "PUBLISHED",
      assignments: assignments.map((a) => ({
        id: a.id ?? randomUUID(),
        membershipId: a.membershipId,
        station: a.role === "KITCHEN" || a.role === "BAR" ? a.role : "SERVICE",
        startsLocal: workforceLocal(a.startsAt.toISOString(), venue.timezone),
        endsLocal: workforceLocal(a.endsAt.toISOString(), venue.timezone),
        breakMinutes: 0,
        note: "",
        requiredSkills: [],
      })),
    });
    return staffScheduleRepository.list({ staff, weekStartsOn });
  },

  async addAvailability({ staff, membershipId, startsAt, endsAt, note }) {
    assertStaffPermission(staff.role, "SCHEDULE_VIEW");
    if (membershipId !== staff.membershipId)
      assertStaffPermission(staff.role, "SCHEDULE_MANAGE");
    if (endsAt <= startsAt)
      throw new InvalidScheduleAssignmentError(
        "Availability needs a valid time range",
      );
    await assertMembership(membershipId, staff);
    return prisma.staffAvailabilityNote.create({
      data: {
        ...sameScope(staff),
        membershipId,
        startsAt,
        endsAt,
        note,
        createdByUserId: staff.userId,
      },
    });
  },

  async createTask({ staff, assigneeMembershipId, ...input }) {
    assertStaffPermission(staff.role, "TASK_MANAGE");
    await assertTaskScope(input.scope, input.scopeId, staff);
    if (assigneeMembershipId)
      await assertMembership(assigneeMembershipId, staff);
    return prisma.operationalTask.create({
      data: {
        ...sameScope(staff),
        ...input,
        assigneeMembershipId,
        createdByUserId: staff.userId,
        createdByMembershipId: staff.membershipId,
      },
    });
  },

  async completeTask({ staff, taskId }) {
    assertStaffPermission(staff.role, "TASK_MANAGE");
    const task = await prisma.operationalTask.findFirst({
      where: { id: taskId, ...sameScope(staff) },
    });
    if (!task) throw new ScheduleResourceNotFoundError("Task");
    if (
      staff.role !== "OWNER" &&
      staff.role !== "MANAGER" &&
      task.assigneeMembershipId !== staff.membershipId
    ) {
      throw new ScheduleConflictError(
        "Only the assigned staff member or management can complete this task",
      );
    }
    return prisma.operationalTask.update({
      where: { id: task.id },
      data: { completedAt: new Date(), completedByUserId: staff.userId },
    });
  },

  async addHandover({ staff, shiftId, body }) {
    assertStaffPermission(staff.role, "TASK_MANAGE");
    if (shiftId) await assertTaskScope("SHIFT", shiftId, staff);
    return prisma.shiftHandoverNote.create({
      data: {
        ...sameScope(staff),
        shiftId,
        body,
        createdByUserId: staff.userId,
        createdByMembershipId: staff.membershipId,
      },
    });
  },
};
