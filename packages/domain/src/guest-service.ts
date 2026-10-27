import type { OrderStatus } from "./order";
import { SERVICE_MODE_CAPABILITIES, type ServiceMode } from "./service-mode";

export const GUEST_SERVICE_REQUESTS = [
  "WAITER_CALL",
  "BILL_REQUEST",
  "WATER_REQUEST",
] as const;

export type GuestServiceRequest = (typeof GUEST_SERVICE_REQUESTS)[number];
export type GuestAction = "ORDER" | GuestServiceRequest;

export class GuestActionNotAllowedError extends Error {
  constructor(action: GuestAction, mode: ServiceMode) {
    super(`${action} is not allowed in ${mode} mode`);
    this.name = "GuestActionNotAllowedError";
  }
}

export function canPerformGuestAction(
  mode: ServiceMode,
  action: GuestAction,
): boolean {
  const capabilities = SERVICE_MODE_CAPABILITIES[mode];
  return action === "ORDER"
    ? capabilities.canOrder
    : capabilities.canRequestService;
}

export function assertGuestActionAllowed(
  mode: ServiceMode,
  action: GuestAction,
): void {
  if (!canPerformGuestAction(mode, action)) {
    throw new GuestActionNotAllowedError(action, mode);
  }
}

export function initialOrderStatus(mode: ServiceMode): OrderStatus {
  assertGuestActionAllowed(mode, "ORDER");
  return SERVICE_MODE_CAPABILITIES[mode].requiresConfirmation
    ? "NEW"
    : "ACCEPTED";
}
