CREATE TYPE "ReservationStatus" AS ENUM ('REQUESTED', 'CONFIRMED', 'SEATED', 'COMPLETED', 'REJECTED', 'CANCELLED', 'NO_SHOW');

ALTER TABLE "Venue" ADD COLUMN "reservationCapacity" INTEGER NOT NULL DEFAULT 40;
ALTER TABLE "Venue" ADD COLUMN "reservationDurationMinutes" INTEGER NOT NULL DEFAULT 120;

CREATE TABLE "Reservation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'REQUESTED',
    "guestName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "locale" "Locale" NOT NULL DEFAULT 'SQ',
    "requestedFor" TIMESTAMP(3) NOT NULL,
    "partySize" INTEGER NOT NULL,
    "guestNotes" TEXT,
    "tableId" TEXT,
    "bookingDurationMinutes" INTEGER NOT NULL DEFAULT 120,
    "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "statusChangedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Reservation_tenantId_venueId_idempotencyKey_key" ON "Reservation"("tenantId", "venueId", "idempotencyKey");
CREATE INDEX "Reservation_tenantId_venueId_requestedFor_status_idx" ON "Reservation"("tenantId", "venueId", "requestedFor", "status");
CREATE INDEX "Reservation_tenantId_venueId_tableId_requestedFor_idx" ON "Reservation"("tenantId", "venueId", "tableId", "requestedFor");
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "DiningTable"("id") ON DELETE SET NULL ON UPDATE CASCADE;
