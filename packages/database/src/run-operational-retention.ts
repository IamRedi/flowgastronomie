import { prisma } from "./client.js";
import { runOperationalRetention } from "./operational-retention.js";

try {
  const summary = await runOperationalRetention();
  console.info(
    JSON.stringify({ event: "operational_retention_completed", summary }),
  );
} finally {
  await prisma.$disconnect();
}
