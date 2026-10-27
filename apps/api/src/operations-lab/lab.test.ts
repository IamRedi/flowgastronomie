import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import {
  assertLabEnvironment,
  installLabGuard,
  assertLabInstance,
  assertLabScope,
  labVenues,
  hash,
} from "./guard.js";
import {
  verifyArchive,
  type ArchiveEntry,
  archiveReceipt,
} from "./pdf-archive.js";
import { prisma, counterSaleRepository } from "@flowgastronomie/database";
import { printerPayload } from "@flowgastronomie/domain";
import { buildApp } from "../app.js";
import { isLabOrderSource } from "./reconciliation.js";
import { labStoragePolicy } from "./storage.js";
import { LabClient } from "./client.js";
import { openRun, Actions } from "./actions.js";
import { installOperator, operatorSecret } from "./operator.js";
import { readFile, writeFile } from "node:fs/promises";
import type { LocalState } from "./provision.js";
import {
  businessDateForInstant,
  assertLabCompletion,
} from "@flowgastronomie/domain";
const url =
  "postgresql://operations_lab:operations_lab_local_only@127.0.0.1:55439/restaurantflow_operations_lab?schema=public";
describe("lab guards without any remote connection", () => {
  it("distinguishes manual activity from browser writes whose acknowledgement was lost", () => {
    const action = {
      expected: { kind: "ORDER" },
      result: null,
      idempotency_key: "lab-event",
      browser_key: "native-key",
    };
    expect(
      isLabOrderSource(
        { id: "canonical", referenceCode: null, idempotencyKey: "native-key" },
        action,
      ),
    ).toBe(true);
    expect(
      isLabOrderSource(
        { id: "manual", referenceCode: null, idempotencyKey: null },
        action,
      ),
    ).toBe(false);
    expect(
      isLabOrderSource(
        { id: "manual", referenceCode: null, idempotencyKey: "unrelated" },
        action,
      ),
    ).toBe(false);
  });
  it("rejects unsafe archive policy before writing any PDF", () => {
    expect(() => labStoragePolicy({ LAB_PDF_MAX_FILES: "0" })).toThrow();
    expect(() => labStoragePolicy({ LAB_PDF_RESERVE_BYTES: "0" })).toThrow();
    expect(labStoragePolicy({})).toMatchObject({
      maxFiles: 50000,
      warningRatio: 0.8,
    });
  });
  const env = {
    NODE_ENV: "development",
    OPERATIONS_LAB_ENABLED: "true",
    DATABASE_URL: url,
  };
  it("allows the explicitly enabled isolated local database", () =>
    expect(() => assertLabEnvironment(env)).not.toThrow());
  for (const DATABASE_URL of [
    url.replace("127.0.0.1", "neon.example.com"),
    url.replace("restaurantflow_operations_lab", "restaurantflow"),
    url.replace("55439", "5432"),
    url.replace("schema=public", "schema=production"),
    url + "&host=remote.example.com",
    url + "&schema=production",
    url.replace("operations_lab:", "restaurantflow:"),
  ])
    it("fails closed for a forbidden endpoint/identity", () =>
      expect(() => assertLabEnvironment({ ...env, DATABASE_URL })).toThrow());
  it("rejects production, missing flag and outgoing provider credentials", () => {
    expect(() =>
      assertLabEnvironment({ ...env, NODE_ENV: "production" }),
    ).toThrow();
    expect(() =>
      assertLabEnvironment({ ...env, OPERATIONS_LAB_ENABLED: "false" }),
    ).toThrow();
    expect(() =>
      assertLabEnvironment({ ...env, BREVO_API_KEY: "forbidden" }),
    ).toThrow();
  });
  it("does not expose lab endpoints on the canonical application", async () => {
    const app = buildApp({}, { logger: false });
    try {
      expect(
        (await app.inject({ method: "GET", url: "/lab/identity" })).statusCode,
      ).toBe(404);
    } finally {
      await app.close();
    }
  });
});
const enabled = process.env.OPERATIONS_LAB_ENABLED === "true";
describe.skipIf(!enabled)(
  "real persistent PostgreSQL archive acceptance",
  () => {
    it("accepts canonical email-only Lab login while retaining scope and password checks", async () => {
      const state = JSON.parse(
        await readFile(".operations-lab/DE.json", "utf8"),
      ) as LocalState;
      const actor = state.actors.manager!;
      const app = buildApp({}, { logger: false });
      installLabGuard(app);
      try {
        const login = (email: string, password: string, tenantSlug?: string) =>
          app.inject({
            method: "POST",
            url: "/v1/auth/login",
            payload: { email, password, ...(tenantSlug ? { tenantSlug } : {}) },
          });
        expect((await login(actor.email, actor.password)).statusCode).toBe(200);
        expect(
          (await login(actor.email, "incorrect-password")).statusCode,
        ).toBe(401);
        expect(
          (await login("outside@example.invalid", actor.password)).statusCode,
        ).toBe(403);
        expect(
          (await login(actor.email, actor.password, "outside-lab-tenant"))
            .statusCode,
        ).toBe(403);
      } finally {
        await app.close();
      }
    });
    it("allows the native quote only within a verified Lab venue", async () => {
      const state = JSON.parse(
        await readFile(".operations-lab/DE.json", "utf8"),
      ) as LocalState;
      const scope = state.actors.owner!.staff!;
      await assertLabScope(scope.tenantId, scope.venueId);
      const website = await prisma.venueWebsite.findUniqueOrThrow({
        where: { venueId: scope.venueId },
      });
      const app = buildApp({}, { logger: false });
      installLabGuard(app);
      const payload = {
        locale: "en",
        idempotencyKey: randomUUID(),
        fulfillmentType: "PICKUP",
        timingMode: "ASAP",
        contact: {
          name: "TEST ONLY quote scope",
          phone: "0000000000",
          email: "quote@operations-lab.invalid",
        },
        items: [{ productId: state.catalog![0]!.productId, quantity: 1 }],
      };
      try {
        const own = await app.inject({
          method: "POST",
          url: `/v1/public/online-orders/${website.publicSlug}/quote`,
          payload,
        });
        expect([200, 400]).toContain(own.statusCode);
        expect(String(own.json().code ?? "")).not.toMatch(/^LAB_/);
        const outside = await app.inject({
          method: "POST",
          url: "/v1/public/online-orders/not-a-lab-venue/quote",
          payload,
        });
        expect(outside.statusCode).toBe(403);
      } finally {
        await app.close();
      }
    });
    it("requires operator auth and enforces cookie origin even with an invalid bearer header", async () => {
      const app = buildApp({}, { logger: false });
      await installOperator(app);
      try {
        expect(
          (await app.inject({ method: "GET", url: "/lab/operator/status" }))
            .statusCode,
        ).toBe(401);
        const login = await app.inject({
          method: "POST",
          url: "/lab/operator/auth",
          headers: { origin: "http://127.0.0.1:3400" },
          payload: { password: await operatorSecret() },
        });
        expect(login.statusCode).toBe(200);
        const header = login.headers["set-cookie"];
        const cookie = (Array.isArray(header) ? header[0]! : header!).split(
          ";",
        )[0]!;
        expect(header).toContain("HttpOnly");
        const rejected = await app.inject({
          method: "POST",
          url: "/lab/operator/control",
          headers: {
            cookie,
            origin: "https://foreign.invalid",
            authorization: "Bearer invalid",
          },
          payload: {},
        });
        expect(rejected.statusCode).toBe(403);
        expect(rejected.json()).toEqual({
          code: "LAB_OPERATOR_ORIGIN_FORBIDDEN",
        });
      } finally {
        await app.close();
      }
    });
    it("recovers a lost real P2 HTTP response and excludes a competing staff session", async () => {
      const state = JSON.parse(
        await readFile(".operations-lab/DE.json", "utf8"),
      ) as LocalState;
      const actor = state.actors.waiter!,
        scope = actor.staff!;
      const client = new LabClient("DE"),
        competing = new LabClient("DE");
      const credentials = {
        tenantSlug: scope.tenantSlug,
        venueSlug: scope.venueSlug,
        email: actor.email,
        password: actor.password,
      };
      const login = await client.request<{ staff: typeof scope }>(
        "POST",
        "/v1/auth/login",
        credentials,
      );
      await competing.request("POST", "/v1/auth/login", credentials);
      const probeVersion =
        "lab1-recovery-probe-v1-" +
        hash(
          Buffer.concat(
            await Promise.all(
              ["guard.ts", "actions.ts", "lab.test.ts"].map((file) =>
                readFile(new URL(file, import.meta.url)),
              ),
            ),
          ),
        ).slice(0, 12);
      const run = await openRun(
        scope.tenantId,
        scope.venueId,
        businessDateForInstant(new Date(), "Europe/Berlin"),
        probeVersion,
      );
      if (run.status === "COMPLETED") {
        expect(run.checkpoint.status).toBe("passed");
        await writeFile(
          "artifacts/operations-lab/recovery.json",
          JSON.stringify({ ...run.checkpoint, replayed: true }, null, 2),
        );
        return;
      }
      const actions = new Actions(run, {
        waiter: {
          membershipId: scope.membershipId,
          sessionId: login.staff.sessionId,
        },
      });
      const payment = await prisma.paymentRecord.findFirstOrThrow({
        where: {
          tenantId: scope.tenantId,
          venueId: scope.venueId,
          method: "CASH",
          orderId: { not: null },
        },
      });
      const body = { method: "CASH", receivedMinor: payment.receivedMinor };
      const path = `/v1/staff/pos/orders/${payment.orderId}/payment`;
      const input = { path, body, key: payment.idempotencyKey };
      const receiptCount = await prisma.receipt.count(),
        paymentCount = await prisma.paymentRecord.count();
      const execute = async () => {
        await expect(
          competing.request("POST", "/v1/staff/register/open", {
            openingCashMinor: 0,
          }),
        ).rejects.toMatchObject({ status: 409, code: "LAB_ACTOR_BUSY" });
        return client.request<{ id: string; paymentId: string }>(
          "POST",
          path,
          body,
          { "idempotency-key": payment.idempotencyKey },
        );
      };
      await expect(
        actions.perform(
          "lost-response",
          "waiter",
          input,
          {},
          true,
          async () => {
            await execute();
            throw new Error("SIMULATED_LOST_ACK");
          },
        ),
      ).rejects.toThrow("SIMULATED_LOST_ACK");
      const result = await actions.perform(
        "lost-response",
        "waiter",
        input,
        {},
        true,
        execute,
      );
      expect(result.paymentId).toBe(payment.id);
      expect(await prisma.receipt.count()).toBe(receiptCount);
      expect(await prisma.paymentRecord.count()).toBe(paymentCount);
      const evidence = await prisma.$queryRaw<
        Array<{ status: string; attempts: number; result_source_ids: string[] }>
      >`SELECT status,attempts,result_source_ids FROM operations_lab.action WHERE run_id=${run.id}`;
      expect(evidence).toMatchObject([{ status: "SUCCEEDED", attempts: 2 }]);
      expect(evidence[0]!.result_source_ids).toContain(payment.id);
      const recovery = {
        version: 1,
        runId: run.id,
        status: "passed",
        attempts: evidence[0]!.attempts,
        realPaymentId: payment.id,
        realReceiptId: result.id,
        receiptCountBefore: receiptCount,
        receiptCountAfter: await prisma.receipt.count(),
        paymentCountBefore: paymentCount,
        paymentCountAfter: await prisma.paymentRecord.count(),
        competingSession: { status: 409, code: "LAB_ACTOR_BUSY" },
        clock: "real wall time",
      };
      await writeFile(
        "artifacts/operations-lab/recovery.json",
        JSON.stringify(recovery, null, 2),
      );
      assertLabCompletion(run.status, 0, 0);
      await prisma.$executeRaw`UPDATE operations_lab.run SET status='COMPLETED',checkpoint=${JSON.stringify(recovery)}::jsonb,updated_at=now() WHERE id=${run.id} AND tenant_id=${run.tenantId} AND venue_id=${run.venueId}`;
    });
    it("verifies actual DB instance and excludes unclaimed scopes", async () => {
      await assertLabInstance();
      expect(await labVenues()).toHaveLength(2);
      await expect(
        assertLabScope("ordinary-development-tenant", "foreign"),
      ).rejects.toThrow();
    });
    it("uses the scoped Albanian venue currency in canonical menu records", async () => {
      const al = (await labVenues()).find((v) => v.profile === "AL")!;
      const products = await prisma.product.findMany({
        where: { tenantId: al.tenant_id, venueId: al.venue_id },
      });
      expect(products.length).toBeGreaterThanOrEqual(2);
      expect(products.every((p) => p.currency === "ALL")).toBe(true);
    });
    it("verifies every PDF hash, preserves money and reprint identity", async () => {
      const entries = await prisma.$queryRaw<
        ArchiveEntry[]
      >`SELECT * FROM operations_lab.archive ORDER BY created_at DESC LIMIT 6`;
      const receiptCount = await prisma.receipt.count(),
        paymentCount = await prisma.paymentRecord.count();
      expect(entries).toHaveLength(6);
      for (const entry of entries) {
        const associations = await prisma.$queryRaw<
          Array<{ job_id: string; content_hash: string }>
        >`SELECT job_id,content_hash FROM operations_lab.archive_print WHERE receipt_id=${entry.receipt_id} AND tenant_id=${entry.tenant_id} AND venue_id=${entry.venue_id}`;
        expect(associations.length).toBeGreaterThan(0);
        expect(
          associations.every((a) => a.content_hash === entry.content_hash),
        ).toBe(true);
        const receipt = await counterSaleRepository.receipt(
          {
            tenantId: entry.tenant_id,
            venueId: entry.venue_id,
            userId: "qa",
            membershipId: "qa",
            role: "OWNER",
          },
          entry.receipt_id,
        );
        expect((await verifyArchive(entry)).subarray(0, 5).toString()).toBe(
          "%PDF-",
        );
        expect(
          await archiveReceipt(
            entry.tenant_id,
            entry.venue_id,
            printerPayload(receipt),
          ),
        ).toMatchObject(entry);
        await expect(
          archiveReceipt(entry.tenant_id, entry.venue_id, {
            ...printerPayload(receipt),
            grossMinor: receipt.grossMinor + 1,
          }),
        ).rejects.toThrow();
      }
      expect(await prisma.receipt.count()).toBe(receiptCount);
      expect(await prisma.paymentRecord.count()).toBe(paymentCount);
    });
  },
);
