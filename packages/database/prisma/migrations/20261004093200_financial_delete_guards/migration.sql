-- Extend immutability to deletion as well as updates. Only fixture cleanup
-- opts out, using the same transaction-local flag as receipt cleanup.
CREATE FUNCTION p2_financial_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('flowgastronomie.test_cleanup', true) = 'on' THEN RETURN OLD; END IF;
 IF TG_TABLE_NAME = 'CashSession' THEN
  IF OLD."status" = 'CLOSED' THEN RAISE EXCEPTION 'Closed cash sessions are immutable'; END IF;
 ELSIF TG_TABLE_NAME = 'PaymentRecord' THEN
  IF OLD."orderId" IS NOT NULL THEN RAISE EXCEPTION 'Finalized counter payments require a new correction document'; END IF;
 ELSIF TG_TABLE_NAME = 'OrderItem' THEN
  IF OLD."taxSnapshot" IS NOT NULL THEN RAISE EXCEPTION 'Order tax and price snapshots are immutable'; END IF;
 END IF;
 RETURN OLD;
END;
$$;
CREATE TRIGGER "CashSession_delete_immutable" BEFORE DELETE ON "CashSession" FOR EACH ROW EXECUTE FUNCTION p2_financial_delete_guard();
CREATE TRIGGER "CounterPayment_delete_immutable" BEFORE DELETE ON "PaymentRecord" FOR EACH ROW EXECUTE FUNCTION p2_financial_delete_guard();
CREATE TRIGGER "OrderItem_delete_immutable" BEFORE DELETE ON "OrderItem" FOR EACH ROW EXECUTE FUNCTION p2_financial_delete_guard();
