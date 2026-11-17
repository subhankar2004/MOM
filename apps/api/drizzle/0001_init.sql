CREATE TYPE "public"."ledger_direction" AS ENUM('credit', 'debit');--> statement-breakpoint
CREATE TYPE "public"."ledger_entry_type" AS ENUM('platform_fee', 'cash_fee', 'refund_reversal', 'settlement', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."order_payment_status" AS ENUM('pending', 'paid', 'due', 'paid_cash', 'refund_pending', 'refunded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('pending_payment', 'placed', 'preparing', 'ready', 'collected', 'rejected', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."payment_attempt_status" AS ENUM('created', 'authorized', 'captured', 'failed');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('upi', 'cash');--> statement-breakpoint
CREATE TYPE "public"."payment_provider" AS ENUM('razorpay');--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('pending', 'processed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."route_status" AS ENUM('not_started', 'pending', 'activated', 'rejected', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."stall_member_role" AS ENUM('owner', 'staff');--> statement-breakpoint
CREATE TYPE "public"."stall_status" AS ENUM('draft', 'active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."transfer_status" AS ENUM('created', 'on_hold', 'released', 'reversed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('student', 'vendor_owner', 'vendor_staff', 'super_admin');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TABLE "auth_otps" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "auth_otps_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"phone" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_otps_attempts_range" CHECK ("auth_otps"."attempts" between 0 and 20)
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"family_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"user_agent" text,
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"phone" text,
	"name" text,
	"role" "user_role" DEFAULT 'student' NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"cash_strikes" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_phone_unique" UNIQUE("phone"),
	CONSTRAINT "users_phone_format" CHECK ("users"."phone" ~ '^\+91[6-9][0-9]{9}$'),
	CONSTRAINT "users_phone_present_unless_deleted" CHECK ("users"."phone" is not null or "users"."deleted_at" is not null),
	CONSTRAINT "users_name_length" CHECK (char_length("users"."name") between 1 and 60),
	CONSTRAINT "users_cash_strikes_non_negative" CHECK ("users"."cash_strikes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stall_hours" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "stall_hours_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"stall_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"opens_at" time NOT NULL,
	"closes_at" time NOT NULL,
	CONSTRAINT "stall_hours_slot_unique" UNIQUE("stall_id","weekday","opens_at"),
	CONSTRAINT "stall_hours_weekday_range" CHECK ("stall_hours"."weekday" between 1 and 7),
	CONSTRAINT "stall_hours_not_empty" CHECK ("stall_hours"."opens_at" <> "stall_hours"."closes_at")
);
--> statement-breakpoint
CREATE TABLE "stall_members" (
	"stall_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "stall_member_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stall_members_stall_id_user_id_pk" PRIMARY KEY("stall_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "stalls" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"location" text,
	"photo_key" text,
	"cuisine_tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_veg_only" boolean DEFAULT false NOT NULL,
	"status" "stall_status" DEFAULT 'draft' NOT NULL,
	"is_open_override" boolean,
	"accepting_orders" boolean DEFAULT true NOT NULL,
	"avg_prep_minutes" smallint DEFAULT 10 NOT NULL,
	"parallel_capacity" smallint DEFAULT 2 NOT NULL,
	"upi_enabled" boolean DEFAULT false NOT NULL,
	"cash_enabled" boolean DEFAULT true NOT NULL,
	"razorpay_account_id" text,
	"route_status" "route_status" DEFAULT 'not_started' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stalls_slug_unique" UNIQUE("slug"),
	CONSTRAINT "stalls_razorpay_account_id_unique" UNIQUE("razorpay_account_id"),
	CONSTRAINT "stalls_slug_format" CHECK ("stalls"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "stalls_name_length" CHECK (char_length("stalls"."name") between 2 and 60),
	CONSTRAINT "stalls_avg_prep_range" CHECK ("stalls"."avg_prep_minutes" between 1 and 120),
	CONSTRAINT "stalls_capacity_range" CHECK ("stalls"."parallel_capacity" between 1 and 50)
);
--> statement-breakpoint
CREATE TABLE "vendor_invites" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"phone" text NOT NULL,
	"stall_id" uuid NOT NULL,
	"role" "stall_member_role" DEFAULT 'owner' NOT NULL,
	"invited_by" uuid,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_invites_phone_stall_unique" UNIQUE("phone","stall_id"),
	CONSTRAINT "vendor_invites_phone_format" CHECK ("vendor_invites"."phone" ~ '^\+91[6-9][0-9]{9}$')
);
--> statement-breakpoint
CREATE TABLE "menu_categories" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"stall_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "menu_categories_id_stall_unique" UNIQUE("id","stall_id"),
	CONSTRAINT "menu_categories_name_length" CHECK (char_length("menu_categories"."name") between 1 and 40)
);
--> statement-breakpoint
CREATE TABLE "menu_items" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"stall_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_paise" integer NOT NULL,
	"is_veg" boolean NOT NULL,
	"image_key" text,
	"is_available" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "menu_items_name_length" CHECK (char_length("menu_items"."name") between 1 and 80),
	CONSTRAINT "menu_items_description_length" CHECK (char_length("menu_items"."description") <= 300),
	CONSTRAINT "menu_items_price_range" CHECK ("menu_items"."price_paise" between 100 and 1000000)
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "platform_settings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"platform_fee_bps" integer NOT NULL,
	"cash_fee_bps" integer NOT NULL,
	"max_open_cash_orders" smallint NOT NULL,
	"cash_strike_limit" smallint NOT NULL,
	"order_expiry_minutes" smallint NOT NULL,
	"congestion_low_max_minutes" smallint NOT NULL,
	"congestion_moderate_max_minutes" smallint NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_settings_platform_fee_range" CHECK ("platform_settings"."platform_fee_bps" between 0 and 2000),
	CONSTRAINT "platform_settings_cash_fee_range" CHECK ("platform_settings"."cash_fee_bps" between 0 and 2000),
	CONSTRAINT "platform_settings_max_cash_orders_range" CHECK ("platform_settings"."max_open_cash_orders" between 0 and 20),
	CONSTRAINT "platform_settings_strike_limit_range" CHECK ("platform_settings"."cash_strike_limit" between 1 and 20),
	CONSTRAINT "platform_settings_expiry_range" CHECK ("platform_settings"."order_expiry_minutes" between 5 and 60),
	CONSTRAINT "platform_settings_congestion_order" CHECK ("platform_settings"."congestion_low_max_minutes" > 0 and "platform_settings"."congestion_low_max_minutes" < "platform_settings"."congestion_moderate_max_minutes")
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "order_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"order_id" uuid NOT NULL,
	"menu_item_id" uuid NOT NULL,
	"name_snapshot" text NOT NULL,
	"unit_price_paise" integer NOT NULL,
	"quantity" smallint NOT NULL,
	"line_total_paise" integer NOT NULL,
	CONSTRAINT "order_items_quantity_range" CHECK ("order_items"."quantity" between 1 and 50),
	CONSTRAINT "order_items_unit_price_positive" CHECK ("order_items"."unit_price_paise" > 0),
	CONSTRAINT "order_items_line_total_matches" CHECK ("order_items"."line_total_paise" = "order_items"."unit_price_paise" * "order_items"."quantity")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"user_id" uuid NOT NULL,
	"stall_id" uuid NOT NULL,
	"token_day" date,
	"token_no" integer,
	"pickup_code" text NOT NULL,
	"status" "order_status" NOT NULL,
	"payment_method" "payment_method" NOT NULL,
	"payment_status" "order_payment_status" NOT NULL,
	"subtotal_paise" integer NOT NULL,
	"platform_fee_paise" integer NOT NULL,
	"cash_fee_paise" integer NOT NULL,
	"total_paise" integer NOT NULL,
	"platform_fee_bps" integer NOT NULL,
	"cash_fee_bps" integer NOT NULL,
	"settings_id" bigint NOT NULL,
	"note" text,
	"reject_reason" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"placed_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"collected_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	CONSTRAINT "orders_stall_token_unique" UNIQUE("stall_id","token_day","token_no"),
	CONSTRAINT "orders_user_idempotency_unique" UNIQUE("user_id","idempotency_key"),
	CONSTRAINT "orders_subtotal_positive" CHECK ("orders"."subtotal_paise" > 0),
	CONSTRAINT "orders_fees_non_negative" CHECK ("orders"."platform_fee_paise" >= 0 and "orders"."cash_fee_paise" >= 0),
	CONSTRAINT "orders_total_matches" CHECK ("orders"."total_paise" = "orders"."subtotal_paise" + "orders"."platform_fee_paise" + "orders"."cash_fee_paise"),
	CONSTRAINT "orders_upi_has_no_cash_fee" CHECK ("orders"."payment_method" = 'cash' or "orders"."cash_fee_paise" = 0),
	CONSTRAINT "orders_fee_bps_range" CHECK ("orders"."platform_fee_bps" between 0 and 2000 and "orders"."cash_fee_bps" between 0 and 2000),
	CONSTRAINT "orders_payment_status_matches_method" CHECK (("orders"."payment_method" = 'upi' and "orders"."payment_status" in ('pending','paid','refund_pending','refunded','failed'))
       or ("orders"."payment_method" = 'cash' and "orders"."payment_status" in ('due','paid_cash','failed'))),
	CONSTRAINT "orders_token_pair" CHECK (("orders"."token_no" is null) = ("orders"."token_day" is null)),
	CONSTRAINT "orders_token_positive" CHECK ("orders"."token_no" is null or "orders"."token_no" > 0),
	CONSTRAINT "orders_token_when_issued" CHECK ("orders"."status" not in ('placed','preparing','ready','collected') or "orders"."token_no" is not null),
	CONSTRAINT "orders_pickup_code_format" CHECK ("orders"."pickup_code" ~ '^[0-9]{4}$'),
	CONSTRAINT "orders_note_length" CHECK (char_length("orders"."note") <= 200),
	CONSTRAINT "orders_idempotency_key_length" CHECK (char_length("orders"."idempotency_key") between 8 and 100)
);
--> statement-breakpoint
CREATE TABLE "token_counters" (
	"stall_id" uuid NOT NULL,
	"day" date NOT NULL,
	"last_token" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "token_counters_stall_id_day_pk" PRIMARY KEY("stall_id","day"),
	CONSTRAINT "token_counters_last_token_non_negative" CHECK ("token_counters"."last_token" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"order_id" uuid NOT NULL,
	"provider" "payment_provider" DEFAULT 'razorpay' NOT NULL,
	"provider_order_id" text NOT NULL,
	"provider_payment_id" text,
	"amount_paise" integer NOT NULL,
	"status" "payment_attempt_status" DEFAULT 'created' NOT NULL,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_provider_order_id_unique" UNIQUE("provider_order_id"),
	CONSTRAINT "payments_provider_payment_id_unique" UNIQUE("provider_payment_id"),
	CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount_paise" > 0)
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"payment_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"amount_paise" integer NOT NULL,
	"provider_refund_id" text,
	"status" "refund_status" DEFAULT 'pending' NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_provider_refund_id_unique" UNIQUE("provider_refund_id"),
	CONSTRAINT "refunds_amount_positive" CHECK ("refunds"."amount_paise" > 0)
);
--> statement-breakpoint
CREATE TABLE "transfers" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"order_id" uuid NOT NULL,
	"stall_id" uuid NOT NULL,
	"provider_transfer_id" text,
	"amount_paise" integer NOT NULL,
	"status" "transfer_status" DEFAULT 'created' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transfers_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "transfers_provider_transfer_id_unique" UNIQUE("provider_transfer_id"),
	CONSTRAINT "transfers_amount_positive" CHECK ("transfers"."amount_paise" > 0)
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	CONSTRAINT "webhook_events_provider_event_unique" UNIQUE("provider","event_id")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cash_settlements" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"stall_id" uuid NOT NULL,
	"amount_paise" integer NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"received_by" uuid NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_settlements_amount_positive" CHECK ("cash_settlements"."amount_paise" > 0),
	CONSTRAINT "cash_settlements_period_order" CHECK ("cash_settlements"."period_end" >= "cash_settlements"."period_start")
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ledger_entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"stall_id" uuid NOT NULL,
	"order_id" uuid,
	"entry_type" "ledger_entry_type" NOT NULL,
	"direction" "ledger_direction" NOT NULL,
	"amount_paise" integer NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_amount_positive" CHECK ("ledger_entries"."amount_paise" > 0),
	CONSTRAINT "ledger_entries_order_required" CHECK ("ledger_entries"."entry_type" in ('settlement','adjustment') or "ledger_entries"."order_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stall_hours" ADD CONSTRAINT "stall_hours_stall_id_stalls_id_fk" FOREIGN KEY ("stall_id") REFERENCES "public"."stalls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stall_members" ADD CONSTRAINT "stall_members_stall_id_stalls_id_fk" FOREIGN KEY ("stall_id") REFERENCES "public"."stalls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stall_members" ADD CONSTRAINT "stall_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_invites" ADD CONSTRAINT "vendor_invites_stall_id_stalls_id_fk" FOREIGN KEY ("stall_id") REFERENCES "public"."stalls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_invites" ADD CONSTRAINT "vendor_invites_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_categories" ADD CONSTRAINT "menu_categories_stall_id_stalls_id_fk" FOREIGN KEY ("stall_id") REFERENCES "public"."stalls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_stall_id_stalls_id_fk" FOREIGN KEY ("stall_id") REFERENCES "public"."stalls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_category_same_stall_fk" FOREIGN KEY ("category_id","stall_id") REFERENCES "public"."menu_categories"("id","stall_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_stall_id_stalls_id_fk" FOREIGN KEY ("stall_id") REFERENCES "public"."stalls"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_settings_id_platform_settings_id_fk" FOREIGN KEY ("settings_id") REFERENCES "public"."platform_settings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_counters" ADD CONSTRAINT "token_counters_stall_id_stalls_id_fk" FOREIGN KEY ("stall_id") REFERENCES "public"."stalls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_stall_id_stalls_id_fk" FOREIGN KEY ("stall_id") REFERENCES "public"."stalls"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_settlements" ADD CONSTRAINT "cash_settlements_stall_id_stalls_id_fk" FOREIGN KEY ("stall_id") REFERENCES "public"."stalls"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_settlements" ADD CONSTRAINT "cash_settlements_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_stall_id_stalls_id_fk" FOREIGN KEY ("stall_id") REFERENCES "public"."stalls"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_otps_phone_created_idx" ON "auth_otps" USING btree ("phone","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "auth_otps_ip_created_idx" ON "auth_otps" USING btree ("ip","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_idx" ON "refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role") WHERE "users"."role" <> 'student';--> statement-breakpoint
CREATE INDEX "stall_hours_stall_idx" ON "stall_hours" USING btree ("stall_id","weekday");--> statement-breakpoint
CREATE INDEX "stall_members_user_idx" ON "stall_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "stalls_status_idx" ON "stalls" USING btree ("status");--> statement-breakpoint
CREATE INDEX "vendor_invites_phone_pending_idx" ON "vendor_invites" USING btree ("phone") WHERE "vendor_invites"."accepted_at" is null;--> statement-breakpoint
CREATE INDEX "vendor_invites_stall_idx" ON "vendor_invites" USING btree ("stall_id");--> statement-breakpoint
CREATE INDEX "vendor_invites_invited_by_idx" ON "vendor_invites" USING btree ("invited_by");--> statement-breakpoint
CREATE UNIQUE INDEX "menu_categories_stall_name_unique" ON "menu_categories" USING btree ("stall_id",lower("name")) WHERE "menu_categories"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "menu_categories_stall_sort_idx" ON "menu_categories" USING btree ("stall_id","sort_order");--> statement-breakpoint
CREATE INDEX "menu_items_menu_idx" ON "menu_items" USING btree ("stall_id","category_id","sort_order") WHERE "menu_items"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "menu_items_category_idx" ON "menu_items" USING btree ("category_id","stall_id");--> statement-breakpoint
CREATE INDEX "platform_settings_effective_idx" ON "platform_settings" USING btree ("effective_from" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "platform_settings_created_by_idx" ON "platform_settings" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_items_menu_item_idx" ON "order_items" USING btree ("menu_item_id");--> statement-breakpoint
CREATE INDEX "orders_user_created_idx" ON "orders" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "orders_stall_created_idx" ON "orders" USING btree ("stall_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "orders_stall_active_idx" ON "orders" USING btree ("stall_id","status") WHERE "orders"."status" in ('placed','preparing','ready');--> statement-breakpoint
CREATE INDEX "orders_pending_expiry_idx" ON "orders" USING btree ("expires_at") WHERE "orders"."status" = 'pending_payment';--> statement-breakpoint
CREATE INDEX "orders_user_open_cash_idx" ON "orders" USING btree ("user_id") WHERE "orders"."payment_method" = 'cash' and "orders"."status" in ('placed','preparing','ready');--> statement-breakpoint
CREATE INDEX "orders_settings_idx" ON "orders" USING btree ("settings_id");--> statement-breakpoint
CREATE INDEX "orders_created_idx" ON "orders" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "payments_order_idx" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "refunds_payment_idx" ON "refunds" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "refunds_order_idx" ON "refunds" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "refunds_created_by_idx" ON "refunds" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "transfers_stall_created_idx" ON "transfers" USING btree ("stall_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "webhook_events_unprocessed_idx" ON "webhook_events" USING btree ("received_at") WHERE "webhook_events"."processed_at" is null;--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity","entity_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "cash_settlements_stall_idx" ON "cash_settlements" USING btree ("stall_id","period_end" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "cash_settlements_received_by_idx" ON "cash_settlements" USING btree ("received_by");--> statement-breakpoint
CREATE INDEX "ledger_entries_stall_created_idx" ON "ledger_entries" USING btree ("stall_id","created_at");--> statement-breakpoint
CREATE INDEX "ledger_entries_created_idx" ON "ledger_entries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ledger_entries_order_idx" ON "ledger_entries" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_created_by_idx" ON "ledger_entries" USING btree ("created_by");