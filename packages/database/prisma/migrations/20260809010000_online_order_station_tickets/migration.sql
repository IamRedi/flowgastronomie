CREATE TABLE "OnlineOrderStationTicket" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "venueId" TEXT NOT NULL,
  "onlineOrderId" TEXT NOT NULL,
  "station" "StationType" NOT NULL,
  "status" "ProductionTicketStatus" NOT NULL DEFAULT 'NEW',
  "version" INTEGER NOT NULL DEFAULT 1,
  "readyAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OnlineOrderStationTicket_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OnlineOrderStationTicket_onlineOrderId_station_key" ON "OnlineOrderStationTicket"("onlineOrderId", "station");
CREATE INDEX "OnlineOrderStationTicket_tenantId_venueId_station_status_createdAt_idx" ON "OnlineOrderStationTicket"("tenantId", "venueId", "station", "status", "createdAt");
ALTER TABLE "OnlineOrderStationTicket" ADD CONSTRAINT "OnlineOrderStationTicket_onlineOrderId_fkey" FOREIGN KEY ("onlineOrderId") REFERENCES "OnlineOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
