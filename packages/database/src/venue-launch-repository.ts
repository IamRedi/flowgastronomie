import {
  LAUNCH_CHECKS,
  assertStaffPermission,
  incompleteLaunchChecks,
  type LaunchCheck,
  type StaffRole,
} from "@flowgastronomie/domain";

import { prisma } from "./client.js";
import { checkOperationalRetention } from "./operational-retention.js";
import type { StaffIdentity } from "./staff-auth-repository.js";

export class VenueLaunchNotFoundError extends Error {
  constructor() {
    super("The venue launch workspace was not found");
    this.name = "VenueLaunchNotFoundError";
  }
}

export class VenueLaunchBlockedError extends Error {
  constructor(public readonly issues: LaunchCheck[]) {
    super("The venue is not ready to launch");
    this.name = "VenueLaunchBlockedError";
  }
}

export type VenueLaunchWorkspace = {
  venue: { name: string; slug: string };
  actorRole: StaffRole;
  checks: Array<{
    key: LaunchCheck;
    required: boolean;
    complete: boolean;
  }>;
  progress: { completed: number; total: number; percent: number };
  rehearsalConfirmedAt: Date | null;
  launchedAt: Date | null;
  canLaunch: boolean;
};

export type VenueLaunchRepository = {
  get(staff: StaffIdentity): Promise<VenueLaunchWorkspace>;
  confirmRehearsal(staff: StaffIdentity): Promise<VenueLaunchWorkspace>;
  launch(staff: StaffIdentity): Promise<VenueLaunchWorkspace>;
};

async function readWorkspace(
  staff: StaffIdentity,
): Promise<VenueLaunchWorkspace> {
  const [
    tenant,
    venue,
    website,
    publishedCategories,
    publishedProducts,
    qrTables,
    members,
    launch,
    retention,
  ] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: staff.tenantId },
      include: {
        billingProfile: true,
        subscription: { include: { entitlements: true } },
      },
    }),
    prisma.venue.findFirst({
      where: { id: staff.venueId, tenantId: staff.tenantId },
      select: { name: true, slug: true },
    }),
    prisma.venueWebsite.findFirst({
      where: { tenantId: staff.tenantId, venueId: staff.venueId },
      select: { status: true },
    }),
    prisma.menuCategory.count({
      where: {
        tenantId: staff.tenantId,
        venueId: staff.venueId,
        published: true,
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
    prisma.membership.count({
      where: { tenantId: staff.tenantId, venueId: staff.venueId, active: true },
    }),
    prisma.venueLaunch.findFirst({
      where: { tenantId: staff.tenantId, venueId: staff.venueId },
    }),
    checkOperationalRetention(),
  ]);
  if (!tenant?.subscription || !venue) throw new VenueLaunchNotFoundError();
  const subscription = tenant.subscription;
  const enabled = new Set(
    subscription.entitlements
      .filter((item) => item.enabled)
      .map((item) => item.featureKey),
  );
  const subscriptionActive =
    subscription.status === "ACTIVE" ||
    (subscription.status === "TRIALING" &&
      subscription.trialEndsAt !== null &&
      subscription.trialEndsAt > new Date());
  const tableManagementEnabled = enabled.has("TABLE_MANAGEMENT");
  const staffShiftsEnabled = enabled.has("STAFF_SHIFTS");
  const serviceRadarEnabled = enabled.has("SERVICE_RADAR");
  const operationalRetentionEnabled = enabled.has("OPERATIONAL_RETENTION");
  const input = {
    subscriptionActive,
    organizationProfileComplete: tenant.billingProfile !== null,
    websitePublished: website?.status === "PUBLISHED",
    menuPublished: publishedCategories > 0 && publishedProducts > 0,
    tableManagementEnabled,
    tableQrReady: qrTables > 0,
    staffShiftsEnabled,
    teamReady: members > 1,
    serviceRadarEnabled,
    serviceRehearsalComplete:
      launch?.rehearsalConfirmedAt !== null &&
      launch?.rehearsalConfirmedAt !== undefined,
    operationalRetentionEnabled,
    retentionHealthy: retention.healthy,
  };
  const incomplete = new Set(incompleteLaunchChecks(input));
  const required = new Set<LaunchCheck>([
    "SUBSCRIPTION_ACTIVE",
    "ORGANIZATION_PROFILE",
    "WEBSITE_PUBLISHED",
    "MENU_PUBLISHED",
    ...(tableManagementEnabled ? (["TABLE_QR_READY"] as const) : []),
    ...(staffShiftsEnabled ? (["TEAM_READY"] as const) : []),
    ...(serviceRadarEnabled ? (["SERVICE_REHEARSAL"] as const) : []),
    ...(operationalRetentionEnabled ? (["RETENTION_HEALTH"] as const) : []),
  ]);
  const checks = LAUNCH_CHECKS.map((key) => ({
    key,
    required: required.has(key),
    complete: !required.has(key) || !incomplete.has(key),
  }));
  const requiredChecks = checks.filter((check) => check.required);
  const completed = requiredChecks.filter((check) => check.complete).length;
  return {
    venue,
    actorRole: staff.role,
    checks,
    progress: {
      completed,
      total: requiredChecks.length,
      percent: Math.round((completed / requiredChecks.length) * 100),
    },
    rehearsalConfirmedAt: launch?.rehearsalConfirmedAt ?? null,
    launchedAt: launch?.launchedAt ?? null,
    canLaunch: incomplete.size === 0,
  };
}

export const venueLaunchRepository: VenueLaunchRepository = {
  async get(staff) {
    assertStaffPermission(staff.role, "LAUNCH_VIEW");
    return readWorkspace(staff);
  },

  async confirmRehearsal(staff) {
    assertStaffPermission(staff.role, "LAUNCH_REHEARSAL");
    const saved = await prisma.$transaction(async (transaction) => {
      const venue = await transaction.venue.findFirst({
        where: { id: staff.venueId, tenantId: staff.tenantId },
        select: { id: true },
      });
      if (!venue) throw new VenueLaunchNotFoundError();
      const launch = await transaction.venueLaunch.upsert({
        where: { venueId: staff.venueId },
        create: {
          tenantId: staff.tenantId,
          venueId: staff.venueId,
          rehearsalConfirmedAt: new Date(),
          rehearsalByUserId: staff.userId,
        },
        update: {
          rehearsalConfirmedAt: new Date(),
          rehearsalByUserId: staff.userId,
        },
      });
      await transaction.auditEvent.create({
        data: {
          tenantId: staff.tenantId,
          venueId: staff.venueId,
          actorUserId: staff.userId,
          actorMembershipId: staff.membershipId,
          action: "SERVICE_REHEARSAL_CONFIRMED",
          entityType: "VenueLaunch",
          entityId: launch.id,
          metadata: {},
        },
      });
      return launch;
    });
    if (!saved) throw new VenueLaunchNotFoundError();
    return readWorkspace(staff);
  },

  async launch(staff) {
    assertStaffPermission(staff.role, "LAUNCH_ACTIVATE");
    const current = await readWorkspace(staff);
    const issues = current.checks
      .filter((check) => check.required && !check.complete)
      .map((check) => check.key);
    if (issues.length) throw new VenueLaunchBlockedError(issues);
    await prisma.$transaction(async (transaction) => {
      const launch = await transaction.venueLaunch.upsert({
        where: { venueId: staff.venueId },
        create: {
          tenantId: staff.tenantId,
          venueId: staff.venueId,
          launchedAt: new Date(),
          launchedByUserId: staff.userId,
        },
        update: {
          launchedAt: new Date(),
          launchedByUserId: staff.userId,
        },
      });
      await transaction.auditEvent.create({
        data: {
          tenantId: staff.tenantId,
          venueId: staff.venueId,
          actorUserId: staff.userId,
          actorMembershipId: staff.membershipId,
          action: "VENUE_LAUNCHED",
          entityType: "VenueLaunch",
          entityId: launch.id,
          metadata: { checks: current.progress.total },
        },
      });
    });
    return readWorkspace(staff);
  },
};
