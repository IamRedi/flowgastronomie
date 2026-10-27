ALTER TABLE "PaymentRecord" ADD COLUMN "onlineOrderId" TEXT;
ALTER TABLE "Receipt" ALTER COLUMN "orderId" DROP NOT NULL;
ALTER TABLE "Receipt" ADD COLUMN "onlineOrderId" TEXT;

CREATE UNIQUE INDEX "PaymentRecord_onlineOrderId_key" ON "PaymentRecord"("onlineOrderId");
CREATE UNIQUE INDEX "Receipt_onlineOrderId_key" ON "Receipt"("onlineOrderId");

ALTER TABLE "PaymentRecord" ADD CONSTRAINT "PaymentRecord_onlineOrderId_fkey"
  FOREIGN KEY ("onlineOrderId") REFERENCES "OnlineOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_onlineOrderId_fkey"
  FOREIGN KEY ("onlineOrderId") REFERENCES "OnlineOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentRecord" ADD CONSTRAINT "PaymentRecord_counter_order_exclusive"
  CHECK ("onlineOrderId" IS NULL OR ("orderId" IS NULL AND "tableSessionId" IS NULL));
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_order_source_exactly_one"
  CHECK (("orderId" IS NULL) <> ("onlineOrderId" IS NULL));
