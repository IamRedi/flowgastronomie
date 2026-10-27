CREATE TYPE "OrderSource" AS ENUM ('GUEST_QR', 'STAFF_TABLET');

ALTER TABLE "Order"
ADD COLUMN "source" "OrderSource" NOT NULL DEFAULT 'GUEST_QR',
ADD COLUMN "createdByUserId" TEXT,
ADD COLUMN "createdByMembershipId" TEXT,
ADD COLUMN "createdByShiftId" TEXT,
ADD COLUMN "serviceOwnerUserId" TEXT,
ADD COLUMN "serviceOwnerMembershipId" TEXT,
ADD COLUMN "serviceOwnerShiftId" TEXT;

CREATE INDEX "Order_serviceOwnerMembershipId_status_idx" ON "Order"("serviceOwnerMembershipId", "status");
