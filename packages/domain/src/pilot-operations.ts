import type { OrderStatus } from "./order";
import type { StaffRole } from "./staff-permissions";

export const orderReference = (id: string) => id.slice(-8).toUpperCase();
export function counterOrderVisible(
  status: OrderStatus,
  paid: boolean,
  tableClosed = false,
) {
  return (
    !tableClosed && status !== "CANCELLED" && !(status === "SERVED" && paid)
  );
}
export function productionStations(
  role: StaffRole,
  station: "KITCHEN" | "BAR",
) {
  if (
    role === "OWNER" ||
    role === "MANAGER" ||
    (role === "KITCHEN" && station === "KITCHEN") ||
    (role === "BAR" && station === "BAR")
  )
    return station === "KITCHEN"
      ? (["KITCHEN", "DESSERT"] as const)
      : (["BAR"] as const);
  return [];
}
export function canCompletePickup(statuses: readonly string[]) {
  return (
    statuses.length > 0 &&
    statuses.some((s) => s === "READY") &&
    statuses.every((s) => s === "READY" || s === "SERVED")
  );
}
export type ProductionItem = {
  quantity: number;
  productName: string;
  variantName: string | null;
  notes: string | null;
  modifiers: Array<{ optionName: string }>;
};
export type PilotTicket = {
  id: string;
  orderId: string;
  reference: string;
  version: number;
  status: "NEW" | "PREPARING" | "READY" | "SERVED";
  station: "KITCHEN" | "BAR" | "DESSERT";
  orderType: "TAKEAWAY" | "DINE_IN";
  tableLabel: string | null;
  createdAt: string;
  items: ProductionItem[];
  canStart: boolean;
  canReady: boolean;
  canServe: boolean;
};
export type CounterQueueOrder = {
  id: string;
  reference: string;
  orderType: "TAKEAWAY" | "DINE_IN";
  tableLabel: string | null;
  totalMinor: number;
  currency: string;
  productionStatus: OrderStatus;
  paymentStatus: "PAID" | "UNPAID";
  receiptId: string | null;
  createdAt: string;
  canComplete: boolean;
  items: ProductionItem[];
};

export type SimplePilotTicket = {
  id: string;
  station: "KITCHEN" | "BAR" | "DESSERT";
  status: "NEW" | "PREPARING" | "READY" | "SERVED";
  version: number;
};

export type SimplePilotOrder = {
  id: string;
  reference: string;
  source: "COUNTER" | "TABLE" | "WEBSITE";
  lifecycleStatus: string;
  productionStatus: "NEW" | "PREPARING" | "READY" | "COMPLETED";
  paymentStatus: "PENDING_PAYMENT" | "PAID";
  totalMinor: number;
  currency: string;
  createdAt: string;
  receiptId: string | null;
  paidMinor: number;
  paymentMethods: Array<"CASH" | "CARD_AT_TABLE" | "CARD_AT_COUNTER" | "OTHER">;
  /** Session payments are deliberately not assigned to an individual order. */
  sessionPaymentMinor: number;
  canPay: boolean;
  items: ProductionItem[];
  tickets: SimplePilotTicket[];
  canManage: boolean;
  canProduce: boolean;
  canComplete: boolean;
};

export const pilotOrderViews = [
  "ACTIVE",
  "TODAY",
  "PAID",
  "COMPLETED",
] as const;
export type PilotOrderView = (typeof pilotOrderViews)[number];
export function pilotOrderMatchesView(
  order: Pick<SimplePilotOrder, "lifecycleStatus" | "paymentStatus">,
  view: PilotOrderView,
  tableClosed = false,
) {
  const completed =
    order.lifecycleStatus === "SERVED" || order.lifecycleStatus === "COMPLETED";
  if (view === "TODAY") return true;
  if (view === "PAID") return order.paymentStatus === "PAID";
  if (view === "COMPLETED") return completed;
  return (
    !tableClosed &&
    order.lifecycleStatus !== "CANCELLED" &&
    order.lifecycleStatus !== "REJECTED" &&
    !(completed && order.paymentStatus === "PAID")
  );
}

export function simpleProductionStatus(
  statuses: readonly string[],
  lifecycleStatus?: string,
): SimplePilotOrder["productionStatus"] {
  if (lifecycleStatus === "SERVED" || lifecycleStatus === "COMPLETED")
    return "COMPLETED";
  if (statuses.length && statuses.every((status) => status === "SERVED"))
    return "COMPLETED";
  if (
    statuses.length &&
    statuses.every((status) => status === "READY" || status === "SERVED")
  )
    return "READY";
  return statuses.includes("PREPARING") ||
    statuses.includes("READY") ||
    statuses.includes("SERVED")
    ? "PREPARING"
    : "NEW";
}
