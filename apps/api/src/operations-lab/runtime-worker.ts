import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { prisma } from "@flowgastronomie/database";
import {
  businessDateForInstant,
  generateLabIntents,
  labRuntimePlan,
  labWallInstant,
  labArrivalDecision,
  assertLabCompletion,
  type LabIntent,
  type LabRun,
  type DailyOperationsReport,
  type LabRuntimeConfig,
} from "@flowgastronomie/domain";
import {
  control,
  initializeControls,
  journal,
  type Control,
  type Profile,
} from "./runtime-store.js";
import { assertLabInstance, hash } from "./guard.js";
import { assertLabApi, LabHttpError } from "./client.js";
import { provision } from "./provision.js";
import { expandLabVenue } from "./catalog.js";
import { openRun } from "./actions.js";
import { LabOperations } from "./operations.js";
import {
  browserCustomer,
  verifyBrowserCompletion,
  closeCustomerBrowser,
} from "./browser-customer.js";
import { reconcile } from "./reconcile.js";
import { archiveRoot } from "./pdf-archive.js";
import { labStorageStatus } from "./storage.js";
import { runVenueLoops } from "./runtime-loops.js";
type Day = {
  run_id: string;
  profile: Profile;
  config: LabRuntimeConfig;
  opens_at: Date;
  closes_at: Date;
  opened: boolean;
  fault_position: number | null;
  report: unknown | null;
};
type Job = {
  id: string;
  run_id: string;
  intent: LabIntent;
  stage: "ARRIVE" | "PREPARE" | "READY" | "SETTLE" | "FINAL" | "DONE";
  status: string;
  due_at: Date;
  order_id: string | null;
  lane: number | null;
  attempts: number;
  lease_until: Date | null;
};
const owner = randomUUID(),
  cache = new Map<Profile, { op: LabOperations; loadedAt: number }>();
let stopping = false;
process.on("message", (m) => {
  if (m === "shutdown") stopping = true;
});
const hydrated = new WeakSet<LabOperations>();
const idleUntil = new Map<Profile, number>();
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    stopping = true;
  });
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function review(c: Control, code: string) {
  await prisma.$executeRaw`UPDATE operations_lab.control SET mode='NEEDS_REVIEW',incident=${code},version=version+1 WHERE profile=${c.profile} AND lease_owner=${owner}`;
  if (c.current_run_id)
    await prisma.$executeRaw`UPDATE operations_lab.run SET status='NEEDS_REVIEW',updated_at=now() WHERE id=${c.current_run_id} AND status<>'COMPLETED' AND tenant_id=${c.tenant_id} AND venue_id=${c.venue_id}`;
  await journal(c, "review:" + c.version + ":" + code, "NEEDS_REVIEW", {
    code,
    impact:
      "Only this venue is paused. Inspect canonical records before resuming.",
    why: "The recorded error requires review; no unsupported cause is inferred.",
  });
}
async function operation(c: Control) {
  const existing = cache.get(c.profile);
  if (
    existing &&
    existing.op.run.id === c.current_run_id &&
    Date.now() - existing.loadedAt < 10 * 3600000
  )
    return existing.op;
  const context = await provision(c.profile);
  await expandLabVenue(context);
  const rows = await prisma.$queryRaw<
    Array<{
      business_date: Date;
      scenario_version: string;
      seed: number;
      status: LabRun["status"];
      checkpoint: LabRun["checkpoint"];
    }>
  >`SELECT business_date,scenario_version,seed,status,checkpoint FROM operations_lab.run WHERE id=${c.current_run_id} AND tenant_id=${c.tenant_id} AND venue_id=${c.venue_id}`;
  const r = rows[0]!;
  const run = await openRun(
    c.tenant_id,
    c.venue_id,
    r.business_date.toISOString().slice(0, 10),
    r.scenario_version,
    r.seed,
  );
  const op = new LabOperations(context, run);
  if (
    process.argv.includes("--fault-crash-after-payment") &&
    c.profile === "DE" &&
    c.config.mode === "FUNCTIONAL_WINDOW"
  )
    op.afterPayment = () => {
      console.log("LAB2_FAULT_CRASH_AFTER_COMMITTED_PAYMENT");
      process.exit(91);
    };
  cache.set(c.profile, { op, loadedAt: Date.now() });
  return op;
}
async function createDay(c: Control) {
  const context = await provision(c.profile),
    catalog = await expandLabVenue(context),
    venue = await prisma.venue.findFirstOrThrow({
      where: { id: c.venue_id, tenantId: c.tenant_id },
    }),
    now = new Date(),
    date = businessDateForInstant(now, venue.timezone);
  const website = await context.clients.owner!.request<{
    openingHours: Array<{
      day: string;
      closed: boolean;
      opensAt: string;
      closesAt: string;
    }>;
  }>("GET", "/v1/workspace/website");
  const weekday = new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      timeZone: venue.timezone,
    })
      .format(now)
      .toUpperCase(),
    hours = website.openingHours.find((h) => h.day === weekday);
  if (!hours || hours.closed) {
    idleUntil.set(c.profile, Date.now() + 3600000);
    return;
  }
  const opens = labWallInstant(date, hours.opensAt, venue.timezone),
    closes = labWallInstant(date, hours.closesAt, venue.timezone);
  if (c.config.mode === "WALL_CLOCK" && now >= closes) {
    idleUntil.set(c.profile, Date.now() + 3600000);
    return;
  }
  const seed = c.config.seed + Number(date.replaceAll("-", "")),
    scenario =
      c.config.mode === "FUNCTIONAL_WINDOW"
        ? "lab2-functional-v1-s" + c.config.seed
        : "lab2-wall-v1";
  const run = await openRun(c.tenant_id, c.venue_id, date, scenario, seed);
  if (run.status === "COMPLETED") {
    await prisma.$executeRaw`UPDATE operations_lab.control SET mode=${c.mode === "STOP_AFTER_DAY" || c.config.mode === "FUNCTIONAL_WINDOW" ? "STOPPED" : c.mode},current_run_id=${run.id},version=version+1 WHERE profile=${c.profile} AND lease_owner=${owner}`;
    return;
  }
  const start =
      c.config.mode === "FUNCTIONAL_WINDOW"
        ? new Date(Date.now() + 1500)
        : opens,
    end =
      c.config.mode === "FUNCTIONAL_WINDOW"
        ? new Date(start.getTime() + c.config.windowSeconds * 1000)
        : closes;
  const weekend = ["SATURDAY", "SUNDAY"].includes(weekday),
    level =
      c.config.weekendBusy && weekend && c.config.level === "NORMAL"
        ? "BUSY"
        : c.config.level;
  const intents = generateLabIntents(
    {
      version: 1,
      profile: c.profile,
      level,
      seed,
      maxOrders: c.config.cap,
      browserOrders: 2,
    },
    catalog,
  );
  const plan = labRuntimePlan(intents, start, end, now, c.config);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`INSERT INTO operations_lab.day(run_id,profile,tenant_id,venue_id,config,opens_at,closes_at) VALUES (${run.id},${c.profile},${c.tenant_id},${c.venue_id},${JSON.stringify(c.config)}::jsonb,${start},${end}) ON CONFLICT(run_id) DO NOTHING`;
    for (const p of plan)
      await tx.$executeRaw`INSERT INTO operations_lab.job(id,run_id,tenant_id,venue_id,intent,stage,due_at) VALUES (${hash(run.id + ":" + p.intent.position)},${run.id},${c.tenant_id},${c.venue_id},${JSON.stringify(p.intent)}::jsonb,'ARRIVE',${p.dueAt}) ON CONFLICT(id) DO NOTHING`;
    await tx.$executeRaw`UPDATE operations_lab.control SET current_run_id=${run.id},checkpoint_at=now() WHERE profile=${c.profile} AND lease_owner=${owner}`;
  });
  cache.set(c.profile, {
    op: new LabOperations(context, run),
    loadedAt: Date.now(),
  });
  if (
    process.argv.includes("--fault-crash-after-payment") &&
    c.profile === "DE" &&
    c.config.mode === "FUNCTIONAL_WINDOW"
  )
    cache.get(c.profile)!.op.afterPayment = () => {
      console.log("LAB2_FAULT_CRASH_AFTER_COMMITTED_PAYMENT");
      process.exit(91);
    };
  c.current_run_id = run.id;
  await journal(c, "plan:" + run.id, "START", {
    planned: intents.length,
    mode: c.config.mode,
    seed,
    start: start.toISOString(),
    closes: end.toISOString(),
    impact:
      "Plan is frozen. Missed undispatched arrivals are skipped; business timestamps are never backdated.",
  });
}
async function stage(c: Control, d: Day, op: LabOperations, j: Job) {
  const intent = j.intent,
    now = new Date(),
    folder = `artifacts/operations-lab/runtime/${op.run.businessDate}/${c.profile}/${op.run.id}`;
  const actions = await prisma.$queryRaw<
    Array<{ status: string }>
  >`SELECT status FROM operations_lab.action WHERE event_id=${op.actions.key(op.name(intent, "create"))} AND tenant_id=${c.tenant_id} AND venue_id=${c.venue_id}`;
  if (j.stage === "ARRIVE") {
    if (
      labArrivalDecision(
        now,
        j.due_at,
        actions.length > 0,
        d.config.graceSeconds,
      ) === "MISSED" ||
      (!actions.length && d.config.mode === "WALL_CLOCK" && now >= d.closes_at)
    ) {
      await prisma.$executeRaw`UPDATE operations_lab.job SET status='MISSED',last_error='MISSED_UNDISPATCHED',updated_at=now() WHERE id=${j.id}`;
      await journal(c, j.id + ":missed", "MISSED", {
        plannedAt: j.due_at.toISOString(),
        observedAt: now.toISOString(),
        actor: "customer scenario",
        impact: "No order/payment/receipt was created.",
      });
      return true;
    }
    const live = await prisma.$queryRaw<
      Array<{ count: bigint }>
    >`SELECT count(*) FROM operations_lab.job WHERE run_id=${d.run_id} AND status NOT IN ('DONE','MISSED') AND order_id IS NOT NULL`;
    if (Number(live[0]!.count) >= d.config.maxActive) return false;
  }
  let lane = j.lane ?? 0;
  if (j.stage === "PREPARE") {
    const occupied = await prisma.$queryRaw<
      Array<{ lane: number }>
    >`SELECT lane FROM operations_lab.job WHERE run_id=${d.run_id} AND stage='READY' AND status NOT IN ('DONE','MISSED')`;
    const free = [0, 1].find((n) => !occupied.some((o) => o.lane === n));
    if (free === undefined) {
      await journal(c, j.id + ":wait", "WAIT", {
        activeBefore: occupied.length,
        capacity: 2,
        why: "Both configured station lanes were occupied when this job was checked.",
        impact: "Preparation waits; no status is forged.",
      });
      return false;
    }
    lane = free;
  }
  const claimed =
    await prisma.$executeRaw`UPDATE operations_lab.job SET status='LEASED',lease_owner=${owner},lease_until=now()+interval '30 seconds' WHERE id=${j.id} AND (status='PENDING' OR (status='LEASED' AND lease_until<now())) AND EXISTS(SELECT 1 FROM operations_lab.control WHERE profile=${c.profile} AND lease_owner=${owner} AND lease_until>now())`;
  if (!claimed) return false;
  let next: Job["stage"] = "DONE",
    source = j.order_id,
    due = new Date(),
    facts: Record<string, unknown> = {
      actor:
        j.stage === "ARRIVE"
          ? intent.provenance
          : j.stage === "PREPARE" || j.stage === "READY"
            ? "Kitchen / Bar"
            : "service staff",
      orderId: source,
    };
  try {
    if (j.stage === "ARRIVE") {
      source = await op.create(
        intent,
        intent.provenance === "WEBSITE_BROWSER"
          ? (key) => browserCustomer(op.context, intent, key, false, folder)
          : undefined,
      );
      await op.confirm(intent, source);
      next = intent.cancel ? "DONE" : "PREPARE";
      const row = await op.projection(source);
      facts = {
        ...facts,
        orderId: source,
        reference: row.reference,
        items: intent.items.map((i) => `${i.quantity} × ${i.name}`).join(", "),
        amountMinor: intent.totalMinor,
        provenance: intent.provenance,
      };
    } else if (j.stage === "PREPARE") {
      const row = await op.projection(source!);
      for (const t of row.tickets)
        await op.advance(
          intent,
          source!,
          t.station,
          "PREPARING",
          (t.station === "KITCHEN" ? "kitchen" : "bar") + (lane ? "2" : ""),
        );
      const seconds =
        d.config.mode === "FUNCTIONAL_WINDOW"
          ? Math.max(2, intent.prepSeconds * 0.008)
          : intent.prepSeconds;
      due = new Date(Date.now() + seconds * 1000);
      next = "READY";
      facts = {
        ...facts,
        targetSeconds: seconds,
        readyDueAt: due.toISOString(),
        lane,
      };
    } else if (j.stage === "READY") {
      const row = await op.projection(source!);
      for (const t of row.tickets)
        await op.advance(
          intent,
          source!,
          t.station,
          "READY",
          (t.station === "KITCHEN" ? "kitchen" : "bar") + (lane ? "2" : ""),
        );
      next = "SETTLE";
      facts = {
        ...facts,
        reference: row.reference,
        dueAt: j.due_at.toISOString(),
        observedAt: new Date().toISOString(),
        overdueSeconds: Math.max(0, (Date.now() - j.due_at.getTime()) / 1000),
        why: "Configured preparation due time was reached. Other causes of delay are not inferred.",
      };
    } else if (j.stage === "SETTLE") {
      if (intent.channel !== "QR" && d.fault_position === null) {
        await prisma.$executeRaw`UPDATE operations_lab.day SET fault_position=${intent.position} WHERE run_id=${d.run_id} AND fault_position IS NULL`;
        d.fault_position = intent.position;
      }
      const result = await op.settle(
        intent,
        source!,
        d.fault_position === intent.position,
      );
      next = intent.provenance === "WEBSITE_BROWSER" ? "FINAL" : "DONE";
      facts = {
        ...facts,
        method: intent.method,
        receiptId: result && "number" in result ? result.id : null,
        receiptNumber: result && "number" in result ? result.number : null,
        impact:
          intent.channel === "QR"
            ? "Session payment has no fabricated P2 receipt."
            : "Canonical finalized P2 receipt/PDF preserved.",
      };
      await op.closeTables();
    } else if (j.stage === "FINAL") {
      const result = await op.actions.perform(
        op.name(intent, "browser-final"),
        "guest",
        { orderId: source },
        { kind: "BROWSER_FINAL" },
        true,
        () =>
          verifyBrowserCompletion(
            op.context,
            intent,
            op.actions.key(op.name(intent, "create")),
            source!,
            folder,
          ),
      );
      facts = { ...facts, ...result };
    }
    await prisma.$executeRaw`UPDATE operations_lab.job SET stage=${next},status=${next === "DONE" ? "DONE" : "PENDING"},order_id=${source},lane=${lane},due_at=${due},lease_owner=null,lease_until=null,last_error=null,updated_at=now() WHERE id=${j.id} AND lease_owner=${owner}`;
    await prisma.$executeRaw`UPDATE operations_lab.control SET checkpoint_at=now() WHERE profile=${c.profile} AND lease_owner=${owner}`;
    await journal(
      c,
      j.id + ":" + j.stage,
      intent.cancel ? "CANCELLED" : j.stage === "FINAL" ? "RECOVERED" : j.stage,
      facts,
    );
    return true;
  } catch (error) {
    const code =
      error instanceof LabHttpError
        ? `${error.status}_${error.code}`
        : (error as Error).message;
    const wait =
      /LAB_ACTION_BUSY|LAB_ACTOR_BUSY|LAB_PICKUP_GATE_PENDING|LAB_TABLE_CAPACITY_WAIT|LAB_RUN_NOT_ACTIVE/.test(
        code,
      );
    const retry =
      wait ||
      /LAB_HTTP_TIMEOUT|ECONNREFUSED|ECONNRESET|401_|429_|5\d\d_/.test(code);
    await prisma.$executeRaw`UPDATE operations_lab.job SET status=${retry ? "PENDING" : "NEEDS_REVIEW"},attempts=attempts+${wait ? 0 : 1},last_error=${code.slice(0, 160)},due_at=now()+interval '5 seconds',lease_owner=null,lease_until=null,updated_at=now() WHERE id=${j.id} AND lease_owner=${owner}`;
    if (error instanceof LabHttpError && error.status === 401) {
      cache.delete(c.profile);
      return true;
    }
    if (!retry || (!wait && j.attempts >= 4)) {
      await review(c, code.slice(0, 160));
    } else
      await journal(c, j.id + ":retry:" + j.attempts, wait ? "WAIT" : "RETRY", {
        code: code.slice(0, 160),
        orderId: source,
        impact:
          "Same source/action key is retained; no fresh payment key is issued.",
      });
    return true;
  }
}
async function tick(profile: Profile) {
  let c = await control(profile);
  await prisma.$executeRaw`UPDATE operations_lab.job SET status='PENDING',lease_owner=null,lease_until=null,last_error='EXPIRED_JOB_LEASE_RECOVERY',updated_at=now() WHERE run_id=${c.current_run_id} AND tenant_id=${c.tenant_id} AND venue_id=${c.venue_id} AND status='LEASED' AND lease_until<now()`;
  if (!["RUNNING", "STOP_AFTER_DAY"].includes(c.mode)) {
    await prisma.$executeRaw`UPDATE operations_lab.control SET heartbeat_at=now() WHERE profile=${profile} AND (lease_owner=${owner} OR lease_until IS NULL OR lease_until<now())`;
    return;
  }
  const claimed =
    await prisma.$executeRaw`UPDATE operations_lab.control SET lease_owner=${owner},lease_until=now()+interval '30 seconds',heartbeat_at=now() WHERE profile=${profile} AND (lease_owner=${owner} OR lease_until IS NULL OR lease_until<now())`;
  if (!claimed) return;
  const heartbeat = setInterval(() => {
    void prisma.$executeRaw`UPDATE operations_lab.control SET lease_until=now()+interval '30 seconds',heartbeat_at=now() WHERE profile=${profile} AND lease_owner=${owner}`.catch(
      () => {},
    );
    void prisma.$executeRaw`UPDATE operations_lab.job SET lease_until=now()+interval '30 seconds' WHERE run_id=${c.current_run_id} AND status='LEASED' AND lease_owner=${owner}`.catch(
      () => {},
    );
  }, 5000);
  try {
    if (!c.current_run_id) {
      if ((idleUntil.get(profile) ?? 0) > Date.now()) return;
      await createDay(c);
      return;
    }
    const rows = await prisma.$queryRaw<
      Day[]
    >`SELECT * FROM operations_lab.day WHERE run_id=${c.current_run_id} AND tenant_id=${c.tenant_id} AND venue_id=${c.venue_id}`;
    const d = rows[0];
    if (!d) return;
    const run = await prisma.$queryRaw<
      Array<{ status: string; business_date: Date }>
    >`SELECT status,business_date FROM operations_lab.run WHERE id=${d.run_id}`;
    if (run[0]!.status === "COMPLETED") {
      const venue = await prisma.venue.findFirstOrThrow({
          where: { id: c.venue_id, tenantId: c.tenant_id },
        }),
        today = businessDateForInstant(new Date(), venue.timezone);
      if (c.mode === "STOP_AFTER_DAY" || d.config.mode === "FUNCTIONAL_WINDOW")
        await prisma.$executeRaw`UPDATE operations_lab.control SET mode='STOPPED',version=version+1 WHERE profile=${profile} AND lease_owner=${owner}`;
      else if (run[0]!.business_date.toISOString().slice(0, 10) !== today) {
        await prisma.$executeRaw`UPDATE operations_lab.control SET current_run_id=null WHERE profile=${profile} AND lease_owner=${owner}`;
        cache.delete(profile);
      }
      return;
    }
    if (
      c.heartbeat_at &&
      Date.now() - c.heartbeat_at.getTime() > 2 * 3600000 &&
      d.opened
    ) {
      await review(c, "LONG_OFFLINE_OPEN_SHIFT_REQUIRES_REVIEW");
      return;
    }
    if (new Date() < new Date(d.opens_at.getTime() - 15 * 60000)) return;
    const op = await operation(c);
    if (!hydrated.has(op)) {
      await op.begin();
      hydrated.add(op);
    }
    if (!d.opened) {
      await prisma.$executeRaw`UPDATE operations_lab.day SET opened=true WHERE run_id=${d.run_id}`;
      await journal(c, d.run_id + ":open", "OPEN", {
        actor: "eight individual synthetic staff",
        impact: "Actual shifts, attendance and cash session are persisted.",
      });
      return;
    }
    const storage = await labStorageStatus(archiveRoot);
    if (storage.full) {
      await review(c, "PDF_STORAGE_FULL");
      return;
    }
    if (storage.warning)
      await journal(c, d.run_id + ":storage-warning", "WARNING", {
        files: storage.files,
        bytes: storage.bytes,
      });
    const jobs = await prisma.$queryRaw<
      Job[]
    >`SELECT * FROM operations_lab.job WHERE run_id=${d.run_id} AND (status='PENDING' OR (status='LEASED' AND lease_until<now())) AND due_at<=now() ORDER BY CASE stage WHEN 'READY' THEN 0 WHEN 'SETTLE' THEN 1 WHEN 'FINAL' THEN 2 WHEN 'PREPARE' THEN 3 ELSE 4 END,due_at LIMIT 32`;
    for (const j of jobs) {
      c = await control(profile);
      if (!["RUNNING", "STOP_AFTER_DAY"].includes(c.mode)) return;
      if (await stage(c, d, op, j)) return;
    }
    const outstanding = await prisma.$queryRaw<
      Array<{ count: bigint }>
    >`SELECT count(*) FROM operations_lab.job WHERE run_id=${d.run_id} AND status NOT IN ('DONE','MISSED')`;
    if (Number(outstanding[0]!.count)) return;
    if (d.config.mode === "WALL_CLOCK" && new Date() < d.closes_at) return;
    const all = await prisma.$queryRaw<
      Job[]
    >`SELECT * FROM operations_lab.job WHERE run_id=${d.run_id}`;
    const foreignCash = await prisma.paymentRecord.findMany({
      where: {
        tenantId: c.tenant_id,
        venueId: c.venue_id,
        cashSessionId: op.cashSessionId,
        status: "RECORDED",
        method: "CASH",
      },
      select: { id: true },
    });
    const ownPayments = await prisma.$queryRaw<
      Array<{ result: { paymentId?: string; id?: string } | null }>
    >`SELECT result FROM operations_lab.action WHERE run_id=${d.run_id} AND expected->>'kind'='PAYMENT'`;
    const cash = await prisma.cashSession.findFirstOrThrow({
      where: {
        id: op.cashSessionId,
        tenantId: c.tenant_id,
        venueId: c.venue_id,
      },
    });
    if (
      cash.status === "OPEN" &&
      foreignCash.some(
        (p) =>
          !ownPayments.some(
            (a) => (a.result?.paymentId ?? a.result?.id) === p.id,
          ),
      )
    ) {
      await review(c, "EXTERNAL_CASH_REQUIRES_OPERATOR_COUNT");
      return;
    }
    await op.end(all.filter((j) => j.status === "DONE").map((j) => j.intent));
    const platform = await op.manager.request<DailyOperationsReport>(
        "GET",
        "/v1/staff/reports/daily?date=" + op.run.businessDate,
      ),
      report = await reconcile(op.run, platform);
    const completedBrowser = all.filter(
      (j) =>
        j.status === "DONE" &&
        j.intent.provenance === "WEBSITE_BROWSER" &&
        !j.intent.cancel,
    ).length;
    await prisma.$executeRaw`UPDATE operations_lab.day SET report=${JSON.stringify({ counts: report.counts, totals: report.totals, cash: report.cash, discrepancies: report.discrepancies, missed: all.filter((j) => j.status === "MISSED").length, completedBrowser, coverageIncomplete: completedBrowser < 2, filename: report.filename })}::jsonb WHERE run_id=${d.run_id}`;
    if (report.discrepancies.length) {
      await review(c, "DAILY_RECONCILIATION_REQUIRES_REVIEW");
      return;
    }
    if (completedBrowser < 2) {
      await review(c, "BROWSER_COVERAGE_INCOMPLETE_PARTIAL_DAY");
      return;
    }
    assertLabCompletion(op.run.status, report.unresolvedActions, 0);
    await prisma.$executeRaw`UPDATE operations_lab.run SET status='COMPLETED',checkpoint=${JSON.stringify({ report: report.filename, mode: d.config.mode })}::jsonb,updated_at=now() WHERE id=${d.run_id} AND tenant_id=${c.tenant_id} AND venue_id=${c.venue_id}`;
    await prisma.$executeRaw`UPDATE operations_lab.day SET report=${JSON.stringify({ counts: report.counts, totals: report.totals, cash: report.cash, discrepancies: report.discrepancies, missed: all.filter((j) => j.status === "MISSED").length, completedBrowser, filename: report.filename })}::jsonb WHERE run_id=${d.run_id}`;
    await journal(c, d.run_id + ":closed", "CLOSED", {
      counts: report.counts,
      missed: all.filter((j) => j.status === "MISSED").length,
      discrepancies: report.discrepancies,
      report: report.filename,
      impact: "No financial ledger was introduced.",
    });
    await mkdir(folderFor(op), { recursive: true });
    await writeFile(
      folderFor(op) + "/daily.json",
      JSON.stringify(report, null, 2),
    );
    await writeFile(
      folderFor(op) + "/daily.md",
      `# ${c.profile} · ${op.run.businessDate}\n\n${d.config.mode}: actual wall-clock events; no multi-day uptime claim.\n\n${report.counts.orders} orders, ${report.counts.cancelled} cancellations, ${report.counts.tickets} Kitchen/Bar tickets, ${report.counts.payments} recorded payments. ${completedBrowser} genuine website-browser orders. ${all.filter((j) => j.status === "MISSED").length} undispatched arrivals skipped.\n\n${report.counts.receipts} canonical P2 receipts and ${report.counts.pdfs} verified PDF archives; ${report.counts.printed} confirmed P3 jobs.\n\nCASH ${(report.totals.cashMinor / 100).toFixed(2)} ${report.currency}; manual CARD ${(report.totals.cardMinor / 100).toFixed(2)} ${report.currency}. QR session-only ${(report.totals.sessionOnlyPaymentMinor / 100).toFixed(2)} ${report.currency} remains unallocated; no invented P2 receipt.\n\nRegister: ${report.cash.map((x) => `opening ${x.opening}; expected ${x.expected}; counted ${x.counted}; difference ${x.difference} (minor units)`).join("; ")}.\n\nIndependent financial discrepancies: ${report.discrepancies.length}. Source evidence: ${report.filename}.\n`,
    );
  } finally {
    clearInterval(heartbeat);
  }
}
function folderFor(op: LabOperations) {
  return `artifacts/operations-lab/runtime/${op.run.businessDate}/${op.run.venueId}`;
}
await assertLabInstance();
await assertLabApi();
await initializeControls();
console.log(
  "LAB2 worker ready: real wall clock, two independently leased synthetic venues",
);
try {
  await runVenueLoops(
    tick,
    async (p, error) => {
      const code =
        error instanceof LabHttpError
          ? `${error.status}_${error.code}`
          : (error as Error).message;
      console.error("LAB2 transport/recovery wait: " + code.slice(0, 140));
      if (error instanceof LabHttpError && error.status === 401)
        cache.delete(p);
      else if (
        error instanceof LabHttpError &&
        [400, 403, 409].includes(error.status)
      ) {
        try {
          const c = await control(p);
          await review(c, code.slice(0, 140));
        } catch {
          console.error(
            "LAB2 review checkpoint waits for database recovery: " + p,
          );
        }
      }
    },
    () => stopping,
  );
} finally {
  await closeCustomerBrowser();
  await prisma.$executeRaw`UPDATE operations_lab.control SET lease_owner=null,lease_until=null WHERE lease_owner=${owner}`.catch(
    () => {},
  );
  await prisma.$disconnect();
  if (process.connected) process.disconnect?.();
}
