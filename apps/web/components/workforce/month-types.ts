import type {
  WorkforceMonthlyAccount,
  WorkforceAccountPolicy,
  WorkforceNotificationCategory,
} from "@flowgastronomie/domain";
export type MonthData = {
  schemaVersion: 1;
  tenantId: string;
  venueId: string;
  venueName: string;
  employee: {
    userId: string;
    membershipId: string;
    profileId: string;
    displayName: string;
    employeeRef: string | null;
    active: boolean;
  };
  account: WorkforceMonthlyAccount;
  fingerprint: string;
  closing: {
    id: string;
    version: number;
    closedAt: string;
    actorUserId: string;
    reason: string;
    retentionUntil: string;
    auditEventId: string;
    sourceHash: string;
    identity: {
      displayName: string;
      employeeRef: string | null;
      venueName: string;
    };
    original: WorkforceMonthlyAccount;
  } | null;
  adjustments: {
    id: string;
    version: number;
    sourceHash: string;
    delta: Partial<WorkforceMonthlyAccount["totals"]>;
    actorUserId: string;
    reason: string;
    createdAt: string;
    auditEventId: string;
  }[];
  canClose: boolean;
};
export type MonthStatistics = {
  month: string;
  totals: Pick<
    WorkforceMonthlyAccount["totals"],
    "plannedMs" | "actualMs" | "approvedMs" | "creditedMs"
  >;
  team: {
    employee: MonthData["employee"];
    totals: WorkforceMonthlyAccount["totals"];
    pendingApprovals: number;
    pendingRequests: number;
    warningCodes: string[];
    closed: boolean;
    adjustments: number;
    leaveMinutes: number;
    deviationMs: number | null;
  }[];
  stations: {
    station: string;
    publishedShifts: number;
    openShifts: number;
    assignedShifts: number;
    publishedPresenceMs: number;
    assignedPresenceMs: number;
    actualMs: number;
    coverageFraction: number | null;
  }[];
  unallocatedActualMs: number;
  trends: {
    month: string;
    actualMs: number;
    approvedMs: number;
    creditedMs: number | null;
  }[];
  laborToSales?: { status: "NOT_CONFIGURED"; reason: string };
};
export type AccountPolicies = {
  canConfigure: boolean;
  versions: (Omit<WorkforceAccountPolicy, "createdByUserId"> & {
    createdByUserId: string | null;
  })[];
};
export type NotificationPreferences = {
  version: number;
  locale: "sq" | "de" | "en" | "it";
  emailEnabled: boolean;
  pushEnabled: boolean;
  reminderMinutes: number;
  categories: WorkforceNotificationCategory[];
};
export type InboxData = {
  schemaVersion: 1;
  unreadCount: number;
  nextCursor: string | null;
  preferences: NotificationPreferences;
  items: {
    id: string;
    category: WorkforceNotificationCategory;
    important: boolean;
    createdAt: string;
    readAt: string | null;
    acknowledgedAt: string | null;
    title: string;
    body: string;
    action: string;
    href: string;
    delivery: {
      channel: string;
      state: string;
      attempts: number;
      code: string | null;
      deliveredAt: string | null;
    }[];
  }[];
};
