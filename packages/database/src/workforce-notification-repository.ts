import { workforceAttendanceIdsInWindow } from "./workforce-attendance-projection.js";
import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import {
  assertStaffPermission,
  hasStaffPermission,
  StaffPermissionDeniedError,
  WorkforceError,
  workforceNotificationCategories,
  workforceNotificationPreferenceSchema,
  workforceNotificationCopy,
  workforceNotificationPath,
  workforceNoticeLinkSchema,
  workforceNoticeImportant,
  workforcePushSubscriptionSchema,
  assertWorkforceNoticeAcknowledgment,
  workforceDeliveryRetry,
  workforceToday,
  type WorkforceNotificationCategory,
  type WorkforceNoticeLink,
  type PlatformLocale,
  type WorkforcePublishedEvent,
} from "@flowgastronomie/domain";
import { prisma } from "./client.js";
import {
  requireWorkforceActor,
  lockWorkforceTenant,
  appendWorkforceAudit,
} from "./workforce-transaction.js";
import type { StaffIdentity } from "./staff-auth-repository.js";
type Tx = Prisma.TransactionClient;
const scope = (s: { tenantId: string; venueId: string }) => ({
  tenantId: s.tenantId,
  venueId: s.venueId,
});
const json = (v: unknown) =>
  JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const missing = () =>
  new WorkforceError(
    "NOT_FOUND",
    "Notification was not found in your authorized workspace.",
  );
function locale(v: string): PlatformLocale {
  return ["sq", "de", "en", "it"].includes(v.toLowerCase())
    ? (v.toLowerCase() as PlatformLocale)
    : "sq";
}
export type WorkforceNoticeInput = {
  tenantId: string;
  venueId: string;
  userId: string;
  eventKey: string;
  sourceKind: string;
  subjectId: string;
  requiredPermission: "SELF" | "VENUE_MANAGER";
  category: WorkforceNotificationCategory;
  link: WorkforceNoticeLink;
  sourceVersionId?: string;
  subjectUserId?: string;
  validUntil?: string;
  createdAt: Date;
};
async function preferences(tx: Tx, s: StaffIdentity) {
  const row = await tx.workforceNotificationPreference.findFirst({
    where: { ...scope(s), userId: s.userId },
  });
  const profile = await tx.staffProfile.findFirst({
    where: { ...scope(s), userId: s.userId, membershipId: s.membershipId },
    select: { preferredLocale: true },
  });
  return row
    ? {
        id: row.id,
        version: row.version,
        locale: locale(row.locale),
        emailEnabled: row.emailEnabled,
        pushEnabled: row.pushEnabled,
        reminderMinutes: row.reminderMinutes,
        categories: row.categories,
      }
    : {
        id: null,
        version: 0,
        locale: locale(profile?.preferredLocale ?? "sq"),
        emailEnabled: false,
        pushEnabled: false,
        reminderMinutes: 60,
        categories: [...workforceNotificationCategories],
      };
}
export async function enqueueWorkforceNotice(
  tx: Tx,
  input: WorkforceNoticeInput,
) {
  workforceNoticeLinkSchema.parse(input.link);
  const member = await tx.membership.findFirst({
    where: {
      ...scope(input),
      userId: input.userId,
      active: true,
      user: { active: true },
      ...(input.requiredPermission === "VENUE_MANAGER"
        ? { role: { in: ["OWNER", "MANAGER"] } }
        : {}),
    },
    include: { staffProfile: { select: { preferredLocale: true } } },
  });
  if (!member) return null;
  const pref = await tx.workforceNotificationPreference.findFirst({
    where: { ...scope(input), userId: input.userId },
  });
  const key = {
    ...scope(input),
    eventKey: input.eventKey,
    userId: input.userId,
  };
  await tx.workforceNotification.createMany({
    data: [
      {
        ...key,
        membershipId: member.id,
        schemaVersion: 1,
        sourceKind: input.sourceKind,
        subjectId: input.subjectId,
        requiredPermission: input.requiredPermission,
        category: input.category,
        locale: locale(
          pref?.locale ?? member.staffProfile?.preferredLocale ?? "sq",
        ),
        important: workforceNoticeImportant(input.category),
        payload: json({
          schemaVersion: 1,
          link: input.link,
          ...(input.sourceVersionId
            ? { sourceVersionId: input.sourceVersionId }
            : {}),
          ...(input.subjectUserId
            ? { subjectUserId: input.subjectUserId }
            : {}),
          ...(input.validUntil ? { validUntil: input.validUntil } : {}),
        }),
        createdAt: input.createdAt,
      },
    ],
    skipDuplicates: true,
  });
  const notice = await tx.workforceNotification.findUniqueOrThrow({
    where: { tenantId_venueId_eventKey_userId: key },
  });
  // Both channel rows are durable even when opt-in/provider is disabled. Inbox
  // is mandatory for relevant business events and never depends on email success.
  for (const channel of ["EMAIL", "PUSH"]) {
    const enabled =
      !!pref &&
      (channel === "EMAIL" ? pref.emailEnabled : pref.pushEnabled) &&
      pref.categories.includes(input.category);
    await tx.workforceNotificationDelivery.createMany({
      data: [
        {
          ...scope(input),
          notificationId: notice.id,
          userId: input.userId,
          channel,
          state: enabled ? "PENDING" : "DISABLED",
          lastCode: enabled ? null : "PREFERENCE_DISABLED",
          nextAttemptAt: input.createdAt,
          createdAt: input.createdAt,
        },
      ],
      skipDuplicates: true,
    });
  }
  return notice;
}
export async function enqueueWorkforceOperationIntent(
  tx: Tx,
  event: Prisma.WorkforceEventIntentGetPayload<object>,
) {
  const recipients = [...new Set(event.recipientUserIds)];
  if (recipients.length) {
    const existing = await tx.workforceNotification.findMany({
      where: {
        ...scope(event),
        eventKey: "OPERATION:" + event.id,
        userId: { in: recipients },
      },
      select: { id: true, userId: true },
    });
    if (
      existing.length === recipients.length &&
      (await tx.workforceNotificationDelivery.count({
        where: {
          ...scope(event),
          notificationId: { in: existing.map((n) => n.id) },
          channel: { in: ["EMAIL", "PUSH"] },
        },
      })) ===
        existing.length * 2
    )
      return;
  }
  const request = await tx.workforceRequest.findFirst({
    where: { ...scope(event), id: event.subjectId },
    select: {
      id: true,
      userId: true,
      invitedUserId: true,
      kind: true,
      startsAt: true,
    },
  });
  const attendance = request
    ? null
    : await tx.workforceAttendance.findFirst({
        where: { ...scope(event), id: event.subjectId },
        select: { id: true, userId: true, startedAt: true },
      });
  let category: WorkforceNotificationCategory | null = null;
  if (event.type === "ATTENDANCE_APPROVED") category = "ATTENDANCE_APPROVED";
  else if (
    event.type === "ATTENDANCE_REVIEW_REQUIRED" ||
    event.type === "CLOCK_EXCEPTION"
  )
    category = "APPROVAL_REQUIRED";
  else if (request?.kind === "LEAVE")
    category = event.type.endsWith("REQUESTED")
      ? "LEAVE_REQUEST"
      : "LEAVE_DECISION";
  else if (request?.kind === "CORRECTION")
    category = event.type.endsWith("REQUESTED")
      ? "APPROVAL_REQUIRED"
      : "CORRECTION_DECISION";
  else if (request)
    category = event.type.endsWith("REQUESTED")
      ? "SHIFT_REQUEST"
      : "SHIFT_DECISION";
  const venue = await tx.venue.findFirstOrThrow({
    where: { tenantId: event.tenantId, id: event.venueId },
    select: { timezone: true },
  });
  const sourceDate = request?.startsAt ?? attendance?.startedAt;
  const date = sourceDate
    ? workforceToday(venue.timezone, sourceDate)
    : undefined;
  if (!category) return;
  for (const userId of event.recipientUserIds) {
    const self =
      userId === (request?.userId ?? attendance?.userId) ||
      userId === request?.invitedUserId;
    await enqueueWorkforceNotice(tx, {
      ...scope(event),
      userId,
      eventKey: "OPERATION:" + event.id,
      sourceKind: "OPERATION",
      subjectId: event.subjectId,
      requiredPermission: self ? "SELF" : "VENUE_MANAGER",
      category,
      link: request
        ? {
            tab: request.kind === "LEAVE" ? "leave" : "requests",
            requestId: request.id,
            ...(date ? { date } : {}),
          }
        : {
            tab: self ? "hours" : "operations",
            ...(attendance ? { attendanceId: attendance.id } : {}),
            ...(date ? { date } : {}),
          },
      createdAt: event.createdAt,
    });
  }
}
export async function enqueueWorkforcePublication(
  tx: Tx,
  event: WorkforcePublishedEvent,
) {
  if (event.type === "SCHEDULE_PUBLISHED") {
    for (const userId of event.recipientUserIds)
      await enqueueWorkforceNotice(tx, {
        ...scope(event),
        userId,
        eventKey: "PUBLICATION:" + event.eventId,
        sourceKind: "SCHEDULE",
        subjectId: event.scheduleId,
        requiredPermission: "SELF",
        category: "SCHEDULE_PUBLISHED",
        link: { tab: "today" },
        createdAt: new Date(event.occurredAt),
      });
  } else
    for (const change of event.changes)
      for (const userId of new Set(
        [change.before?.userId, change.after?.userId].filter(
          (id): id is string => !!id,
        ),
      )) {
        const cancelled = change.after?.userId !== userId,
          category = cancelled
            ? "SHIFT_CANCELLED"
            : change.before?.userId === userId
              ? "SHIFT_CHANGED"
              : "SCHEDULE_PUBLISHED";
        await enqueueWorkforceNotice(tx, {
          ...scope(event),
          userId,
          eventKey: "PUBLICATION:" + event.eventId + ":" + change.id,
          sourceKind: "SCHEDULE",
          subjectId: change.id,
          requiredPermission: "SELF",
          category,
          link: { tab: "today", assignmentId: change.id },
          createdAt: new Date(event.occurredAt),
        });
      }
}
function authorizedNotice(s: StaffIdentity) {
  return {
    OR: [
      { requiredPermission: "SELF" },
      ...(hasStaffPermission(s.role, "SCHEDULE_MANAGE")
        ? [{ requiredPermission: "VENUE_MANAGER" }]
        : []),
    ],
  };
}
/** Shared parameterized query for inbox counting and PostgreSQL plan verification.
 * The receipt's composite FK binds its tenant/venue/user to this exact notice;
 * its unique notificationId index is sufficient for the anti-join. Avoid redundant
 * correlated scope predicates that can favor a broad user index in generic plans.
 */
export function workforceUnreadCountQuery(s: StaffIdentity) {
  const permissions = hasStaffPermission(s.role, "SCHEDULE_MANAGE")
    ? ["SELF", "VENUE_MANAGER"]
    : ["SELF"];
  return Prisma.sql`
    SELECT count(*) AS unread FROM "WorkforceNotification" n
    WHERE n."tenantId" = ${s.tenantId} AND n."venueId" = ${s.venueId}
      AND n."userId" = ${s.userId} AND n."membershipId" = ${s.membershipId}
      AND n."requiredPermission" IN (${Prisma.join(permissions)})
      AND NOT EXISTS (
        SELECT 1 FROM "WorkforceNotificationReceipt" r
        WHERE r."notificationId" = n.id AND r."readAt" IS NOT NULL
      )`;
}
async function ownedNotice(tx: Tx, s: StaffIdentity, id: string) {
  const n = await tx.workforceNotification.findFirst({
    where: {
      ...scope(s),
      userId: s.userId,
      membershipId: s.membershipId,
      id,
      ...authorizedNotice(s),
    },
  });
  if (!n) throw missing();
  return n;
}
export const workforceNotificationRepository = {
  async inbox(s: StaffIdentity, lang: PlatformLocale, cursor?: string) {
    assertStaffPermission(s.role, "SCHEDULE_VIEW");
    return prisma.$transaction(
      async (tx) => {
        await requireWorkforceActor(tx, s);
        const where = {
          ...scope(s),
          userId: s.userId,
          membershipId: s.membershipId,
          ...authorizedNotice(s),
        };
        if (
          cursor &&
          !(await tx.workforceNotification.findFirst({
            where: { ...where, id: cursor },
          }))
        )
          throw missing();
        const notices = await tx.workforceNotification.findMany({
          where,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 101,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        const ids = notices.slice(0, 100).map((n) => n.id),
          receipts = await tx.workforceNotificationReceipt.findMany({
            where: {
              ...scope(s),
              userId: s.userId,
              notificationId: { in: ids },
            },
          });
        const deliveries = await tx.workforceNotificationDelivery.findMany({
          where: { ...scope(s), userId: s.userId, notificationId: { in: ids } },
          select: {
            notificationId: true,
            channel: true,
            state: true,
            attemptCount: true,
            lastCode: true,
            deliveredAt: true,
          },
        });
        // Count in PostgreSQL: historical receipt IDs never enter application memory.
        // Notification scope/user index and the unique receipt notification index
        // support the anti-join; purpose visibility matches the paginated read.
        const [count] = await tx.$queryRaw<{ unread: bigint }[]>(
          workforceUnreadCountQuery(s),
        );
        const unread = Number(count!.unread);
        return {
          schemaVersion: 1,
          unreadCount: unread,
          nextCursor: notices.length > 100 ? notices[99]!.id : null,
          preferences: await preferences(tx, s),
          items: notices.slice(0, 100).map((n) => {
            const receipt = receipts.find((r) => r.notificationId === n.id),
              link = workforceNoticeLinkSchema.parse(
                (n.payload as { link: unknown }).link,
              );
            return {
              id: n.id,
              schemaVersion: n.schemaVersion,
              category: n.category,
              important: n.important,
              createdAt: n.createdAt.toISOString(),
              readAt: receipt?.readAt?.toISOString() ?? null,
              acknowledgedAt: receipt?.acknowledgedAt?.toISOString() ?? null,
              ...workforceNotificationCopy(
                n.category as WorkforceNotificationCategory,
                lang,
              ),
              href: workforceNotificationPath(lang, link),
              delivery: deliveries
                .filter((d) => d.notificationId === n.id)
                .map((d) => ({
                  channel: d.channel,
                  state: d.state,
                  attempts: d.attemptCount,
                  code: d.lastCode,
                  deliveredAt: d.deliveredAt?.toISOString() ?? null,
                })),
            };
          }),
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 20000,
      },
    );
  },
  async mark(
    s: StaffIdentity,
    id: string,
    acknowledge: boolean,
    confirmed: boolean,
    now = new Date(),
  ) {
    assertStaffPermission(s.role, "SCHEDULE_VIEW");
    return prisma.$transaction(async (tx) => {
      await lockWorkforceTenant(tx, s);
      await requireWorkforceActor(tx, s);
      const n = await ownedNotice(tx, s, id);
      if (acknowledge)
        assertWorkforceNoticeAcknowledgment(n.important, confirmed);
      const old = await tx.workforceNotificationReceipt.findUnique({
        where: { notificationId: id },
      });
      if (old?.readAt && (!acknowledge || old.acknowledgedAt))
        return {
          readAt: old.readAt.toISOString(),
          acknowledgedAt: old.acknowledgedAt?.toISOString() ?? null,
        };
      const row = old
        ? await tx.workforceNotificationReceipt.update({
            where: { id: old.id },
            data: {
              version: { increment: 1 },
              readAt: old.readAt ?? now,
              ...(acknowledge ? { acknowledgedAt: now } : {}),
            },
          })
        : await tx.workforceNotificationReceipt.create({
            data: {
              ...scope(s),
              userId: s.userId,
              notificationId: id,
              readAt: now,
              acknowledgedAt: acknowledge ? now : null,
            },
          });
      await appendWorkforceAudit(
        tx,
        s,
        acknowledge ? "WORKFORCE_NOTICE_ACKNOWLEDGED" : "WORKFORCE_NOTICE_READ",
        id,
        now,
      );
      return {
        readAt: row.readAt!.toISOString(),
        acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
      };
    });
  },
  async savePreferences(s: StaffIdentity, value: unknown, now = new Date()) {
    const b = workforceNotificationPreferenceSchema.parse(value);
    assertStaffPermission(s.role, "SCHEDULE_VIEW");
    return prisma.$transaction(async (tx) => {
      await lockWorkforceTenant(tx, s);
      await requireWorkforceActor(tx, s);
      const old = await preferences(tx, s);
      if (b.expectedVersion !== old.version)
        throw new WorkforceError(
          "CONFLICT",
          "Notification preferences changed. Reload before saving.",
        );
      const data = {
        locale: b.locale,
        emailEnabled: b.emailEnabled,
        pushEnabled: b.pushEnabled,
        reminderMinutes: b.reminderMinutes,
        categories: b.categories,
      };
      const row = old.id
        ? await tx.workforceNotificationPreference.update({
            where: { id: old.id },
            data: { ...data, version: { increment: 1 } },
          })
        : await tx.workforceNotificationPreference.create({
            data: {
              ...scope(s),
              userId: s.userId,
              membershipId: s.membershipId,
              ...data,
              version: 1,
            },
          });
      await tx.workforceNotificationPreferenceRevision.create({
        data: {
          ...scope(s),
          userId: s.userId,
          preferenceId: row.id,
          version: row.version,
          before: json(old),
          after: json(data),
          actorUserId: s.userId,
          createdAt: now,
        },
      });
      if (!b.pushEnabled)
        await tx.workforcePushSubscription.updateMany({
          where: { ...scope(s), userId: s.userId, active: true },
          data: { active: false },
        });
      await appendWorkforceAudit(
        tx,
        s,
        "WORKFORCE_NOTIFICATION_PREFERENCES",
        row.id,
        now,
        { schemaVersion: 1, version: row.version },
      );
      return preferences(tx, s);
    });
  },
  async subscribe(s: StaffIdentity, value: unknown, now = new Date()) {
    const b = workforcePushSubscriptionSchema.parse(value);
    return prisma.$transaction(async (tx) => {
      await lockWorkforceTenant(tx, s);
      await requireWorkforceActor(tx, s);
      const pref = await preferences(tx, s);
      if (!pref.pushEnabled)
        throw new WorkforceError(
          "APPROVAL",
          "Enable push preferences with explicit consent first.",
        );
      const endpointHash = createHash("sha256")
        .update(JSON.stringify(b.subscription))
        .digest("hex");
      // One current browser endpoint per user/venue. Previous endpoints and attempts
      // are retained; no subscription key is exposed through inbox/team APIs.
      await tx.workforcePushSubscription.updateMany({
        where: {
          ...scope(s),
          userId: s.userId,
          endpointHash: { not: endpointHash },
          active: true,
        },
        data: { active: false },
      });
      const row = await tx.workforcePushSubscription.upsert({
        where: {
          tenantId_venueId_userId_endpointHash: {
            ...scope(s),
            userId: s.userId,
            endpointHash,
          },
        },
        create: {
          ...scope(s),
          userId: s.userId,
          membershipId: s.membershipId,
          endpointHash,
          subscription: json(b.subscription),
        },
        update: { active: true },
      });
      await appendWorkforceAudit(tx, s, "WORKFORCE_PUSH_OPT_IN", row.id, now);
      return { id: row.id, active: row.active };
    });
  },
};

export type WorkforceDeliveryClaim = {
  id: string;
  leaseToken: string;
  attemptNumber: number;
  channel: string;
  notification: {
    id: string;
    category: string;
    locale: PlatformLocale;
    payload: Prisma.JsonValue;
    createdAt: Date;
  };
  recipient: string | null;
  subscription: Prisma.JsonValue | null;
  disabledCode: string | null;
  startedAt: Date;
};
async function deliveryRecipient(
  tx: Tx,
  delivery: Prisma.WorkforceNotificationDeliveryGetPayload<object>,
  n: Prisma.WorkforceNotificationGetPayload<object>,
  now: Date,
) {
  const member = await tx.membership.findFirst({
    where: {
      ...scope(n),
      id: n.membershipId,
      userId: n.userId,
      active: true,
      user: { active: true },
      ...(n.requiredPermission === "VENUE_MANAGER"
        ? { role: { in: ["OWNER", "MANAGER"] } }
        : {}),
    },
    include: {
      user: { select: { email: true } },
      staffProfile: { select: { preferredLocale: true } },
    },
  });
  if (!member)
    return {
      disabled: "RECIPIENT_UNAUTHORIZED",
      recipient: null,
      subscription: null,
      subscriptionId: null,
    };
  const payload = n.payload as {
    link?: { assignmentId?: string };
    sourceVersionId?: string;
    subjectUserId?: string;
    validUntil?: string;
  };
  if (
    n.sourceKind === "REMINDER" ||
    n.sourceKind === "PUBLISHED_MISSING_PUNCH"
  ) {
    const rows = await tx.publishedAssignmentRevision.findMany({
      where: { ...scope(n), assignmentId: n.subjectId },
      orderBy: { sequence: "desc" },
      take: 1,
      select: { id: true, after: true },
    });
    const a = rows[0]?.after as { userId?: string } | null | undefined;
    if (
      rows[0]?.id !== payload.sourceVersionId ||
      a?.userId !== (payload.subjectUserId ?? n.userId)
    )
      return {
        disabled: "STALE_SHIFT_REMINDER",
        recipient: null,
        subscription: null,
        subscriptionId: null,
      };
  }
  if (
    n.category === "MISSING_PUNCH" &&
    n.sourceKind === "ATTENDANCE_EXCEPTION" &&
    !(await tx.workforceAttendance.findFirst({
      where: { ...scope(n), id: n.subjectId, state: { not: "CLOSED" } },
      select: { id: true },
    }))
  )
    return {
      disabled: "ATTENDANCE_RESOLVED",
      recipient: null,
      subscription: null,
      subscriptionId: null,
    };
  if (n.sourceKind === "PUBLISHED_MISSING_PUNCH" && payload.subjectUserId) {
    const publication = await tx.publishedAssignmentRevision.findMany({
      where: { ...scope(n), assignmentId: n.subjectId },
      orderBy: { sequence: "desc" },
      take: 1,
      select: { after: true },
    });
    const a = publication[0]?.after as {
      startsAt: string;
      endsAt: string;
    } | null;
    if (a) {
      const attendance = await workforceAttendanceIdsInWindow(
        tx,
        { tenantId: n.tenantId, userId: payload.subjectUserId },
        { start: Date.parse(a.startsAt), end: Date.parse(a.endsAt) },
        now,
      );
      if (attendance.length)
        return {
          disabled: "ATTENDANCE_RESOLVED",
          recipient: null,
          subscription: null,
          subscriptionId: null,
        };
    }
  }
  if (n.category === "APPROVAL_REQUIRED") {
    const request = await tx.workforceRequest.findFirst({
      where: { ...scope(n), id: n.subjectId },
      select: { status: true },
    });
    if (request && !["PENDING", "ACCEPTED"].includes(request.status))
      return {
        disabled: "REQUEST_RESOLVED",
        recipient: null,
        subscription: null,
        subscriptionId: null,
      };
    if (!request) {
      const attendance = await tx.workforceAttendance.findFirst({
        where: { ...scope(n), id: n.subjectId },
        select: {
          version: true,
          approvals: { select: { attendanceVersion: true } },
        },
      });
      if (
        attendance?.approvals.some(
          (p) => p.attendanceVersion === attendance.version,
        )
      )
        return {
          disabled: "ATTENDANCE_APPROVED",
          recipient: null,
          subscription: null,
          subscriptionId: null,
        };
    }
  }
  const pref = await tx.workforceNotificationPreference.findFirst({
    where: { ...scope(n), userId: n.userId },
  });
  if (
    !pref ||
    !pref.categories.includes(n.category) ||
    !(delivery.channel === "EMAIL" ? pref.emailEnabled : pref.pushEnabled)
  )
    return {
      disabled: "PREFERENCE_DISABLED",
      recipient: null,
      subscription: null,
      subscriptionId: null,
    };
  if (delivery.channel === "EMAIL") {
    if (
      delivery.recipientAddress &&
      delivery.recipientAddress !== member.user.email
    )
      return {
        disabled: "RECIPIENT_CHANGED",
        recipient: null,
        subscription: null,
        subscriptionId: null,
      };
    return {
      disabled: null,
      recipient: member.user.email,
      subscription: null,
      subscriptionId: null,
    };
  }
  const subscription = await tx.workforcePushSubscription.findFirst({
    where: {
      ...scope(n),
      userId: n.userId,
      membershipId: n.membershipId,
      active: true,
      ...(delivery.subscriptionId ? { id: delivery.subscriptionId } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  return {
    disabled: subscription ? null : "PUSH_SUBSCRIPTION_UNAVAILABLE",
    recipient: null,
    subscription: subscription?.subscription ?? null,
    subscriptionId: subscription?.id ?? null,
  };
}
export const workforceNotificationOutbox = {
  async claim(now = new Date()): Promise<WorkforceDeliveryClaim | null> {
    return prisma.$transaction(
      async (tx) => {
        // Separate worker processes compete for one durable lease, without keeping
        // a database transaction open during network delivery.
        const rows = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM "WorkforceNotificationDelivery" WHERE (state='PENDING' AND "nextAttemptAt"<=${now}) OR (state='LEASED' AND "leaseUntil"<=${now}) ORDER BY "nextAttemptAt",id FOR UPDATE SKIP LOCKED LIMIT 1`;
        if (!rows[0]) return null;
        let d = await tx.workforceNotificationDelivery.findUniqueOrThrow({
          where: { id: rows[0].id },
        });
        if (d.state === "LEASED") {
          await tx.workforceNotificationDeliveryAttempt.createMany({
            data: [
              {
                ...scope(d),
                userId: d.userId,
                deliveryId: d.id,
                attemptNumber: d.attemptCount,
                leaseToken: d.leaseToken!,
                provider: "UNKNOWN",
                outcome: "UNCERTAIN",
                code: "LEASE_EXPIRED",
                startedAt: new Date(d.leaseUntil!.getTime() - 120000),
                completedAt: now,
              },
            ],
            skipDuplicates: true,
          });
          if (
            now.getTime() - (d.firstAttemptAt ?? d.createdAt).getTime() >=
            23 * 3600000
          ) {
            await tx.workforceNotificationDelivery.update({
              where: { id: d.id },
              data: {
                state: "UNCERTAIN",
                version: { increment: 1 },
                leaseToken: null,
                leaseUntil: null,
                lastCode: "IDEMPOTENCY_WINDOW_EXPIRED",
              },
            });
            return null;
          }
        }
        const n = await tx.workforceNotification.findUniqueOrThrow({
            where: { id: d.notificationId },
          }),
          recipient = await deliveryRecipient(tx, d, n, now),
          token = randomUUID();
        d = await tx.workforceNotificationDelivery.update({
          where: { id: d.id },
          data: {
            state: "LEASED",
            version: { increment: 1 },
            attemptCount: { increment: 1 },
            ...(!d.firstAttemptAt ? { firstAttemptAt: now } : {}),
            leaseToken: token,
            leaseUntil: new Date(now.getTime() + 120000),
            ...(!d.recipientAddress && recipient.recipient
              ? { recipientAddress: recipient.recipient }
              : {}),
            ...(!d.subscriptionId && recipient.subscriptionId
              ? { subscriptionId: recipient.subscriptionId }
              : {}),
          },
        });
        return {
          id: d.id,
          leaseToken: token,
          attemptNumber: d.attemptCount,
          channel: d.channel,
          notification: {
            id: n.id,
            category: n.category,
            locale: locale(n.locale),
            payload: n.payload,
            createdAt: n.createdAt,
          },
          recipient: recipient.recipient,
          subscription: recipient.subscription,
          disabledCode: recipient.disabled,
          startedAt: now,
        };
      },
      { timeout: 10000 },
    );
  },
  async authorizeClaim(claim: WorkforceDeliveryClaim, now = new Date()) {
    return prisma.$transaction(async (tx) => {
      const d = await tx.workforceNotificationDelivery.findFirst({
        where: { id: claim.id, state: "LEASED", leaseToken: claim.leaseToken },
      });
      if (!d) return "LEASE_LOST";
      const n = await tx.workforceNotification.findUniqueOrThrow({
        where: { id: d.notificationId },
      });
      const payload = n.payload as { validUntil?: string };
      if (payload.validUntil && Date.parse(payload.validUntil) <= now.getTime())
        return "REMINDER_EXPIRED";
      return (await deliveryRecipient(tx, d, n, now)).disabled;
    });
  },
  async finish(
    claim: WorkforceDeliveryClaim,
    outcome: "DELIVERED" | "DISABLED" | "FAILURE" | "UNCERTAIN",
    provider: string,
    code: string | null,
    now = new Date(),
  ) {
    return prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM "WorkforceNotificationDelivery" WHERE id=${claim.id} AND state='LEASED' AND "leaseToken"=${claim.leaseToken} FOR UPDATE`;
      if (!rows[0]) return { recorded: false };
      const d = await tx.workforceNotificationDelivery.findUniqueOrThrow({
        where: { id: claim.id },
      });
      const retry =
        outcome === "FAILURE"
          ? workforceDeliveryRetry(
              d.attemptCount,
              now,
              d.firstAttemptAt ?? claim.startedAt,
            )
          : { state: outcome, nextAttemptAt: now };
      await tx.workforceNotificationDeliveryAttempt.create({
        data: {
          ...scope(d),
          userId: d.userId,
          deliveryId: d.id,
          attemptNumber: d.attemptCount,
          leaseToken: claim.leaseToken,
          provider,
          outcome,
          code,
          startedAt: claim.startedAt,
          completedAt: now,
        },
      });
      const row = await tx.workforceNotificationDelivery.update({
        where: { id: d.id },
        data: {
          state: retry.state,
          version: { increment: 1 },
          nextAttemptAt: retry.nextAttemptAt,
          leaseToken: null,
          leaseUntil: null,
          lastCode: code,
          ...(outcome === "DELIVERED" ? { deliveredAt: now } : {}),
        },
      });
      return { recorded: true, state: row.state };
    });
  },
  async replayIntents(s: StaffIdentity) {
    assertStaffPermission(s.role, "SCHEDULE_MANAGE");
    // Capture a finite source set, then revalidate current operator scope and
    // commit bounded batches. Replay is idempotent per event/recipient/channel;
    // a partial run resumes without one transaction spanning the entire history.
    const sources = await prisma.$transaction(async (tx) => {
      await requireWorkforceActor(tx, s);
      const operations = await tx.workforceEventIntent.findMany({
        where: scope(s),
        orderBy: { id: "asc" },
        select: { id: true },
      });
      const publications = await tx.scheduleRevision.findMany({
        where: {
          ...scope(s),
          status: "PUBLISHED",
          publicationEvent: { not: Prisma.DbNull },
        },
        orderBy: { id: "asc" },
        select: { id: true },
      });
      return {
        operations: operations.map((r) => r.id),
        publications: publications.map((r) => r.id),
      };
    });
    for (let offset = 0; offset < sources.operations.length; offset += 25)
      await prisma.$transaction(
        async (tx) => {
          await lockWorkforceTenant(tx, s);
          await requireWorkforceActor(tx, s);
          const events = await tx.workforceEventIntent.findMany({
            where: {
              ...scope(s),
              id: { in: sources.operations.slice(offset, offset + 25) },
            },
            orderBy: { id: "asc" },
          });
          for (const event of events)
            await enqueueWorkforceOperationIntent(tx, event);
        },
        { timeout: 20000 },
      );
    for (let offset = 0; offset < sources.publications.length; offset += 25)
      await prisma.$transaction(
        async (tx) => {
          await lockWorkforceTenant(tx, s);
          await requireWorkforceActor(tx, s);
          const events = await tx.scheduleRevision.findMany({
            where: {
              ...scope(s),
              id: { in: sources.publications.slice(offset, offset + 25) },
            },
            orderBy: { id: "asc" },
            select: { publicationEvent: true },
          });
          for (const event of events)
            if (event.publicationEvent)
              await enqueueWorkforcePublication(
                tx,
                event.publicationEvent as unknown as WorkforcePublishedEvent,
              );
        },
        { timeout: 20000 },
      );
    return {
      operationEvents: sources.operations.length,
      publicationEvents: sources.publications.length,
    };
  },
};
