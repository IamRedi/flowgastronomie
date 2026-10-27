/** Independent fixture ledger. No platform/domain/Temporal imports. All expected
 * inputs are explicit fixture facts; API output is never a calculation input. */
export type Country = "DE" | "AL";
export type Contract = { from: string; weeklyMinutes: number };
export type Break = { start: number; end: number; kind: "PAID" | "UNPAID" };
export type Interval = {
  start: number;
  end: number;
  breaks: Break[];
  source: string;
};
export type Plan = {
  id: string;
  worker: number | null;
  day: string;
  startsLocal: string;
  endsLocal: string;
  start: number;
  end: number;
  breakMinutes: number;
  station: string;
  cancelled?: boolean;
};
export type LedgerWorker = {
  key: string;
  contracts: Contract[];
  endedOn?: string;
  planned: Plan[];
  actual: Interval[];
  leave: { date: string; category: string; minutes: number; status: string }[];
  carryMinutes: number;
};
export const configs = [
  {
    country: "DE" as const,
    name: "WF4 Synthetic Pizza Workshop",
    currency: "EUR",
    timezone: "Europe/Berlin",
    stations: ["KITCHEN", "COUNTER", "SERVICE", "DELIVERY"],
    weekdays: [1, 2, 3, 4, 5],
    weekly: [2400, 1800, 1200, 600, 2400, 1800, 900, 2400],
    plannedPaid: false,
    carry: 30,
  },
  {
    country: "AL" as const,
    name: "WF4 Synthetic Restaurant Workshop",
    currency: "ALL",
    timezone: "Europe/Tirane",
    stations: ["KITCHEN", "SERVICE", "BAR", "COUNTER"],
    weekdays: [1, 2, 3, 4, 5, 6],
    weekly: [2520, 2100, 1680, 1260, 2520, 2100, 840, 2520],
    plannedPaid: true,
    carry: 60,
  },
];
export function dayAdd(day: string, n: number) {
  return new Date(Date.parse(day + "T12:00Z") + n * 86400000)
    .toISOString()
    .slice(0, 10);
}
export function weekday(day: string) {
  return new Date(day + "T12:00Z").getUTCDay() || 7;
}
export function monday(day: string) {
  return dayAdd(day, 1 - weekday(day));
}
/** Explicit 2031 European DST fixtures, independently stated as UTC offsets.
 * Gaps/folds are tested with explicit instants, never guessed local parsing. */
export function instant(local: string, fold: "earlier" | "later" = "earlier") {
  const date = local.slice(0, 10),
    time = local.slice(11, 16);
  let offset = 1;
  if (
    (date > "2031-03-30" && date < "2031-10-26") ||
    (date === "2031-03-30" && time >= "03:00") ||
    (date === "2031-10-26" &&
      (time < "02:00" || (time < "03:00" && fold === "earlier")))
  )
    offset = 2;
  if (date === "2031-03-30" && time >= "02:00" && time < "03:00")
    throw new Error("Fixture local time is in the DST gap");
  return Date.parse(local + "Z") - offset * 3600000;
}
const clip = (start: number, end: number, lo: number, hi: number) =>
  Math.max(0, Math.min(end, hi) - Math.max(start, lo));
export function intervalTotals(rows: Interval[], lo: number, hi: number) {
  let presence = 0,
    paid = 0,
    unpaid = 0;
  for (const row of rows) {
    presence += clip(row.start, row.end, lo, hi);
    for (const b of row.breaks) {
      const v = clip(
        b.start,
        b.end,
        Math.max(row.start, lo),
        Math.min(row.end, hi),
      );
      if (b.kind === "PAID") paid += v;
      else unpaid += v;
    }
  }
  return { presence, paid, unpaid, net: presence - unpaid };
}
export function targetMinutes(
  w: LedgerWorker,
  day: string,
  c: (typeof configs)[number],
) {
  if ((w.endedOn && day > w.endedOn) || !c.weekdays.includes(weekday(day)))
    return 0;
  const contract = [...w.contracts]
    .filter((x) => x.from <= day)
    .sort((a, b) => b.from.localeCompare(a.from))[0];
  if (!contract)
    throw new Error("Oracle contract missing: " + w.key + " " + day);
  return contract.weeklyMinutes / c.weekdays.length;
}
export function expectedMonth(
  w: LedgerWorker,
  c: (typeof configs)[number],
  asOf = Infinity,
  month = "2031-03",
) {
  const first = month + "-01",
    next =
      month === "2031-03"
        ? "2031-04-01"
        : month === "2031-04"
          ? "2031-05-01"
          : month === "2031-10"
            ? "2031-11-01"
            : "2031-03-01";
  const lo = instant(first + "T00:00"),
    hi = instant(next + "T00:00"),
    actual = intervalTotals(
      w.actual.filter((r) => r.end <= asOf),
      lo,
      hi,
    );
  let planned = 0,
    target = 0,
    credited = 0;
  for (const p of w.planned.filter((p) => !p.cancelled)) {
    const overlap = clip(p.start, p.end, lo, hi);
    planned +=
      overlap *
      (1 - (c.plannedPaid ? 0 : (p.breakMinutes * 60000) / (p.end - p.start)));
  }
  for (let day = first; day < next; day = dayAdd(day, 1)) {
    const targetDay = targetMinutes(w, day, c) * 60000;
    target += targetDay;
    const rangeLo = instant(day + "T00:00"),
      rangeHi = instant(dayAdd(day, 1) + "T00:00"),
      approvedDay = intervalTotals(
        w.actual.filter((r) => r.end <= asOf),
        rangeLo,
        rangeHi,
      ).net;
    let remaining = Math.max(0, targetDay - approvedDay);
    if (day === "2031-03-17") {
      credited += remaining;
      remaining = 0;
    }
    for (const l of w.leave.filter(
      (l) =>
        l.date === day &&
        l.status === "APPROVED" &&
        ["ANNUAL", "SICKNESS"].includes(l.category),
    )) {
      const v = Math.min(remaining, l.minutes * 60000);
      credited += v;
      remaining -= v;
    }
  }
  const carry = w.carryMinutes * 60000;
  return {
    plannedMs: Math.round(planned),
    actualMs: actual.net,
    approvedMs: actual.net,
    creditedMs: credited,
    targetMs: target,
    carryMs: carry,
    balanceMs: actual.net + credited - target + carry,
    overtimeMs: Math.max(
      0,
      actual.net + (c.country === "AL" ? credited : 0) - target,
    ),
    actualPresenceMs: actual.presence,
    actualPaidBreakMs: actual.paid,
    actualUnpaidBreakMs: actual.unpaid,
    approvedPaidBreakMs: actual.paid,
    approvedUnpaidBreakMs: actual.unpaid,
  };
}
/** BALANCE carry policy used by these fixtures; caps are explicit fixture inputs.
 * Both months are derived exclusively from the input ledger, never API totals. */
export function expectedFollowingMonth(
  w: LedgerWorker,
  c: (typeof configs)[number],
  previousMonth: string,
  month: string,
  caps: { positiveMinutes: number | null; negativeMinutes: number | null },
) {
  let carryMs = expectedMonth(w, c, Infinity, previousMonth).balanceMs;
  if (caps.positiveMinutes !== null)
    carryMs = Math.min(carryMs, caps.positiveMinutes * 60000);
  if (caps.negativeMinutes !== null)
    carryMs = Math.max(carryMs, -caps.negativeMinutes * 60000);
  return expectedMonth(
    { ...w, carryMinutes: carryMs / 60000 },
    c,
    Infinity,
    month,
  );
}
export function reconcile(
  actual: Record<string, number | null>,
  expected: Record<string, number>,
  context: string,
) {
  const discrepancies = Object.entries(expected)
    .filter(([k, v]) => actual[k] !== v)
    .map(([metric, value]) => ({
      context,
      metric,
      expectedMs: value,
      actualMs: actual[metric],
    }));
  if (discrepancies.length)
    throw new Error(
      "Independent WF4 ledger mismatch: " + JSON.stringify(discrepancies),
    );
  return { context, expected, actual, discrepancies: [] };
}
