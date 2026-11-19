ALTER TABLE "transfers" ADD COLUMN "released_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transfers" ADD COLUMN "reversed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transfers" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "transfers" ADD COLUMN "last_error" text;--> statement-breakpoint
CREATE INDEX "transfers_status_idx" ON "transfers" USING btree ("status");