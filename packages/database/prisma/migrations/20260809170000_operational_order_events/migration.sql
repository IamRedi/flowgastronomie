-- CreateEnum
CREATE TYPE "OperationalOrderKind" AS ENUM ('TABLE', 'ONLINE');

-- CreateEnum
CREATE TYPE "OperationalOrderEventType" AS ENUM ('ORDER_CREATED', 'ORDER_STATUS_CHANGED');

-- CreateTable
CREATE TABLE "OperationalOrderEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderKind" "OperationalOrderKind" NOT NULL,
    "type" "OperationalOrderEventType" NOT NULL,
    "source" TEXT NOT NULL,
    "fulfillment" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "totalMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorMembershipId" TEXT,
    "actorShiftId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationalOrderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OperationalOrderEvent_tenantId_venueId_occurredAt_idx"
ON "OperationalOrderEvent"("tenantId", "venueId", "occurredAt");

-- CreateIndex
CREATE INDEX "OperationalOrderEvent_tenantId_venueId_orderKind_orderId_occurredAt_idx"
ON "OperationalOrderEvent"("tenantId", "venueId", "orderKind", "orderId", "occurredAt");
