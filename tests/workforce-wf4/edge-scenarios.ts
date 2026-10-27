import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { prisma, workforceNotificationOutbox } from "@flowgastronomie/database";
import {
  workforceDefaultRules,
  workforceNotificationCategories,
} from "@flowgastronomie/domain";
import { createWorkforceNotificationWorker } from "../../apps/api/src/workforce-notification-worker.js";
import { instant, intervalTotals } from "./oracle.js";
import type { Actor, Business, Clock } from "./engine.js";
type Context = {
  app: FastifyInstance;
  clock: Clock;
  businesses: Business[];
  checks: string[];
  api: (
    actor: Actor,
    path: string,
    payload?: unknown,
    method?: string,
  ) => Promise<any>;
  response: (
    actor: Actor,
    path: string,
    payload?: unknown,
    method?: string,
    expected?: number,
  ) => Promise<any>;
};
export async function runEdgeScenarios({
  app,
  clock,
  businesses,
  api,
  response,
  checks,
}: Context) {
  const evidence: any[] = [];
  const key = () => randomUUID();
  async function punch(
    actor: Actor,
    kind: string,
    version: number,
    extra = {},
  ) {
    return api(actor, "attendance/punch", {
      kind,
      expectedVersion: version,
      idempotencyKey: key(),
      ...extra,
    });
  }
  const approval = {
    reason: "Independent synthetic edge-case review",
    reviewConfirmed: true,
    warningsAcknowledged: true,
  };
  // Five elapsed hours through the fall fold, with an explicit paid break.
  for (const b of businesses) {
    const worker = b.workers[6]!.actor;
    clock.now = instant("2031-10-26T00:00");
    const r = await punch(worker, "CLOCK_IN", 0);
    clock.now = instant("2031-10-26T01:00");
    await punch(worker, "BREAK_START", 1, { breakKind: "PAID" });
    clock.now = instant("2031-10-26T01:30");
    await punch(worker, "BREAK_END", 2);
    clock.now = instant("2031-10-26T04:00");
    await punch(worker, "CLOCK_OUT", 3);
    await api(b.managers[0]!, "attendance/" + r.attendanceId + "/approval", {
      ...approval,
      expectedVersion: 4,
    });
    const data = await api(
      worker,
      "approved-hours?from=2031-10-26&to=2031-10-26",
    );
    assert.equal(data.records.length, 1);
    const row = data.records[0];
    assert.equal(row.snapshot.startsAt, "2031-10-25T22:00:00.000Z");
    assert.equal(row.snapshot.endsAt, "2031-10-26T03:00:00.000Z");
    assert.equal(row.totals.presenceMs, 300 * 60000);
    assert.equal(row.totals.paidBreakMs, 30 * 60000);
    assert.equal(row.totals.workedMs, 300 * 60000);
    evidence.push({
      country: b.config.country,
      case: "fall fold",
      expectedPresenceMs: 300 * 60000,
      expectedNetMs: 300 * 60000,
      source: row.attendanceId,
    });
  }
  // Only fixture setup without a public venue/membership-grant operation: same
  // canonical User, new authorized venue/membership; profiles/contracts/auth use APIs.
  for (const b of businesses) {
    clock.now = instant("2031-10-27T08:00");
    const worker = b.workers[6]!.actor;
    const venue = await prisma.venue.create({
      data: {
        tenantId: b.owner.tenantId,
        name: "WF4 Synthetic Annex",
        slug: "wf4-annex-" + key(),
        countryCode: b.config.country,
        currency: b.config.currency,
        timezone: b.config.timezone,
        workforceStations: ["KITCHEN"],
      },
    });
    await prisma.membership.create({
      data: {
        tenantId: b.owner.tenantId,
        venueId: venue.id,
        userId: b.owner.userId,
        role: "OWNER",
      },
    });
    await prisma.membership.create({
      data: {
        tenantId: b.owner.tenantId,
        venueId: venue.id,
        userId: worker.userId,
        role: "WAITER",
      },
    });
    const login = async (actor: Actor) => {
      const r = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: {
          tenantSlug: actor.tenantSlug,
          venueSlug: venue.slug,
          email: actor.email,
          password: actor.password,
        },
      });
      assert.equal(r.statusCode, 200, r.body);
      return {
        ...r.json().staff,
        password: actor.password,
        cookie: r.cookies.map((c) => c.name + "=" + c.value).join("; "),
      } as Actor;
    };
    const owner = await login(b.owner),
      annex = await login(worker);
    await api(
      owner,
      "profiles/" + owner.membershipId,
      { expectedVersion: 0, stations: ["KITCHEN"], skills: ["WF4 hygiene"] },
      "PUT",
    );
    await api(owner, "policy", {
      expectedVersion: 0,
      effectiveFrom: "2031-02-01",
      countryCode: b.config.country,
      rules: {
        ...workforceDefaultRules(b.config.country),
        paidBreaksAllowed: true,
      },
      reason: "Explicit synthetic annex operational policy",
    });
    await api(
      owner,
      "profiles/" + annex.membershipId,
      {
        expectedVersion: 0,
        employmentStartedOn: "2031-02-01",
        stations: ["KITCHEN"],
        skills: ["WF4 hygiene"],
      },
      "PUT",
    );
    await api(owner, "profiles/" + annex.membershipId + "/contracts", {
      expectedVersion: 1,
      effectiveFrom: "2031-02-01",
      employmentType: "PART_TIME",
      weeklyTargetMinutes: 600,
      monthlyTargetMinutes: null,
      countryCode: b.config.country,
      terms: "Synthetic annex contract",
    });
    clock.now = instant("2031-10-27T09:00");
    const first = await punch(worker, "CLOCK_IN", 0);
    await response(
      annex,
      "attendance/punch",
      { kind: "CLOCK_IN", expectedVersion: 0, idempotencyKey: key() },
      "POST",
      409,
    );
    await response(
      worker,
      "monthly-account?month=2031-10&membershipId=" + annex.membershipId,
      undefined,
      "GET",
      403,
    );
    await response(
      businesses.find((x) => x !== b)!.owner,
      "monthly-account?month=2031-10&membershipId=" + annex.membershipId,
      undefined,
      "GET",
      404,
    );
    clock.now = instant("2031-10-27T11:00");
    await punch(worker, "CLOCK_OUT", 1);
    await api(
      b.managers[0]!,
      "attendance/" + first.attendanceId + "/approval",
      { ...approval, expectedVersion: 2 },
    );
    clock.now = instant("2031-10-27T12:00");
    const second = await punch(annex, "CLOCK_IN", 0);
    clock.now = instant("2031-10-27T14:00");
    await punch(annex, "CLOCK_OUT", 1);
    await api(owner, "attendance/" + second.attendanceId + "/approval", {
      ...approval,
      expectedVersion: 2,
    });
    const own = await api(worker, "monthly-account?month=2031-10"),
      other = await api(annex, "monthly-account?month=2031-10");
    assert.equal(own.account.totals.actualMs, 420 * 60000);
    assert.equal(other.account.totals.actualMs, 120 * 60000);
    assert.equal(other.employee.userId, worker.userId);
    assert.notEqual(own.venueId, other.venueId);
    evidence.push({
      country: b.config.country,
      case: "same user, two authorized venues",
      userId: worker.userId,
      primaryVenueId: b.owner.venueId,
      annexVenueId: venue.id,
      expectedPrimaryMs: 420 * 60000,
      expectedAnnexMs: 120 * 60000,
      fixtureSetup:
        "venue and membership grants only; no public creation operation exists",
    });
  }
  assert.equal(
    await prisma.tenant.count(),
    2,
    "exactly two primary businesses",
  );
  // Real POS creation and cancellation with synthetic menu, no payments/tax/fiscal.
  for (const b of businesses) {
    clock.now = instant("2031-10-28T08:00");
    const worker = b.workers[1]!.actor,
      before = await api(worker, "monthly-account?month=2031-10");
    const translations = ["sq", "de", "en", "it"].map((locale) => ({
      locale,
      name: "WF4 Synthetic Menu",
    }));
    const category = (
      await response(
        b.owner,
        "/v1/staff/menu/categories",
        { published: true, sortOrder: 0, translations },
        "POST",
        201,
      )
    ).json();
    const product = (
      await response(
        b.owner,
        "/v1/staff/menu/products",
        {
          categoryId: category.id,
          priceMinor: b.config.country === "DE" ? 900 : 90000,
          sortOrder: 0,
          available: true,
          published: true,
          station: "KITCHEN",
          translations: translations.map((x) => ({
            ...x,
            name: "WF4 Synthetic Meal",
            description: "Synthetic operational acceptance",
          })),
        },
        "POST",
        201,
      )
    ).json();
    await api(worker, "/v1/staff/shift/start", {});
    const order = await app.inject({
      method: "POST",
      url: "/v1/staff/orders",
      headers: { cookie: worker.cookie, "idempotency-key": key() },
      payload: {
        orderType: "TAKEAWAY",
        locale: "en",
        items: [{ productId: product.id, quantity: 1 }],
      },
    });
    assert.equal(order.statusCode, 201, order.body);
    const saved = order.json();
    const forbidden = await app.inject({
      method: "POST",
      url: "/v1/staff/orders",
      headers: { cookie: b.workers[0]!.actor.cookie, "idempotency-key": key() },
      payload: {
        orderType: "TAKEAWAY",
        locale: "en",
        items: [{ productId: product.id, quantity: 1 }],
      },
    });
    assert.equal(forbidden.statusCode, 403, forbidden.body);
    await api(b.managers[0]!, "/v1/staff/shift/start", {});
    await api(
      b.managers[0]!,
      "/v1/staff/orders/" + saved.id + "/status",
      {
        status: "CANCELLED",
        expectedVersion: (
          await prisma.order.findUniqueOrThrow({ where: { id: saved.id } })
        ).version,
      },
      "PATCH",
    );
    await api(b.managers[0]!, "/v1/staff/shift/end", {});
    await api(worker, "/v1/staff/shift/end", {});
    const after = await api(worker, "monthly-account?month=2031-10");
    assert.deepEqual(after.account.totals, before.account.totals);
    assert.equal(await prisma.paymentRecord.count(), 0);
    assert.equal(await prisma.receipt.count(), 0);
    const stats = await api(b.owner, "monthly-statistics?month=2031-10");
    assert.equal(stats.laborToSales.status, "NOT_CONFIGURED");
    evidence.push({
      country: b.config.country,
      case: "POS operational activity is separate",
      orderId: saved.id,
      payments: 0,
      receipts: 0,
      workforceTotalsUnchanged: true,
      laborToSales: "NOT_CONFIGURED",
    });
  }
  // Controlled retry transport; no Brevo/network or push transport is constructed.
  const attempts = new Map<string, number>(),
    delivered: string[] = [];
  for (const b of businesses) {
    const worker = b.workers[0]!.actor;
    await api(
      worker,
      "notification-preferences",
      {
        expectedVersion: 1,
        locale: "en",
        emailEnabled: true,
        pushEnabled: false,
        reminderMinutes: 60,
        categories: [...workforceNotificationCategories],
        consentConfirmed: true,
      },
      "PUT",
    );
    await api(
      b.managers[0]!,
      "schedule",
      {
        week: "2031-10-27",
        expectedVersion: 0,
        status: "PUBLISHED",
        reviewConfirmed: true,
        assignments: [
          {
            id: key(),
            membershipId: worker.membershipId,
            station: "KITCHEN",
            startsLocal: "2031-10-29T14:00",
            endsLocal: "2031-10-29T16:00",
            startChoice: "reject",
            endChoice: "reject",
            breakMinutes: 0,
            requiredSkills: ["WF4 hygiene"],
            note: "Synthetic notification retry",
          },
        ],
      },
      "PUT",
    );
  }
  const worker = createWorkforceNotificationWorker({
    emailProvider: "test",
    clock: () => new Date(clock.now),
    emailService: {
      async send(n) {
        assert.equal(n.kind, "WORKFORCE_UPDATE");
        assert(n.recipient.endsWith(".invalid"));
        const id = (n as any).notificationId ?? (n as any).idempotencyKey;
        const k = id ?? n.recipient;
        const count = (attempts.get(k) ?? 0) + 1;
        attempts.set(k, count);
        if (count === 1) throw new Error("CONTROLLED_TRANSIENT");
        delivered.push(n.recipient);
      },
    },
  });
  await worker.runOnce(100);
  assert.equal(delivered.length, 0);
  clock.now += 31000;
  await worker.runOnce(100);
  assert.equal(delivered.length, 2);
  const notices = await prisma.workforceNotification.count(),
    deliveries = await prisma.workforceNotificationDelivery.count();
  for (const b of businesses)
    await workforceNotificationOutbox.replayIntents(b.owner);
  await worker.runOnce(100);
  assert.equal(delivered.length, 2);
  assert.equal(await prisma.workforceNotification.count(), notices);
  assert.equal(await prisma.workforceNotificationDelivery.count(), deliveries);
  assert.equal(
    await prisma.workforceNotificationDelivery.count({
      where: { channel: "PUSH", state: "DELIVERED" },
    }),
    0,
  );
  for (const b of businesses) {
    const manager = b.managers[0]!;
    await api(
      manager,
      "notification-preferences",
      {
        expectedVersion: 1,
        locale: "en",
        emailEnabled: true,
        pushEnabled: false,
        reminderMinutes: 60,
        categories: [...workforceNotificationCategories],
        consentConfirmed: true,
      },
      "PUT",
    );
    const future = await api(b.workers[5]!.actor, "leave", {
      idempotencyKey: key(),
      category: "ANNUAL",
      from: "2031-10-30",
      to: "2031-10-30",
      partial: null,
    });

    const before = await api(manager, "notifications?locale=en");
    const managerOnly = await prisma.workforceNotification.findMany({
      where: {
        tenantId: manager.tenantId,
        venueId: manager.venueId,
        userId: manager.userId,
        requiredPermission: "VENUE_MANAGER",
      },
      select: { id: true },
    });
    assert(managerOnly.length > 0);
    await api(
      b.owner,
      "/v1/staff/team/members/" + manager.membershipId,
      { role: "WAITER" },
      "PATCH",
    );
    const after = await api(manager, "notifications?locale=en");
    assert(
      after.items.every(
        (item: any) => !managerOnly.some((n) => n.id === item.id),
      ),
    );
    assert(after.unreadCount < before.unreadCount);
    await worker.runOnce(100);
    assert(
      !delivered.includes(manager.email),
      "revoked manager recipient must never be delivered",
    );
    assert.equal(
      await prisma.workforceNotificationDelivery.count({
        where: { userId: manager.userId, state: "PENDING" },
      }),
      0,
    );
    await api(b.managers[1]!, "requests/" + future.id + "/decision", {
      expectedVersion: 0,
      action: "APPROVE",
      reason: "Independent future allowance review",
      reviewConfirmed: true,
      warningsAcknowledged: true,
    });
    await response(
      manager,
      "monthly-statistics?month=2031-03",
      undefined,
      "GET",
      403,
    );
    await api(
      b.owner,
      "/v1/staff/team/members/" + manager.membershipId,
      { role: "MANAGER" },
      "PATCH",
    );
    evidence.push({
      country: b.config.country,
      case: "current-role purpose revocation",
      managerNotices: managerOnly.length,
      unreadBefore: before.unreadCount,
      unreadAfter: after.unreadCount,
    });
  }
  for (const b of businesses) {
    for (const [i, w] of b.workers.entries()) {
      const csv = await response(
        b.managers[0]!,
        "monthly-account/export?month=2031-03&membershipId=" +
          w.actor.membershipId +
          "&format=csv&locale=en",
      );
      assert(csv.body.includes(w.actor.userId));
      for (const source of w.attendance) assert(csv.body.includes(source.id));
      await writeFile(
        "artifacts/workforce-wf4/" + b.config.country + "-worker-" + i + ".csv",
        csv.body,
      );
    }
    for (const locale of ["sq", "de", "en", "it"]) {
      const pdf = await response(
        b.managers[0]!,
        "monthly-account/export?month=2031-03&membershipId=" +
          b.workers[4]!.actor.membershipId +
          "&format=pdf&locale=" +
          locale,
      );
      assert.equal(pdf.rawPayload.subarray(0, 4).toString(), "%PDF");
      await writeFile(
        "artifacts/workforce-wf4/" + b.config.country + "-" + locale + ".pdf",
        pdf.rawPayload,
      );
    }
  }
  checks.push(
    "fall fold exact elapsed evidence; same canonical user across authorized venues; active attendance isolation; tenant/venue denial; POS permissions and no payroll side effect; controlled retry/replay; role downgrade; complete CSV/PDF sources",
  );
  await writeFile(
    "artifacts/workforce-wf4/edge-evidence.json",
    JSON.stringify(evidence, null, 2),
  );
  return evidence;
}
