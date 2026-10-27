import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { z } from "zod";
import { buildApp } from "../../apps/api/src/app.js";
import { prisma } from "@flowgastronomie/database";
import { runWorkforceMonth } from "./engine.js";
async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert(
    ["localhost", "127.0.0.1"].includes(url.hostname) &&
      /^workforce_wf4_\d+$/.test(url.searchParams.get("schema") ?? "") &&
      process.env.WORKFORCE_WF4_GATE === "true" &&
      process.env.NODE_ENV !== "production",
    "Local guarded WF4 executable required",
  );
  const clock = { now: Date.parse("2031-02-28T07:00Z") },
    app = buildApp({}, { workforceClock: () => new Date(clock.now) });
  // These fixture routes belong only to this loopback executable. The production
  // server never imports this file and has no clock environment/HTTP override.
  app.post("/__fixture/workforce-wf4/clock", async (request) => {
    const b = z
      .object({ now: z.string().datetime() })
      .strict()
      .parse(request.body);
    const next = Date.parse(b.now);
    assert(next >= clock.now, "Browser fixture clock must be monotonic");
    clock.now = next;
    return { now: new Date(clock.now).toISOString() };
  });
  app.post("/__fixture/workforce-wf4/finalize", async () => {
    const closes = await prisma.workforceMonthlyClose.count();
    assert.equal(
      closes,
      22,
      "twenty staff March closes and two April carry closes",
    );
    const approvals = await prisma.workforceAttendanceApproval.findMany({
      select: { attendanceId: true, attendanceVersion: true, snapshot: true },
      orderBy: { attendanceVersion: "desc" },
    });
    const seen = new Set<string>();
    let actualBreaks = 0;
    for (const approval of approvals) {
      if (!seen.has(approval.attendanceId)) {
        seen.add(approval.attendanceId);
        actualBreaks += (
          (approval.snapshot as { breaks: unknown[] }).breaks ?? []
        ).length;
      }
    }
    const evidence = {
      ...result.manifest,
      browserPending: false,
      notificationCount: await prisma.workforceNotification.count(),
      deliveryCount: await prisma.workforceNotificationDelivery.count(),
      counts: { ...result.manifest.counts, closes },
      databaseTotals: {
        ...result.manifest.databaseTotals,
        attendance: await prisma.workforceAttendance.count(),
        attendanceEvents: await prisma.workforceAttendanceEvent.count(),
        actualBreaks,
        approvals: await prisma.workforceAttendanceApproval.count(),
        requests: await prisma.workforceRequest.count(),
        closes,
        adjustments: await prisma.workforceMonthlyAdjustment.count(),
      },
      status: "passed",
    };
    await writeFile(
      "artifacts/workforce-wf4/manifest.json",
      JSON.stringify(evidence, null, 2),
    );
    return { status: "passed", closes };
  });
  const result = await runWorkforceMonth(app, clock, true);
  await app.listen({ host: "127.0.0.1", port: 4406 });
  const shutdown = async () => {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
