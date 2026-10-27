CREATE TYPE "ProductionTicketStatus" AS ENUM ('NEW', 'PREPARING', 'READY');

CREATE TABLE "OrderStationTicket" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "station" "StationType" NOT NULL,
    "status" "ProductionTicketStatus" NOT NULL DEFAULT 'NEW',
    "version" INTEGER NOT NULL DEFAULT 1,
    "assignedMembershipId" TEXT,
    "assignedUserId" TEXT,
    "assignedShiftId" TEXT,
    "assignedByUserId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderStationTicket_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrderStationTicket_orderId_station_key" ON "OrderStationTicket"("orderId", "station");
CREATE INDEX "OrderStationTicket_tenantId_venueId_station_status_createdAt_idx" ON "OrderStationTicket"("tenantId", "venueId", "station", "status", "createdAt");
CREATE INDEX "OrderStationTicket_assignedMembershipId_status_idx" ON "OrderStationTicket"("assignedMembershipId", "status");

ALTER TABLE "OrderStationTicket" ADD CONSTRAINT "OrderStationTicket_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
