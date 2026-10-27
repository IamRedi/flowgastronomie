CREATE TYPE "ScheduleStatus" AS ENUM ('DRAFT', 'PUBLISHED');
CREATE TYPE "OperationalTaskScope" AS ENUM ('VENUE', 'SHIFT', 'TABLE', 'ORDER');
CREATE TYPE "OperationalTaskPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH');

CREATE TABLE "VenueSchedule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "weekStartsOn" TIMESTAMP(3) NOT NULL,
    "status" "ScheduleStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "publishedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VenueSchedule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ScheduleAssignment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ScheduleAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StaffAvailabilityNote" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StaffAvailabilityNote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OperationalTask" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "scope" "OperationalTaskScope" NOT NULL,
    "scopeId" TEXT,
    "title" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3),
    "priority" "OperationalTaskPriority" NOT NULL DEFAULT 'NORMAL',
    "assigneeMembershipId" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedByUserId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdByMembershipId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OperationalTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShiftHandoverNote" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "shiftId" TEXT,
    "body" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdByMembershipId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShiftHandoverNote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VenueSchedule_venueId_weekStartsOn_key" ON "VenueSchedule"("venueId", "weekStartsOn");
CREATE INDEX "VenueSchedule_tenantId_venueId_weekStartsOn_idx" ON "VenueSchedule"("tenantId", "venueId", "weekStartsOn");
CREATE INDEX "ScheduleAssignment_tenantId_venueId_membershipId_startsAt_endsAt_idx" ON "ScheduleAssignment"("tenantId", "venueId", "membershipId", "startsAt", "endsAt");
CREATE INDEX "ScheduleAssignment_scheduleId_startsAt_idx" ON "ScheduleAssignment"("scheduleId", "startsAt");
CREATE INDEX "StaffAvailabilityNote_tenantId_venueId_membershipId_startsAt_endsAt_idx" ON "StaffAvailabilityNote"("tenantId", "venueId", "membershipId", "startsAt", "endsAt");
CREATE INDEX "OperationalTask_tenantId_venueId_completedAt_dueAt_idx" ON "OperationalTask"("tenantId", "venueId", "completedAt", "dueAt");
CREATE INDEX "OperationalTask_tenantId_venueId_assigneeMembershipId_completedAt_idx" ON "OperationalTask"("tenantId", "venueId", "assigneeMembershipId", "completedAt");
CREATE INDEX "ShiftHandoverNote_tenantId_venueId_createdAt_idx" ON "ShiftHandoverNote"("tenantId", "venueId", "createdAt");
CREATE INDEX "ShiftHandoverNote_tenantId_venueId_shiftId_idx" ON "ShiftHandoverNote"("tenantId", "venueId", "shiftId");

ALTER TABLE "VenueSchedule" ADD CONSTRAINT "VenueSchedule_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScheduleAssignment" ADD CONSTRAINT "ScheduleAssignment_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "VenueSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScheduleAssignment" ADD CONSTRAINT "ScheduleAssignment_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffAvailabilityNote" ADD CONSTRAINT "StaffAvailabilityNote_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffAvailabilityNote" ADD CONSTRAINT "StaffAvailabilityNote_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OperationalTask" ADD CONSTRAINT "OperationalTask_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShiftHandoverNote" ADD CONSTRAINT "ShiftHandoverNote_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
