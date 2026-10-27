-- CreateEnum
CREATE TYPE "CashSessionStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('FINALIZED');

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'CARD_AT_COUNTER';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "taxCategoryId" TEXT;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "taxSnapshot" JSONB;

-- AlterTable
ALTER TABLE "OnlineOrderItem" ADD COLUMN     "taxSnapshot" JSONB;

-- AlterTable
ALTER TABLE "PaymentRecord" ADD COLUMN     "cashSessionId" TEXT,
ADD COLUMN     "changeMinor" INTEGER,
ADD COLUMN     "counterPaymentKey" TEXT,
ADD COLUMN     "orderId" TEXT,
ADD COLUMN     "receivedMinor" INTEGER,
ALTER COLUMN "tableSessionId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "CashSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "openedByMembershipId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "closedByMembershipId" TEXT,
    "closedByShiftId" TEXT,
    "openingCashMinor" INTEGER NOT NULL,
    "expectedCashMinor" INTEGER,
    "countedCashMinor" INTEGER,
    "differenceMinor" INTEGER,
    "status" "CashSessionStatus" NOT NULL DEFAULT 'OPEN',
    "activeVenueKey" TEXT,
    "openingNote" TEXT,
    "closingNote" TEXT,

    CONSTRAINT "CashSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxCategory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "rateBasisPoints" INTEGER NOT NULL,
    "dineInRateBasisPoints" INTEGER,
    "takeawayRateBasisPoints" INTEGER,

    CONSTRAINT "TaxCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptSequence" (
    "venueId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ReceiptSequence_pkey" PRIMARY KEY ("venueId")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "number" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'FINALIZED',
    "snapshot" JSONB NOT NULL,
    "fiscalTransactionId" TEXT,
    "tseSerial" TEXT,
    "signatureCounter" BIGINT,
    "signature" TEXT,
    "transactionStartedAt" TIMESTAMP(3),
    "transactionEndedAt" TIMESTAMP(3),
    "verificationPayload" TEXT,
    "exportReference" TEXT,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CashSession_activeVenueKey_key" ON "CashSession"("activeVenueKey");

-- CreateIndex
CREATE INDEX "CashSession_tenantId_venueId_status_idx" ON "CashSession"("tenantId", "venueId", "status");

-- CreateIndex
CREATE INDEX "TaxCategory_tenantId_venueId_idx" ON "TaxCategory"("tenantId", "venueId");

-- CreateIndex
CREATE UNIQUE INDEX "TaxCategory_venueId_code_key" ON "TaxCategory"("venueId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_orderId_key" ON "Receipt"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_paymentId_key" ON "Receipt"("paymentId");

-- CreateIndex
CREATE INDEX "Receipt_tenantId_venueId_issuedAt_idx" ON "Receipt"("tenantId", "venueId", "issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_venueId_sequence_key" ON "Receipt"("venueId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_venueId_number_key" ON "Receipt"("venueId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRecord_orderId_key" ON "PaymentRecord"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRecord_counterPaymentKey_key" ON "PaymentRecord"("counterPaymentKey");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_taxCategoryId_fkey" FOREIGN KEY ("taxCategoryId") REFERENCES "TaxCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRecord" ADD CONSTRAINT "PaymentRecord_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRecord" ADD CONSTRAINT "PaymentRecord_cashSessionId_fkey" FOREIGN KEY ("cashSessionId") REFERENCES "CashSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_openedByMembershipId_fkey" FOREIGN KEY ("openedByMembershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "StaffShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxCategory" ADD CONSTRAINT "TaxCategory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxCategory" ADD CONSTRAINT "TaxCategory_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptSequence" ADD CONSTRAINT "ReceiptSequence_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptSequence" ADD CONSTRAINT "ReceiptSequence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "PaymentRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- P2 financial invariants. Privileged local demo/test cleanup is explicit and
-- transaction-scoped; no application route enables it.
ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_amounts" CHECK (
 "openingCashMinor" >= 0 AND ("status" <> 'CLOSED' OR
 ("closedAt" IS NOT NULL AND "activeVenueKey" IS NULL AND
  "expectedCashMinor" IS NOT NULL AND "countedCashMinor" >= 0 AND
  "differenceMinor" = "countedCashMinor" - "expectedCashMinor")));
ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_open_key" CHECK (
 ("status" = 'OPEN' AND "activeVenueKey" = "venueId") OR
 ("status" = 'CLOSED' AND "activeVenueKey" IS NULL));
ALTER TABLE "TaxCategory" ADD CONSTRAINT "TaxCategory_rates" CHECK (
 "rateBasisPoints" BETWEEN 0 AND 10000 AND
 ("dineInRateBasisPoints" IS NULL OR "dineInRateBasisPoints" BETWEEN 0 AND 10000) AND
 ("takeawayRateBasisPoints" IS NULL OR "takeawayRateBasisPoints" BETWEEN 0 AND 10000));
ALTER TABLE "PaymentRecord" ADD CONSTRAINT "CounterPayment_shape" CHECK (
 "orderId" IS NULL OR ("amountMinor" >= 0 AND "counterPaymentKey" IS NOT NULL AND
 (("method" = 'CASH' AND "cashSessionId" IS NOT NULL AND "receivedMinor" >= "amountMinor" AND "changeMinor" = "receivedMinor" - "amountMinor") OR
 ("method"::text = 'CARD_AT_COUNTER' AND "cashSessionId" IS NULL AND "receivedMinor" IS NULL AND "changeMinor" IS NULL))));

CREATE FUNCTION p2_immutable_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' AND current_setting('flowgastronomie.test_cleanup', true) = 'on' THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Finalized receipts are immutable; issue a new correction document';
END;
$$;
CREATE TRIGGER "Receipt_immutable" BEFORE UPDATE OR DELETE ON "Receipt"
 FOR EACH ROW EXECUTE FUNCTION p2_immutable_receipt();

CREATE FUNCTION p2_immutable_financial_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME = 'CashSession' AND OLD."status" = 'CLOSED' THEN
  RAISE EXCEPTION 'Closed cash sessions are immutable';
 ELSIF TG_TABLE_NAME = 'OrderItem' AND OLD."taxSnapshot" IS NOT NULL AND
  (NEW."taxSnapshot" IS DISTINCT FROM OLD."taxSnapshot" OR NEW."unitPriceMinor" <> OLD."unitPriceMinor" OR NEW."quantity" <> OLD."quantity" OR NEW."productName" <> OLD."productName" OR NEW."productId" <> OLD."productId" OR NEW."orderId" <> OLD."orderId") THEN
  RAISE EXCEPTION 'Order tax and price snapshots are immutable';
 ELSIF TG_TABLE_NAME = 'PaymentRecord' AND OLD."orderId" IS NOT NULL THEN
  RAISE EXCEPTION 'Finalized counter payments require a new correction document';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER "CashSession_closed_immutable" BEFORE UPDATE ON "CashSession" FOR EACH ROW EXECUTE FUNCTION p2_immutable_financial_snapshot();
CREATE TRIGGER "OrderItem_tax_immutable" BEFORE UPDATE ON "OrderItem" FOR EACH ROW EXECUTE FUNCTION p2_immutable_financial_snapshot();
CREATE TRIGGER "CounterPayment_immutable" BEFORE UPDATE ON "PaymentRecord" FOR EACH ROW EXECUTE FUNCTION p2_immutable_financial_snapshot();
