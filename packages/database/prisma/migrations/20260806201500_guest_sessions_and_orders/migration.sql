-- AlterTable
ALTER TABLE "Order" DROP COLUMN "guestKey",
ADD COLUMN "guestId" TEXT NOT NULL,
ADD COLUMN "idempotencyKey" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "ServiceSignal" ADD COLUMN "guestId" TEXT,
ADD COLUMN "idempotencyKey" TEXT,
ADD COLUMN "orderId" TEXT;

-- AlterTable
ALTER TABLE "TableSession" ADD COLUMN "activeTableKey" TEXT;

-- CreateTable
CREATE TABLE "TableGuest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "tableSessionId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TableGuest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TableGuest_tokenHash_key" ON "TableGuest"("tokenHash");

-- CreateIndex
CREATE INDEX "TableGuest_tenantId_venueId_tableSessionId_idx" ON "TableGuest"("tenantId", "venueId", "tableSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_tableSessionId_guestId_idempotencyKey_key" ON "Order"("tableSessionId", "guestId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceSignal_orderId_key" ON "ServiceSignal"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceSignal_tableSessionId_guestId_idempotencyKey_key" ON "ServiceSignal"("tableSessionId", "guestId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "TableSession_activeTableKey_key" ON "TableSession"("activeTableKey");

-- AddForeignKey
ALTER TABLE "TableGuest" ADD CONSTRAINT "TableGuest_tableSessionId_fkey" FOREIGN KEY ("tableSessionId") REFERENCES "TableSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "TableGuest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceSignal" ADD CONSTRAINT "ServiceSignal_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "TableGuest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceSignal" ADD CONSTRAINT "ServiceSignal_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
