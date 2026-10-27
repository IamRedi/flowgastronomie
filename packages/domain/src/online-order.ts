export const ONLINE_FULFILLMENT_TYPES = [
  "PICKUP",
  "DELIVERY",
  "CATERING",
] as const;

export type OnlineFulfillmentType = (typeof ONLINE_FULFILLMENT_TYPES)[number];

export const ONLINE_ORDER_STATUSES = [
  "PENDING_CONFIRMATION",
  "ACCEPTED",
  "PREPARING",
  "READY",
  "OUT_FOR_DELIVERY",
  "COMPLETED",
  "REJECTED",
  "CANCELLED",
] as const;

export type OnlineOrderStatus = (typeof ONLINE_ORDER_STATUSES)[number];

export class OnlineOrderQuoteChangedError extends Error {}
/** Older clients omit the proof; reviewed checkouts must reconfirm changed totals/options. */
export function assertOnlineOrderQuote(
  expected: string | undefined,
  current: string,
) {
  if (expected !== undefined && expected !== current)
    throw new OnlineOrderQuoteChangedError();
}

// Reference-only public projection. Never add identity, items, money, messages,
// history or credentials here; those require the existing private tracking link.
export type OnlineOrderPublicStatus = {
  status: OnlineOrderStatus;
  requestedFor?: string;
  timingMode?: "ASAP" | "SCHEDULED";
  venue: { name: string; timezone: string };
};

export type DeliveryZoneRule = {
  id: string;
  postalPrefixes: string[];
  feeMinor: number;
  minimumOrderMinor: number;
  active: boolean;
};

export function resolveDeliveryZone(
  postalCode: string,
  zones: DeliveryZoneRule[],
) {
  return zones
    .filter((zone) => zone.active)
    .flatMap((zone) =>
      zone.postalPrefixes
        .map((prefix) => prefix.trim())
        .filter((prefix) => prefix && postalCode.startsWith(prefix))
        .map((prefix) => ({ zone, prefix })),
    )
    .sort((left, right) => right.prefix.length - left.prefix.length)[0]?.zone;
}

export type OnlineOrderContact = {
  name: string;
  phone: string;
  email?: string | null;
};

export type OnlineDeliveryAddress = {
  line1: string;
  postalCode: string;
  city: string;
};

export type OnlineOrderRequestDetails = {
  fulfillmentType: OnlineFulfillmentType;
  contact: OnlineOrderContact;
  requestedFor: Date;
  deliveryAddress?: OnlineDeliveryAddress | null;
  cateringGuestCount?: number | null;
};

export class OnlineOrderRequestInvalidError extends Error {
  constructor(readonly issues: string[]) {
    super("The online order request is invalid");
    this.name = "OnlineOrderRequestInvalidError";
  }
}

function blank(value: string | null | undefined) {
  return !value?.trim();
}

export function onlineOrderRequestIssues(
  request: OnlineOrderRequestDetails,
  now: Date,
): string[] {
  const issues: string[] = [];
  if (blank(request.contact.name)) issues.push("CONTACT_NAME_REQUIRED");
  if (blank(request.contact.phone)) issues.push("CONTACT_PHONE_REQUIRED");
  if (request.requestedFor.getTime() <= now.getTime()) {
    issues.push("REQUESTED_TIME_MUST_BE_FUTURE");
  }
  if (request.fulfillmentType === "DELIVERY") {
    if (blank(request.deliveryAddress?.line1)) {
      issues.push("DELIVERY_ADDRESS_REQUIRED");
    }
    if (blank(request.deliveryAddress?.postalCode)) {
      issues.push("DELIVERY_POSTAL_CODE_REQUIRED");
    }
    if (blank(request.deliveryAddress?.city)) {
      issues.push("DELIVERY_CITY_REQUIRED");
    }
  }
  if (
    request.fulfillmentType === "CATERING" &&
    (!Number.isInteger(request.cateringGuestCount) ||
      (request.cateringGuestCount ?? 0) < 2)
  ) {
    issues.push("CATERING_GUEST_COUNT_INVALID");
  }
  return issues;
}

export function assertOnlineOrderRequest(
  request: OnlineOrderRequestDetails,
  now: Date,
) {
  const issues = onlineOrderRequestIssues(request, now);
  if (issues.length) throw new OnlineOrderRequestInvalidError(issues);
}

export function canTransitionOnlineOrder(
  from: OnlineOrderStatus,
  to: Exclude<OnlineOrderStatus, "PENDING_CONFIRMATION">,
  fulfillmentType: OnlineFulfillmentType,
) {
  if (from === "PENDING_CONFIRMATION") {
    return ["ACCEPTED", "REJECTED", "CANCELLED"].includes(to);
  }
  if (from === "ACCEPTED") return ["PREPARING", "CANCELLED"].includes(to);
  if (from === "PREPARING") return ["READY", "CANCELLED"].includes(to);
  if (from === "READY") {
    return fulfillmentType === "DELIVERY"
      ? to === "OUT_FOR_DELIVERY"
      : to === "COMPLETED";
  }
  if (from === "OUT_FOR_DELIVERY") return to === "COMPLETED";
  return false;
}
