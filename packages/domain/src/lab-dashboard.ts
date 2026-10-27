import type { LabRuntimeConfig, LabControlMode } from "./lab-runtime";
export type LabJournalRow = {
  seq: string;
  kind: string;
  messages: Record<string, string>;
  facts: Record<string, unknown>;
  at: string;
};
export type LabVenueDashboard = {
  profile: "DE" | "AL";
  name: string;
  currency: string;
  timezone: string;
  date: string;
  mode: LabControlMode;
  version: number;
  config: LabRuntimeConfig;
  runId: string | null;
  runDate: string | null;
  startedAt: string | null;
  heartbeat: string | null;
  checkpoint: string | null;
  incident: string | null;
  counts: {
    received: number;
    accepted: number;
    cancelled: number;
    completed: number;
    pendingOnline: number;
    own: number;
    planned: number;
    missed: number;
    activeTickets: number;
    inFlight: number;
    finalizedReceipts: number;
    archivedPdfs: number;
  };
  money: { cash: number; card: number };
  staff: Array<{ name: string; startedAt: string }>;
  receipts: Array<{
    id: string;
    number: string;
    grossMinor: number;
    method: string;
    pdf: boolean;
  }>;
  printer: Array<{
    id: string;
    status: string;
    error: string | null;
    receiptId: string;
    attempts: number;
  }>;
  next: string | null;
  reviews: Array<{ id: string; provenance: string; code: string | null }>;
  report: {
    discrepancies: string[];
    counts: Record<string, number>;
    missed: number;
    completedBrowser: number;
    coverageIncomplete?: boolean;
  } | null;
  journal: LabJournalRow[];
  week: Array<{
    date: string;
    events: number;
    closed: number;
    incidents: number;
  }>;
};
export type LabDashboardSnapshot = {
  version: 1;
  now: string;
  venues: LabVenueDashboard[];
  storage: {
    files: number;
    bytes: number;
    freeBytes: number;
    warning: boolean;
    full: boolean;
  };
};
