import { createRequire } from "node:module";
import {
  readFile,
  writeFile,
  mkdir,
  stat,
  copyFile,
  truncate,
} from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "@flowgastronomie/database";
import { assertLabInstance } from "./guard.js";
import { renewLabTests } from "./test-entitlements.js";
import { labStorageStatus } from "./storage.js";
import { archiveRoot } from "./pdf-archive.js";
const cfg = JSON.parse(
  await readFile(process.env.LAB_RUNTIME_CONFIG!, "utf8"),
) as { code: string; data: string; revision: string; pm2Home: string };
const pm2 = createRequire(join(cfg.code, "package.json"))("pm2") as {
  connect(cb: (error: Error | null) => void): void;
  list(
    cb: (
      error: Error | null,
      list: Array<{
        name: string;
        pid: number;
        pm2_env: { status: string; restart_time: number; exit_code?: number };
      }>,
    ) => void,
  ): void;
  disconnect(): void;
};
let stopped = false,
  lastRenewal = 0;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => (stopped = true));
process.on("message", (m) => {
  if (m === "shutdown") stopped = true;
});
async function reachable(path: string) {
  try {
    return (await fetch(path, { signal: AbortSignal.timeout(3000) })).ok;
  } catch {
    return false;
  }
}
async function collect() {
  const api = await reachable("http://127.0.0.1:4400/lab/identity"),
    web = await reachable("http://127.0.0.1:3400/en/lab");
  let database = false,
    rows: Array<{
      profile: string;
      last_action: Date | null;
      last_day: string | null;
      pending: bigint;
      stuck: bigint;
      browser_failures: bigint;
      issues: bigint;
      financial_discrepancies: number | null;
      print_pending: bigint;
      print_failed: bigint;
      archive_pending: bigint;
      expiry: Date | null;
      status: string;
      opted_in: boolean;
    }> = [],
    storage: Awaited<ReturnType<typeof labStorageStatus>> | null = null;
  try {
    await assertLabInstance();
    if (Date.now() - lastRenewal > 6 * 3600000) {
      await renewLabTests();
      lastRenewal = Date.now();
    }
    rows = await prisma.$queryRaw`SELECT v.profile,
      (SELECT max(a.updated_at) FROM operations_lab.action a WHERE a.tenant_id=v.tenant_id AND a.venue_id=v.venue_id AND a.status='SUCCEEDED') AS last_action,
      (SELECT max(r.business_date)::text FROM operations_lab.run r WHERE r.tenant_id=v.tenant_id AND r.venue_id=v.venue_id AND r.status='COMPLETED') AS last_day,
      (SELECT count(*) FROM operations_lab.job j WHERE j.tenant_id=v.tenant_id AND j.venue_id=v.venue_id AND j.status IN ('PENDING','LEASED')) AS pending,
      (SELECT count(*) FROM operations_lab.job j WHERE j.tenant_id=v.tenant_id AND j.venue_id=v.venue_id AND j.status='LEASED' AND j.lease_until<now()) AS stuck,
      (SELECT count(*) FROM operations_lab.job j WHERE j.tenant_id=v.tenant_id AND j.venue_id=v.venue_id AND j.status='NEEDS_REVIEW' AND j.intent->>'provenance'='WEBSITE_BROWSER') AS browser_failures,
      (SELECT count(*) FROM operations_lab.control c WHERE c.tenant_id=v.tenant_id AND c.venue_id=v.venue_id AND c.mode='NEEDS_REVIEW') AS issues,
      (SELECT jsonb_array_length(d.report->'discrepancies') FROM operations_lab.day d JOIN operations_lab.run r ON r.id=d.run_id WHERE r.tenant_id=v.tenant_id AND r.venue_id=v.venue_id AND d.report IS NOT NULL ORDER BY r.created_at DESC LIMIT 1) AS financial_discrepancies,
      (SELECT count(*) FROM "PrintJob" p WHERE p."tenantId"=v.tenant_id AND p."venueId"=v.venue_id AND p.status IN ('QUEUED','PRINTING')) AS print_pending,
      (SELECT count(*) FROM (SELECT DISTINCT ON (p."receiptId") p.status FROM "PrintJob" p WHERE p."tenantId"=v.tenant_id AND p."venueId"=v.venue_id ORDER BY p."receiptId",p."createdAt" DESC,p.id DESC) latest WHERE latest.status='FAILED') AS print_failed,
      (SELECT count(*) FROM "Receipt" r WHERE r."tenantId"=v.tenant_id AND r."venueId"=v.venue_id AND NOT EXISTS(SELECT 1 FROM operations_lab.archive a WHERE a.tenant_id=v.tenant_id AND a.venue_id=v.venue_id AND a.receipt_id=r.id)) AS archive_pending,
      s."trialEndsAt" AS expiry,s.status::text AS status,
      EXISTS(SELECT 1 FROM operations_lab.entitlement_opt_in e WHERE e.tenant_id=v.tenant_id AND e.venue_id=v.venue_id) AS opted_in
      FROM operations_lab.venue v JOIN "Subscription" s ON s."tenantId"=v.tenant_id ORDER BY v.profile`;
    storage = await labStorageStatus(archiveRoot);
    database = true;
  } catch (e) {
    console.error(
      "LAB monitor database/renewal waiting: " +
        ((e as { code?: string }).code ?? "GUARD_OR_DATABASE"),
    );
  }
  await new Promise<void>((resolve, reject) =>
    pm2.connect((e) => (e ? reject(e) : resolve())),
  );
  const list = await new Promise<
    Array<{
      name: string;
      pid: number;
      pm2_env: { status: string; restart_time: number; exit_code?: number };
    }>
  >((resolve, reject) =>
    pm2.list((e, list) => (e ? reject(e) : resolve(list))),
  );
  pm2.disconnect();
  const processes = list
    .filter((p) => p.name.startsWith("rflow-lab-"))
    .map((p) => ({
      name: p.name,
      pid: p.pid,
      status: p.pm2_env.status,
      restarts: p.pm2_env.restart_time,
      lastExitCode: p.pm2_env.exit_code ?? null,
    }));
  const backup = JSON.parse(
    await readFile(join(cfg.data, ".runtime/last-backup.json"), "utf8").catch(
      () => "null",
    ),
  ) as unknown;
  const report = {
    version: 1,
    revision: cfg.revision,
    observedAt: new Date().toISOString(),
    api,
    web,
    database,
    processes,
    venues: rows.map((r) => ({
      profile: r.profile,
      lastSuccessfulAction: r.last_action?.toISOString() ?? null,
      lastClosedDay: r.last_day,
      pending: Number(r.pending),
      expiredLeases: Number(r.stuck),
      browserFailures: Number(r.browser_failures),
      needsReview: Number(r.issues),
      lastReconciliationDiscrepancies: r.financial_discrepancies,
      printerPending: Number(r.print_pending),
      printerFailures: Number(r.print_failed),
      receiptArchivePending: Number(r.archive_pending),
      entitlement: {
        status: r.status,
        validUntil: r.expiry?.toISOString() ?? null,
        optedIn: r.opted_in,
      },
    })),
    storage,
    lastBackup: backup,
  };
  await mkdir(join(cfg.data, ".runtime"), { recursive: true, mode: 0o700 });
  await writeFile(
    join(cfg.data, ".runtime/health.json"),
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
  const summary =
    `# Laboratori · ${new Date().toLocaleDateString("sq-AL", { timeZone: "Europe/Berlin" })}\n\nVëzhguar: ${report.observedAt}. API ${api ? "përgjigjet" : "nuk përgjigjet"}; website ${web ? "përgjigjet" : "nuk përgjigjet"}; PostgreSQL ${database ? "i lidhur" : "i palidhur"}.\n\n` +
    report.venues
      .map(
        (v) =>
          `${v.profile}: veprimi i fundit ${v.lastSuccessfulAction ?? "nuk është vëzhguar"}; dita e fundit e mbyllur ${v.lastClosedDay ?? "ende asnjë"}; ${v.pending} punë në pritje, ${v.expiredLeases} lease të skaduara, ${v.browserFailures} incidente browser. Rakordimi i fundit: ${v.lastReconciliationDiscrepancies ?? "ende pa raport"} mospërputhje; printeri: ${v.printerPending} në pritje, ${v.printerFailures} rezultate të fundit të dështuara; ${v.receiptArchivePending} fatura P2 presin arkivim PDF. ${v.needsReview || v.printerFailures ? "Operatori duhet të shqyrtojë incidentin në panel." : "Nuk ka kontroll venue në NEEDS_REVIEW ose printim të fundit të dështuar."} Entitlement test deri ${v.entitlement.validUntil}; opt-in ${v.entitlement.optedIn ? "po" : "jo"}.`,
      )
      .join("\n\n") +
    "\n\nShkaku nuk hamendësohet: kontrolloni gjendjen e regjistruar dhe journal-in. Një restart procesi nuk provon vetvetiu recovery financiar.\n";
  await writeFile(join(cfg.data, ".runtime/daily-sq.md"), summary, {
    mode: 0o600,
  });
  for (const p of ["api", "web", "worker", "monitor"])
    for (const suffix of ["out", "error"]) {
      const file = join(cfg.data, `.runtime/logs/${p}.${suffix}.log`);
      try {
        if ((await stat(file)).size > 10_000_000) {
          await copyFile(file, file + ".previous");
          await truncate(file, 0);
        }
      } catch {}
    }
}
try {
  while (!stopped) {
    try {
      await collect();
    } catch {
      console.error("LAB monitoring recovery wait");
    }
    for (let i = 0; i < 30 && !stopped; i++)
      await new Promise((r) => setTimeout(r, 1000));
  }
} finally {
  pm2.disconnect();
  await prisma.$disconnect();
  if (process.connected) process.disconnect?.();
}
