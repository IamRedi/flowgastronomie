import type { SubscriptionPlan } from "./subscription";

export const BILLING_INVOICE_STATUSES = ["OPEN", "PAID", "VOID"] as const;
export type BillingInvoiceStatus = (typeof BILLING_INVOICE_STATUSES)[number];

export const PLAN_CHANGE_STATUSES = [
  "PENDING",
  "APPLIED",
  "CANCELLED",
] as const;
export type PlanChangeStatus = (typeof PLAN_CHANGE_STATUSES)[number];

export type PlanChangeIssue = "SAME_PLAN" | "REQUEST_ALREADY_PENDING";

export function planChangeIssues(input: {
  currentPlan: SubscriptionPlan;
  requestedPlan: SubscriptionPlan;
  hasPendingRequest: boolean;
}): PlanChangeIssue[] {
  const issues: PlanChangeIssue[] = [];
  if (input.currentPlan === input.requestedPlan) issues.push("SAME_PLAN");
  if (input.hasPendingRequest) issues.push("REQUEST_ALREADY_PENDING");
  return issues;
}

export function isValidBillingCountryCode(value: string): boolean {
  return /^[A-Z]{2}$/.test(value);
}

export function normalizeBillingCountryCode(value: string): string {
  return value.trim().toUpperCase();
}
