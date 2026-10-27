import { workforceAttendanceIdsInWindow } from "./workforce-attendance-projection.js";
import { Prisma } from "@prisma/client";
import { workforceToday } from "@flowgastronomie/domain";
import { prisma } from "./client.js";
import { publishedAssignments } from "./workforce-repository.js";
import { enqueueWorkforceNotice } from "./workforce-notification-repository.js";
export async function enqueueDueWorkforceReminders(now = new Date()) {
  const venues = await prisma.venue.findMany({
    select: { id: true, tenantId: true, timezone: true },
  });
  let enqueued = 0;
  for (const venue of venues)
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"workforce:" + venue.tenantId},0))`;
        const members = await tx.membership.findMany({
          where: {
            tenantId: venue.tenantId,
            venueId: venue.id,
            active: true,
            user: { active: true },
          },
          select: { id: true, userId: true, role: true },
        });
        if (!members.length) return;
        // Publication reader uses only these scope fields. Recipient permission is
        // revalidated from canonical membership before each event/delivery.
        const staff = {
          tenantId: venue.tenantId,
          venueId: venue.id,
        };
        const published = await publishedAssignments(tx, staff),
          prefs = await tx.workforceNotificationPreference.findMany({
            where: { tenantId: venue.tenantId, venueId: venue.id },
          });
        for (const row of published) {
          const a = row.after;
          if (!a.userId || !members.some((m) => m.userId === a.userId))
            continue;
          const pref = prefs.find((p) => p.userId === a.userId),
            lead = pref?.reminderMinutes ?? 60;
          if (
            Date.parse(a.startsAt) > now.getTime() &&
            Date.parse(a.startsAt) <= now.getTime() + lead * 60000
          ) {
            const notice = await enqueueWorkforceNotice(tx, {
              tenantId: venue.tenantId,
              venueId: venue.id,
              userId: a.userId,
              eventKey: "REMINDER:" + row.publishedAssignmentRevisionId,
              sourceKind: "REMINDER",
              sourceVersionId: row.publishedAssignmentRevisionId,
              validUntil: a.startsAt,
              subjectId: a.id,
              requiredPermission: "SELF",
              category: "SHIFT_REMINDER",
              link: {
                tab: "today",
                date: a.startsLocal.slice(0, 10),
                assignmentId: a.id,
              },
              createdAt: now,
            });
            if (notice) enqueued++;
          }
        }
        for (const row of published) {
          const a = row.after;
          if (
            !a.userId ||
            Date.parse(a.startsAt) > now.getTime() - 15 * 60000 ||
            Date.parse(a.endsAt) + 3600000 <= now.getTime()
          )
            continue;
          const presence = await workforceAttendanceIdsInWindow(
            tx,
            { tenantId: venue.tenantId, userId: a.userId },
            { start: Date.parse(a.startsAt), end: Date.parse(a.endsAt) },
            now,
          );
          if (presence.length) continue;
          for (const member of members.filter(
            (m) =>
              m.userId === a.userId || ["OWNER", "MANAGER"].includes(m.role),
          )) {
            const self = member.userId === a.userId,
              n = await enqueueWorkforceNotice(tx, {
                tenantId: venue.tenantId,
                venueId: venue.id,
                userId: member.userId,
                eventKey: "MISSING_IN:" + row.publishedAssignmentRevisionId,
                sourceKind: "PUBLISHED_MISSING_PUNCH",
                sourceVersionId: row.publishedAssignmentRevisionId,
                subjectUserId: a.userId,
                validUntil: new Date(
                  Date.parse(a.endsAt) + 3600000,
                ).toISOString(),
                subjectId: a.id,
                requiredPermission: self ? "SELF" : "VENUE_MANAGER",
                category: "MISSING_PUNCH",
                link: {
                  tab: self ? "requests" : "operations",
                  date: a.startsLocal.slice(0, 10),
                  assignmentId: a.id,
                },
                createdAt: now,
              });
            if (n) enqueued++;
          }
        }
        const active = await tx.workforceAttendance.findMany({
          where: {
            tenantId: venue.tenantId,
            venueId: venue.id,
            state: { not: "CLOSED" },
            startedAt: { lt: new Date(now.getTime() - 16 * 3600000) },
          },
          select: { id: true, userId: true, version: true, startedAt: true },
        });
        for (const attendance of active)
          for (const member of members.filter(
            (m) =>
              m.userId === attendance.userId ||
              ["OWNER", "MANAGER"].includes(m.role),
          )) {
            const self = member.userId === attendance.userId,
              n = await enqueueWorkforceNotice(tx, {
                tenantId: venue.tenantId,
                venueId: venue.id,
                userId: member.userId,
                eventKey:
                  "MISSING_PUNCH:" + attendance.id + ":" + attendance.version,
                sourceKind: "ATTENDANCE_EXCEPTION",
                subjectId: attendance.id,
                requiredPermission: self ? "SELF" : "VENUE_MANAGER",
                category: "MISSING_PUNCH",
                link: {
                  tab: self ? "hours" : "operations",
                  date: workforceToday(venue.timezone, attendance.startedAt),
                  attendanceId: attendance.id,
                },
                createdAt: now,
              });
            if (n) enqueued++;
          }
      },
      { timeout: 30000 },
    );
  return { venues: venues.length, enqueued };
}
