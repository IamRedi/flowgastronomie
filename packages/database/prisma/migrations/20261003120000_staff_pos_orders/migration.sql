-- Staff POS orders are created without an anonymous guest session, so the
-- guest-session columns become optional; dine-in orders keep a direct table
-- reference and staff creation is idempotent per membership and key.
ALTER TABLE "Order" ALTER COLUMN "tableSessionId" DROP NOT NULL;
ALTER TABLE "Order" ALTER COLUMN "guestId" DROP NOT NULL;
ALTER TABLE "Order" ADD COLUMN "tableId" TEXT;
ALTER TABLE "Order" ADD COLUMN "staffOrderKey" TEXT;
CREATE UNIQUE INDEX "Order_staffOrderKey_key" ON "Order"("staffOrderKey");
CREATE INDEX "Order_tableId_idx" ON "Order"("tableId");
ALTER TABLE "Order" ADD CONSTRAINT "Order_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "DiningTable"("id") ON DELETE SET NULL ON UPDATE CASCADE;
