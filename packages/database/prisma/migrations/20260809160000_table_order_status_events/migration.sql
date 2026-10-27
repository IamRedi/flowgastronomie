-- CreateEnum
CREATE TYPE "OrderStatusEventKind" AS ENUM ('INITIAL', 'TRANSITION');

-- CreateTable
CREATE TABLE "OrderStatusEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL,
    "kind" "OrderStatusEventKind" NOT NULL,
    "actorUserId" TEXT,
    "actorMembershipId" TEXT,
    "actorShiftId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderStatusEvent_tenantId_venueId_orderId_createdAt_idx"
ON "OrderStatusEvent"("tenantId", "venueId", "orderId", "createdAt");

-- AddForeignKey
ALTER TABLE "OrderStatusEvent"
ADD CONSTRAINT "OrderStatusEvent_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
