import type { DatabaseReadinessProbe } from "@flowgastronomie/database";

export const DEFAULT_READINESS_TIMEOUT_MS = 2_000;

export class ReadinessConfigurationError extends Error {}

class ReadinessTimeoutError extends Error {}

export function readinessTimeoutFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const configured = environment.READINESS_TIMEOUT_MS?.trim();
  if (!configured) return DEFAULT_READINESS_TIMEOUT_MS;

  const timeoutMs = Number(configured);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
    throw new ReadinessConfigurationError(
      "READINESS_TIMEOUT_MS must be an integer between 100 and 30000",
    );
  }
  return timeoutMs;
}

function withTimeout(promise: Promise<void>, timeoutMs: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () => reject(new ReadinessTimeoutError("Readiness check timed out")),
      timeoutMs,
    );
    timeout.unref();
  });

  return Promise.race([promise, deadline]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

export function createBoundedDatabaseReadinessProbe(
  probe: DatabaseReadinessProbe,
  timeoutMs = DEFAULT_READINESS_TIMEOUT_MS,
): DatabaseReadinessProbe {
  let activeCheck: Promise<void> | undefined;

  return {
    async check() {
      if (!activeCheck) {
        activeCheck = Promise.resolve().then(() => probe.check());
        void activeCheck.then(
          () => {
            activeCheck = undefined;
          },
          () => {
            activeCheck = undefined;
          },
        );
      }
      await withTimeout(activeCheck, timeoutMs);
    },
  };
}
