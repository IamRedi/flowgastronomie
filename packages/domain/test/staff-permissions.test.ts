import { describe, expect, it } from "vitest";

import {
  assertStaffPermission,
  hasStaffPermission,
  permissionForOrderTransition,
  StaffPermissionDeniedError,
} from "../src/index.js";

describe("staff permissions", () => {
  it("keeps production acceptance away from waiters and allows serving", () => {
    expect(hasStaffPermission("WAITER", "ORDER_ACCEPT")).toBe(false);
    expect(hasStaffPermission("WAITER", "ORDER_SERVE")).toBe(true);
  });

  it("prevents a waiter from marking kitchen preparation", () => {
    expect(() => assertStaffPermission("WAITER", "ORDER_PREPARE")).toThrow(
      StaffPermissionDeniedError,
    );
  });

  it("allows production roles to prepare and ready orders", () => {
    expect(hasStaffPermission("BAR", "ORDER_PREPARE")).toBe(true);
    expect(hasStaffPermission("KITCHEN", "ORDER_READY")).toBe(true);
  });

  it("limits menu management to owners and managers", () => {
    expect(hasStaffPermission("OWNER", "MENU_MANAGE")).toBe(true);
    expect(hasStaffPermission("MANAGER", "MENU_VIEW")).toBe(true);
    expect(hasStaffPermission("MANAGER", "MENU_MANAGE")).toBe(true);
    expect(hasStaffPermission("WAITER", "MENU_VIEW")).toBe(false);
    expect(hasStaffPermission("BAR", "MENU_MANAGE")).toBe(false);
    expect(hasStaffPermission("KITCHEN", "MENU_MANAGE")).toBe(false);
  });

  it("limits ingredient costs and supplier prices to owners and managers", () => {
    expect(hasStaffPermission("OWNER", "COST_MANAGE")).toBe(true);
    expect(hasStaffPermission("MANAGER", "COST_MANAGE")).toBe(true);
    expect(hasStaffPermission("WAITER", "COST_MANAGE")).toBe(false);
    expect(hasStaffPermission("KITCHEN", "COST_MANAGE")).toBe(false);
  });

  it("limits venue setup to owners and managers", () => {
    expect(hasStaffPermission("OWNER", "VENUE_SETUP_MANAGE")).toBe(true);
    expect(hasStaffPermission("MANAGER", "VENUE_SETUP_VIEW")).toBe(true);
    expect(hasStaffPermission("WAITER", "VENUE_SETUP_VIEW")).toBe(false);
  });

  it("allows every worker to manage their own shift but limits payment voids", () => {
    expect(hasStaffPermission("WAITER", "SHIFT_SELF")).toBe(true);
    expect(hasStaffPermission("KITCHEN", "SHIFT_SELF")).toBe(true);
    expect(hasStaffPermission("WAITER", "PAYMENT_RECORD")).toBe(true);
    expect(hasStaffPermission("WAITER", "PAYMENT_VOID")).toBe(false);
    expect(hasStaffPermission("MANAGER", "PAYMENT_VOID")).toBe(true);
  });

  it("limits team administration to leadership roles", () => {
    expect(hasStaffPermission("OWNER", "TEAM_MANAGE")).toBe(true);
    expect(hasStaffPermission("MANAGER", "TABLE_ASSIGN")).toBe(true);
    expect(hasStaffPermission("MANAGER", "SHIFT_REPORT")).toBe(true);
    expect(hasStaffPermission("WAITER", "TEAM_VIEW")).toBe(false);
  });

  it("keeps the unified operational order view with leadership", () => {
    expect(hasStaffPermission("OWNER", "OPERATIONAL_ORDER_VIEW")).toBe(true);
    expect(hasStaffPermission("MANAGER", "OPERATIONAL_ORDER_VIEW")).toBe(true);
    expect(hasStaffPermission("WAITER", "OPERATIONAL_ORDER_VIEW")).toBe(false);
  });

  it("keeps customer records with leadership", () => {
    expect(hasStaffPermission("OWNER", "CUSTOMER_MANAGE")).toBe(true);
    expect(hasStaffPermission("MANAGER", "CUSTOMER_VIEW")).toBe(true);
    expect(hasStaffPermission("WAITER", "CUSTOMER_VIEW")).toBe(false);
    expect(hasStaffPermission("KITCHEN", "CUSTOMER_MANAGE")).toBe(false);
  });

  it("keeps the business workspace separate from staff workspaces", () => {
    expect(hasStaffPermission("OWNER", "WORKSPACE_OVERVIEW_VIEW")).toBe(true);
    expect(hasStaffPermission("MANAGER", "WORKSPACE_OVERVIEW_VIEW")).toBe(true);
    expect(hasStaffPermission("WAITER", "WORKSPACE_OVERVIEW_VIEW")).toBe(false);
    expect(hasStaffPermission("BAR", "WORKSPACE_OVERVIEW_VIEW")).toBe(false);
  });

  it("limits restaurant website management to leadership", () => {
    expect(hasStaffPermission("OWNER", "WEBSITE_MANAGE")).toBe(true);
    expect(hasStaffPermission("MANAGER", "WEBSITE_VIEW")).toBe(true);
    expect(hasStaffPermission("WAITER", "WEBSITE_VIEW")).toBe(false);
  });

  it("reserves custom-domain management for the owner", () => {
    expect(hasStaffPermission("OWNER", "WEBSITE_DOMAIN_MANAGE")).toBe(true);
    expect(hasStaffPermission("MANAGER", "WEBSITE_DOMAIN_MANAGE")).toBe(false);
  });

  it("reserves legal holds for the owner", () => {
    expect(hasStaffPermission("OWNER", "LEGAL_HOLD_MANAGE")).toBe(true);
    expect(hasStaffPermission("MANAGER", "LEGAL_HOLD_MANAGE")).toBe(false);
  });

  it("reserves subscription and billing data for the owner", () => {
    expect(hasStaffPermission("OWNER", "BILLING_VIEW")).toBe(true);
    expect(hasStaffPermission("OWNER", "BILLING_MANAGE")).toBe(true);
    expect(hasStaffPermission("MANAGER", "BILLING_VIEW")).toBe(false);
  });

  it("lets managers rehearse but reserves launch activation for the owner", () => {
    expect(hasStaffPermission("MANAGER", "LAUNCH_VIEW")).toBe(true);
    expect(hasStaffPermission("MANAGER", "LAUNCH_REHEARSAL")).toBe(true);
    expect(hasStaffPermission("MANAGER", "LAUNCH_ACTIVATE")).toBe(false);
    expect(hasStaffPermission("OWNER", "LAUNCH_ACTIVATE")).toBe(true);
  });

  it("maps target status to its required permission", () => {
    expect(permissionForOrderTransition("ACCEPTED")).toBe("ORDER_ACCEPT");
    expect(permissionForOrderTransition("PREPARING")).toBe("ORDER_PREPARE");
    expect(permissionForOrderTransition("SERVED")).toBe("ORDER_SERVE");
  });

  it("lets service staff create POS orders but keeps production roles out", () => {
    expect(hasStaffPermission("OWNER", "ORDER_CREATE")).toBe(true);
    expect(hasStaffPermission("MANAGER", "ORDER_CREATE")).toBe(true);
    expect(hasStaffPermission("WAITER", "ORDER_CREATE")).toBe(true);
    expect(hasStaffPermission("BAR", "ORDER_CREATE")).toBe(false);
    expect(hasStaffPermission("KITCHEN", "ORDER_CREATE")).toBe(false);
    expect(() => assertStaffPermission("KITCHEN", "ORDER_CREATE")).toThrow(
      StaffPermissionDeniedError,
    );
  });
});
