import { buildApp } from "../../apps/api/src/app.js";
import { prisma } from "@flowgastronomie/database";
import { runWorkforceMonth } from "./engine.js";
async function main() {
  const clock = { now: Date.parse("2031-02-28T07:00Z") };
  const app = buildApp({}, { workforceClock: () => new Date(clock.now) });
  try {
    const r = await runWorkforceMonth(app, clock);
    console.log(
      JSON.stringify({
        status: r.manifest.status,
        counts: r.manifest.counts,
        discrepancies: r.manifest.discrepancies,
      }),
    );
  } finally {
    await app.close();
    await prisma.$disconnect();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
