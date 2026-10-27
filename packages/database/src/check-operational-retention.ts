import { prisma } from "./client.js";
import { checkOperationalRetention } from "./operational-retention.js";

try {
  const result = await checkOperationalRetention();
  console.info(
    JSON.stringify({ event: "operational_retention_health", ...result }),
  );
  if (!result.healthy) process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
