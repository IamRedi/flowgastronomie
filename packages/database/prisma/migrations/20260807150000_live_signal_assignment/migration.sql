ALTER TABLE "ServiceSignal"
ADD COLUMN "assignedMembershipId" TEXT,
ADD COLUMN "assignedUserId" TEXT,
ADD COLUMN "assignedShiftId" TEXT,
ADD COLUMN "assignedByUserId" TEXT,
ADD COLUMN "claimedAt" TIMESTAMP(3);

CREATE INDEX "ServiceSignal_tenantId_venueId_assignedMembershipId_claimedAt_idx"
ON "ServiceSignal"("tenantId", "venueId", "assignedMembershipId", "claimedAt");
