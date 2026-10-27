import type { StaffRole } from "./staff-permissions";
import type { DailyReconciliation } from "./payment-reconciliation";

export type DailyReportScope = "VENUE" | "SELF";

export type DailyStaffActivity = {
  membershipId: string;
  displayName: string;
  role: StaffRole;
  shiftCount: number;
  workedMinutes: number;
  onShift: boolean;
  actionCount: number;
  ticketsStarted: number;
  ticketsReady: number;
  partsServed: number;
  requestsCompleted: number;
  paymentsRecorded: number;
  paymentTotalMinor: number;
  tablesClosed: number;
};

export type DailyOperationsReport = {
  date: string;
  timezone: string;
  currency: string;
  scope: DailyReportScope;
  range: { startsAt: string; endsAt: string };
  /** Venue-wide creation-date/payment-date reconciliation; unavailable in SELF. */
  reconciliation: DailyReconciliation | null;
  orders: {
    submitted: number;
    served: number;
    cancelled: number;
    orderValueMinor: number;
  };
  channels: {
    table: { submitted: number; orderValueMinor: number };
    pickup: { submitted: number; orderValueMinor: number };
    delivery: { submitted: number; orderValueMinor: number };
    catering: { submitted: number; orderValueMinor: number };
  };
  reservations: {
    requested: number;
    confirmed: number;
    seated: number;
    completed: number;
    cancelled: number;
    noShows: number;
    partySize: number;
  };
  popularProducts: Array<{
    productId: string;
    productName: string;
    quantity: number;
    orderValueMinor: number;
  }>;
  costing: {
    /**
     * Current recipe and supplier-price estimate for sold item snapshots. This
     * is operational planning data, not historical inventory valuation.
     */
    complete: boolean;
    itemCount: number;
    costedItemCount: number;
    estimatedOrderValueMinor: number;
    estimatedDirectCostMinor: number | null;
    estimatedFoodCostBasisPoints: number | null;
    estimatedContributionMinor: number | null;
    missingRecipeProductIds: string[];
    missingPriceIngredientIds: string[];
  };
  payments: {
    recordedMinor: number;
    voidedMinor: number;
    cashMinor: number;
    cardMinor: number;
    otherMinor: number;
  };
  service: {
    requests: number;
    acknowledged: number;
    unresolved: number;
    averageAcknowledgeSeconds: number | null;
  };
  shifts: {
    count: number;
    open: number;
    workedMinutes: number;
  };
  staff: DailyStaffActivity[];
};

export type StaffPaymentHistory = {
  date: string;
  timezone: string;
  currency: string;
  scope: DailyReportScope;
  payments: Array<{
    id: string;
    tableLabel: string;
    area: string | null;
    amountMinor: number;
    currency: string;
    method: "CASH" | "CARD_AT_TABLE" | "CARD_AT_COUNTER" | "OTHER";
    status: "RECORDED" | "VOIDED";
    recordedAt: string;
    recordedBy: { membershipId: string; displayName: string };
    voidedAt: string | null;
    voidedBy: { membershipId: string; displayName: string } | null;
    voidReason: string | null;
    externalReference: string | null;
    canVoid: boolean;
  }>;
};

function parseDate(date: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new RangeError("Date must use YYYY-MM-DD");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    throw new RangeError("Date is not a valid calendar day");
  }
  return { year, month, day };
}

function partsInTimezone(instant: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

function localMidnightToUtc(
  date: { year: number; month: number; day: number },
  timezone: string,
) {
  const target = Date.UTC(date.year, date.month - 1, date.day);
  let guess = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const local = partsInTimezone(new Date(guess), timezone);
    const representedAsUtc = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
      local.second,
    );
    guess = target - (representedAsUtc - guess);
  }
  return new Date(guess);
}

export function businessDateForInstant(instant: Date, timezone: string) {
  const { year, month, day } = partsInTimezone(instant, timezone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function businessDayUtcRange(date: string, timezone: string) {
  const startDate = parseDate(date);
  const nextCalendarDay = new Date(
    Date.UTC(startDate.year, startDate.month - 1, startDate.day + 1),
  );
  const endDate = {
    year: nextCalendarDay.getUTCFullYear(),
    month: nextCalendarDay.getUTCMonth() + 1,
    day: nextCalendarDay.getUTCDate(),
  };
  return {
    startsAt: localMidnightToUtc(startDate, timezone),
    endsAt: localMidnightToUtc(endDate, timezone),
  };
}
