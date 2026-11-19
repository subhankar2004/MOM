CREATE TABLE "reconciliation_runs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "reconciliation_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"orders_checked" integer NOT NULL,
	"status" text NOT NULL,
	"issues" jsonb NOT NULL,
	"started_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reconciliation_runs_status" CHECK ("reconciliation_runs"."status" in ('ok', 'mismatch'))
);
--> statement-breakpoint
ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reconciliation_runs_created_idx" ON "reconciliation_runs" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
-- Reconciliation results are evidence, like the ledger: append-only.
CREATE TRIGGER "reconciliation_runs_append_only"
  BEFORE UPDATE OR DELETE ON "reconciliation_runs"
  FOR EACH ROW EXECUTE FUNCTION "prevent_append_only_mutation"();
--> statement-breakpoint
CREATE TRIGGER "reconciliation_runs_no_truncate"
  BEFORE TRUNCATE ON "reconciliation_runs"
  FOR EACH STATEMENT EXECUTE FUNCTION "prevent_append_only_mutation"();
