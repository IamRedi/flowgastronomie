import type {
  AttendanceSnapshot,
  AttendanceEvidence,
  WorkforcePolicyVersion,
  WorkforcePolicyRules,
  LeaveSlice,
} from "@flowgastronomie/domain";
export type AttendanceRow = {
  id: string;
  userId: string;
  membershipId: string;
  venueId: string;
  timezone: string;
  state: string;
  version: number;
  startedAt: string;
  contractRevisionId: string | null;
  policyRevisionId: string;
  publishedAssignmentRevisionId: string | null;
  original: AttendanceSnapshot | null;
  actual: AttendanceSnapshot | null;
  totals: TimeTotals | null;
  events: (AttendanceEvidence & { recordedAt: string; actorUserId: string })[];
  approved: {
    id: string;
    attendanceVersion: number;
    snapshot: AttendanceSnapshot;
    totals: TimeTotals;
    sourceEventIds: string[];
    actorUserId: string;
    createdAt: string;
    reason: string;
  } | null;
  approvalHistory: {
    id: string;
    attendanceVersion: number;
    snapshot: AttendanceSnapshot;
    totals: TimeTotals;
    actorUserId: string;
    createdAt: string;
    reason: string;
  }[];
};
export type TimeTotals = {
  presenceMinutes: number;
  breakMinutes: number;
  workedMinutes: number;
  paidBreakMinutes: number;
  unpaidBreakMinutes: number;
};
export type RequestRow = {
  allowedActions: import("@flowgastronomie/domain").WorkforceRequestAction[];
  affectedShifts?: {
    assignmentId: string;
    userId: string | null;
    startsLocal: string;
    endsLocal: string;
    station: string;
  }[];
  policyRevisionId: string;
  id: string;
  userId: string;
  membershipId: string;
  kind: string;
  status: string;
  version: number;
  invitedUserId: string | null;
  startsAt: string;
  endsAt: string;
  payload: {
    category?: string;
    from?: string;
    to?: string;
    slices?: LeaveSlice[];
    snapshot?: AttendanceSnapshot;
    attendanceId?: string | null;
    attendanceVersion?: number;
    exceptionReason?: string;
    assignmentId?: string;
    otherAssignmentId?: string;
    targetMembershipId?: string | null;
  };
  transitions: {
    id: string;
    version: number;
    action: string;
    fromStatus: string | null;
    toStatus: string;
    actorUserId: string;
    reason: string;
    createdAt: string;
  }[];
};
export type LeaveBalance = {
  year: number;
  configured: boolean;
  version: number;
  allowanceMinutes: number | null;
  usedMinutes: number;
  pendingMinutes: number;
  remainingMinutes: number | null;
  membershipId?: string;
  userId?: string;
  history: {
    id: string;
    version: number;
    minutes: number;
    reason: string;
    createdAt: string;
  }[];
};
export type ShiftChoice = {
  assignmentId: string;
  publicationRevisionId: string;
  membershipId: string | null;
  userId: string | null;
  station: string;
  startsAt: string;
  endsAt: string;
  startsLocal: string;
  endsLocal: string;
  breakMinutes: number;
};
export type OperationsData = {
  operationalSession: { id: string; startedAt: string } | null;
  serverNow: string;
  today: string;
  viewer: {
    userId: string;
    membershipId: string;
    role: string;
    canManage: boolean;
    canConfigure: boolean;
  };
  venue: { id: string; name: string; timezone: string; countryCode: string };
  policy: WorkforcePolicyVersion | null;
  policyVersions: WorkforcePolicyVersion[];
  rules: WorkforcePolicyRules;
  attendance: AttendanceRow[];
  current: AttendanceRow | null;
  activeElsewhere: { id: string; venueId: string; state: string } | null;
  requests: RequestRow[];
  roster: {
    membershipId: string;
    userId: string;
    displayName: string;
    role: string;
    active: boolean;
  }[];
  shifts: ShiftChoice[];
  nextShift: { startsLocal: string; endsLocal: string; station: string } | null;
  balance: LeaveBalance;
  balances: LeaveBalance[];
  warnings: { attendanceId: string; codes: string[] }[];
  absent: {
    assignmentId: string;
    userId: string;
    membershipId: string;
    startsAt: string;
    endsAt: string;
    status: string;
  }[];
  truncated: boolean;
};
export type OperationsCommand = (
  path: string,
  body: unknown,
) => Promise<boolean>;
