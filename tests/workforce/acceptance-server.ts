import {
  workforceMove,
  workforceAddDays,
  workforceAssignmentSchema,
} from "@flowgastronomie/domain";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { buildApp } from "../../apps/api/src/app.js";
import { prisma, workforceRepository } from "@flowgastronomie/database";
import { workforceFixture } from "./fixtures.js";
async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    !/^workforce_browser_\d+$/.test(url.searchParams.get("schema") ?? "") ||
    process.env.WORKFORCE_BROWSER_GATE !== "true" ||
    process.env.NODE_ENV === "production"
  )
    throw new Error("Isolated synthetic browser fixture required");
  const app = buildApp(),
    fixture = await workforceFixture(app, "DE"),
    manager = await fixture.addEmployee("Plan Manager", "MANAGER"),
    worker = await fixture.addEmployee("Crew A"),
    peer = await fixture.addEmployee("Crew B"),
    chef = await fixture.addEmployee("Crew C", "KITCHEN"),
    bar = await fixture.addEmployee("Crew D", "BAR");
  for (const m of [worker, peer, chef, bar]) {
    await workforceRepository.saveProfile(fixture.owner, m.membershipId, {
      expectedVersion: 0,
      jobTitle:
        m.role === "KITCHEN"
          ? "Chef"
          : m.role === "BAR"
            ? "Bar specialist"
            : "Service",
      employmentStartedOn: "2026-01-01",
      stations:
        m.role === "KITCHEN"
          ? ["KITCHEN"]
          : m.role === "BAR"
            ? ["BAR"]
            : ["SERVICE", "COUNTER"],
      skills: ["Food safety"],
      recurringAvailability: [],
      annualLeaveDays: 24,
    });
    await workforceRepository.addContract(fixture.owner, m.membershipId, {
      expectedVersion: 1,
      effectiveFrom: "2026-01-01",
      employmentType: "PART_TIME",
      weeklyTargetMinutes: 1800,
      monthlyTargetMinutes: 7800,
      countryCode: "DE",
      terms: "Synthetic work agreement",
    });
  }
  const days = [
    "2030-08-12",
    "2030-08-13",
    "2030-08-14",
    "2030-08-15",
    "2030-08-16",
  ];
  const assignments = [worker, peer, chef, bar].flatMap((m, index) =>
    days.slice(index % 2).map((day, i) => ({
      id: randomUUID(),
      membershipId: m.membershipId,
      station:
        m.role === "KITCHEN" ? "KITCHEN" : m.role === "BAR" ? "BAR" : "SERVICE",
      startsLocal: day + (index % 2 ? "T15:00" : "T09:00"),
      endsLocal: day + (index % 2 ? "T23:00" : "T17:00"),
      breakMinutes: 30,
      requiredSkills: [],
      note: "",
      startChoice: "reject",
      endChoice: "reject",
    })),
  );
  await workforceRepository.saveSchedule(manager, {
    week: "2030-08-12",
    expectedVersion: 0,
    status: "PUBLISHED",
    reviewConfirmed: true,
    assignments,
  });
  const week2 = assignments.map((a) => ({
    ...workforceMove(
      workforceAssignmentSchema.parse(a),
      workforceAddDays(a.startsLocal.slice(0, 10), 7),
      a.membershipId,
    ),
    id: randomUUID(),
  }));
  // Only the explicitly selected synthetic fixture dates are populated.
  await workforceRepository.saveSchedule(manager, {
    week: "2030-08-19",
    expectedVersion: 0,
    status: "PUBLISHED",
    reviewConfirmed: true,
    assignments: week2,
  });
  await workforceRepository.addTemplate(manager, {
    name: "Evening service",
    station: "SERVICE",
    startMinute: 1080,
    durationMinutes: 480,
    breakMinutes: 30,
    requiredSkills: [],
  });
  await mkdir("artifacts/workforce", { recursive: true });
  const sanitize = (m: typeof worker) => {
    const { cookie, ...actor } = m;
    return actor;
  };
  await writeFile(
    "artifacts/workforce/actors.json",
    JSON.stringify({
      owner: sanitize(fixture.owner),
      manager: sanitize(manager),
      worker: sanitize(worker),
      peer: sanitize(peer),
      chef: sanitize(chef),
      bar: sanitize(bar),
    }),
  );
  await app.listen({ host: "127.0.0.1", port: 4403 });
  const stop = async () => {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
}
main().catch((error) => {
  console.error(
    "Workforce acceptance fixture failed",
    error instanceof Error ? error.message : "unknown",
  );
  process.exitCode = 1;
});
