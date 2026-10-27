import { Prisma } from "@prisma/client";
import {
  PLAN_DEFINITIONS,
  SUBSCRIPTION_PLANS,
  assertStaffPermission,
  isValidBillingCountryCode,
  normalizeBillingCountryCode,
  planChangeIssues,
  type BillingInvoiceStatus,
  type FeatureKey,
  type PlanChangeIssue,
  type SubscriptionPlan,
} from "@flowgastronomie/domain";

import { prisma } from "./client.js";
import type { StaffIdentity } from "./staff-auth-repository.js";

export class BillingWorkspaceNotFoundError extends Error {
  constructor() {
    super("The organization subscription was not found");
    this.name = "BillingWorkspaceNotFoundError";
  }
}

export class BillingProfileInvalidError extends Error {
  constructor() {
    super("The billing profile is invalid");
    this.name = "BillingProfileInvalidError";
  }
}

export class PlanChangeConflictError extends Error {
  constructor(public readonly issues: PlanChangeIssue[]) {
    super("The plan change request cannot be created");
    this.name = "PlanChangeConflictError";
  }
}

export type BillingProfileInput = {
  organizationName: string;
  legalName: string;
  billingEmail: string;
  addressLine1: string;
  postalCode: string;
  city: string;
  countryCode: string;
  vatId: string | null;
};

export type BillingWorkspace = {
  organization: { name: string; slug: string };
  profile: Omit<BillingProfileInput, "organizationName"> | null;
  subscription: {
    plan: SubscriptionPlan;
    status: "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELLED";
    trialEndsAt: Date | null;
    currentPeriodStartedAt: Date | null;
    currentPeriodEndsAt: Date | null;
    features: Array<{
      featureKey: FeatureKey;
      enabled: boolean;
      limit: number | null;
    }>;
    usage: Array<{ usageKey: string; quantity: number; measuredAt: Date }>;
  };
  plans: Array<{
    key: SubscriptionPlan;
    monthlyPriceMinor: number;
    currency: string;
    features: readonly FeatureKey[];
    limits: { venues: number; staffSeats: number; publishedSites: number };
  }>;
  pendingChange: {
    id: string;
    currentPlan: SubscriptionPlan;
    requestedPlan: SubscriptionPlan;
    requestedAt: Date;
  } | null;
  invoices: Array<{
    id: string;
    number: string;
    status: BillingInvoiceStatus;
    amountMinor: number;
    currency: string;
    periodStart: Date;
    periodEnd: Date;
    issuedAt: Date;
    dueAt: Date;
    paidAt: Date | null;
    externalUrl: string | null;
  }>;
};

export type BillingWorkspaceRepository = {
  get(staff: StaffIdentity): Promise<BillingWorkspace>;
  updateProfile(input: {
    staff: StaffIdentity;
    profile: BillingProfileInput;
  }): Promise<BillingWorkspace>;
  requestPlanChange(input: {
    staff: StaffIdentity;
    requestedPlan: SubscriptionPlan;
  }): Promise<BillingWorkspace>;
  cancelPlanChange(input: {
    staff: StaffIdentity;
    requestId: string;
  }): Promise<BillingWorkspace>;
};

const billingInclude = {
  billingProfile: true,
  subscription: {
    include: {
      entitlements: { orderBy: { featureKey: "asc" as const } },
      usageRecords: { orderBy: { usageKey: "asc" as const } },
      invoices: { orderBy: { issuedAt: "desc" as const }, take: 24 },
      planChanges: {
        where: { status: "PENDING" as const },
        orderBy: { requestedAt: "desc" as const },
        take: 1,
      },
    },
  },
};

async function readWorkspace(tenantId: string): Promise<BillingWorkspace> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: billingInclude,
  });
  if (!tenant?.subscription) throw new BillingWorkspaceNotFoundError();
  const subscription = tenant.subscription;
  const pending = subscription.planChanges[0] ?? null;
  return {
    organization: { name: tenant.name, slug: tenant.slug },
    profile: tenant.billingProfile
      ? {
          legalName: tenant.billingProfile.legalName,
          billingEmail: tenant.billingProfile.billingEmail,
          addressLine1: tenant.billingProfile.addressLine1,
          postalCode: tenant.billingProfile.postalCode,
          city: tenant.billingProfile.city,
          countryCode: tenant.billingProfile.countryCode,
          vatId: tenant.billingProfile.vatId,
        }
      : null,
    subscription: {
      plan: subscription.plan,
      status: subscription.status,
      trialEndsAt: subscription.trialEndsAt,
      currentPeriodStartedAt: subscription.currentPeriodStartedAt,
      currentPeriodEndsAt: subscription.currentPeriodEndsAt,
      features: subscription.entitlements.map((item) => ({
        featureKey: item.featureKey as FeatureKey,
        enabled: item.enabled,
        limit: item.limitInt,
      })),
      usage: subscription.usageRecords.map((item) => ({
        usageKey: item.usageKey,
        quantity: item.quantity,
        measuredAt: item.measuredAt,
      })),
    },
    plans: SUBSCRIPTION_PLANS.map((key) => ({
      key,
      monthlyPriceMinor: PLAN_DEFINITIONS[key].monthlyPriceMinor,
      currency: PLAN_DEFINITIONS[key].currency,
      features: PLAN_DEFINITIONS[key].features,
      limits: PLAN_DEFINITIONS[key].limits,
    })),
    pendingChange: pending
      ? {
          id: pending.id,
          currentPlan: pending.currentPlan,
          requestedPlan: pending.requestedPlan,
          requestedAt: pending.requestedAt,
        }
      : null,
    invoices: subscription.invoices.map((invoice) => ({
      id: invoice.id,
      number: invoice.number,
      status: invoice.status,
      amountMinor: invoice.amountMinor,
      currency: invoice.currency,
      periodStart: invoice.periodStart,
      periodEnd: invoice.periodEnd,
      issuedAt: invoice.issuedAt,
      dueAt: invoice.dueAt,
      paidAt: invoice.paidAt,
      externalUrl: invoice.externalUrl,
    })),
  };
}

export const billingWorkspaceRepository: BillingWorkspaceRepository = {
  async get(staff) {
    assertStaffPermission(staff.role, "BILLING_VIEW");
    return readWorkspace(staff.tenantId);
  },

  async updateProfile({ staff, profile }) {
    assertStaffPermission(staff.role, "BILLING_MANAGE");
    const countryCode = normalizeBillingCountryCode(profile.countryCode);
    if (!isValidBillingCountryCode(countryCode)) {
      throw new BillingProfileInvalidError();
    }
    await prisma.$transaction(async (transaction) => {
      const tenant = await transaction.tenant.findUnique({
        where: { id: staff.tenantId },
        select: { id: true },
      });
      if (!tenant) throw new BillingWorkspaceNotFoundError();
      await transaction.tenant.update({
        where: { id: staff.tenantId },
        data: { name: profile.organizationName },
      });
      await transaction.organizationBillingProfile.upsert({
        where: { tenantId: staff.tenantId },
        create: {
          tenantId: staff.tenantId,
          legalName: profile.legalName,
          billingEmail: profile.billingEmail,
          addressLine1: profile.addressLine1,
          postalCode: profile.postalCode,
          city: profile.city,
          countryCode,
          vatId: profile.vatId,
        },
        update: {
          legalName: profile.legalName,
          billingEmail: profile.billingEmail,
          addressLine1: profile.addressLine1,
          postalCode: profile.postalCode,
          city: profile.city,
          countryCode,
          vatId: profile.vatId,
        },
      });
      await transaction.auditEvent.create({
        data: {
          tenantId: staff.tenantId,
          venueId: staff.venueId,
          actorUserId: staff.userId,
          actorMembershipId: staff.membershipId,
          action: "BILLING_PROFILE_UPDATED",
          entityType: "Tenant",
          entityId: staff.tenantId,
          metadata: { countryCode },
        },
      });
    });
    return readWorkspace(staff.tenantId);
  },

  async requestPlanChange({ staff, requestedPlan }) {
    assertStaffPermission(staff.role, "BILLING_MANAGE");
    try {
      await prisma.$transaction(
        async (transaction) => {
          const subscription = await transaction.subscription.findUnique({
            where: { tenantId: staff.tenantId },
            include: {
              planChanges: { where: { status: "PENDING" }, take: 1 },
            },
          });
          if (!subscription) throw new BillingWorkspaceNotFoundError();
          const issues = planChangeIssues({
            currentPlan: subscription.plan,
            requestedPlan,
            hasPendingRequest: subscription.planChanges.length > 0,
          });
          if (issues.length) throw new PlanChangeConflictError(issues);
          const request =
            await transaction.subscriptionPlanChangeRequest.create({
              data: {
                tenantId: staff.tenantId,
                subscriptionId: subscription.id,
                currentPlan: subscription.plan,
                requestedPlan,
                requestedByUserId: staff.userId,
                requestedByMembershipId: staff.membershipId,
              },
            });
          await transaction.auditEvent.create({
            data: {
              tenantId: staff.tenantId,
              venueId: staff.venueId,
              actorUserId: staff.userId,
              actorMembershipId: staff.membershipId,
              action: "SUBSCRIPTION_PLAN_CHANGE_REQUESTED",
              entityType: "SubscriptionPlanChangeRequest",
              entityId: request.id,
              metadata: {
                currentPlan: subscription.plan,
                requestedPlan,
              },
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new PlanChangeConflictError(["REQUEST_ALREADY_PENDING"]);
      }
      throw error;
    }
    return readWorkspace(staff.tenantId);
  },

  async cancelPlanChange({ staff, requestId }) {
    assertStaffPermission(staff.role, "BILLING_MANAGE");
    const cancelled = await prisma.$transaction(async (transaction) => {
      const request = await transaction.subscriptionPlanChangeRequest.findFirst(
        {
          where: {
            id: requestId,
            tenantId: staff.tenantId,
            status: "PENDING",
          },
        },
      );
      if (!request) throw new BillingWorkspaceNotFoundError();
      await transaction.subscriptionPlanChangeRequest.update({
        where: { id: request.id },
        data: { status: "CANCELLED", resolvedAt: new Date() },
      });
      await transaction.auditEvent.create({
        data: {
          tenantId: staff.tenantId,
          venueId: staff.venueId,
          actorUserId: staff.userId,
          actorMembershipId: staff.membershipId,
          action: "SUBSCRIPTION_PLAN_CHANGE_CANCELLED",
          entityType: "SubscriptionPlanChangeRequest",
          entityId: request.id,
          metadata: { requestedPlan: request.requestedPlan },
        },
      });
      return true;
    });
    if (!cancelled) throw new BillingWorkspaceNotFoundError();
    return readWorkspace(staff.tenantId);
  },
};
