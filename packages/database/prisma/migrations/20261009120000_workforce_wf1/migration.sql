-- AlterTable
ALTER TABLE "Venue" ADD COLUMN     "workforceConfigVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "workforceStations" TEXT[] DEFAULT ARRAY['KITCHEN', 'SERVICE', 'BAR', 'COUNTER', 'DELIVERY']::TEXT[];

-- AlterTable
ALTER TABLE "StaffProfile" ADD COLUMN     "annualLeaveDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "employmentEndedOn" TEXT,
ADD COLUMN     "employmentStartedOn" TEXT,
ADD COLUMN     "employmentStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "jobTitle" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "recurringAvailability" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "stations" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "workPhone" TEXT;

-- AlterTable
ALTER TABLE "VenueSchedule" ADD COLUMN     "publishedSnapshot" JSONB,
ADD COLUMN     "publishedVersion" INTEGER,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ScheduleAssignment" ADD COLUMN     "breakMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "note" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "requiredSkills" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "station" TEXT NOT NULL DEFAULT 'SERVICE',
ADD COLUMN     "userId" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "membershipId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "StaffEmploymentContract" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "effectiveFrom" TEXT NOT NULL,
    "employmentType" TEXT NOT NULL,
    "weeklyTargetMinutes" INTEGER NOT NULL,
    "monthlyTargetMinutes" INTEGER,
    "countryCode" TEXT NOT NULL,
    "terms" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffEmploymentContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffWorkDocument" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "expiresOn" TEXT,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "nonce" BYTEA NOT NULL,
    "authTag" BYTEA NOT NULL,
    "byteLength" INTEGER NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffWorkDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleRevision" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "ScheduleStatus" NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "changes" JSONB NOT NULL,
    "publicationEvent" JSONB,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduleRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkforceShiftTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "station" TEXT NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "breakMinutes" INTEGER NOT NULL,
    "requiredSkills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkforceShiftTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffProfileRevision" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffProfileRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublishedAssignmentRevision" (
    "id" TEXT NOT NULL,
    "sequence" BIGSERIAL NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "timezone" TEXT NOT NULL,
    "venueName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublishedAssignmentRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaffEmploymentContract_tenantId_venueId_profileId_effectiv_idx" ON "StaffEmploymentContract"("tenantId", "venueId", "profileId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "StaffEmploymentContract_profileId_version_key" ON "StaffEmploymentContract"("profileId", "version");

-- CreateIndex
CREATE INDEX "StaffWorkDocument_tenantId_venueId_profileId_idx" ON "StaffWorkDocument"("tenantId", "venueId", "profileId");

-- CreateIndex
CREATE INDEX "ScheduleRevision_tenantId_venueId_scheduleId_idx" ON "ScheduleRevision"("tenantId", "venueId", "scheduleId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleRevision_tenantId_venueId_id_key" ON "ScheduleRevision"("tenantId", "venueId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleRevision_scheduleId_version_key" ON "ScheduleRevision"("scheduleId", "version");

-- CreateIndex
CREATE INDEX "WorkforceShiftTemplate_tenantId_venueId_idx" ON "WorkforceShiftTemplate"("tenantId", "venueId");

-- CreateIndex
CREATE INDEX "StaffProfileRevision_tenantId_venueId_profileId_idx" ON "StaffProfileRevision"("tenantId", "venueId", "profileId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffProfileRevision_profileId_version_key" ON "StaffProfileRevision"("profileId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "PublishedAssignmentRevision_sequence_key" ON "PublishedAssignmentRevision"("sequence");

-- CreateIndex
CREATE INDEX "PublishedAssignmentRevision_tenantId_venueId_assignmentId_s_idx" ON "PublishedAssignmentRevision"("tenantId", "venueId", "assignmentId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "StaffProfile_tenantId_venueId_id_key" ON "StaffProfile"("tenantId", "venueId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "VenueSchedule_tenantId_venueId_id_key" ON "VenueSchedule"("tenantId", "venueId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleAssignment_tenantId_venueId_id_key" ON "ScheduleAssignment"("tenantId", "venueId", "id");

-- AddForeignKey
ALTER TABLE "StaffEmploymentContract" ADD CONSTRAINT "StaffEmploymentContract_tenantId_venueId_profileId_fkey" FOREIGN KEY ("tenantId", "venueId", "profileId") REFERENCES "StaffProfile"("tenantId", "venueId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffWorkDocument" ADD CONSTRAINT "StaffWorkDocument_tenantId_venueId_profileId_fkey" FOREIGN KEY ("tenantId", "venueId", "profileId") REFERENCES "StaffProfile"("tenantId", "venueId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleRevision" ADD CONSTRAINT "ScheduleRevision_tenantId_venueId_scheduleId_fkey" FOREIGN KEY ("tenantId", "venueId", "scheduleId") REFERENCES "VenueSchedule"("tenantId", "venueId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkforceShiftTemplate" ADD CONSTRAINT "WorkforceShiftTemplate_tenantId_venueId_fkey" FOREIGN KEY ("tenantId", "venueId") REFERENCES "Venue"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffProfileRevision" ADD CONSTRAINT "StaffProfileRevision_tenantId_venueId_profileId_fkey" FOREIGN KEY ("tenantId", "venueId", "profileId") REFERENCES "StaffProfile"("tenantId", "venueId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishedAssignmentRevision" ADD CONSTRAINT "PublishedAssignmentRevision_tenantId_venueId_assignmentId_fkey" FOREIGN KEY ("tenantId", "venueId", "assignmentId") REFERENCES "ScheduleAssignment"("tenantId", "venueId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishedAssignmentRevision" ADD CONSTRAINT "PublishedAssignmentRevision_tenantId_venueId_revisionId_fkey" FOREIGN KEY ("tenantId", "venueId", "revisionId") REFERENCES "ScheduleRevision"("tenantId", "venueId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve existing assignment identities and published data during migration.
UPDATE "ScheduleAssignment" a SET "userId"=m."userId", station=CASE WHEN a.role::text IN ('BAR','KITCHEN') THEN a.role::text ELSE 'SERVICE' END FROM "Membership" m WHERE a."membershipId"=m.id;
UPDATE "VenueSchedule" s SET "publishedVersion"=0,"publishedSnapshot"=jsonb_build_object(
 'week',to_char(s."weekStartsOn",'YYYY-MM-DD'),'timezone',v.timezone,'venueId',v.id,'venueName',v.name,
 'assignments',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'membershipId',a."membershipId",'userId',a."userId",'role',a.role::text,'displayName',u."displayName",'station',a.station,'startsAt',a."startsAt" AT TIME ZONE 'UTC','endsAt',a."endsAt" AT TIME ZONE 'UTC','startsLocal',to_char(a."startsAt" AT TIME ZONE 'UTC' AT TIME ZONE v.timezone,'YYYY-MM-DD"T"HH24:MI'),'endsLocal',to_char(a."endsAt" AT TIME ZONE 'UTC' AT TIME ZONE v.timezone,'YYYY-MM-DD"T"HH24:MI'),'startChoice','reject','endChoice','reject','breakMinutes',0,'requiredSkills','[]'::jsonb,'note','') ORDER BY a."startsAt",a.id) FROM "ScheduleAssignment" a JOIN "Membership" m ON m.id=a."membershipId" JOIN "User" u ON u.id=m."userId" WHERE a."scheduleId"=s.id),'[]'::jsonb)) FROM "Venue" v WHERE s."venueId"=v.id AND s.status='PUBLISHED';
-- Seed a revision of old publications; no fabricated old change history.
INSERT INTO "ScheduleRevision"(id,"tenantId","venueId","scheduleId",version,status,before,after,changes,"createdByUserId")
SELECT 'wf1-legacy-'||id,"tenantId","venueId",id,0,'PUBLISHED',"publishedSnapshot","publishedSnapshot",'[]'::jsonb,COALESCE("publishedByUserId",'legacy-unattributed') FROM "VenueSchedule" WHERE "publishedSnapshot" IS NOT NULL;
-- Index legacy published assignments without rewriting the original snapshots.
INSERT INTO "PublishedAssignmentRevision"(id,"tenantId","venueId","assignmentId","revisionId","after",timezone,"venueName")
SELECT 'wf1-legacy-'||a.id,s."tenantId",s."venueId",a.id,'wf1-legacy-'||s.id,entry,s."publishedSnapshot"->>'timezone',s."publishedSnapshot"->>'venueName' FROM "VenueSchedule" s CROSS JOIN LATERAL jsonb_array_elements(s."publishedSnapshot"->'assignments') entry JOIN "ScheduleAssignment" a ON a.id=entry->>'id' WHERE s."publishedSnapshot" IS NOT NULL;
CREATE FUNCTION workforce_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' AND current_setting('flowgastronomie.test_cleanup',true)='on' THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Workforce history is append-only';
END $$;
CREATE TRIGGER workforce_schedule_history BEFORE UPDATE OR DELETE ON "ScheduleRevision" FOR EACH ROW EXECUTE FUNCTION workforce_history_immutable();
CREATE TRIGGER workforce_contract_history BEFORE UPDATE OR DELETE ON "StaffEmploymentContract" FOR EACH ROW EXECUTE FUNCTION workforce_history_immutable();

CREATE TRIGGER workforce_profile_history BEFORE UPDATE OR DELETE ON "StaffProfileRevision" FOR EACH ROW EXECUTE FUNCTION workforce_history_immutable();
CREATE TRIGGER workforce_assignment_history BEFORE UPDATE OR DELETE ON "PublishedAssignmentRevision" FOR EACH ROW EXECUTE FUNCTION workforce_history_immutable();
