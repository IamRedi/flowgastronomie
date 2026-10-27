import { prisma } from "@flowgastronomie/database";
import { labTestRenewal } from "@flowgastronomie/domain";
import {
  assertLabInstance,
  assertLabScope,
  labVenues,
  hash,
  ownerEmail,
} from "./guard.js";
import type { Profile } from "./runtime-store.js";
import { readFile } from "node:fs/promises";
export async function continuitySchema(sourceRoot: string) {
  await assertLabInstance();
  await prisma.$executeRawUnsafe(
    "DO $$ BEGIN\n" +
      (await readFile(
        sourceRoot + "/tools/operations-lab/continuity.sql",
        "utf8",
      )) +
      "\nEND $$;",
  );
}
export async function renewLabTests(optInReason?: string, only?: Profile) {
  await assertLabInstance();
  if (only && !["DE", "AL"].includes(only))
    throw new Error("LAB_SCOPE_FORBIDDEN");
  if (
    optInReason !== undefined &&
    (optInReason.length < 8 || optInReason.length > 300)
  )
    throw new Error("LAB_OPT_IN_REASON_REQUIRED");
  const results = [];
  for (const v of await labVenues()) {
    if (only && v.profile !== only) continue;
    await assertLabScope(v.tenant_id, v.venue_id);
    results.push(
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"lab-test-entitlement:" + v.tenant_id},0))`;
        const tenant = await tx.tenant.findFirstOrThrow({
          where: {
            id: v.tenant_id,
            kind: "REAL",
            name: `Operations Lab ${v.profile} TEST ONLY`,
          },
        });
        const owner = await tx.membership.findFirstOrThrow({
          where: {
            tenantId: tenant.id,
            venueId: v.venue_id,
            role: "OWNER",
            active: true,
            user: { email: ownerEmail(v.profile), active: true },
          },
          include: { user: true },
        });
        if (v.owner_email !== owner.user.email)
          throw new Error("LAB_SYNTHETIC_SCOPE_MISMATCH");
        const sub = await tx.subscription.findUniqueOrThrow({
          where: { tenantId: tenant.id },
        });
        if (
          sub.status !== "TRIALING" ||
          sub.plan !== "RESTAURANT_PRO" ||
          sub.billingProvider ||
          sub.billingCustomerReference ||
          sub.billingSubscriptionReference ||
          sub.currentPeriodStartedAt ||
          sub.currentPeriodEndsAt
        )
          throw new Error("LAB_NONCOMMERCIAL_TRIAL_REQUIRED");
        const approved = await tx.$queryRaw<
          Array<{ reason: string }>
        >`SELECT reason FROM operations_lab.entitlement_opt_in WHERE profile=${v.profile} AND tenant_id=${v.tenant_id} AND venue_id=${v.venue_id}`;
        const initial = !approved.length && optInReason !== undefined;
        if (initial)
          await tx.$executeRaw`INSERT INTO operations_lab.entitlement_opt_in(profile,tenant_id,venue_id,approved_by,reason) VALUES (${v.profile},${v.tenant_id},${v.venue_id},${owner.userId},${optInReason!})`;
        const clock = await tx.$queryRaw<
          Array<{ now: Date }>
        >`SELECT clock_timestamp() AS now`;
        const next = labTestRenewal(
          approved.length > 0 || initial,
          sub.status,
          sub.trialEndsAt,
          clock[0]!.now,
          initial,
        );
        if (!next)
          return {
            profile: v.profile,
            renewed: false,
            optedIn: approved.length > 0,
            validUntil: sub.trialEndsAt,
          };
        const reason = initial
          ? optInReason!
          : "Automatic bounded LAB-only renewal; approval: " +
            approved[0]!.reason;
        const changed = await tx.subscription.updateMany({
          where: {
            id: sub.id,
            tenantId: v.tenant_id,
            status: "TRIALING",
            trialEndsAt: sub.trialEndsAt,
          },
          data: { trialEndsAt: next },
        });
        if (changed.count !== 1) throw new Error("LAB_ENTITLEMENT_CONFLICT");
        const id = hash(
          sub.id +
            ":" +
            sub.trialEndsAt!.toISOString() +
            ":" +
            next.toISOString(),
        );
        await tx.$executeRaw`INSERT INTO operations_lab.entitlement_event(id,profile,tenant_id,venue_id,subscription_id,previous_until,valid_until,reason) VALUES (${id},${v.profile},${v.tenant_id},${v.venue_id},${sub.id},${sub.trialEndsAt!},${next},${reason})`;
        await tx.auditEvent.create({
          data: {
            tenantId: v.tenant_id,
            venueId: v.venue_id,
            actorUserId: owner.userId,
            actorMembershipId: owner.id,
            action: "LAB_TEST_ENTITLEMENT_RENEWED",
            entityType: "Subscription",
            entityId: sub.id,
            metadata: {
              evidenceId: id,
              previousUntil: sub.trialEndsAt!.toISOString(),
              validUntil: next.toISOString(),
              reason,
              testOnly: true,
              commercialActivation: false,
            },
          },
        });
        return {
          profile: v.profile,
          renewed: true,
          optedIn: true,
          validUntil: next,
        };
      }),
    );
  }
  return results;
}
