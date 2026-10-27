import { assertStaffPermission, type StaffRole } from "@flowgastronomie/domain";

import { prisma } from "./client.js";
import { checkOperationalRetention } from "./operational-retention.js";

type OwnerDiagnosticsActor = {
  tenantId: string;
  venueId: string;
  role: StaffRole;
};

export type OwnerDiagnostics = {
  configuration: {
    websitePublished: boolean;
    publishedProducts: number;
    activeTableQrs: number;
    activeTeamMembers: number;
  };
  entitlements: Array<{ feature: string; enabled: boolean }>;
  delivery: { activeZones: number; totalZones: number };
  retention: { healthy: boolean; lastCompletedAt: Date | null };
};

export type OwnerDiagnosticsRepository = {
  get(staff: OwnerDiagnosticsActor): Promise<OwnerDiagnostics>;
};

export const ownerDiagnosticsRepository: OwnerDiagnosticsRepository = {
  async get(staff) {
    // Billing access is intentionally Owner-only and keeps diagnostics out of
    // operational staff and Manager workspaces.
    assertStaffPermission(staff.role, "BILLING_VIEW");
    const [
      website,
      publishedProducts,
      activeTableQrs,
      activeTeamMembers,
      zones,
      tenant,
      retention,
    ] = await Promise.all([
      prisma.venueWebsite.findFirst({
        where: { tenantId: staff.tenantId, venueId: staff.venueId },
        select: { status: true },
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
      prisma.membership.count({
        where: {
          tenantId: staff.tenantId,
          venueId: staff.venueId,
          active: true,
        },
      }),
      prisma.deliveryZone.groupBy({
        by: ["active"],
        where: { tenantId: staff.tenantId, venueId: staff.venueId },
        _count: { _all: true },
      }),
      prisma.tenant.findFirst({
        where: { id: staff.tenantId },
        select: { subscription: { include: { entitlements: true } } },
      }),
      checkOperationalRetention(),
    ]);
    const activeZones = zones.find((zone) => zone.active)?._count._all ?? 0;
    return {
      configuration: {
        websitePublished: website?.status === "PUBLISHED",
        publishedProducts,
        activeTableQrs,
        activeTeamMembers,
      },
      entitlements:
        tenant?.subscription?.entitlements.map((entitlement) => ({
          feature: entitlement.featureKey,
          enabled: entitlement.enabled,
        })) ?? [],
      delivery: {
        activeZones,
        totalZones: zones.reduce((total, zone) => total + zone._count._all, 0),
      },
      retention,
    };
  },
};
