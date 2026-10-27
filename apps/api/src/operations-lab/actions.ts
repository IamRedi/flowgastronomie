import { randomUUID } from "node:crypto";
import { prisma } from "@flowgastronomie/database";
import {
  labReplayPolicy,
  labRunSchema,
  labActionSchema,
  type LabRun,
} from "@flowgastronomie/domain";
import { assertLabScope, hash } from "./guard.js";
import { labActionContext } from "./action-context.js";
type ActionRow = {
  status: string;
  result: unknown;
  request_hash: string;
  lease_until: Date | null;
  attempts: number;
};
export async function openRun(
  tenantId: string,
  venueId: string,
  date: string,
  scenarioVersion = "lab1-day-v1",
  seed = 29,
): Promise<LabRun> {
  await assertLabScope(tenantId, venueId);
  const id = hash(
    tenantId + ":" + venueId + ":" + date + ":" + scenarioVersion,
  );
  await prisma.$executeRaw`INSERT INTO operations_lab.run (id,tenant_id,venue_id,version,scenario_version,seed,business_date,status)
    VALUES (${id},${tenantId},${venueId},1,${scenarioVersion},${seed},${date}::date,'RUNNING') ON CONFLICT (id) DO NOTHING`;
  const rows = await prisma.$queryRaw<
    Array<{ status: LabRun["status"]; checkpoint: LabRun["checkpoint"] }>
  >`SELECT status,checkpoint FROM operations_lab.run WHERE id=${id} AND tenant_id=${tenantId} AND venue_id=${venueId}`;
  return labRunSchema.parse({
    version: 1,
    id,
    tenantId,
    venueId,
    scenarioVersion,
    seed,
    businessDate: date,
    ...rows[0],
  });
}
export class Actions {
  constructor(
    readonly run: LabRun,
    private actors: Record<
      string,
      { membershipId: string; sessionId: string }
    > = {},
  ) {}
  key(name: string) {
    return hash(this.run.id + ":" + name);
  }
  async perform<T>(
    name: string,
    actor: string,
    request: unknown,
    expected: Record<string, unknown>,
    idempotent: boolean,
    execute: (key: string) => Promise<T>,
  ): Promise<T> {
    const r = this.run;
    await assertLabScope(r.tenantId, r.venueId);
    const current = await prisma.$queryRaw<
      Array<{ status: string }>
    >`SELECT status FROM operations_lab.run WHERE id=${r.id} AND tenant_id=${r.tenantId} AND venue_id=${r.venueId}`;
    if (
      !current[0] ||
      !["RUNNING", "STOP_AFTER_SHIFT"].includes(current[0].status)
    )
      throw new Error("LAB_RUN_NOT_ACTIVE");
    const eventId = this.key(name),
      requestHash = hash(JSON.stringify(request));
    const identity = this.actors[actor];
    const actorId = identity?.membershipId ?? actor;
    const actorSessionId = identity?.sessionId ?? null;
    const leaseOwner = randomUUID();
    labActionSchema.parse({
      version: 1,
      eventId,
      runId: r.id,
      tenantId: r.tenantId,
      venueId: r.venueId,
      actor: actorId,
      kind: name,
      dueAt: new Date().toISOString(),
      status: "PENDING",
      attempts: 0,
      leaseOwner: null,
      leaseUntil: null,
      idempotencyKey: eventId,
      requestHash,
      expected,
      resultSourceIds: [],
    });
    const claimStartedAt = performance.now();
    const saved = await prisma
      .$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"lab-actor:" + r.tenantId + ":" + r.venueId + ":" + actorId},0))`;
          if (identity) {
            const busy = await tx.$queryRaw<
              Array<{ event_id: string }>
            >`SELECT event_id FROM operations_lab.action WHERE tenant_id=${r.tenantId} AND venue_id=${r.venueId} AND actor=${actorId} AND status='LEASED' AND lease_until>now() AND event_id<>${eventId} LIMIT 1`;
            if (busy.length) throw new Error("LAB_ACTOR_BUSY");
          }
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${eventId},0))`;
          await tx.$executeRaw`INSERT INTO operations_lab.action (event_id,run_id,tenant_id,venue_id,version,actor,kind,due_at,status,idempotency_key,request_hash,expected)
        VALUES (${eventId},${r.id},${r.tenantId},${r.venueId},1,${actor},${name},now(),'PENDING',${eventId},${requestHash},${JSON.stringify(expected)}::jsonb)
        ON CONFLICT (event_id) DO NOTHING`;
          const rows = await tx.$queryRaw<
            ActionRow[]
          >`SELECT status,result,request_hash,lease_until,attempts FROM operations_lab.action WHERE event_id=${eventId} AND tenant_id=${r.tenantId} AND venue_id=${r.venueId}`;
          const row = rows[0]!;
          labActionSchema.shape.status.parse(row.status);
          labActionSchema.shape.attempts.parse(row.attempts);
          if (row.request_hash !== requestHash)
            throw new Error("LAB_ACTION_INPUT_CHANGED");
          if (
            row.status === "LEASED" &&
            row.lease_until &&
            row.lease_until > new Date()
          )
            throw new Error("LAB_ACTION_BUSY");
          const policy = labReplayPolicy(row.status, idempotent);
          if (policy === "RETURN")
            return { returned: true, result: row.result };
          if (policy === "REVIEW" || row.attempts >= 3) {
            await tx.$executeRaw`UPDATE operations_lab.action SET status='NEEDS_REVIEW',error_code='AMBIGUOUS_OR_EXHAUSTED',lease_owner=null,lease_until=null WHERE event_id=${eventId}`;
            return { review: true };
          }
          await tx.$executeRaw`UPDATE operations_lab.action SET status='LEASED',actor=${actorId},actor_session_id=${actorSessionId}, attempts=attempts+1, lease_owner=${leaseOwner},lease_until=now()+interval '2 minutes',updated_at=now() WHERE event_id=${eventId}`;
          return { returned: false };
        },
        { maxWait: 5000, timeout: 15000 },
      )
      .catch((error: unknown) => {
        // Lab ledger only: execution must never start before a committed claim.
        const code = (error as { code?: unknown })?.code;
        console.error(
          JSON.stringify({
            phase: "LAB_ACTION_CLAIM",
            eventHash: eventId,
            elapsedMs: Math.round(performance.now() - claimStartedAt),
            code:
              typeof code === "string" && /^P[0-9]{4}$/.test(code)
                ? code
                : "CLAIM_FAILED",
          }),
        );
        throw error;
      });
    if (saved.review) {
      await prisma.$executeRaw`UPDATE operations_lab.run SET status='NEEDS_REVIEW',updated_at=now() WHERE id=${r.id} AND tenant_id=${r.tenantId} AND venue_id=${r.venueId}`;
      throw new Error("LAB_ACTION_NEEDS_REVIEW");
    }
    if (saved.returned) return saved.result as T;
    try {
      const result = await labActionContext.run({ eventId }, () =>
        execute(eventId),
      );
      const sourceIds =
        typeof result === "object" && result !== null
          ? Object.entries(result)
              .filter(
                ([key, value]) =>
                  [
                    "id",
                    "orderId",
                    "onlineOrderId",
                    "paymentId",
                    "receiptId",
                    "eventId",
                    "referenceCode",
                  ].includes(key) && typeof value === "string",
              )
              .map(([, value]) => value)
          : [];
      await assertLabScope(r.tenantId, r.venueId);
      const count =
        await prisma.$executeRaw`UPDATE operations_lab.action SET status='SUCCEEDED',result=${JSON.stringify(result ?? null)}::jsonb,result_source_ids=${JSON.stringify(sourceIds)}::jsonb,lease_owner=null,lease_until=null,updated_at=now()
        WHERE event_id=${eventId} AND tenant_id=${r.tenantId} AND venue_id=${r.venueId} AND lease_owner=${leaseOwner}`;
      if (count !== 1) throw new Error("LAB_ACTION_LEASE_LOST");
      return result;
    } catch (error) {
      await assertLabScope(r.tenantId, r.venueId);
      await prisma.$executeRaw`UPDATE operations_lab.action SET status=${idempotent ? "PENDING" : "NEEDS_REVIEW"},error_code='ACTION_FAILED',lease_owner=null,lease_until=null,updated_at=now()
        WHERE event_id=${eventId} AND tenant_id=${r.tenantId} AND venue_id=${r.venueId} AND lease_owner=${leaseOwner}`;
      if (!idempotent)
        await prisma.$executeRaw`UPDATE operations_lab.run SET status='NEEDS_REVIEW',updated_at=now() WHERE id=${r.id} AND tenant_id=${r.tenantId} AND venue_id=${r.venueId}`;
      throw error;
    }
  }
}
