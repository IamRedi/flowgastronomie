import { prisma } from "./client.js";

export type DatabaseReadinessProbe = {
  check(): Promise<void>;
};

export function createDatabaseReadinessProbe(
  query: () => PromiseLike<unknown> = () =>
    prisma.$queryRaw`SELECT 1 AS "ready"`,
): DatabaseReadinessProbe {
  return {
    async check() {
      await query();
    },
  };
}

export const databaseReadinessProbe = createDatabaseReadinessProbe();
