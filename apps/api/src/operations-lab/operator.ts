import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { prisma } from "@flowgastronomie/database";
import {
  businessDateForInstant,
  businessDayUtcRange,
  labControlModeSchema,
  labRuntimeConfigSchema,
  type LabDashboardSnapshot,
  type LabVenueDashboard,
  type LabJournalRow,
  type FinalReceipt,
  assertLabCompletion,
  assertLabControlTransition,
} from "@flowgastronomie/domain";
import {
  initializeControls,
  control,
  changeControl,
  journal,
  type Profile,
  type Control,
} from "./runtime-store.js";
import { assertLabInstance, assertLabScope, hash } from "./guard.js";
import {
  archiveRoot,
  verifyArchive,
  type ArchiveEntry,
} from "./pdf-archive.js";
import { labStorageStatus } from "./storage.js";
import { LabClient } from "./client.js";
import { provision, type LocalState } from "./provision.js";
import { browserCustomer } from "./browser-customer.js";
import { LabOperations } from "./operations.js";
import type { LabIntent } from "@flowgastronomie/domain";
import { openRun } from "./actions.js";
import { reconcile } from "./reconcile.js";
import type { LabContinuityHealth } from "@flowgastronomie/domain";
const profileSchema = z.enum(["DE", "AL"]),
  cookieName = "operations_lab_operator";
let secret = "";
export async function operatorSecret() {
  if (secret) return secret;
  await assertLabInstance();
  await mkdir(".operations-lab", { recursive: true, mode: 0o700 });
  try {
    secret = (
      JSON.parse(await readFile(".operations-lab/operator.json", "utf8")) as {
        secret: string;
      }
    ).secret;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    secret = randomBytes(32).toString("hex");
    await writeFile(
      ".operations-lab/operator.json",
      JSON.stringify({ version: 1, secret }),
      { flag: "wx", mode: 0o600 },
    );
  }
  if (!/^[a-f0-9]{64}$/.test(secret))
    throw new Error("LAB_OPERATOR_SECRET_INVALID");
  return secret;
}
function equal(a: string, b: string) {
  return timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));
}
function sign(body: string) {
  return createHmac("sha256", secret).update(body).digest("hex");
}
function validCookie(value: string | undefined) {
  if (!value) return false;
  const parts = value.split(".");
  return (
    parts.length === 3 &&
    Number(parts[0]) > Date.now() &&
    Number(parts[0]) < Date.now() + 12 * 3600000 + 60000 &&
    equal(parts[2]!, sign(parts[0] + "." + parts[1]))
  );
}
async function manager(profile: Profile) {
  const c = await control(profile),
    state = JSON.parse(
      await readFile(`.operations-lab/${profile}.json`, "utf8"),
    ) as LocalState,
    actor = state.actors.manager!,
    scope = actor.staff!;
  if (scope.tenantId !== c.tenant_id || scope.venueId !== c.venue_id)
    throw new Error("LAB_SCOPE_MISMATCH");
  const client = new LabClient(profile);
  await client.request("POST", "/v1/auth/login", {
    tenantSlug: scope.tenantSlug,
    venueSlug: scope.venueSlug,
    email: actor.email,
    password: actor.password,
  });
  return client;
}
async function journalRows(c: Control, before?: string) {
  const rows = before
    ? await prisma.$queryRaw<
        Array<{
          seq: bigint;
          kind: string;
          messages: Record<string, string>;
          facts: Record<string, unknown>;
          created_at: Date;
        }>
      >`SELECT seq,kind,messages,facts,created_at FROM operations_lab.journal WHERE tenant_id=${c.tenant_id} AND venue_id=${c.venue_id} AND seq<${BigInt(before)} ORDER BY seq DESC LIMIT 50`
    : await prisma.$queryRaw<
        Array<{
          seq: bigint;
          kind: string;
          messages: Record<string, string>;
          facts: Record<string, unknown>;
          created_at: Date;
        }>
      >`SELECT seq,kind,messages,facts,created_at FROM operations_lab.journal WHERE tenant_id=${c.tenant_id} AND venue_id=${c.venue_id} ORDER BY seq DESC LIMIT 50`;
  return rows.map((r) => ({
    seq: String(r.seq),
    kind: r.kind,
    messages: r.messages,
    facts: r.facts,
    at: r.created_at.toISOString(),
  })) satisfies LabJournalRow[];
}
export async function dashboardSnapshot(): Promise<LabDashboardSnapshot> {
  await assertLabInstance();
  await initializeControls();
  const venues: LabVenueDashboard[] = [];
  for (const profile of ["DE", "AL"] as const) {
    const c = await control(profile),
      scope = { tenantId: c.tenant_id, venueId: c.venue_id },
      v = await prisma.venue.findFirstOrThrow({
        where: { id: c.venue_id, tenantId: c.tenant_id },
      }),
      date = businessDateForInstant(new Date(), v.timezone),
      range = businessDayUtcRange(date, v.timezone),
      day = { gte: range.startsAt, lt: range.endsAt };
    const orders = await prisma.order.findMany({
        where: { ...scope, createdAt: day },
        select: { id: true, status: true },
      }),
      online = await prisma.onlineOrder.findMany({
        where: { ...scope, createdAt: day },
        select: { id: true, status: true },
      });
    const payments = await prisma.paymentRecord.findMany({
      where: { ...scope, recordedAt: day, status: "RECORDED" },
      select: { amountMinor: true, method: true },
    });
    // Staff/QR creation enters service directly; website acceptance is explicit.
    // Historical acceptance remains counted after a subsequent cancellation.
    const acceptedOnline = await prisma.onlineOrder.count({
      where: {
        ...scope,
        createdAt: day,
        statusEvents: { some: { status: "ACCEPTED" } },
      },
    });
    const receipts = await prisma.receipt.findMany({
      where: { ...scope, issuedAt: day, status: "FINALIZED" },
      orderBy: { issuedAt: "desc" },
      take: 100,
      select: { id: true, number: true, snapshot: true },
    });
    const finalizedReceipts = await prisma.receipt.count({
      where: { ...scope, issuedAt: day, status: "FINALIZED" },
    });
    const archiveCounts = await prisma.$queryRaw<
      Array<{ count: bigint }>
    >`SELECT count(*) FROM operations_lab.archive WHERE tenant_id=${c.tenant_id} AND venue_id=${c.venue_id}`;
    const archives = await prisma.$queryRaw<
      Array<{ receipt_id: string }>
    >`SELECT receipt_id FROM operations_lab.archive WHERE tenant_id=${c.tenant_id} AND venue_id=${c.venue_id} ORDER BY created_at DESC LIMIT 500`;
    const printer = await prisma.printJob.findMany({
      where: {
        ...scope,
        OR: [
          { status: { in: ["FAILED", "PRINTING", "QUEUED"] } },
          { createdAt: day },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        status: true,
        lastErrorCode: true,
        receiptId: true,
        attempts: true,
      },
    });
    const shifts = await prisma.staffShift.findMany({
      where: { ...scope, status: "OPEN" },
      include: { membership: { include: { user: true } } },
      take: 30,
    });
    const tickets =
      (await prisma.orderStationTicket.count({
        where: {
          ...scope,
          status: { in: ["NEW", "PREPARING"] },
          order: { status: { notIn: ["CANCELLED", "SERVED"] } },
        },
      })) +
      (await prisma.onlineOrderStationTicket.count({
        where: {
          ...scope,
          status: { in: ["NEW", "PREPARING"] },
          onlineOrder: { status: { notIn: ["CANCELLED", "COMPLETED"] } },
        },
      }));
    const jobs = await prisma.$queryRaw<
      Array<{
        status: string;
        stage: string;
        id: string;
        intent: { provenance: string };
        last_error: string | null;
        lease_until: Date | null;
        order_id: string | null;
        due_at: Date;
      }>
    >`SELECT id,status,stage,order_id,due_at,intent,last_error,lease_until FROM operations_lab.job WHERE run_id=${c.current_run_id} AND tenant_id=${c.tenant_id} AND venue_id=${c.venue_id} ORDER BY due_at`;
    const d = await prisma.$queryRaw<
      Array<{
        report: LabVenueDashboard["report"];
        created_at: Date;
        run_date: string;
      }>
    >`SELECT d.report,d.created_at,r.business_date::text AS run_date FROM operations_lab.day d JOIN operations_lab.run r ON r.id=d.run_id AND r.tenant_id=d.tenant_id AND r.venue_id=d.venue_id WHERE d.run_id=${c.current_run_id} AND d.tenant_id=${c.tenant_id} AND d.venue_id=${c.venue_id}`;
    const week = await prisma.$queryRaw<
      Array<{ date: string; events: bigint; closed: bigint; incidents: bigint }>
    >`SELECT to_char(created_at AT TIME ZONE ${v.timezone},'YYYY-MM-DD') AS date,count(*) AS events,count(*) FILTER(WHERE kind='CLOSED') AS closed,count(*) FILTER(WHERE kind='NEEDS_REVIEW') AS incidents FROM operations_lab.journal WHERE tenant_id=${c.tenant_id} AND venue_id=${c.venue_id} AND created_at>=now()-interval '7 days' GROUP BY date ORDER BY date`;
    venues.push({
      profile,
      name: v.name,
      currency: v.currency,
      timezone: v.timezone,
      date,
      mode: c.mode,
      version: c.version,
      config: c.config,
      runId: c.current_run_id,
      runDate: d[0]?.run_date ?? null,
      startedAt: d[0]?.created_at.toISOString() ?? null,
      heartbeat: c.heartbeat_at?.toISOString() ?? null,
      checkpoint: c.checkpoint_at?.toISOString() ?? null,
      incident: c.incident,
      counts: {
        received: orders.length + online.length,
        finalizedReceipts,
        archivedPdfs: Number(archiveCounts[0]!.count),
        accepted: orders.length + acceptedOnline,
        cancelled:
          orders.filter((o) => o.status === "CANCELLED").length +
          online.filter((o) => o.status === "CANCELLED").length,
        completed:
          orders.filter((o) => o.status === "SERVED").length +
          online.filter((o) => o.status === "COMPLETED").length,
        pendingOnline: online.filter((o) => o.status === "PENDING_CONFIRMATION")
          .length,
        own: jobs.filter((j) => j.order_id).length,
        planned: jobs.length,
        missed: jobs.filter((j) => j.status === "MISSED").length,
        activeTickets: tickets,
        inFlight: jobs.filter(
          (j) =>
            j.status === "LEASED" &&
            j.lease_until &&
            j.lease_until > new Date(),
        ).length,
      },
      money: {
        cash: payments
          .filter((p) => p.method === "CASH")
          .reduce((a, p) => a + p.amountMinor, 0),
        card: payments
          .filter((p) => p.method !== "CASH")
          .reduce((a, p) => a + p.amountMinor, 0),
      },
      staff: shifts.map((s) => ({
        name: s.membership.user.displayName,
        startedAt: s.startedAt.toISOString(),
      })),
      receipts: receipts.map((r) => ({
        id: r.id,
        number: r.number,
        grossMinor: (r.snapshot as unknown as FinalReceipt).grossMinor,
        method: (r.snapshot as unknown as FinalReceipt).method,
        pdf: archives.some((a) => a.receipt_id === r.id),
      })),
      printer: printer.map((p) => ({
        id: p.id,
        status: p.status,
        error: p.lastErrorCode,
        receiptId: p.receiptId,
        attempts: p.attempts,
      })),
      next:
        jobs
          .find((j) => ["PENDING", "LEASED"].includes(j.status))
          ?.due_at.toISOString() ?? null,
      report: d[0]?.report ?? null,
      reviews: jobs
        .filter((j) => j.status === "NEEDS_REVIEW")
        .map((j) => ({
          id: j.id,
          provenance: j.intent.provenance,
          code: j.last_error,
        })),
      journal: await journalRows(c),
      week: week.map((w) => ({
        date: w.date,
        events: Number(w.events),
        closed: Number(w.closed),
        incidents: Number(w.incidents),
      })),
    });
  }
  await mkdir(archiveRoot, { recursive: true });
  const storage = await labStorageStatus(archiveRoot);
  return { version: 1, now: new Date().toISOString(), venues, storage };
}
export async function installOperator(app: FastifyInstance) {
  await initializeControls();
  for (;;) {
    const unsized = await prisma.$queryRaw<
      ArchiveEntry[]
    >`SELECT * FROM operations_lab.archive WHERE byte_size IS NULL LIMIT 256`;
    if (!unsized.length) break;
    for (const a of unsized) {
      const bytes = await verifyArchive(a);
      await prisma.$executeRaw`UPDATE operations_lab.archive SET byte_size=${bytes.length} WHERE receipt_id=${a.receipt_id} AND tenant_id=${a.tenant_id} AND venue_id=${a.venue_id} AND byte_size IS NULL`;
    }
  }
  await operatorSecret();
  await app.register(async (routes) => {
    routes.get(
      "/lab/operator/continuity",
      async (): Promise<LabContinuityHealth> => {
        const stored = JSON.parse(
          await readFile(".runtime/health.json", "utf8").catch(() => "null"),
        ) as LabContinuityHealth["monitor"];
        const rows = await prisma.$queryRaw<
          Array<{
            profile: string;
            opted_in: boolean;
            status: string;
            valid_until: Date | null;
            renewed_at: Date | null;
          }>
        >`SELECT v.profile,s.status::text AS status,s."trialEndsAt" AS valid_until,EXISTS(SELECT 1 FROM operations_lab.entitlement_opt_in e WHERE e.tenant_id=v.tenant_id AND e.venue_id=v.venue_id) AS opted_in,(SELECT max(created_at) FROM operations_lab.entitlement_event e WHERE e.tenant_id=v.tenant_id AND e.venue_id=v.venue_id) AS renewed_at FROM operations_lab.venue v JOIN "Subscription" s ON s."tenantId"=v.tenant_id ORDER BY v.profile`;
        return {
          version: 1,
          monitor: stored
            ? {
                observedAt: stored.observedAt,
                revision: stored.revision,
                api: stored.api,
                web: stored.web,
                database: stored.database,
                processes: stored.processes.map((p) => ({
                  name: p.name,
                  pid: p.pid,
                  status: p.status,
                  restarts: p.restarts,
                  lastExitCode: p.lastExitCode,
                })),
                lastBackup: stored.lastBackup,
              }
            : null,
          entitlements: rows.map((r) => ({
            profile: r.profile,
            optedIn: r.opted_in,
            status: r.status,
            validUntil: r.valid_until?.toISOString() ?? null,
            lastRenewedAt: r.renewed_at?.toISOString() ?? null,
          })),
        };
      },
    );
    routes.addHook("preHandler", async (request, reply) => {
      await assertLabInstance();
      reply.header("Cache-Control", "no-store");
      if (request.routeOptions.url === "/lab/operator/auth") return;
      const bearer = request.headers.authorization?.replace(/^Bearer /, "");
      const bearerAuthenticated = Boolean(bearer && equal(bearer, secret));
      if (!bearerAuthenticated && !validCookie(request.cookies[cookieName]))
        return reply.code(401).send({ code: "LAB_OPERATOR_AUTH_REQUIRED" });
      if (
        !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
        !bearerAuthenticated &&
        request.headers.origin !== "http://127.0.0.1:3400"
      )
        return reply.code(403).send({ code: "LAB_OPERATOR_ORIGIN_FORBIDDEN" });
    });
    routes.post(
      "/lab/operator/auth",
      { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
      async (request, reply) => {
        const body = z
          .strictObject({ password: z.string().max(128) })
          .safeParse(request.body);
        if (!body.success || !equal(body.data.password, secret))
          return reply.code(401).send({ code: "LAB_OPERATOR_AUTH_REQUIRED" });
        if (
          request.headers.origin &&
          request.headers.origin !== "http://127.0.0.1:3400"
        )
          return reply
            .code(403)
            .send({ code: "LAB_OPERATOR_ORIGIN_FORBIDDEN" });
        const value =
          String(Date.now() + 12 * 3600000) +
          "." +
          randomBytes(16).toString("hex");
        reply.setCookie(cookieName, value + "." + sign(value), {
          httpOnly: true,
          sameSite: "strict",
          path: "/lab/operator",
          maxAge: 12 * 3600,
          secure: false,
        });
        return { authenticated: true };
      },
    );
    routes.get("/lab/operator/status", () => dashboardSnapshot());
    routes.post("/lab/operator/logout", async (_r, reply) => {
      reply.clearCookie(cookieName, { path: "/lab/operator" });
      return { loggedOut: true };
    });
    routes.post("/lab/operator/control", async (request, reply) => {
      try {
        const body = z
          .strictObject({
            profile: profileSchema,
            mode: labControlModeSchema,
            expectedVersion: z.number().int(),
          })
          .parse(request.body);
        const c = await changeControl(
          body.profile,
          body.mode,
          body.expectedVersion,
        );
        return { mode: c.mode, version: c.version };
      } catch (e) {
        return reply.code(409).send({ code: (e as Error).message });
      }
    });
    routes.post("/lab/operator/config", async (request, reply) => {
      const body = z
          .strictObject({
            profile: profileSchema,
            expectedVersion: z.number().int(),
            config: labRuntimeConfigSchema,
          })
          .parse(request.body),
        c = await control(body.profile);
      if (c.mode !== "STOPPED" || c.version !== body.expectedVersion)
        return reply
          .code(409)
          .send({ code: "LAB_CONFIG_REQUIRES_STOPPED_CURRENT_VERSION" });
      if (c.current_run_id) {
        const runs = await prisma.$queryRaw<
          Array<{ status: string }>
        >`SELECT status FROM operations_lab.run WHERE id=${c.current_run_id} AND tenant_id=${c.tenant_id} AND venue_id=${c.venue_id}`;
        if (runs[0]?.status !== "COMPLETED")
          return reply
            .code(409)
            .send({ code: "LAB_UNFINISHED_DAY_MUST_BE_RESOLVED" });
      }
      const updated = await prisma.$transaction(async (tx) => {
        const n =
          await tx.$executeRaw`UPDATE operations_lab.control SET config=${JSON.stringify(body.config)}::jsonb,current_run_id=null,version=version+1 WHERE profile=${body.profile} AND mode='STOPPED' AND version=${body.expectedVersion}`;
        if (n !== 1) return false;
        await journal(
          c,
          "config:" + (c.version + 1),
          "CONFIG",
          {
            actor: "local operator",
            configuration: body.config,
            impact:
              "Configuration applies to a future run; completed history is retained.",
          },
          tx,
        );
        return true;
      });
      if (!updated)
        return reply.code(409).send({ code: "LAB_CONTROL_VERSION_CONFLICT" });
      return { configured: true };
    });
    routes.get("/lab/operator/journal", async (request) => {
      const q = z
        .strictObject({
          profile: profileSchema,
          before: z.string().regex(/^\d+$/).optional(),
        })
        .parse(request.query);
      return journalRows(await control(q.profile), q.before);
    });
    routes.get(
      "/lab/operator/pdf/:profile/:receiptId",
      async (request, reply) => {
        const p = z
            .strictObject({
              profile: profileSchema,
              receiptId: z.string().min(1).max(100),
            })
            .parse(request.params),
          c = await control(p.profile);
        const rows = await prisma.$queryRaw<
          ArchiveEntry[]
        >`SELECT * FROM operations_lab.archive WHERE receipt_id=${p.receiptId} AND tenant_id=${c.tenant_id} AND venue_id=${c.venue_id}`;
        if (!rows[0])
          return reply.code(404).send({ code: "LAB_PDF_NOT_FOUND" });
        const bytes = await verifyArchive(rows[0]);
        return reply
          .type("application/pdf")
          .header(
            "Content-Disposition",
            `attachment; filename="${rows[0].filename}"`,
          )
          .send(bytes);
      },
    );
    routes.post("/lab/operator/print-review", async (request, reply) => {
      const body = z
          .strictObject({
            profile: profileSchema,
            jobId: z.string().min(1).max(100),
            confirmPossibleDuplicate: z.literal(true),
          })
          .parse(request.body),
        c = await control(body.profile);
      const job = await prisma.printJob.findFirst({
        where: {
          id: body.jobId,
          tenantId: c.tenant_id,
          venueId: c.venue_id,
          lastErrorCode: "UNKNOWN_RESULT",
          status: "FAILED",
        },
      });
      if (!job)
        return reply.code(409).send({ code: "LAB_UNCERTAIN_JOB_NOT_FOUND" });
      const client = await manager(body.profile),
        result = await client.request<{ job: { status: string } }>(
          "POST",
          `/v1/staff/hardware/jobs/${job.id}/execute`,
          { retry: true, confirmPossibleDuplicate: true },
        );
      if (result.job.status !== "PRINTED")
        return reply.code(409).send({ code: "LAB_PRINT_STILL_UNCONFIRMED" });
      await prisma.$executeRaw`UPDATE operations_lab.job SET status='PENDING',last_error=null,due_at=now() WHERE run_id=${c.current_run_id} AND tenant_id=${c.tenant_id} AND venue_id=${c.venue_id} AND status='NEEDS_REVIEW' AND last_error IN ('LAB_PRINT_NEEDS_REVIEW','LAB_PDF_OUTPUT_UNCONFIRMED')`;
      await journal(c, "print-review:" + job.id, "PRINT_REVIEW", {
        jobId: job.id,
        receiptId: job.receiptId,
        actor: "local operator through authenticated manager",
        impact:
          "P3 explicit possible-duplicate confirmation used. No payment/receipt issued.",
      });
      return { printed: true };
    });
    routes.post("/lab/operator/close-partial", async (request, reply) => {
      const b = z
          .strictObject({
            profile: profileSchema,
            expectedVersion: z.number().int(),
            acknowledgeIncompleteCoverage: z.literal(true),
          })
          .parse(request.body),
        c = await control(b.profile);
      if (
        c.mode !== "NEEDS_REVIEW" ||
        c.version !== b.expectedVersion ||
        c.incident !== "BROWSER_COVERAGE_INCOMPLETE_PARTIAL_DAY"
      )
        return reply
          .code(409)
          .send({ code: "LAB_NOT_A_FINANCIALLY_CLOSED_PARTIAL_DAY" });
      const rows = await prisma.$queryRaw<
        Array<{ business_date: Date; scenario_version: string; seed: number }>
      >`SELECT business_date,scenario_version,seed FROM operations_lab.run WHERE id=${c.current_run_id} AND tenant_id=${c.tenant_id} AND venue_id=${c.venue_id}`;
      const row = rows[0]!,
        run = await openRun(
          c.tenant_id,
          c.venue_id,
          row.business_date.toISOString().slice(0, 10),
          row.scenario_version,
          row.seed,
        ),
        r = await reconcile(run);
      assertLabCompletion(
        run.status,
        r.unresolvedActions,
        r.discrepancies.length,
      );
      assertLabControlTransition("NEEDS_REVIEW", "PAUSED");
      assertLabControlTransition("PAUSED", "STOP_AFTER_DAY");
      assertLabControlTransition("STOP_AFTER_DAY", "STOPPED");
      await prisma.$transaction(async (tx) => {
        const changed =
          await tx.$executeRaw`UPDATE operations_lab.control SET mode='STOPPED',incident='PARTIAL_DAY_ACKNOWLEDGED_NOT_FULL_ACCEPTANCE',version=version+1 WHERE profile=${b.profile} AND version=${b.expectedVersion}`;
        if (changed !== 1) throw new Error("LAB_CONTROL_VERSION_CONFLICT");
        await tx.$executeRaw`UPDATE operations_lab.run SET status='COMPLETED',checkpoint=${JSON.stringify({ financialClosed: true, coverageIncomplete: true, review: "Explicit operator acknowledged missed/partial demand; not full acceptance", report: r.filename })}::jsonb,updated_at=now() WHERE id=${run.id}`;
        await journal(
          c,
          "partial-closed:" + run.id,
          "CLOSED",
          {
            actor: "local operator",
            impact:
              "Partial financial close acknowledged. Browser/traffic coverage remains incomplete; this is not full acceptance.",
            report: r.filename,
          },
          tx,
        );
      });
      return { partial: true, fullAcceptance: false };
    });
    routes.post("/lab/operator/browser-review", async (request, reply) => {
      const b = z
          .strictObject({
            profile: profileSchema,
            jobId: z.string().min(1).max(100),
          })
          .parse(request.body),
        c = await control(b.profile);
      const jobs = await prisma.$queryRaw<
        Array<{ intent: LabIntent }>
      >`SELECT intent FROM operations_lab.job WHERE id=${b.jobId} AND run_id=${c.current_run_id} AND tenant_id=${c.tenant_id} AND venue_id=${c.venue_id} AND status='NEEDS_REVIEW'`;
      const j = jobs[0];
      if (!j || j.intent.provenance !== "WEBSITE_BROWSER")
        return reply.code(409).send({ code: "LAB_BROWSER_REVIEW_NOT_FOUND" });
      const rows = await prisma.$queryRaw<
        Array<{ business_date: Date; scenario_version: string; seed: number }>
      >`SELECT business_date,scenario_version,seed FROM operations_lab.run WHERE id=${c.current_run_id}`;
      const row = rows[0]!,
        run = await openRun(
          c.tenant_id,
          c.venue_id,
          row.business_date.toISOString().slice(0, 10),
          row.scenario_version,
          row.seed,
        ),
        context = await provision(b.profile),
        op = new LabOperations(context, run),
        event = op.actions.key(op.name(j.intent, "create"));
      const actions = await prisma.$queryRaw<
        Array<{ browser_key: string | null }>
      >`SELECT browser_key FROM operations_lab.action WHERE event_id=${event} AND tenant_id=${c.tenant_id} AND venue_id=${c.venue_id}`;
      const key = actions[0]?.browser_key;
      const actual = key
        ? await prisma.onlineOrder.findFirst({
            where: {
              tenantId: c.tenant_id,
              venueId: c.venue_id,
              idempotencyKey: key,
            },
          })
        : null;
      if (!actual)
        return reply
          .code(409)
          .send({ code: "LAB_BROWSER_DISPATCH_NOT_PROVEN_NO_RESUBMIT" });
      const observed = await browserCustomer(
        context,
        j.intent,
        event,
        false,
        `artifacts/operations-lab/runtime/${run.businessDate}/${b.profile}/${run.id}`,
      );
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`UPDATE operations_lab.action SET status='SUCCEEDED',result=${JSON.stringify(observed)}::jsonb,result_source_ids=${JSON.stringify([actual.id, actual.referenceCode])}::jsonb,error_code='OBSERVED_BROWSER_RECOVERY',lease_owner=null,lease_until=null WHERE event_id=${event} AND tenant_id=${c.tenant_id} AND venue_id=${c.venue_id}`;
        await tx.$executeRaw`UPDATE operations_lab.job SET status='PENDING',order_id=${actual.id},last_error=null,due_at=now() WHERE id=${b.jobId} AND run_id=${run.id}`;
        await journal(
          c,
          "browser-reviewed:" + event,
          "RECOVERED",
          {
            actor: "local operator",
            orderId: actual.id,
            reference: actual.referenceCode,
            impact:
              "Original native request/tracking identity and staff UI observed; no customer submission repeated.",
          },
          tx,
        );
      });
      return { observed: true, resubmitted: false };
    });
  });
}
