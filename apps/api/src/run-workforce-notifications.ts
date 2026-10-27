import { setTimeout } from "node:timers/promises";
import {
  prisma,
  enqueueDueWorkforceReminders,
} from "@flowgastronomie/database";
import { createWorkforceNotificationWorker } from "./workforce-notification-worker.js";
if (process.env.WORKFORCE_NOTIFICATION_WORKER_ENABLED !== "true")
  throw new Error(
    "Workforce worker requires explicit operator configuration; it is disabled by default.",
  );
const worker = createWorkforceNotificationWorker(),
  once = process.argv.includes("--once");
let stopped = false;
process.on("SIGINT", () => {
  stopped = true;
});
process.on("SIGTERM", () => {
  stopped = true;
});
try {
  do {
    await enqueueDueWorkforceReminders();
    const result = await worker.runOnce(100);
    process.stdout.write(
      JSON.stringify({
        event: "workforce_outbox_batch",
        processed: result.processed,
        states: result.results.map((r) => r.state),
      }) + "\n",
    );
    if (!once && !stopped) await setTimeout(10000);
  } while (!once && !stopped);
} finally {
  await prisma.$disconnect();
}
