CREATE TYPE "LegalHoldTarget" AS ENUM ('ONLINE_ORDER', 'RESERVATION', 'CUSTOMER_PROFILE');

CREATE TABLE "RetentionLegalHold" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "venueId" TEXT NOT NULL,
  "target" "LegalHoldTarget" NOT NULL,
  "targetId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "reviewAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdByMembershipId" TEXT NOT NULL,
  "releasedAt" TIMESTAMP(3),
  "releasedByUserId" TEXT,
  "releasedByMembershipId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RetentionLegalHold_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RetentionLegalHold_tenantId_venueId_target_targetId_expiresAt_idx" ON "RetentionLegalHold"("tenantId", "venueId", "target", "targetId", "expiresAt");
