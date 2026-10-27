import type {
  WorkforceAssignment,
  WorkforceInstantAssignment,
  WorkforceSnapshot,
} from "@flowgastronomie/domain";
export type Profile = {
  membershipId: string;
  userId: string;
  displayName: string;
  workEmail: string;
  role: string;
  active: boolean;
  profileId: string | null;
  version: number;
  workPhone: string | null;
  employeeRef: string | null;
  jobTitle: string;
  employmentStartedOn: string | null;
  employmentEndedOn: string | null;
  employmentStatus: string;
  stations: string[];
  skills: string[];
  recurringAvailability: {
    day: number;
    startMinute: number;
    endMinute: number;
  }[];
  annualLeaveDays: number | null;
  targetWeeklyMinutes: number | null;
  targetMonthlyMinutes: number | null;
  canManageHR: boolean;
  history?: {
    id: string;
    version: number;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    createdAt: string;
  }[];
  contracts?: {
    id: string;
    version: number;
    effectiveFrom: string;
    employmentType: string;
    weeklyTargetMinutes: number;
    monthlyTargetMinutes: number | null;
    countryCode: string;
    terms: string;
  }[];
  documents?: {
    id: string;
    title: string;
    kind: string;
    expiresOn: string | null;
    filename: string;
    byteLength: number;
  }[];
};
export type Schedule = {
  id: string;
  week: string;
  version: number;
  status: "DRAFT" | "PUBLISHED";
  publishedVersion: number | null;
  publishedAt: string | null;
  snapshot: WorkforceSnapshot;
};
export type Workspace = {
  viewer: {
    membershipId: string;
    userId: string;
    role: string;
    canManage: boolean;
  };
  venue: {
    id: string;
    name: string;
    timezone: string;
    countryCode: string | null;
    stations: string[];
    configVersion: number;
  };
  today: string;
  todayAssignments: WorkforceInstantAssignment[];
  nextShift:
    | (WorkforceInstantAssignment & { timezone: string; venueName: string })
    | null;
  profiles: Profile[];
  schedules: Schedule[];
  availability: {
    id: string;
    membershipId: string;
    startsAt: string;
    endsAt: string;
    note: string;
  }[];
  warnings: { assignmentId: string; code: string }[];
  history: {
    id: string;
    scheduleId: string;
    version: number;
    status: string;
    changes: { id: string; kind: string }[];
    createdAt: string;
    createdByUserId: string;
  }[];
  templates: {
    id: string;
    name: string;
    station: string;
    startMinute: number;
    durationMinutes: number;
    breakMinutes: number;
    requiredSkills: string[];
  }[];
};
export function assignmentInput(
  a: WorkforceInstantAssignment,
): WorkforceAssignment {
  const { userId, role, displayName, startsAt, endsAt, ...input } = a;
  return input;
}
