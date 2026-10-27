import { openingHoursMatcher, type OpeningHoursEntry } from "./venue-website";

export const PICKUP_SLOT_MINUTES = 15;
export const PICKUP_BOOKING_DAYS = 7;
export type PickupTimingMode = "ASAP" | "SCHEDULED";
export type PickupAvailability = {
  generatedAt: Date;
  timezone: string;
  earliest: Date | null;
  slots: Array<{ at: Date; day: string; label: string }>;
  unavailableReason: "NOT_CONFIGURED" | "NO_OPENING" | null;
};
export class PickupTimeUnavailableError extends Error {
  constructor(readonly availability: PickupAvailability) {
    super("No valid pickup time selected");
  }
}

export function pickupAvailability(input: {
  now: Date;
  timezone: string;
  openingHours: OpeningHoursEntry[];
  pickupLeadMinutes: number | null;
}): PickupAvailability {
  const result: PickupAvailability = {
    generatedAt: input.now,
    timezone: input.timezone,
    earliest: null,
    slots: [],
    unavailableReason: "NOT_CONFIGURED",
  };
  const lead = input.pickupLeadMinutes;
  if (lead === null || !Number.isInteger(lead) || lead < 1 || lead > 240)
    return result;
  const open = openingHoursMatcher(input);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: input.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const first = Math.ceil(input.now.getTime() / 60_000) * 60_000;
  const end = first + PICKUP_BOOKING_DAYS * 86_400_000;
  let openMinutes = 0;
  // Walk real UTC minutes: DST gaps cannot create nonexistent slots and repeated
  // local times retain distinct instants. Preparation must fit a continuous
  // opening interval, including overnight hours, before the pickup instant.
  for (let timestamp = first; timestamp < end; timestamp += 60_000) {
    const at = new Date(timestamp);
    if (!open(at)) {
      openMinutes = 0;
      continue;
    }
    if (openMinutes++ < lead) continue;
    result.earliest ??= at;
    const parts = formatter.formatToParts(at);
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((p) => p.type === type)!.value;
    if (Number(get("minute")) % PICKUP_SLOT_MINUTES !== 0) continue;
    result.slots.push({
      at,
      day: `${get("year")}-${get("month")}-${get("day")}`,
      label: `${get("hour")}:${get("minute")}`,
    });
  }
  // Repeated fall-back hours need an offset so customers can distinguish the
  // two real instants without relying on ambiguous local clock labels.
  const labels = new Map<string, number>();
  for (const slot of result.slots) {
    const key = `${slot.day}/${slot.label}`;
    labels.set(key, (labels.get(key) ?? 0) + 1);
  }
  const offset = new Intl.DateTimeFormat("en", {
    timeZone: input.timezone,
    timeZoneName: "shortOffset",
  });
  for (const slot of result.slots) {
    if (labels.get(`${slot.day}/${slot.label}`)! > 1) {
      const zone = offset
        .formatToParts(slot.at)
        .find((p) => p.type === "timeZoneName")!.value;
      slot.label += ` (${zone})`;
    }
  }
  result.unavailableReason = result.earliest ? null : "NO_OPENING";
  return result;
}

export function resolvePickupTime(
  input: Parameters<typeof pickupAvailability>[0] & {
    timingMode: PickupTimingMode;
    requestedFor?: Date | undefined;
  },
) {
  const availability = pickupAvailability(input);
  const selected =
    input.timingMode === "ASAP"
      ? availability.earliest
      : availability.slots.find(
          (slot) => slot.at.getTime() === input.requestedFor?.getTime(),
        )?.at;
  if (!selected) throw new PickupTimeUnavailableError(availability);
  const plannedStart = new Date(
    selected.getTime() - input.pickupLeadMinutes! * 60_000,
  );
  const startNow =
    input.timingMode === "ASAP" &&
    plannedStart.getTime() - input.now.getTime() < 60_000 &&
    openingHoursMatcher(input)(input.now);
  return {
    requestedFor: selected,
    productionNotBefore: startNow ? input.now : plannedStart,
  };
}

// Backward-compatible timestamp clients may send non-quarter-hour times, but
// cannot bypass the configured minimum preparation window or opening hours.
export function resolveLegacyPickupTime(
  input: Parameters<typeof pickupAvailability>[0] & { requestedFor: Date },
) {
  const lead = input.pickupLeadMinutes ?? 0;
  const productionNotBefore = new Date(
    input.requestedFor.getTime() - lead * 60_000,
  );
  const open = openingHoursMatcher(input);
  let valid =
    input.requestedFor > input.now &&
    productionNotBefore >= input.now &&
    open(input.requestedFor);
  for (
    let at = productionNotBefore.getTime();
    valid && at < input.requestedFor.getTime();
    at += 60_000
  )
    valid = open(new Date(at));
  if (!valid) throw new PickupTimeUnavailableError(pickupAvailability(input));
  return { requestedFor: input.requestedFor, productionNotBefore };
}

export function onlineProductionCanStart(notBefore: Date | null, now: Date) {
  return notBefore === null || notBefore.getTime() <= now.getTime();
}

// Formatting normalization only; never infer country codes or match suffixes.
export function normalizeOrderRecoveryPhone(phone: string) {
  const compact = phone
    .trim()
    .replace(/[\s().-]/g, "")
    .replace(/^00/, "+");
  return /^\+?\d{6,15}$/.test(compact) ? compact : null;
}
