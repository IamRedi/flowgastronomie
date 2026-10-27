import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { spawnCommandSync } from "../operations/process-command.mjs";
const require = createRequire(import.meta.url),
  { PrismaClient } = require("@prisma/client"),
  baseline = "e4178b4d261579d943287e50bb3dc745dab8b4ac";
const url = new URL(process.env.DATABASE_URL ?? "");
if (
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  !/^postgres(ql)?:$/.test(url.protocol)
)
  throw new Error("WF2 upgrade gate is local only");
const schema = "workforce_wf2_upgrade_" + Date.now();
url.searchParams.set("schema", schema);
const env = { ...process.env, DATABASE_URL: url.toString() },
  directory = resolve("artifacts/workforce-wf2/upgrade-prisma-" + Date.now());
mkdirSync(join(directory, "migrations"), { recursive: true });
writeFileSync(
  join(directory, "schema.prisma"),
  execFileSync("git", [
    "show",
    baseline + ":packages/database/prisma/schema.prisma",
  ]),
);
const names = execFileSync(
  "git",
  ["ls-tree", "--name-only", baseline + ":packages/database/prisma/migrations"],
  { encoding: "utf8" },
)
  .trim()
  .split("\n");
for (const name of names) {
  if (name === "migration_lock.toml") {
    copyFileSync(
      "packages/database/prisma/migrations/" + name,
      join(directory, "migrations", name),
    );
    continue;
  }
  mkdirSync(join(directory, "migrations", name), { recursive: true });
  writeFileSync(
    join(directory, "migrations", name, "migration.sql"),
    execFileSync("git", [
      "show",
      baseline +
        ":packages/database/prisma/migrations/" +
        name +
        "/migration.sql",
    ]),
  );
}
const db = new PrismaClient({ datasourceUrl: url.toString() });
function migrate(path) {
  const r = spawnCommandSync(
    process.execPath,
    [
      require.resolve("prisma/build/index.js"),
      "migrate",
      "deploy",
      "--schema",
      path,
    ],
    { env, stdio: "inherit" },
  );
  if (r.status !== 0) throw new Error("WF2 upgrade migration failed");
}
const tables = [
  "Tenant",
  "Venue",
  "User",
  "Membership",
  "StaffProfile",
  "StaffEmploymentContract",
  "StaffProfileRevision",
  "VenueSchedule",
  "ScheduleAssignment",
  "ScheduleRevision",
  "PublishedAssignmentRevision",
  "StaffShift",
  "AuditEvent",
];
async function evidence() {
  const result = {};
  for (const table of tables) {
    const rows = await db.$queryRawUnsafe(
      'SELECT row_to_json(t) AS row FROM "' + table + '" t ORDER BY id',
    );
    result[table] = {
      count: rows.length,
      hash: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
    };
  }
  return result;
}
try {
  migrate(join(directory, "schema.prisma"));
  const statements = [
    `INSERT INTO "Tenant"(id,name,slug,"updatedAt") VALUES ('wf2-upgrade-tenant','Synthetic upgrade fixture','wf2-upgrade-tenant',CURRENT_TIMESTAMP)`,
    `INSERT INTO "Venue"(id,"tenantId",name,slug,timezone,"countryCode","updatedAt") VALUES('wf2-upgrade-venue','wf2-upgrade-tenant','Synthetic upgrade venue','wf2-upgrade-venue','Europe/Berlin','DE',CURRENT_TIMESTAMP)`,
    `INSERT INTO "User"(id,"tenantId",email,"displayName","passwordHash") VALUES('wf2-upgrade-user','wf2-upgrade-tenant','upgrade@workforce.invalid','Synthetic upgrade worker','not-a-login')`,
    `INSERT INTO "Membership"(id,"tenantId","venueId","userId",role) VALUES('wf2-upgrade-member','wf2-upgrade-tenant','wf2-upgrade-venue','wf2-upgrade-user','OWNER')`,
    `INSERT INTO "StaffProfile"(id,"tenantId","venueId","userId","membershipId",version,skills) VALUES('wf2-upgrade-profile','wf2-upgrade-tenant','wf2-upgrade-venue','wf2-upgrade-user','wf2-upgrade-member',1,ARRAY['Food safety'])`,
    `INSERT INTO "StaffEmploymentContract"(id,"tenantId","venueId","profileId",version,"effectiveFrom","employmentType","weeklyTargetMinutes","countryCode",terms,"createdByUserId") VALUES('wf2-upgrade-contract','wf2-upgrade-tenant','wf2-upgrade-venue','wf2-upgrade-profile',1,'2026-01-01','FULL_TIME',2400,'DE','Synthetic historic contract','wf2-upgrade-user')`,
    `INSERT INTO "StaffProfileRevision"(id,"tenantId","venueId","profileId",version,"before","after","createdByUserId") VALUES('wf2-upgrade-profile-revision','wf2-upgrade-tenant','wf2-upgrade-venue','wf2-upgrade-profile',1,'{}','{"skills":["Food safety"]}','wf2-upgrade-user')`,
    `INSERT INTO "VenueSchedule"(id,"tenantId","venueId","weekStartsOn",status,version,"publishedVersion","publishedSnapshot","updatedAt") VALUES('wf2-upgrade-plan','wf2-upgrade-tenant','wf2-upgrade-venue','2030-08-12','PUBLISHED',1,1,'{"week":"2030-08-12","timezone":"Europe/Berlin","venueId":"wf2-upgrade-venue","venueName":"Synthetic upgrade venue","assignments":[]}',CURRENT_TIMESTAMP)`,
    `INSERT INTO "ScheduleAssignment"(id,"tenantId","venueId","scheduleId","membershipId","userId",role,"startsAt","endsAt","updatedAt") VALUES('wf2-upgrade-shift','wf2-upgrade-tenant','wf2-upgrade-venue','wf2-upgrade-plan','wf2-upgrade-member','wf2-upgrade-user','OWNER','2030-08-12T07:00Z','2030-08-12T15:00Z',CURRENT_TIMESTAMP)`,
    `INSERT INTO "ScheduleRevision"(id,"tenantId","venueId","scheduleId",version,status,"before","after",changes,"createdByUserId") VALUES('wf2-upgrade-revision','wf2-upgrade-tenant','wf2-upgrade-venue','wf2-upgrade-plan',1,'PUBLISHED','{}','{"assignments":[]}','[]','wf2-upgrade-user')`,
    `INSERT INTO "PublishedAssignmentRevision"(id,"tenantId","venueId","assignmentId","revisionId","after",timezone,"venueName") VALUES('wf2-upgrade-publication','wf2-upgrade-tenant','wf2-upgrade-venue','wf2-upgrade-shift','wf2-upgrade-revision','{"id":"wf2-upgrade-shift","userId":"wf2-upgrade-user"}','Europe/Berlin','Synthetic upgrade venue')`,
    `INSERT INTO "StaffShift"(id,"tenantId","venueId","userId","membershipId",status,"activeShiftKey") VALUES('wf2-upgrade-pos','wf2-upgrade-tenant','wf2-upgrade-venue','wf2-upgrade-user','wf2-upgrade-member','OPEN','wf2-upgrade-pos-key')`,
    `INSERT INTO "AuditEvent"(id,"tenantId","venueId","actorUserId","actorMembershipId",action,"entityType","entityId",metadata) VALUES('wf2-upgrade-audit','wf2-upgrade-tenant','wf2-upgrade-venue','wf2-upgrade-user','wf2-upgrade-member','WF1_SYNTHETIC_UPGRADE','StaffProfile','wf2-upgrade-profile','{}')`,
  ];
  for (const statement of statements) await db.$executeRawUnsafe(statement);
  const before = await evidence();
  migrate("packages/database/prisma/schema.prisma");
  const after = await evidence();
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw new Error(
      "Existing WF1 identity, planning, contract, POS or audit evidence changed",
    );
  const file = "artifacts/workforce-wf2/migration-acceptance.json";
  writeFileSync(
    file,
    JSON.stringify(
      {
        status: "passed",
        baseline,
        tables: after,
        historyPreserved: true,
        financialWrites: false,
      },
      null,
      2,
    ),
  );
  console.log(
    "WF2 upgrade: all 13 existing table hashes preserved; contract, publication, POS and audit records unchanged.",
  );
} finally {
  if (!/^workforce_wf2_upgrade_\d+$/.test(schema))
    throw new Error("Invalid upgrade fixture schema");
  await db.$executeRawUnsafe('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE');
  await db.$disconnect();
}
