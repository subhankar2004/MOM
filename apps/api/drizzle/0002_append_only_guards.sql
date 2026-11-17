-- Money ledger and audit log are append-only (spec §4.4, A8).
-- Corrections are made by inserting a new entry (e.g. an 'adjustment'), never by
-- editing or deleting history. Enforced in the database so no code path can bypass it.
CREATE FUNCTION "prevent_append_only_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on "%" is not allowed: the table is append-only', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "ledger_entries_append_only"
  BEFORE UPDATE OR DELETE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION "prevent_append_only_mutation"();
--> statement-breakpoint
CREATE TRIGGER "ledger_entries_no_truncate"
  BEFORE TRUNCATE ON "ledger_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION "prevent_append_only_mutation"();
--> statement-breakpoint
CREATE TRIGGER "audit_log_append_only"
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION "prevent_append_only_mutation"();
--> statement-breakpoint
CREATE TRIGGER "audit_log_no_truncate"
  BEFORE TRUNCATE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION "prevent_append_only_mutation"();
