export type LabContinuityHealth = {
  version: 1;
  monitor: null | {
    observedAt: string;
    revision: string;
    api: boolean;
    web: boolean;
    database: boolean;
    processes: Array<{
      name: string;
      pid: number;
      status: string;
      restarts: number;
      lastExitCode: number | null;
    }>;
    lastBackup: null | {
      createdAt: string;
      manifest: string;
      databaseHash: string;
    };
  };
  entitlements: Array<{
    profile: string;
    optedIn: boolean;
    status: string;
    validUntil: string | null;
    lastRenewedAt: string | null;
  }>;
};
