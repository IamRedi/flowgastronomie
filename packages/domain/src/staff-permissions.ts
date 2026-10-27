import type { OrderStatus } from "./order";

export const STAFF_ROLES = [
  "OWNER",
  "MANAGER",
  "WAITER",
  "BAR",
  "KITCHEN",
] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

export const STAFF_PERMISSIONS = [
  "WORKFORCE_PRIVATE_MANAGE",
  "IMPORT_MANAGE",
  "CREATIVE_VIEW",
  "CREATIVE_EDIT",
  "CREATIVE_EXPORT",
  "CREATIVE_AI_USE",
  "RADAR_VIEW",
  "SIGNAL_ACKNOWLEDGE",
  "ORDER_ACCEPT",
  "ORDER_PREPARE",
  "ORDER_READY",
  "ORDER_SERVE",
  "ORDER_CANCEL",
  "OPERATIONAL_ORDER_VIEW",
  "ONLINE_ORDER_VIEW",
  "ONLINE_ORDER_MANAGE",
  "ORDER_CREATE",
  "SESSION_CLOSE",
  "MENU_VIEW",
  "MENU_MANAGE",
  "COST_MANAGE",
  "SCHEDULE_VIEW",
  "SCHEDULE_MANAGE",
  "TASK_VIEW",
  "TASK_MANAGE",
  "RESERVATION_VIEW",
  "RESERVATION_MANAGE",
  "CUSTOMER_VIEW",
  "CUSTOMER_MANAGE",
  "LEGAL_HOLD_MANAGE",
  "VENUE_SETUP_VIEW",
  "VENUE_SETUP_MANAGE",
  "SHIFT_SELF",
  "PAYMENT_RECORD",
  "REGISTER_MANAGE",
  "HARDWARE_MANAGE",
  "RECEIPT_PRINT",
  "DRAWER_MANUAL",
  "PAYMENT_VOID",
  "TEAM_VIEW",
  "TEAM_MANAGE",
  "TABLE_ASSIGN",
  "SHIFT_REPORT",
  "WORKSPACE_OVERVIEW_VIEW",
  "WEBSITE_VIEW",
  "WEBSITE_MANAGE",
  "WEBSITE_DOMAIN_MANAGE",
  "BILLING_VIEW",
  "BILLING_MANAGE",
  "LAUNCH_VIEW",
  "LAUNCH_REHEARSAL",
  "LAUNCH_ACTIVATE",
] as const;

export type StaffPermission = (typeof STAFF_PERMISSIONS)[number];

const allPermissions: readonly StaffPermission[] = STAFF_PERMISSIONS;

const permissionsByRole: Record<StaffRole, readonly StaffPermission[]> = {
  OWNER: allPermissions,
  MANAGER: allPermissions.filter(
    (permission) =>
      permission !== "WORKFORCE_PRIVATE_MANAGE" &&
      permission !== "WEBSITE_DOMAIN_MANAGE" &&
      permission !== "BILLING_VIEW" &&
      permission !== "BILLING_MANAGE" &&
      permission !== "LAUNCH_ACTIVATE" &&
      permission !== "LEGAL_HOLD_MANAGE",
  ),
  WAITER: [
    "RADAR_VIEW",
    "SIGNAL_ACKNOWLEDGE",
    "ORDER_CREATE",
    "ORDER_SERVE",
    "SESSION_CLOSE",
    "SHIFT_SELF",
    "PAYMENT_RECORD",
    "RECEIPT_PRINT",
    "SCHEDULE_VIEW",
    "TASK_VIEW",
    "TASK_MANAGE",
  ],
  BAR: [
    "RADAR_VIEW",
    "ORDER_PREPARE",
    "ORDER_READY",
    "SHIFT_SELF",
    "SCHEDULE_VIEW",
    "TASK_VIEW",
    "TASK_MANAGE",
  ],
  KITCHEN: [
    "RADAR_VIEW",
    "ORDER_PREPARE",
    "ORDER_READY",
    "SHIFT_SELF",
    "SCHEDULE_VIEW",
    "TASK_VIEW",
    "TASK_MANAGE",
  ],
};

export class StaffPermissionDeniedError extends Error {
  constructor(role: StaffRole, permission: StaffPermission) {
    super(`${role} does not have ${permission} permission`);
    this.name = "StaffPermissionDeniedError";
  }
}

export function hasStaffPermission(
  role: StaffRole,
  permission: StaffPermission,
): boolean {
  return permissionsByRole[role].includes(permission);
}

export function assertStaffPermission(
  role: StaffRole,
  permission: StaffPermission,
): void {
  if (!hasStaffPermission(role, permission)) {
    throw new StaffPermissionDeniedError(role, permission);
  }
}

export function permissionForOrderTransition(
  nextStatus: OrderStatus,
): StaffPermission {
  const permissionByStatus: Record<
    Exclude<OrderStatus, "NEW">,
    StaffPermission
  > = {
    ACCEPTED: "ORDER_ACCEPT",
    PREPARING: "ORDER_PREPARE",
    READY: "ORDER_READY",
    SERVED: "ORDER_SERVE",
    CANCELLED: "ORDER_CANCEL",
  };

  if (nextStatus === "NEW") {
    throw new Error("Orders cannot transition back to NEW");
  }

  return permissionByStatus[nextStatus];
}
