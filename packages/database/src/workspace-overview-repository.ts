import {
  assertStaffPermission,
  type ServiceMode,
  type StaffRole,
  type SubscriptionPlan,
} from "@flowgastronomie/domain";

import { prisma } from "./client.js";

type WorkspaceActor = {
  tenantId: string;
  venueId: string;
  role: StaffRole;
};

export class WorkspaceOverviewNotFoundError extends Error {
  constructor() {
    super("The business workspace was not found");
    this.name = "WorkspaceOverviewNotFoundError";
  }
}

export type WorkspaceOverview = {
  organization: { id: string; name: string; slug: string };
  venue: {
    id: string;
    name: string;
    slug: string;
    timezone: string;
    currency: string;
    defaultServiceMode: ServiceMode;
  };
  subscription: {
    plan: SubscriptionPlan;
    status: "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELLED";
    trialEndsAt: Date | null;
    enabledFeatures: number;
    features: string[];
    staffSeatLimit: number | null;
  } | null;
  launch: {
    completed: number;
    total: number;
    steps: {
      account: boolean;
      venue: boolean;
      menu: boolean;
      area: boolean;
      tableQr: boolean;
      team: boolean;
    };
  };
  content: {
    categories: number;
    products: number;
    publishedProducts: number;
    areas: number;
    tables: number;
    activeQrTables: number;
    teamMembers: number;
  };
  live: {
    openTableSessions: number;
    actionableSignals: number;
    activeOrders: number;
    activeShifts: number;
  };
};

export type WorkspaceOverviewRepository = {
  get(staff: WorkspaceActor): Promise<WorkspaceOverview>;
};

export const workspaceOverviewRepository: WorkspaceOverviewRepository = {
  async get(staff) {
    assertStaffPermission(staff.role, "WORKSPACE_OVERVIEW_VIEW");

    const [tenant, venue, publishedProducts, activeQrTables, live] =
      await Promise.all([
        prisma.tenant.findFirst({
          where: { id: staff.tenantId },
          select: {
            id: true,
            name: true,
            slug: true,
            subscription: {
              include: { entitlements: true },
            },
          },
        }),
        prisma.venue.findFirst({
          where: { id: staff.venueId, tenantId: staff.tenantId },
          select: {
            id: true,
            name: true,
            slug: true,
            timezone: true,
            currency: true,
            defaultServiceMode: true,
            _count: {
              select: {
                areas: true,
                tables: true,
                categories: true,
                products: true,
                memberships: { where: { active: true } },
              },
            },
          },
        }),
        prisma.product.count({
          where: {
            tenantId: staff.tenantId,
            venueId: staff.venueId,
            published: true,
          },
        }),
        prisma.diningTable.count({
          where: {
            tenantId: staff.tenantId,
            venueId: staff.venueId,
            qrRevokedAt: null,
            qrTokenHash: { not: "" },
          },
        }),
        Promise.all([
          prisma.tableSession.count({
            where: {
              tenantId: staff.tenantId,
              venueId: staff.venueId,
              status: "OPEN",
            },
          }),
          prisma.serviceSignal.count({
            where: {
              tenantId: staff.tenantId,
              venueId: staff.venueId,
              acknowledgedAt: null,
            },
          }),
          prisma.order.count({
            where: {
              tenantId: staff.tenantId,
              venueId: staff.venueId,
              status: { notIn: ["SERVED", "CANCELLED"] },
            },
          }),
          prisma.staffShift.count({
            where: {
              tenantId: staff.tenantId,
              venueId: staff.venueId,
              status: "OPEN",
            },
          }),
        ]),
      ]);

    if (!tenant || !venue) throw new WorkspaceOverviewNotFoundError();

    const steps = {
      account: true,
      venue: true,
      menu: publishedProducts > 0,
      area: venue._count.areas > 0,
      tableQr: activeQrTables > 0,
      team: venue._count.memberships > 1,
    };
    const completed = Object.values(steps).filter(Boolean).length;
    const staffSeatEntitlement = tenant.subscription?.entitlements.find(
      (entitlement) => entitlement.featureKey === "STAFF_SHIFTS",
    );

    return {
      organization: { id: tenant.id, name: tenant.name, slug: tenant.slug },
      venue: {
        id: venue.id,
        name: venue.name,
        slug: venue.slug,
        timezone: venue.timezone,
        currency: venue.currency,
        defaultServiceMode: venue.defaultServiceMode,
      },
      subscription: tenant.subscription
        ? {
            plan: tenant.subscription.plan,
            status: tenant.subscription.status,
            trialEndsAt: tenant.subscription.trialEndsAt,
            enabledFeatures: tenant.subscription.entitlements.filter(
              (entitlement) => entitlement.enabled,
            ).length,
            features: tenant.subscription.entitlements
              .filter((entitlement) => entitlement.enabled)
              .map((entitlement) => entitlement.featureKey),
            staffSeatLimit: staffSeatEntitlement?.limitInt ?? null,
          }
        : null,
      launch: { completed, total: Object.keys(steps).length, steps },
      content: {
        categories: venue._count.categories,
        products: venue._count.products,
        publishedProducts,
        areas: venue._count.areas,
        tables: venue._count.tables,
        activeQrTables,
        teamMembers: venue._count.memberships,
      },
      live: {
        openTableSessions: live[0],
        actionableSignals: live[1],
        activeOrders: live[2],
        activeShifts: live[3],
      },
    };
  },
};
