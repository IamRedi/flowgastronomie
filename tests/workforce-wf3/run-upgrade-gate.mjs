import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { spawnCommandSync } from "../operations/process-command.mjs";
const require = createRequire(import.meta.url),
  { PrismaClient } = require("@prisma/client"),
  baseline = "e2c067d08024a7c10292e84e4bfc91b8ca366912";
const url = new URL(process.env.DATABASE_URL ?? "");
if (
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  !/^postgres(ql)?:$/.test(url.protocol)
)
  throw new Error("WF3 upgrade gate is local only");
const schema = "workforce_wf3_upgrade_" + Date.now();
url.searchParams.set("schema", schema);
const env = { ...process.env, DATABASE_URL: url.toString() },
  directory = resolve("artifacts/workforce-wf3/upgrade-prisma-" + Date.now());
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
  if (r.status !== 0) throw new Error("WF3 upgrade migration failed");
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
  "WorkforcePolicy",
  "WorkforceAttendance",
  "WorkforceAttendanceEvent",
  "WorkforceAttendanceApproval",
  "WorkforceRequest",
  "WorkforceRequestTransition",
  "WorkforceLeaveGrant",
  "WorkforceEventIntent",
  "Order",
  "PaymentRecord",
  "Receipt",
  "CashSession",
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
    `INSERT INTO "Tenant"(id,name,slug,"updatedAt") VALUES ('wf3-upgrade-tenant','Synthetic upgrade fixture','wf3-upgrade-tenant',CURRENT_TIMESTAMP)`,
    `INSERT INTO "Venue"(id,"tenantId",name,slug,timezone,"countryCode","updatedAt") VALUES('wf3-upgrade-venue','wf3-upgrade-tenant','Synthetic upgrade venue','wf3-upgrade-venue','Europe/Berlin','DE',CURRENT_TIMESTAMP)`,
    `INSERT INTO "User"(id,"tenantId",email,"displayName","passwordHash") VALUES('wf3-upgrade-user','wf3-upgrade-tenant','upgrade@workforce.invalid','Synthetic upgrade worker','not-a-login')`,
    `INSERT INTO "Membership"(id,"tenantId","venueId","userId",role) VALUES('wf3-upgrade-member','wf3-upgrade-tenant','wf3-upgrade-venue','wf3-upgrade-user','OWNER')`,
    `INSERT INTO "StaffProfile"(id,"tenantId","venueId","userId","membershipId",version,skills) VALUES('wf3-upgrade-profile','wf3-upgrade-tenant','wf3-upgrade-venue','wf3-upgrade-user','wf3-upgrade-member',1,ARRAY['Food safety'])`,
    `INSERT INTO "StaffEmploymentContract"(id,"tenantId","venueId","profileId",version,"effectiveFrom","employmentType","weeklyTargetMinutes","countryCode",terms,"createdByUserId") VALUES('wf3-upgrade-contract','wf3-upgrade-tenant','wf3-upgrade-venue','wf3-upgrade-profile',1,'2026-01-01','FULL_TIME',2400,'DE','Synthetic historic contract','wf3-upgrade-user')`,
    `INSERT INTO "StaffProfileRevision"(id,"tenantId","venueId","profileId",version,"before","after","createdByUserId") VALUES('wf3-upgrade-profile-revision','wf3-upgrade-tenant','wf3-upgrade-venue','wf3-upgrade-profile',1,'{}','{"skills":["Food safety"]}','wf3-upgrade-user')`,
    `INSERT INTO "VenueSchedule"(id,"tenantId","venueId","weekStartsOn",status,version,"publishedVersion","publishedSnapshot","updatedAt") VALUES('wf3-upgrade-plan','wf3-upgrade-tenant','wf3-upgrade-venue','2030-08-12','PUBLISHED',1,1,'{"week":"2030-08-12","timezone":"Europe/Berlin","venueId":"wf3-upgrade-venue","venueName":"Synthetic upgrade venue","assignments":[]}',CURRENT_TIMESTAMP)`,
    `INSERT INTO "ScheduleAssignment"(id,"tenantId","venueId","scheduleId","membershipId","userId",role,"startsAt","endsAt","updatedAt") VALUES('wf3-upgrade-shift','wf3-upgrade-tenant','wf3-upgrade-venue','wf3-upgrade-plan','wf3-upgrade-member','wf3-upgrade-user','OWNER','2030-08-12T07:00Z','2030-08-12T15:00Z',CURRENT_TIMESTAMP)`,
    `INSERT INTO "ScheduleRevision"(id,"tenantId","venueId","scheduleId",version,status,"before","after",changes,"createdByUserId") VALUES('wf3-upgrade-revision','wf3-upgrade-tenant','wf3-upgrade-venue','wf3-upgrade-plan',1,'PUBLISHED','{}','{"assignments":[]}','[]','wf3-upgrade-user')`,
    `INSERT INTO "PublishedAssignmentRevision"(id,"tenantId","venueId","assignmentId","revisionId","after",timezone,"venueName") VALUES('wf3-upgrade-publication','wf3-upgrade-tenant','wf3-upgrade-venue','wf3-upgrade-shift','wf3-upgrade-revision','{"id":"wf3-upgrade-shift","userId":"wf3-upgrade-user"}','Europe/Berlin','Synthetic upgrade venue')`,
    `INSERT INTO "StaffShift"(id,"tenantId","venueId","userId","membershipId",status,"activeShiftKey") VALUES('wf3-upgrade-pos','wf3-upgrade-tenant','wf3-upgrade-venue','wf3-upgrade-user','wf3-upgrade-member','OPEN','wf3-upgrade-pos-key')`,
    `INSERT INTO "AuditEvent"(id,"tenantId","venueId","actorUserId","actorMembershipId",action,"entityType","entityId",metadata) VALUES('wf3-upgrade-audit','wf3-upgrade-tenant','wf3-upgrade-venue','wf3-upgrade-user','wf3-upgrade-member','WF1_SYNTHETIC_UPGRADE','StaffProfile','wf3-upgrade-profile','{}')`,
  ];
  for (const statement of statements) await db.$executeRawUnsafe(statement);

  const extra = [
    `INSERT INTO "User"(id,"tenantId",email,"displayName","passwordHash") VALUES('wf3-upgrade-reviewer','wf3-upgrade-tenant','reviewer@workforce.invalid','Synthetic independent reviewer','not-a-login')`,
    `INSERT INTO "Membership"(id,"tenantId","venueId","userId",role) VALUES('wf3-upgrade-reviewer-member','wf3-upgrade-tenant','wf3-upgrade-venue','wf3-upgrade-reviewer','MANAGER')`,
    `INSERT INTO "WorkforcePolicy"(id,"tenantId","venueId",version,"effectiveFrom","countryCode",rules,reason,"createdByUserId") VALUES('wf3-upgrade-policy','wf3-upgrade-tenant','wf3-upgrade-venue',1,'2026-01-01','DE','{}','Synthetic historical policy','wf3-upgrade-reviewer')`,
    `INSERT INTO "WorkforceAttendance"(id,"tenantId","venueId","userId","membershipId","profileId",timezone,"contractRevisionId","policyRevisionId",state,version,"startedAt","updatedAt") VALUES('wf3-upgrade-attendance','wf3-upgrade-tenant','wf3-upgrade-venue','wf3-upgrade-user','wf3-upgrade-member','wf3-upgrade-profile','Europe/Berlin','wf3-upgrade-contract','wf3-upgrade-policy','CLOSED',2,'2030-08-12T07:00Z',CURRENT_TIMESTAMP)`,
    `INSERT INTO "WorkforceAttendanceEvent"(id,"tenantId","venueId","userId","attendanceId",sequence,kind,"occurredAt","actorUserId","idempotencyKey","requestHash",payload) VALUES('wf3-upgrade-in','wf3-upgrade-tenant','wf3-upgrade-venue','wf3-upgrade-user','wf3-upgrade-attendance',1,'CLOCK_IN','2030-08-12T07:00Z','wf3-upgrade-user','historic-clock-in','historic-hash','{}'),('wf3-upgrade-out','wf3-upgrade-tenant','wf3-upgrade-venue','wf3-upgrade-user','wf3-upgrade-attendance',2,'CLOCK_OUT','2030-08-12T08:00Z','wf3-upgrade-user','historic-clock-out','historic-hash','{}')`,
    `INSERT INTO "WorkforceAttendanceApproval"(id,"tenantId","venueId","attendanceId","attendanceVersion","userId","actorUserId",reason,snapshot,calculation,"sourceEventIds") VALUES('wf3-upgrade-approval','wf3-upgrade-tenant','wf3-upgrade-venue','wf3-upgrade-attendance',2,'wf3-upgrade-user','wf3-upgrade-reviewer','Reviewed historical synthetic hour','{"startsAt":"2030-08-12T07:00Z","endsAt":"2030-08-12T08:00Z","breaks":[],"timezone":"Europe/Berlin","contractRevisionId":"wf3-upgrade-contract","policyRevisionId":"wf3-upgrade-policy"}','{"workedMs":3600000}',ARRAY['wf3-upgrade-in','wf3-upgrade-out'])`,
    `INSERT INTO "WorkforceRequest"(id,"tenantId","venueId","userId","membershipId","profileId",kind,status,version,"idempotencyKey","requestHash",payload,"startsAt","endsAt","contractRevisionId","policyRevisionId","updatedAt") VALUES('wf3-upgrade-leave','wf3-upgrade-tenant','wf3-upgrade-venue','wf3-upgrade-user','wf3-upgrade-member','wf3-upgrade-profile','LEAVE','APPROVED',1,'historic-leave','historic-hash','{"category":"ANNUAL","slices":[]}','2030-08-14T07:00Z','2030-08-14T15:00Z','wf3-upgrade-contract','wf3-upgrade-policy',CURRENT_TIMESTAMP)`,
    `INSERT INTO "WorkforceRequestTransition"(id,"tenantId","venueId","requestId",version,"fromStatus","toStatus",action,"actorUserId",reason,result) VALUES('wf3-upgrade-request','wf3-upgrade-tenant','wf3-upgrade-venue','wf3-upgrade-leave',0,NULL,'PENDING','REQUEST','wf3-upgrade-user','','{}'),('wf3-upgrade-decision','wf3-upgrade-tenant','wf3-upgrade-venue','wf3-upgrade-leave',1,'PENDING','APPROVED','APPROVE','wf3-upgrade-reviewer','Reviewed historical leave','{}')`,
    `INSERT INTO "WorkforceLeaveGrant"(id,"tenantId","venueId","userId","membershipId","profileId",year,version,minutes,reason,"contractRevisionId","policyRevisionId","actorUserId","idempotencyKey","requestHash") VALUES('wf3-upgrade-grant','wf3-upgrade-tenant','wf3-upgrade-venue','wf3-upgrade-user','wf3-upgrade-member','wf3-upgrade-profile',2030,1,4800,'Historical explicit allowance','wf3-upgrade-contract','wf3-upgrade-policy','wf3-upgrade-reviewer','historic-grant','historic-hash')`,
    `INSERT INTO "WorkforceEventIntent"(id,"tenantId","venueId",type,"subjectId","actorUserId","recipientUserIds",payload) VALUES('wf3-upgrade-intent','wf3-upgrade-tenant','wf3-upgrade-venue','ATTENDANCE_APPROVED','wf3-upgrade-attendance','wf3-upgrade-reviewer',ARRAY['wf3-upgrade-user'],'{"schemaVersion":1}')`,
    `INSERT INTO "Order"(id,"tenantId","venueId","idempotencyKey",status,"totalMinor",currency,"updatedAt") VALUES('wf3-upgrade-order','wf3-upgrade-tenant','wf3-upgrade-venue','historical-synthetic-order','SERVED',1500,'EUR',CURRENT_TIMESTAMP)`,
    `INSERT INTO "CashSession"(id,"tenantId","venueId","openedByMembershipId","shiftId","openingCashMinor","expectedCashMinor","countedCashMinor","differenceMinor",status,"closedAt","closedByMembershipId","closedByShiftId") VALUES('wf3-upgrade-cash','wf3-upgrade-tenant','wf3-upgrade-venue','wf3-upgrade-member','wf3-upgrade-pos',0,1500,1500,0,'CLOSED','2030-08-12T15:00Z','wf3-upgrade-member','wf3-upgrade-pos')`,
    `INSERT INTO "PaymentRecord"(id,"tenantId","venueId","orderId","cashSessionId","counterPaymentKey","amountMinor","receivedMinor","changeMinor",currency,method,"recordedByUserId","recordedByMembershipId","recordedByShiftId","idempotencyKey") VALUES('wf3-upgrade-payment','wf3-upgrade-tenant','wf3-upgrade-venue','wf3-upgrade-order','wf3-upgrade-cash','historic-counter-payment',1500,1500,0,'EUR','CASH','wf3-upgrade-user','wf3-upgrade-member','wf3-upgrade-pos','historical-synthetic-payment')`,
    `INSERT INTO "Receipt"(id,"tenantId","venueId","orderId","paymentId",sequence,number,snapshot) VALUES('wf3-upgrade-receipt','wf3-upgrade-tenant','wf3-upgrade-venue','wf3-upgrade-order','wf3-upgrade-payment',1,'SYNTHETIC-0001','{"immutableHistoricalTotal":1500}')`,
  ];
  await db.$transaction(async (tx) => {
    for (const statement of extra) await tx.$executeRawUnsafe(statement);
  });
  const before = await evidence();
  migrate("packages/database/prisma/schema.prisma");
  const after = await evidence();
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw new Error(
      "Existing WF1/WF2 or synthetic financial/audit history changed",
    );
  const file = "artifacts/workforce-wf3/migration-acceptance.json";
  writeFileSync(
    file,
    JSON.stringify(
      {
        status: "passed",
        baseline,
        tables: after,
        historyPreserved: true,
        migrationFinancialWrites: false,
        syntheticFinancialFixtures: 4,
      },
      null,
      2,
    ),
  );
  console.log(
    "WF3 upgrade: all 25 existing table hashes preserved; contract, publication, POS and audit records unchanged.",
  );
} finally {
  if (!/^workforce_wf3_upgrade_\d+$/.test(schema))
    throw new Error("Invalid upgrade fixture schema");
  await db.$executeRawUnsafe('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE');
  await db.$disconnect();
}
