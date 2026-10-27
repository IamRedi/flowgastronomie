import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnCommandSync } from "../operations/process-command.mjs";
import {
  baselineMigrations,
  baselineSchema,
} from "../operations/prisma-baseline.mjs";
const require = createRequire(import.meta.url),
  { PrismaClient } = require("@prisma/client");
const source = new URL(process.env.DATABASE_URL ?? "");
if (
  !["localhost", "127.0.0.1"].includes(source.hostname) ||
  !/^postgres(ql)?:$/.test(source.protocol)
)
  throw new Error("Legacy migration gate is local only");
const schema = "workforce_legacy_" + Date.now();
source.searchParams.set("schema", schema);
const env = { ...process.env, DATABASE_URL: source.toString() };
const directory = resolve("artifacts/workforce/legacy-prisma-" + Date.now());
mkdirSync(join(directory, "migrations"), { recursive: true });
writeFileSync(
  join(directory, "schema.prisma"),
  baselineSchema("50edc7cb45690fc48fbdb803b11ab104a0930d62"),
);
const baselineNames = baselineMigrations(
  "50edc7cb45690fc48fbdb803b11ab104a0930d62",
);
for (const name of baselineNames) {
  if (name === "migration_lock.toml") {
    copyFileSync(
      join("packages/database/prisma/migrations", name),
      join(directory, "migrations", name),
    );
    continue;
  }
  mkdirSync(join(directory, "migrations", name), { recursive: true });
  copyFileSync(
    join("packages/database/prisma/migrations", name, "migration.sql"),
    join(directory, "migrations", name, "migration.sql"),
  );
}
const client = new PrismaClient({ datasourceUrl: source.toString() });
function migrate(path) {
  const result = spawnCommandSync(
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
  if (result.status !== 0) throw new Error("Migration gate failed");
}
try {
  migrate(join(directory, "schema.prisma"));
  const legacySQL = `INSERT INTO "Tenant"(id,name,slug,"updatedAt") VALUES ('wf-legacy-tenant','Synthetic legacy fixture','wf-legacy-tenant',CURRENT_TIMESTAMP);
 INSERT INTO "Venue"(id,"tenantId",name,slug,timezone,"updatedAt") VALUES('wf-legacy-venue','wf-legacy-tenant','Legacy synthetic venue','wf-legacy-venue','Europe/Berlin',CURRENT_TIMESTAMP);
 INSERT INTO "User"(id,"tenantId",email,"displayName","passwordHash") VALUES('wf-legacy-worker','wf-legacy-tenant','worker@workforce.invalid','Legacy synthetic worker','not-a-login'),('wf-legacy-owner','wf-legacy-tenant','owner@workforce.invalid','Legacy synthetic owner','not-a-login');
 INSERT INTO "Membership"(id,"tenantId","venueId","userId",role) VALUES('wf-legacy-member','wf-legacy-tenant','wf-legacy-venue','wf-legacy-worker','WAITER'),('wf-legacy-leader','wf-legacy-tenant','wf-legacy-venue','wf-legacy-owner','OWNER');
 INSERT INTO "StaffProfile"(id,"tenantId","venueId","userId","membershipId") VALUES('wf-legacy-profile','wf-legacy-tenant','wf-legacy-venue','wf-legacy-worker','wf-legacy-member');
 INSERT INTO "VenueSchedule"(id,"tenantId","venueId","weekStartsOn",status,"publishedAt","publishedByUserId","updatedAt") VALUES('wf-legacy-published','wf-legacy-tenant','wf-legacy-venue','2030-08-12','PUBLISHED',CURRENT_TIMESTAMP,'wf-legacy-owner',CURRENT_TIMESTAMP),('wf-legacy-draft','wf-legacy-tenant','wf-legacy-venue','2030-08-19','DRAFT',NULL,NULL,CURRENT_TIMESTAMP),('wf-legacy-fold','wf-legacy-tenant','wf-legacy-venue','2030-10-21','PUBLISHED',CURRENT_TIMESTAMP,'wf-legacy-owner',CURRENT_TIMESTAMP);
 INSERT INTO "ScheduleAssignment"(id,"tenantId","venueId","scheduleId","membershipId",role,"startsAt","endsAt","updatedAt") VALUES('wf-legacy-shift','wf-legacy-tenant','wf-legacy-venue','wf-legacy-published','wf-legacy-member','WAITER','2030-08-12T07:00:00Z','2030-08-12T15:00:00Z',CURRENT_TIMESTAMP),('wf-legacy-hidden','wf-legacy-tenant','wf-legacy-venue','wf-legacy-draft','wf-legacy-member','WAITER','2030-08-19T07:00:00Z','2030-08-19T15:00:00Z',CURRENT_TIMESTAMP),('wf-legacy-dst','wf-legacy-tenant','wf-legacy-venue','wf-legacy-fold','wf-legacy-member','WAITER','2030-10-27T00:30:00Z','2030-10-27T01:30:00Z',CURRENT_TIMESTAMP);`;
  for (const statement of legacySQL.split(";").filter((s) => s.trim()))
    await client.$executeRawUnsafe(statement);
  const before = await client.$queryRawUnsafe(
    'SELECT id,"startsAt","endsAt",role,"membershipId" FROM "ScheduleAssignment" ORDER BY id',
  );
  migrate("packages/database/prisma/schema.prisma");
  const after = await client.$queryRawUnsafe(
    'SELECT id,"startsAt","endsAt",role,"membershipId" FROM "ScheduleAssignment" ORDER BY id',
  );
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw new Error("Legacy identity/time changed");
  const views = await client.venueSchedule.findMany({ orderBy: { id: "asc" } });
  if (views.find((v) => v.id === "wf-legacy-draft").publishedSnapshot !== null)
    throw new Error("Draft became published");
  if (
    (await client.publishedAssignmentRevision.count()) !== 2 ||
    (await client.scheduleRevision.count()) !== 2
  )
    throw new Error("Legacy publication backfill is incomplete");
  for (const v of views.filter((v) => v.publishedSnapshot !== null)) {
    if (
      v.publishedVersion !== 0 ||
      v.publishedSnapshot.assignments.length !== 1
    )
      throw new Error("Invalid baseline snapshot");
  }
  const statements = readFileSync(
    "packages/database/prisma/migrations/20261009120000_workforce_wf1/migration.sql",
    "utf8",
  );
  if (
    /\b(?:DROP\s+(?:TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM)\b/i.test(statements)
  )
    throw new Error("Destructive migration statement");
  writeFileSync(
    "artifacts/workforce/migration-acceptance.json",
    JSON.stringify({
      status: "passed",
      legacyAssignments: 3,
      immutablePublications: 2,
      draftVisible: false,
      identitiesAndInstantsPreserved: true,
      destructiveStatements: false,
    }),
  );
  console.log(
    "Legacy migration: 3 identities/instants preserved, 2 immutable publications, draft remains private.",
  );
} finally {
  if (!/^workforce_legacy_\d+$/.test(schema))
    throw new Error("Invalid legacy schema");
  await client.$executeRawUnsafe(
    'DROP SCHEMA IF EXISTS "' + schema + '" CASCADE',
  );
  await client.$disconnect();
}
