import { prisma } from "@flowgastronomie/database";
import {
  generateLabIntents,
  labTrafficConfigSchema,
  assertLabCompletion,
  assertLabRunTransition,
  type LabIntent,
  type DailyOperationsReport,
} from "@flowgastronomie/domain";
import { mkdir, writeFile } from "node:fs/promises";
import { provision } from "./provision.js";
import { expandLabVenue } from "./catalog.js";
import { assertLabApi, LabHttpError } from "./client.js";
import { assertLabInstance, assertLabScope } from "./guard.js";
import { openRun } from "./actions.js";
import { LabOperations } from "./operations.js";
import {
  browserCustomer,
  closeCustomerBrowser,
  verifyBrowserCompletion,
} from "./browser-customer.js";
import { reconcile } from "./reconcile.js";
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const argument = (key: string, fallback: string) =>
  process.argv.find((a) => a.startsWith("--" + key + "="))?.split("=")[1] ??
  fallback;
await assertLabInstance();
await assertLabApi();
const summaries: Array<
  Pick<
    Awaited<ReturnType<typeof reconcile>>,
    | "counts"
    | "channels"
    | "provenance"
    | "waiting"
    | "totals"
    | "cash"
    | "discrepancies"
  > & {
    profile: "DE" | "AL";
    runId: string;
    mode: string;
    elapsedSeconds: number;
    invocationSeconds: number;
    queueSamples: Array<{ at: string; pending: number; preparing: number }>;
  }
> = [];
try {
  await prisma.$transaction(
    async (tx) => {
      const locks = await tx.$queryRaw<
        Array<{ locked: boolean }>
      >`SELECT pg_try_advisory_xact_lock(292901) AS locked`;
      if (!locks[0]?.locked) throw new Error("LAB_RUNNER_ALREADY_ACTIVE");
      for (const profile of ["DE", "AL"] as const) {
        const context = await provision(profile),
          catalog = await expandLabVenue(context),
          scope = context.state.actors.owner!.staff!;
        const config = labTrafficConfigSchema.parse({
          version: 1,
          profile,
          level: argument("level", "NORMAL"),
          seed: Number(argument("seed", "29")),
          maxOrders: Number(argument("cap", "160")),
          browserOrders: 3,
        });
        const run = await openRun(
          scope.tenantId,
          scope.venueId,
          context.date,
          "lab1-normal-v2-" + config.level + "-s" + config.seed,
          config.seed,
        );
        if (
          run.checkpoint.config &&
          Object.entries(config).some(
            ([key, value]) =>
              (run.checkpoint.config as Record<string, unknown>)[key] !== value,
          )
        )
          throw new Error("LAB_RUN_CONFIGURATION_CHANGED_USE_A_NEW_SEED");
        if (!run.checkpoint.config && run.status !== "COMPLETED")
          await prisma.$executeRaw`UPDATE operations_lab.run SET checkpoint=checkpoint || ${JSON.stringify({ config })}::jsonb WHERE id=${run.id} AND tenant_id=${run.tenantId} AND venue_id=${run.venueId}`;
        const intents = generateLabIntents(config, catalog).sort(
          (a, b) =>
            a.arrivalMinute - b.arrivalMinute || a.position - b.position,
        );
        if (
          run.status === "NEEDS_REVIEW" &&
          process.argv.includes("--recover-pre-submit")
        ) {
          const failed = await prisma.$queryRaw<
            Array<{
              event_id: string;
              browser_key: string | null;
              expected: { provenance?: string };
            }>
          >`SELECT event_id,browser_key,expected FROM operations_lab.action WHERE run_id=${run.id} AND tenant_id=${run.tenantId} AND venue_id=${run.venueId} AND status='NEEDS_REVIEW'`;
          if (
            !failed.length ||
            failed.some(
              (a) =>
                a.browser_key !== null ||
                a.expected.provenance !== "WEBSITE_BROWSER",
            )
          )
            throw new Error(
              "LAB_BROWSER_DISPATCH_UNCERTAIN_REQUIRES_OPERATOR_REVIEW",
            );
          await prisma.$executeRaw`UPDATE operations_lab.action SET status='PENDING',error_code='PRE_DISPATCH_RETRY_REVIEWED' WHERE run_id=${run.id} AND tenant_id=${run.tenantId} AND venue_id=${run.venueId} AND status='NEEDS_REVIEW' AND browser_key IS NULL`;
          assertLabRunTransition(run.status, "PAUSED");
          assertLabRunTransition("PAUSED", "RUNNING");
          await prisma.$executeRaw`UPDATE operations_lab.run SET status='RUNNING',checkpoint=checkpoint || '{"reviewedResume":"NEEDS_REVIEW -> PAUSED -> RUNNING"}'::jsonb,updated_at=now() WHERE id=${run.id} AND tenant_id=${run.tenantId} AND venue_id=${run.venueId}`;
          run.status = "RUNNING";
        }
        if (
          run.status === "NEEDS_REVIEW" &&
          process.argv.includes("--recover-browser-reviewed")
        ) {
          const failed = await prisma.$queryRaw<
            Array<{
              event_id: string;
              kind: string;
              browser_key: string | null;
              expected: { provenance?: string };
            }>
          >`SELECT event_id,kind,browser_key,expected FROM operations_lab.action WHERE run_id=${run.id} AND tenant_id=${run.tenantId} AND venue_id=${run.venueId} AND status='NEEDS_REVIEW'`;
          if (
            !failed.length ||
            failed.some(
              (a) =>
                !a.browser_key || a.expected.provenance !== "WEBSITE_BROWSER",
            )
          )
            throw new Error("LAB_BROWSER_REVIEW_SOURCE_REQUIRED");
          for (const a of failed) {
            const intent = intents.find(
              (i) =>
                new LabOperations(context, run).name(i, "create") === a.kind,
            )!;
            const observed = await browserCustomer(context, intent, a.event_id);
            await prisma.$executeRaw`UPDATE operations_lab.action SET status='SUCCEEDED',result=${JSON.stringify(observed)}::jsonb,result_source_ids=${JSON.stringify([observed.referenceCode])}::jsonb,error_code='OBSERVED_BROWSER_RECOVERY',lease_owner=null,lease_until=null WHERE event_id=${a.event_id} AND tenant_id=${run.tenantId} AND venue_id=${run.venueId}`;
          }
          assertLabRunTransition(run.status, "PAUSED");
          assertLabRunTransition("PAUSED", "RUNNING");
          await prisma.$executeRaw`UPDATE operations_lab.run SET status='RUNNING',checkpoint=checkpoint || '{"reviewedResume":"NEEDS_REVIEW -> PAUSED -> RUNNING"}'::jsonb,updated_at=now() WHERE id=${run.id} AND tenant_id=${run.tenantId} AND venue_id=${run.venueId}`;
          run.status = "RUNNING";
        }
        if (!["RUNNING", "COMPLETED"].includes(run.status))
          throw new Error("LAB_NORMAL_RUN_REQUIRES_REVIEW");
        const op = new LabOperations(context, run);
        const scale = Number(argument("prep-scale", "0.003"));
        if (!Number.isFinite(scale) || scale < 0.001 || scale > 0.1)
          throw new Error("LAB_COMPRESSED_PREPARATION_SCALE_INVALID");
        const startedAt = new Date(),
          queueSamples: Array<{
            at: string;
            pending: number;
            preparing: number;
          }> = [];
        if (run.status !== "COMPLETED") {
          await op.begin();
          let faultDone = false,
            staleDone = false;
          let cursor = 0;
          while (cursor < intents.length) {
            const created: Array<{ intent: LabIntent; id: string }> = [];
            let arrivals = 0;
            while (cursor < intents.length && arrivals < 8) {
              const intent = intents[cursor]!;
              let id: string;
              try {
                id = await op.create(
                  intent,
                  intent.provenance === "WEBSITE_BROWSER"
                    ? (key) => browserCustomer(context, intent, key)
                    : undefined,
                );
              } catch (error) {
                if (
                  (error as Error).message === "LAB_TABLE_CAPACITY_WAIT" &&
                  created.length
                )
                  break;
                throw error;
              }
              await op.confirm(intent, id);
              if (!intent.cancel) created.push({ intent, id });
              cursor++;
              arrivals++;
            }
            const pending = await op.manager.request<Array<{ status: string }>>(
              "GET",
              "/v1/staff/production/KITCHEN",
            );
            queueSamples.push({
              at: new Date().toISOString(),
              pending: pending.filter((t) => t.status === "NEW").length,
              preparing: pending.filter((t) => t.status === "PREPARING").length,
            });
            for (let index = 0; index < created.length; index += 2) {
              const group = created.slice(index, index + 2),
                timers: Array<{
                  intent: LabIntent;
                  id: string;
                  dueAt: number;
                  lane: number;
                }> = [];
              for (const [lane, entry] of group.entries()) {
                for (const station of ["KITCHEN", "BAR"])
                  await op.advance(
                    entry.intent,
                    entry.id,
                    station,
                    "PREPARING",
                    (station === "KITCHEN" ? "kitchen" : "bar") +
                      (lane ? "2" : ""),
                  );
                const timer = await op.actions.perform(
                  op.name(entry.intent, "preparation-timer"),
                  "manager",
                  { orderId: entry.id, scale },
                  { orderId: entry.id },
                  true,
                  async () => ({
                    id: entry.id,
                    dueAt: Date.now() + entry.intent.prepSeconds * scale * 1000,
                  }),
                );
                timers.push({ ...entry, dueAt: timer.dueAt, lane });
                if (!staleDone) {
                  await op.actions.perform(
                    "stale-transition-rejected",
                    "manager",
                    { orderId: entry.id },
                    { kind: "NEGATIVE" },
                    true,
                    async () => {
                      const ticket = (
                        await op.projection(entry.id)
                      ).tickets.find((t) => t.station === "KITCHEN")!;
                      try {
                        await op.manager.request(
                          "PATCH",
                          `/v1/staff/${entry.intent.channel === "WEBSITE" ? "online-production" : "production"}-tickets/${ticket.id}/status`,
                          {
                            status: "READY",
                            expectedVersion: ticket.version - 1,
                          },
                        );
                        throw new Error("LAB_STALE_TRANSITION_ACCEPTED");
                      } catch (error) {
                        if (
                          !(error instanceof LabHttpError) ||
                          error.status !== 409
                        )
                          throw error;
                      }
                      return {
                        rejected: true,
                        status: 409,
                        ticketId: ticket.id,
                      };
                    },
                  );
                  staleDone = true;
                }
              }
              for (const timer of timers) {
                await delay(Math.max(0, timer.dueAt - Date.now()));
                for (const station of ["BAR", "KITCHEN"])
                  await op.advance(
                    timer.intent,
                    timer.id,
                    station,
                    "READY",
                    (station === "KITCHEN" ? "kitchen" : "bar") +
                      (timer.lane ? "2" : ""),
                  );
                const fault = !faultDone && timer.intent.channel !== "QR";
                await op.settle(timer.intent, timer.id, fault);
                if (timer.intent.provenance === "WEBSITE_BROWSER")
                  await op.actions.perform(
                    op.name(timer.intent, "browser-final"),
                    "guest",
                    { orderId: timer.id },
                    { kind: "BROWSER_FINAL" },
                    true,
                    () =>
                      verifyBrowserCompletion(
                        context,
                        timer.intent,
                        op.actions.key(op.name(timer.intent, "create")),
                        timer.id,
                      ),
                  );
                if (fault) faultDone = true;
              }
            }
            await op.closeTables();
            console.log(
              JSON.stringify({
                profile,
                mode: "COMPRESSED_VOLUME",
                completed: cursor,
                target: intents.length,
              }),
            );
          }
          const candidate = intents.find(
            (i) => i.provenance === "WEBSITE_BROWSER",
          )!;
          await op.actions.perform(
            "browser-availability-conflict",
            "guest",
            { productId: candidate.items[0]!.productId },
            { kind: "NEGATIVE" },
            true,
            (key) => browserCustomer(context, candidate, key, true),
          );
          await op.end(intents);
        }
        if (run.status === "COMPLETED") {
          for (const intent of intents.filter(
            (i) => i.provenance === "WEBSITE_BROWSER",
          )) {
            const source = await prisma.$queryRaw<
              Array<{ result: { referenceCode: string } }>
            >`SELECT result FROM operations_lab.action WHERE event_id=${op.actions.key(op.name(intent, "create"))} AND tenant_id=${run.tenantId} AND venue_id=${run.venueId}`;
            const order = await op.projection(source[0]!.result.referenceCode);
            await verifyBrowserCompletion(
              context,
              intent,
              op.actions.key(op.name(intent, "create")),
              order.id,
            );
          }
        }
        const platform = await op.manager.request<DailyOperationsReport>(
          "GET",
          "/v1/staff/reports/daily?date=" + context.date,
        );
        const report = await reconcile(run, platform);
        const runTimes = await prisma.$queryRaw<
          Array<{ created_at: Date; updated_at: Date }>
        >`SELECT created_at,updated_at FROM operations_lab.run WHERE id=${run.id} AND tenant_id=${run.tenantId} AND venue_id=${run.venueId}`;
        if (report.discrepancies.length)
          throw new Error(
            "LAB_NORMAL_RECONCILIATION_FAILED: " +
              report.discrepancies.join("; "),
          );
        if (run.status !== "COMPLETED") {
          assertLabCompletion(run.status, report.unresolvedActions, 0);
          await assertLabScope(run.tenantId, run.venueId);
          await prisma.$executeRaw`UPDATE operations_lab.run SET status='COMPLETED',checkpoint=${JSON.stringify({ mode: "COMPRESSED_VOLUME", report: report.filename, config, startedAt: runTimes[0]!.created_at.toISOString(), endedAt: new Date().toISOString(), queueSamples })}::jsonb,updated_at=now() WHERE id=${run.id} AND tenant_id=${run.tenantId} AND venue_id=${run.venueId}`;
        }
        summaries.push({
          profile,
          runId: run.id,
          mode: "COMPRESSED_VOLUME",
          elapsedSeconds:
            ((run.status === "COMPLETED"
              ? runTimes[0]!.updated_at.getTime()
              : Date.now()) -
              runTimes[0]!.created_at.getTime()) /
            1000,
          invocationSeconds: (Date.now() - startedAt.getTime()) / 1000,
          counts: report.counts,
          channels: report.channels,
          provenance: report.provenance,
          waiting: report.waiting,
          queueSamples:
            run.status === "COMPLETED"
              ? ((run.checkpoint.queueSamples as typeof queueSamples) ?? [])
              : queueSamples,
          totals: report.totals,
          cash: report.cash,
          discrepancies: report.discrepancies,
        });
      }
    },
    { timeout: 1800000 },
  );
  await mkdir("artifacts/operations-lab/normal-day", { recursive: true });
  await writeFile(
    "artifacts/operations-lab/normal-day/acceptance.json",
    JSON.stringify(
      {
        version: 1,
        status: "passed",
        mode: "COMPRESSED_VOLUME",
        truth: "No fake clock or claim of eight elapsed operating hours",
        venues: summaries,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      status: "passed",
      venues: summaries.map((s) => ({
        profile: s.profile,
        counts: s.counts,
        channels: s.channels,
        provenance: s.provenance,
        discrepancies: s.discrepancies,
      })),
    }),
  );
} catch (error) {
  console.error(
    error instanceof LabHttpError ? error.message : (error as Error).message,
  );
  process.exitCode = 1;
} finally {
  await closeCustomerBrowser();
  await prisma.$disconnect();
}
