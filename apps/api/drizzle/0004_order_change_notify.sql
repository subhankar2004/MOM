-- Live order updates (#17): every change to an order's status, payment or token sends a
-- Postgres notification on channel "mom_orders". Notifications are delivered when the
-- transaction commits, so listeners never see a change that was rolled back.
-- Payload is tiny (ids + new state); listeners fetch details through the normal API.
CREATE FUNCTION "notify_order_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify(
    'mom_orders',
    json_build_object(
      'orderId', NEW.id,
      'userId', NEW.user_id,
      'stallId', NEW.stall_id,
      'status', NEW.status,
      'paymentStatus', NEW.payment_status,
      'tokenNo', NEW.token_no
    )::text
  );
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "orders_notify_insert"
  AFTER INSERT ON "orders"
  FOR EACH ROW EXECUTE FUNCTION "notify_order_change"();
--> statement-breakpoint
CREATE TRIGGER "orders_notify_update"
  AFTER UPDATE OF "status", "payment_status", "token_no" ON "orders"
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status
     OR OLD.payment_status IS DISTINCT FROM NEW.payment_status
     OR OLD.token_no IS DISTINCT FROM NEW.token_no)
  EXECUTE FUNCTION "notify_order_change"();
