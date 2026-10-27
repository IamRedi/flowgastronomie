ALTER TABLE "PaymentRecord" ADD COLUMN "idempotencyKey" TEXT NOT NULL;
CREATE UNIQUE INDEX "PaymentRecord_tableSessionId_recordedByUserId_idempotencyKey_key" ON "PaymentRecord"("tableSessionId", "recordedByUserId", "idempotencyKey");
