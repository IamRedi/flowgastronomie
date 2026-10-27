-- Keep trigger expressions specific to their table: PostgreSQL resolves record
-- fields before boolean short-circuiting across differently shaped tables.
CREATE OR REPLACE FUNCTION p2_immutable_financial_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME = 'CashSession' THEN
  IF OLD."status" = 'CLOSED' THEN RAISE EXCEPTION 'Closed cash sessions are immutable'; END IF;
 ELSIF TG_TABLE_NAME = 'OrderItem' THEN
  IF OLD."taxSnapshot" IS NOT NULL AND
   (NEW."taxSnapshot" IS DISTINCT FROM OLD."taxSnapshot" OR NEW."unitPriceMinor" <> OLD."unitPriceMinor" OR NEW."quantity" <> OLD."quantity" OR NEW."productName" <> OLD."productName" OR NEW."productId" <> OLD."productId" OR NEW."orderId" <> OLD."orderId") THEN
   RAISE EXCEPTION 'Order tax and price snapshots are immutable';
  END IF;
 ELSIF TG_TABLE_NAME = 'PaymentRecord' THEN
  IF OLD."orderId" IS NOT NULL THEN RAISE EXCEPTION 'Finalized counter payments require a new correction document'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_closed_fields" CHECK (
 "status" <> 'CLOSED' OR ("countedCashMinor" IS NOT NULL AND "differenceMinor" IS NOT NULL AND "expectedCashMinor" >= 0 AND "closedByMembershipId" IS NOT NULL AND "closedByShiftId" IS NOT NULL));
ALTER TABLE "PaymentRecord" ADD CONSTRAINT "CounterPayment_cash_fields" CHECK (
 "orderId" IS NULL OR "method" <> 'CASH' OR ("receivedMinor" IS NOT NULL AND "changeMinor" IS NOT NULL));
