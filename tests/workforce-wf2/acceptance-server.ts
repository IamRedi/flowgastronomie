import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";
import {
  workforceDefaultRules,
  type WorkforceAssignment,
} from "@flowgastronomie/domain";
import {
  prisma,
  workforceRepository,
  createWorkforceOperationsRepository,
} from "@flowgastronomie/database";
import { buildApp } from "../../apps/api/src/app.js";
import { workforceFixture } from "../workforce/fixtures.js";
async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    !/^workforce_wf2_browser_\d+$/.test(url.searchParams.get("schema") ?? "") ||
    process.env.WORKFORCE_WF2_BROWSER_GATE !== "true" ||
    process.env.NODE_ENV === "production"
  )
    throw new Error("Isolated WF2 browser fixture required");
  let now = new Date("2030-08-12T07:00:00Z");
  const clock = () => new Date(now),
    app = buildApp({}, { workforceClock: clock }),
    repo = createWorkforceOperationsRepository(clock),
    actors: Record<string, unknown> = {};
  // This route exists only in this guarded, loopback-bound fixture executable.
  // Runtime app routes never accept a clock override.
  app.post("/__fixture/workforce-wf2/clock", async (request) => {
    const input = z
      .object({ now: z.string().datetime() })
      .strict()
      .parse(request.body);
    now = new Date(input.now);
    return { now: now.toISOString() };
  });
  for (const locale of ["en", "de", "it", "sq"] as const) {
    const country = locale === "sq" ? "AL" : "DE",
      fixture = await workforceFixture(
        app,
        country,
        "127.0.0." + { en: 21, de: 22, it: 23, sq: 24 }[locale],
      ),
      manager = await fixture.addEmployee("Operations Manager", "MANAGER"),
      worker = await fixture.addEmployee("Crew A"),
      peer = await fixture.addEmployee("Crew B"),
      bar = await fixture.addEmployee("Crew C", "BAR");
    for (const m of [worker, peer, bar]) {
      await workforceRepository.saveProfile(fixture.owner, m.membershipId, {
        expectedVersion: 0,
        stations: m.role === "BAR" ? ["BAR"] : ["KITCHEN"],
        skills: ["Food safety"],
        annualLeaveDays: 24,
      });
      await workforceRepository.addContract(fixture.owner, m.membershipId, {
        expectedVersion: 1,
        effectiveFrom: "2026-01-01",
        employmentType: "FULL_TIME",
        weeklyTargetMinutes: 2400,
        monthlyTargetMinutes: null,
        countryCode: country,
        terms: "Synthetic private contract",
      });
    }
    await repo.configure(fixture.owner, {
      expectedVersion: 0,
      effectiveFrom: "2030-01-01",
      countryCode: country,
      rules: workforceDefaultRules(country),
      reason: "Synthetic explicit workforce baseline",
    });
    await repo.grant(fixture.owner, {
      membershipId: worker.membershipId,
      year: 2030,
      minutes: 4800,
      expectedVersion: 0,
      reason: "Explicit synthetic allowance, no assumed accrual or carry",
      idempotencyKey: randomUUID(),
    });
    const row = (
      membershipId: string | null,
      day: string,
    ): WorkforceAssignment => ({
      id: randomUUID(),
      membershipId,
      station: "KITCHEN",
      startsLocal: day + "T09:00",
      endsLocal: day + "T17:00",
      startChoice: "reject",
      endChoice: "reject",
      breakMinutes: 30,
      requiredSkills: ["Food safety"],
      note: "",
    });
    const assignments = [
      row(worker.membershipId, "2030-08-12"),
      row(worker.membershipId, "2030-08-15"),
      row(peer.membershipId, "2030-08-16"),
      row(null, "2030-08-14"),
    ];
    await workforceRepository.saveSchedule(manager, {
      week: "2030-08-12",
      expectedVersion: 0,
      status: "PUBLISHED",
      reviewConfirmed: true,
      assignments,
    });
    await workforceRepository.saveSchedule(manager, {
      week: "2030-08-19",
      expectedVersion: 0,
      status: "PUBLISHED",
      reviewConfirmed: true,
      assignments: [row(worker.membershipId, "2030-08-20")],
    });
    const active = await app.inject({
      method: "POST",
      url: "/v1/staff/workforce/attendance/punch",
      headers: { cookie: bar.cookie },
      payload: {
        kind: "CLOCK_IN",
        expectedVersion: 0,
        idempotencyKey: randomUUID(),
      },
    });
    if (active.statusCode !== 200)
      throw new Error("Synthetic active attendance setup failed");
    const sanitize = (actor: typeof worker) => {
      const { cookie, ...safe } = actor;
      return safe;
    };
    actors[locale] = {
      owner: sanitize(fixture.owner),
      manager: sanitize(manager),
      worker: sanitize(worker),
      peer: sanitize(peer),
      bar: sanitize(bar),
      shiftIds: assignments.map((a) => a.id),
    };
  }
  await mkdir("artifacts/workforce-wf2", { recursive: true });
  await writeFile(
    "artifacts/workforce-wf2/actors.json",
    JSON.stringify(actors),
  );
  await app.listen({ host: "127.0.0.1", port: 4404 });
  const stop = async () => {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
}
main().catch((e) => {
  console.error(
    "WF2 synthetic fixture failed",
    e instanceof Error ? e.message : "unknown",
  );
  process.exitCode = 1;
});
