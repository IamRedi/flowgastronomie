import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  flowGastronomiePrisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.flowGastronomiePrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.flowGastronomiePrisma = prisma;
}
