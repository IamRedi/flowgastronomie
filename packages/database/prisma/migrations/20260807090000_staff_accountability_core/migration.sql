CREATE TYPE "StaffShiftStatus" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD_AT_TABLE', 'OTHER');
CREATE TYPE "PaymentRecordStatus" AS ENUM ('RECORDED', 'VOIDED');

DROP INDEX "Membership_venueId_userId_role_key";
ALTER TABLE "Membership" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ServiceSignal" ADD COLUMN "acknowledgedByShiftId" TEXT,
ADD COLUMN "acknowledgedByUserId" TEXT;

CREATE TABLE "StaffProfile" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "venueId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "membershipId" TEXT NOT NULL,
  "preferredLocale" "Locale" NOT NULL DEFAULT 'SQ',
  "avatarUrl" TEXT,
  "employeeRef" TEXT,
  CONSTRAINT "StaffProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StaffShift" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "venueId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "membershipId" TEXT NOT NULL,
  "status" "StaffShiftStatus" NOT NULL DEFAULT 'OPEN',
  "activeShiftKey" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  "openingNote" TEXT,
  "closingNote" TEXT,
  CONSTRAINT "StaffShift_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TableAssignment" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "venueId" TEXT NOT NULL,
  "tableId" TEXT NOT NULL,
  "shiftId" TEXT NOT NULL,
  "activeTableKey" TEXT,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  CONSTRAINT "TableAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditEvent" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "venueId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "actorMembershipId" TEXT NOT NULL,
  "actorShiftId" TEXT,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "metadata" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentRecord" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "venueId" TEXT NOT NULL,
  "tableSessionId" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "method" "PaymentMethod" NOT NULL,
  "status" "PaymentRecordStatus" NOT NULL DEFAULT 'RECORDED',
  "recordedByUserId" TEXT NOT NULL,
  "recordedByMembershipId" TEXT NOT NULL,
  "recordedByShiftId" TEXT NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "externalReference" TEXT,
  "voidedByUserId" TEXT,
  "voidedByMembershipId" TEXT,
  "voidedByShiftId" TEXT,
  "voidedAt" TIMESTAMP(3),
  "voidReason" TEXT,
  CONSTRAINT "PaymentRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StaffProfile_membershipId_key" ON "StaffProfile"("membershipId");
CREATE INDEX "StaffProfile_tenantId_venueId_userId_idx" ON "StaffProfile"("tenantId", "venueId", "userId");
CREATE UNIQUE INDEX "StaffShift_activeShiftKey_key" ON "StaffShift"("activeShiftKey");
CREATE INDEX "StaffShift_tenantId_venueId_userId_status_startedAt_idx" ON "StaffShift"("tenantId", "venueId", "userId", "status", "startedAt");
CREATE UNIQUE INDEX "TableAssignment_activeTableKey_key" ON "TableAssignment"("activeTableKey");
CREATE INDEX "TableAssignment_tenantId_venueId_shiftId_endedAt_idx" ON "TableAssignment"("tenantId", "venueId", "shiftId", "endedAt");
CREATE INDEX "AuditEvent_tenantId_venueId_createdAt_idx" ON "AuditEvent"("tenantId", "venueId", "createdAt");
CREATE INDEX "AuditEvent_actorUserId_actorShiftId_createdAt_idx" ON "AuditEvent"("actorUserId", "actorShiftId", "createdAt");
CREATE INDEX "AuditEvent_entityType_entityId_createdAt_idx" ON "AuditEvent"("entityType", "entityId", "createdAt");
CREATE INDEX "PaymentRecord_tenantId_venueId_tableSessionId_status_idx" ON "PaymentRecord"("tenantId", "venueId", "tableSessionId", "status");
CREATE INDEX "PaymentRecord_recordedByUserId_recordedByShiftId_recordedAt_idx" ON "PaymentRecord"("recordedByUserId", "recordedByShiftId", "recordedAt");
CREATE UNIQUE INDEX "Membership_venueId_userId_key" ON "Membership"("venueId", "userId");

ALTER TABLE "StaffProfile" ADD CONSTRAINT "StaffProfile_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffShift" ADD CONSTRAINT "StaffShift_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffShift" ADD CONSTRAINT "StaffShift_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffShift" ADD CONSTRAINT "StaffShift_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TableAssignment" ADD CONSTRAINT "TableAssignment_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "DiningTable"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TableAssignment" ADD CONSTRAINT "TableAssignment_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "StaffShift"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentRecord" ADD CONSTRAINT "PaymentRecord_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentRecord" ADD CONSTRAINT "PaymentRecord_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentRecord" ADD CONSTRAINT "PaymentRecord_tableSessionId_fkey" FOREIGN KEY ("tableSessionId") REFERENCES "TableSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentRecord" ADD CONSTRAINT "PaymentRecord_recordedByShiftId_fkey" FOREIGN KEY ("recordedByShiftId") REFERENCES "StaffShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentRecord" ADD CONSTRAINT "PaymentRecord_voidedByShiftId_fkey" FOREIGN KEY ("voidedByShiftId") REFERENCES "StaffShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
