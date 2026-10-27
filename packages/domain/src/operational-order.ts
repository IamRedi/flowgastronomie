import type { OnlineFulfillmentType, OnlineOrderStatus } from "./online-order";
import type { OrderStatus } from "./order";

export const OPERATIONAL_ORDER_STATUSES = [
  "PENDING_CONFIRMATION",
  "ACCEPTED",
  "PREPARING",
  "READY",
  "OUT_FOR_DELIVERY",
  "COMPLETED",
  "REJECTED",
  "CANCELLED",
] as const;

export type OperationalOrderStatus =
  (typeof OPERATIONAL_ORDER_STATUSES)[number];

export type OperationalOrderSource =
  | "TABLE_GUEST_QR"
  | "TABLE_STAFF_TABLET"
  | "ONLINE_PICKUP"
  | "ONLINE_DELIVERY"
  | "ONLINE_CATERING";

export type OperationalOrderFulfillment =
  "DINE_IN" | "PICKUP" | "DELIVERY" | "CATERING";

export const OPERATIONAL_ORDER_EVENT_TYPES = [
  "ORDER_CREATED",
  "ORDER_STATUS_CHANGED",
] as const;

export type OperationalOrderEventType =
  (typeof OPERATIONAL_ORDER_EVENT_TYPES)[number];

export type OperationalOrderEvent = {
  id: string;
  tenantId: string;
  venueId: string;
  orderId: string;
  orderKind: "TABLE" | "ONLINE";
  type: OperationalOrderEventType;
  source: OperationalOrderSource;
  fulfillment: OperationalOrderFulfillment;
  status: OperationalOrderStatus;
  totalMinor: number;
  currency: string;
  actor: {
    userId: string;
    membershipId: string;
    shiftId: string | null;
  } | null;
  occurredAt: Date;
};

export type OperationalOrder = {
  id: string;
  reference: string;
  source: OperationalOrderSource;
  fulfillment: OperationalOrderFulfillment;
  status: OperationalOrderStatus;
  createdAt: Date;
  updatedAt: Date;
  requestedFor: Date | null;
  totals: { totalMinor: number; currency: string };
  customerLink: { kind: "TABLE_GUEST" | "ORDER_CONTACT"; id: string | null };
  table: { sessionId: string; label: string } | null;
  payment: { status: "NOT_RECORDED" };
  items: Array<{
    productId: string;
    productName: string;
    quantity: number;
    unitPriceMinor: number;
    station: "BAR" | "KITCHEN" | "DESSERT";
    notes: string | null;
    variantId: string | null;
    variantName: string | null;
    modifiers: Array<{
      modifierOptionId: string;
      groupName: string;
      optionName: string;
      priceDeltaMinor: number;
    }>;
  }>;
  production: Array<{
    station: "BAR" | "KITCHEN" | "DESSERT";
    status: "NEW" | "PREPARING" | "READY" | "SERVED";
    updatedAt: Date;
  }>;
  statusHistory: Array<{
    status: OperationalOrderStatus;
    occurredAt: Date;
    actor: { userId: string; membershipId: string } | null;
  }>;
  statusHistoryCoverage: "CURRENT_STATE_ONLY" | "RECORDED_EVENTS";
  actors: {
    created: { userId: string; membershipId: string; shiftId: string } | null;
    serviceOwner: {
      userId: string;
      membershipId: string;
      shiftId: string;
    } | null;
    decision: { userId: string; membershipId: string } | null;
  };
};

export function operationalStatusFromTableOrder(
  status: OrderStatus,
): OperationalOrderStatus {
  const statusMap: Record<OrderStatus, OperationalOrderStatus> = {
    NEW: "PENDING_CONFIRMATION",
    ACCEPTED: "ACCEPTED",
    PREPARING: "PREPARING",
    READY: "READY",
    SERVED: "COMPLETED",
    CANCELLED: "CANCELLED",
  };
  return statusMap[status];
}

export function operationalStatusFromOnlineOrder(
  status: OnlineOrderStatus,
): OperationalOrderStatus {
  return status;
}

export function operationalSourceFromOnlineFulfillment(
  fulfillment: OnlineFulfillmentType,
): OperationalOrderSource {
  const sourceMap: Record<OnlineFulfillmentType, OperationalOrderSource> = {
    PICKUP: "ONLINE_PICKUP",
    DELIVERY: "ONLINE_DELIVERY",
    CATERING: "ONLINE_CATERING",
  };
  return sourceMap[fulfillment];
}

export function operationalSourceFromTableOrder(
  source: "GUEST_QR" | "STAFF_TABLET",
): OperationalOrderSource {
  return source === "STAFF_TABLET" ? "TABLE_STAFF_TABLET" : "TABLE_GUEST_QR";
}
