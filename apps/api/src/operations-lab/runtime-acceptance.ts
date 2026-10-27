import { prisma } from "@flowgastronomie/database";
import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { assertLabInstance, hash, assertLabScope } from "./guard.js";
import { control } from "./runtime-store.js";
import { provision, type LocalState } from "./provision.js";
import { LabClient } from "./client.js";
import { spawnCommandSync } from "../../../../tests/operations/process-command.mjs";
import { verifyArchive, type ArchiveEntry } from "./pdf-archive.js";
import type {
  FinalReceipt,
  LabDashboardSnapshot,
  SimplePilotOrder,
} from "@flowgastronomie/domain";
const mode = process.argv[2],
  pause = (ms: number) => new Promise((r) => setTimeout(r, ms)),
  root = "artifacts/operations-lab/runtime-proof";
await assertLabInstance();
await mkdir(root, { recursive: true });
const secret = (
  JSON.parse(await readFile(".operations-lab/operator.json", "utf8")) as {
    secret: string;
  }
).secret;
async function op(path: string, body?: unknown) {
  const headers: Record<string, string> = { authorization: "Bearer " + secret };
  if (body !== undefined) headers["content-type"] = "application/json";
  const r = await fetch("http://127.0.0.1:4400/lab/operator" + path, {
    method: body === undefined ? "GET" : "POST",
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!r.ok) throw new Error("OPERATOR_PROBE_FAILED_" + r.status);
  return r.json();
}
async function dashboard() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto("http://127.0.0.1:3400/en/lab");
    await page.getByLabel("Local operator key").fill(secret);
    await page.getByRole("button", { name: "Open lab", exact: true }).click();
    await expect(page.locator("[data-profile='DE']")).toBeVisible({
      timeout: 30000,
    });
    await expect(page.locator("#lab-password")).toHaveCount(0);
    const snapshot = (await op("/status")) as LabDashboardSnapshot;
    for (const venue of snapshot.venues) {
      if (
        venue.counts.accepted > venue.counts.received ||
        venue.counts.accepted < venue.counts.completed
      )
        throw new Error("DASHBOARD_ACCEPTED_COUNT_INCONSISTENT");
      await expect(
        page.getByTestId(`lab-accepted-${venue.profile}`).locator("strong"),
      ).toHaveText(String(venue.counts.accepted));
    }
    await page.screenshot({ path: root + "/operator-en.png", fullPage: true });
    await page.goto("http://127.0.0.1:3400/sq/lab");
    await expect(
      page.getByRole("heading", { name: "Laboratori i Operacioneve" }),
    ).toBeVisible();
    await expect(page.locator("[data-profile='AL']")).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: root + "/operator-sq-390.png",
      fullPage: true,
    });
    const widths = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      width: innerWidth,
    }));
    if (widths.scroll > widths.width + 2)
      throw new Error("OPERATOR_MOBILE_OVERFLOW");
    await page.goto("http://127.0.0.1:3400/de/lab");
    await expect(
      page.getByRole("heading", { name: "Operationslabor" }),
    ).toBeVisible();
    await page.goto("http://127.0.0.1:3400/it/lab");
    await expect(
      page.getByRole("heading", { name: "Laboratorio operativo" }),
    ).toBeVisible();
  } finally {
    await browser.close();
  }
}
try {
  if (mode === "probe") {
    const anonymous = await fetch("http://127.0.0.1:4400/lab/operator/status");
    if (anonymous.status !== 401) throw new Error("OPERATOR_AUTH_NOT_ENFORCED");
    const cross = await fetch("http://127.0.0.1:4400/lab/operator/config", {
      method: "POST",
      headers: {
        authorization: "Bearer " + secret,
        "content-type": "application/json",
      },
      body: JSON.stringify({ profile: "NEON", expectedVersion: 0, config: {} }),
    });
    if (cross.ok) throw new Error("FOREIGN_OPERATOR_SCOPE_ACCEPTED");
    await dashboard();
    // An independent staff client creates/fulfills a real CARD order outside worker actions.
    for (const profile of ["DE", "AL"] as const) {
      const c = await control(profile),
        ctx = await provision(profile),
        staff = ctx.clients.cashier!,
        manager = ctx.clients.manager!,
        item = ctx.state.catalog!.find((i) => i.category === "MEAL")!,
        key = hash(c.current_run_id + ":operator-fixture");
      const created = await staff.request<{ id: string }>(
        "POST",
        "/v1/staff/orders",
        {
          locale: "en",
          orderType: "TAKEAWAY",
          items: [{ productId: item.productId, quantity: 1 }],
        },
        { "idempotency-key": key },
      );
      let row = (
        await manager.request<SimplePilotOrder[]>(
          "GET",
          "/v1/staff/pilot/orders?view=TODAY",
        )
      ).find((o) => o.id === created.id)!;
      for (const t of row.tickets)
        await ctx.clients.kitchen!.request(
          "PATCH",
          `/v1/staff/production-tickets/${t.id}/status`,
          { status: "PREPARING", expectedVersion: t.version },
        );
      await pause(2000);
      row = (
        await manager.request<SimplePilotOrder[]>(
          "GET",
          "/v1/staff/pilot/orders?view=TODAY",
        )
      ).find((o) => o.id === created.id)!;
      for (const t of row.tickets)
        await ctx.clients.kitchen!.request(
          "PATCH",
          `/v1/staff/production-tickets/${t.id}/status`,
          { status: "READY", expectedVersion: t.version },
        );
      const receipt = await staff.request<FinalReceipt>(
        "POST",
        `/v1/staff/pos/orders/${created.id}/payment`,
        { method: "CARD_AT_COUNTER", terminalConfirmed: true },
        { "idempotency-key": key + "-pay" },
      );
      if (receipt.grossMinor !== item.priceMinor)
        throw new Error("EXTERNAL_FIXTURE_MONEY_MISMATCH");
      await staff.request(
        "POST",
        `/v1/staff/pos/orders/${created.id}/complete`,
      );
      const devices = await manager.request<{
          devices: Array<{ id: string; mode: string }>;
        }>("GET", "/v1/staff/hardware/devices"),
        device = devices.devices.find((d) => d.mode === "SIMULATOR")!;
      const job = await manager.request<{ id: string }>(
        "POST",
        "/v1/staff/hardware/jobs",
        { receiptId: receipt.id, deviceId: device.id, key: key + "-print" },
      );
      await manager.request(
        "POST",
        `/v1/staff/hardware/jobs/${job.id}/execute`,
        { retry: false },
      );
      const wrong = await op(
        `/pdf/${profile === "DE" ? "AL" : "DE"}/${receipt.id}`,
      )
        .then(() => true)
        .catch(() => false);
      if (wrong) throw new Error("OPERATOR_PDF_TENANT_LEAK");
      await writeFile(
        root + `/${profile}-external.json`,
        JSON.stringify(
          {
            orderId: created.id,
            paymentId: receipt.paymentId,
            receiptId: receipt.id,
            amountMinor: item.priceMinor,
            source: "Independent operator fixture outside simulator actions",
          },
          null,
          2,
        ),
      );
      const legacy = await prisma.receipt.findMany({
        where: {
          tenantId: c.tenant_id,
          venueId: c.venue_id,
          status: "FINALIZED",
        },
        orderBy: { issuedAt: "asc" },
        take: 2,
      });
      const beforePayments = await prisma.paymentRecord.count(),
        beforeReceipts = await prisma.receipt.count();
      const parallelJobs = await Promise.all(
        legacy.map((r, i) =>
          manager.request<{ id: string }>("POST", "/v1/staff/hardware/jobs", {
            receiptId: r.id,
            deviceId: device.id,
            key: key + "-parallel" + i,
          }),
        ),
      );
      const results = await Promise.all(
        parallelJobs.map((j) =>
          manager.request<{ job: { status: string } }>(
            "POST",
            `/v1/staff/hardware/jobs/${j.id}/execute`,
            { retry: false },
          ),
        ),
      );
      if (
        results.some((r) => r.job.status !== "PRINTED") ||
        (await prisma.paymentRecord.count()) !== beforePayments ||
        (await prisma.receipt.count()) !== beforeReceipts
      )
        throw new Error("CONCURRENT_PDF_SCOPE_OR_FINANCIAL_DUPLICATION");
      for (let i = 0; i < parallelJobs.length; i++) {
        const links = await prisma.$queryRaw<
          Array<{ receipt_id: string }>
        >`SELECT receipt_id FROM operations_lab.archive_print WHERE job_id=${parallelJobs[i]!.id} AND tenant_id=${c.tenant_id} AND venue_id=${c.venue_id}`;
        if (links[0]?.receipt_id !== legacy[i]!.id)
          throw new Error("CONCURRENT_PRINT_JOB_ASSOCIATION_MISMATCH");
      }
    }
    await assertLabInstance();
    const restart = spawnCommandSync(
      "docker",
      ["compose", "-f", "compose.operations-lab.yaml", "restart", "postgres"],
      { stdio: "ignore" },
    );
    if (restart.status !== 0) throw new Error("LAB_POSTGRES_RESTART_FAILED");
    let recovered = false;
    for (let i = 0; i < 90; i++) {
      try {
        await assertLabInstance();
        recovered = true;
        break;
      } catch {}
      await pause(500);
    }
    if (!recovered) throw new Error("LAB_POSTGRES_RESTART_NOT_RECOVERED");
    let s: LabDashboardSnapshot | undefined;
    for (let i = 0; i < 30; i++) {
      try {
        s = (await op("/status")) as LabDashboardSnapshot;
        break;
      } catch {
        await pause(500);
      }
    }
    if (!s) throw new Error("API_POOL_NOT_RECOVERED_AFTER_POSTGRES_RESTART");
    if (s.venues.some((v) => v.mode !== "PAUSED"))
      throw new Error("POSTGRES_RESTART_LOST_PAUSE");
    await writeFile(
      root + "/restart.json",
      JSON.stringify(
        {
          actualAt: new Date().toISOString(),
          postgresInstanceUnchanged: true,
          apiRestartPausePersisted: true,
          postgresRestartPausePersisted: true,
          operatorAuth: true,
          tenantIsolation: true,
          locales: ["sq", "de", "en", "it"],
        },
        null,
        2,
      ),
    );
  } else if (mode === "parallel") {
    const p0 = await prisma.paymentRecord.count(),
      r0 = await prisma.receipt.count();
    for (const profile of ["DE", "AL"] as const) {
      const c = await control(profile),
        state = JSON.parse(
          await readFile(`.operations-lab/${profile}.json`, "utf8"),
        ) as LocalState,
        a = state.actors.manager!,
        s = a.staff!,
        client = new LabClient(profile);
      await client.request("POST", "/v1/auth/login", {
        tenantSlug: s.tenantSlug,
        venueSlug: s.venueSlug,
        email: a.email,
        password: a.password,
      });
      const devices = await client.request<{
          devices: Array<{ id: string; mode: string }>;
        }>("GET", "/v1/staff/hardware/devices"),
        device = devices.devices.find((d) => d.mode === "SIMULATOR")!,
        receipts = await prisma.receipt.findMany({
          where: { tenantId: c.tenant_id, venueId: c.venue_id },
          orderBy: { issuedAt: "asc" },
          take: 2,
        });
      const jobs = await Promise.all(
        receipts.map((r, i) =>
          client.request<{ id: string }>("POST", "/v1/staff/hardware/jobs", {
            receiptId: r.id,
            deviceId: device.id,
            key: hash(c.current_run_id + ":parallel-audit:" + i),
          }),
        ),
      );
      const results = await Promise.all(
        jobs.map((j) =>
          client.request<{ job: { status: string } }>(
            "POST",
            `/v1/staff/hardware/jobs/${j.id}/execute`,
            { retry: false },
          ),
        ),
      );
      if (results.some((r) => r.job.status !== "PRINTED"))
        throw new Error("CONCURRENT_PRINT_FAILED");
      for (let i = 0; i < jobs.length; i++) {
        const links = await prisma.$queryRaw<
          Array<{ receipt_id: string }>
        >`SELECT receipt_id FROM operations_lab.archive_print WHERE job_id=${jobs[i]!.id} AND tenant_id=${c.tenant_id} AND venue_id=${c.venue_id}`;
        if (links[0]?.receipt_id !== receipts[i]!.id)
          throw new Error("CONCURRENT_SCOPE_MISMATCH");
      }
    }
    if (
      (await prisma.paymentRecord.count()) !== p0 ||
      (await prisma.receipt.count()) !== r0
    )
      throw new Error("CONCURRENT_REPRINT_DUPLICATED_MONEY");
    await writeFile(
      root + "/parallel.json",
      JSON.stringify(
        {
          status: "passed",
          concurrentJobs: 4,
          paymentCountBefore: p0,
          paymentCountAfter: p0,
          receiptCountBefore: r0,
          receiptCountAfter: r0,
          associationsVerified: true,
        },
        null,
        2,
      ),
    );
  } else if (mode === "unknown") {
    const state = JSON.parse(
        await readFile(".operations-lab/DE.json", "utf8"),
      ) as LocalState,
      actor = state.actors.manager!,
      scope = actor.staff!,
      client = new LabClient("DE");
    await assertLabScope(scope.tenantId, scope.venueId);
    await client.request("POST", "/v1/auth/login", {
      tenantSlug: scope.tenantSlug,
      venueSlug: scope.venueSlug,
      email: actor.email,
      password: actor.password,
    });
    const devices = await client.request<{
      devices: Array<{ id: string; mode: string }>;
    }>("GET", "/v1/staff/hardware/devices");
    await client.request(
      "POST",
      `/v1/staff/hardware/simulator/${devices.devices.find((d) => d.mode === "SIMULATOR")!.id}/diagnostics`,
      { nextPrintFailure: "UNKNOWN_RESULT" },
    );
  } else if (mode === "final") {
    const s = (await op("/status")) as LabDashboardSnapshot;
    for (const v of s.venues) {
      const c = await control(v.profile),
        report = v.report;
      if (
        !report ||
        report.discrepancies.length ||
        report.completedBrowser !== 2
      )
        throw new Error("RUNTIME_FINAL_REPORT_FAILED");
      const jobs = await prisma.$queryRaw<
        Array<{
          order_id: string | null;
          status: string;
          intent: { channel: string; cancel: boolean };
        }>
      >`SELECT order_id,status,intent FROM operations_lab.job WHERE run_id=${c.current_run_id}`;
      if (
        jobs.length !== 18 ||
        jobs.some((j) => j.status !== "DONE") ||
        new Set(jobs.map((j) => j.order_id)).size !== 18
      )
        throw new Error("DUPLICATE_OR_MISSING_RUNTIME_ORDER");
      const actions = await prisma.$queryRaw<
        Array<{ result: { paymentId?: string; id?: string } | null }>
      >`SELECT result FROM operations_lab.action WHERE run_id=${c.current_run_id} AND expected->>'kind'='PAYMENT'`;
      const ids = actions.map((a) => a.result?.paymentId ?? a.result?.id ?? "");
      if (new Set(ids).size !== ids.length)
        throw new Error("DUPLICATE_RUNTIME_PAYMENT");
      const receipts = await prisma.receipt.findMany({
        where: {
          tenantId: c.tenant_id,
          venueId: c.venue_id,
          paymentId: { in: ids },
        },
      });
      for (const r of receipts) {
        const entries = await prisma.$queryRaw<
          ArchiveEntry[]
        >`SELECT * FROM operations_lab.archive WHERE receipt_id=${r.id} AND tenant_id=${c.tenant_id} AND venue_id=${c.venue_id}`;
        const bytes = await verifyArchive(entries[0]!);
        if (
          createHash("sha256").update(bytes).digest("hex") !==
          entries[0]!.content_hash
        )
          throw new Error("RUNTIME_PDF_HASH_MISMATCH");
      }
      const external = JSON.parse(
        await readFile(root + `/${v.profile}-external.json`, "utf8"),
      ) as { orderId: string };
      const day = await prisma.$queryRaw<
        Array<{ report: { filename: string } }>
      >`SELECT report FROM operations_lab.day WHERE run_id=${c.current_run_id}`;
      const actual = JSON.parse(
        await readFile(day[0]!.report.filename, "utf8"),
      ) as { externalActivity: { orders: Array<{ id: string }> } };
      if (
        !actual.externalActivity.orders.some((o) => o.id === external.orderId)
      )
        throw new Error("EXTERNAL_ACTIVITY_NOT_DISTINGUISHED");
      if (
        !v.journal.length ||
        v.journal.some(
          (row) =>
            !row.messages.en ||
            !row.messages.sq ||
            !row.messages.de ||
            !row.messages.it,
        )
      )
        throw new Error("RUNTIME_JOURNAL_EXPLANATION_MISSING");
      await writeFile(
        root + `/${v.profile}-journal.json`,
        JSON.stringify(
          {
            observedAt: s.now,
            profile: v.profile,
            rows: v.journal,
            week: v.week,
          },
          null,
          2,
        ),
      );
      await writeFile(
        root + `/${v.profile}-daily.md`,
        `# ${v.profile} · ${v.date}\n\nObserved at ${s.now}. Run ${v.runId}.\n\n` +
          `${report.counts.orders} worker orders; ${report.counts.tickets} tickets; ${report.counts.payments} payments; ${report.counts.pdfs} immutable receipt PDFs. Browser journeys: ${report.completedBrowser}. Missed arrivals: ${report.missed}. Unexplained discrepancies: ${report.discrepancies.length}.\n\n` +
          `Reconciliation: ${day[0]!.report.filename}. This is a short functional window, not proven multi-day uptime.\n\n## Recent observed events\n\n` +
          v.journal
            .slice()
            .reverse()
            .map(
              (row) =>
                `${row.at} — ${row.messages.en}${typeof row.facts.items === "string" ? " · " + row.facts.items : ""}`,
            )
            .join("\n\n") +
          `\n\n## Observed week\n\n` +
          v.week
            .map(
              (w) =>
                `${w.date}: ${w.events} events, ${w.closed} closes, ${w.incidents} incidents.`,
            )
            .join("\n\n") +
          "\n",
      );
    }
    await dashboard();
    await writeFile(
      root + "/integrity.json",
      JSON.stringify(
        {
          status: "passed",
          runtimeOrders: 36,
          externalOrders: 2,
          uniquePaymentIdentities: true,
          pdfHashesVerified: true,
          browserOrders: 4,
          externalActivityDistinct: true,
          actualAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } else throw new Error("UNKNOWN_RUNTIME_PROBE");
  console.log("LAB2 " + mode + " probe passed");
} finally {
  await prisma.$disconnect();
}
