-- =====================================================================
-- MOM — campus food-stall pre-ordering platform
-- Initial schema: profiles, stalls, menu, orders, tokens, fees, RLS.
--
-- Money is stored as INTEGER PAISE everywhere (₹1 = 100 paise) so there
-- is never any floating-point rounding drift.
--
-- All price / fee / token computation happens in this file (Postgres
-- functions). Clients only *preview* totals; the database is authoritative.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
create type public.user_role      as enum ('student', 'vendor', 'admin');
create type public.payment_mode   as enum ('online', 'offline');
create type public.payment_status as enum ('pending', 'paid', 'pay_at_counter', 'failed', 'refunded');
create type public.order_status   as enum (
  'pending_payment',  -- online order created, waiting for Razorpay
  'placed',           -- confirmed; token issued; stall can see it
  'preparing',
  'ready',            -- student should come and collect
  'completed',        -- handed over
  'cancelled'
);

-- ---------------------------------------------------------------------
-- Platform settings (single row) — fee percentages live here so the
-- business can change them without a code deploy.
-- ---------------------------------------------------------------------
create table public.platform_settings (
  id                 boolean primary key default true check (id), -- enforces single row
  online_fee_percent  numeric(5,2) not null default 1.00 check (online_fee_percent  >= 0 and online_fee_percent  <= 100),
  offline_fee_percent numeric(5,2) not null default 5.00 check (offline_fee_percent >= 0 and offline_fee_percent <= 100),
  updated_at         timestamptz not null default now()
);
insert into public.platform_settings (id) values (true);

-- ---------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text,
  phone      text,
  email      text,
  role       public.user_role not null default 'student',
  created_at timestamptz not null default now()
);

-- Auto-create a profile when someone signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, phone)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.phone
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Stalls
-- ---------------------------------------------------------------------
create table public.stalls (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid references public.profiles (id) on delete set null,
  name          text not null,
  description   text,
  cuisine       text,                 -- e.g. "South Indian", "Chinese"
  location      text,                 -- e.g. "Near Main Gate"
  image_url     text,
  is_open       boolean not null default true,
  avg_prep_mins integer not null default 15 check (avg_prep_mins > 0),
  created_at    timestamptz not null default now()
);
create index stalls_owner_idx on public.stalls (owner_id);

-- ---------------------------------------------------------------------
-- Menu items
-- ---------------------------------------------------------------------
create table public.menu_items (
  id           uuid primary key default gen_random_uuid(),
  stall_id     uuid not null references public.stalls (id) on delete cascade,
  name         text not null,
  description  text,
  category     text not null default 'Other',
  price_paise  integer not null check (price_paise > 0),
  is_veg       boolean not null default true,
  is_available boolean not null default true,
  image_url    text,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now()
);
create index menu_items_stall_idx on public.menu_items (stall_id);

-- ---------------------------------------------------------------------
-- Token counters — one sequence per stall per (IST) day.
-- Token numbers reset to 1 every morning, like a real stall counter.
-- ---------------------------------------------------------------------
create table public.stall_token_counters (
  stall_id   uuid not null references public.stalls (id) on delete cascade,
  day        date not null,
  last_token integer not null default 0,
  primary key (stall_id, day)
);

-- ---------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------
create table public.orders (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles (id) on delete cascade,
  stall_id            uuid not null references public.stalls (id) on delete restrict,
  token_no            integer,                -- null until confirmed
  token_day           date,
  status              public.order_status   not null,
  payment_mode        public.payment_mode   not null,
  payment_status      public.payment_status not null,
  subtotal_paise      integer not null check (subtotal_paise > 0),
  fee_percent         numeric(5,2) not null,
  fee_paise           integer not null check (fee_paise >= 0),
  total_paise         integer not null check (total_paise = subtotal_paise + fee_paise),
  note                text,
  razorpay_order_id   text unique,
  razorpay_payment_id text unique,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (stall_id, token_day, token_no)
);
create index orders_user_idx  on public.orders (user_id, created_at desc);
create index orders_stall_idx on public.orders (stall_id, created_at desc);

create table public.order_items (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references public.orders (id) on delete cascade,
  menu_item_id     uuid references public.menu_items (id) on delete set null,
  name             text not null,      -- snapshot at order time
  unit_price_paise integer not null,   -- snapshot at order time
  quantity         integer not null check (quantity between 1 and 50),
  line_total_paise integer not null
);
create index order_items_order_idx on public.order_items (order_id);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger orders_touch before update on public.orders
  for each row execute function public.touch_updated_at();

-- =====================================================================
-- Helper functions
-- =====================================================================
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.owns_stall(p_stall_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.stalls where id = p_stall_id and owner_id = auth.uid());
$$;

-- Fee = percent of subtotal, rounded to the nearest paisa.
create or replace function public.compute_fee_paise(p_subtotal_paise integer, p_percent numeric)
returns integer
language sql immutable
as $$
  select round(p_subtotal_paise * p_percent / 100.0)::integer;
$$;

-- Issue the next token number for a stall (today, India time).
-- Row-locks the counter so two simultaneous orders never get the same token.
create or replace function public.next_token(p_stall_id uuid, out token_no integer, out token_day date)
language plpgsql security definer set search_path = public
as $$
begin
  token_day := (now() at time zone 'Asia/Kolkata')::date;
  insert into public.stall_token_counters as c (stall_id, day, last_token)
  values (p_stall_id, token_day, 1)
  on conflict (stall_id, day) do update set last_token = c.last_token + 1
  returning c.last_token into token_no;
end;
$$;

-- =====================================================================
-- place_order — the ONLY way to create an order.
--   p_items: [{"menu_item_id": "...", "quantity": 2}, ...]
--   offline → token issued immediately, pay at counter (+offline fee)
--   online  → status pending_payment; token issued after Razorpay verifies
-- =====================================================================
create or replace function public.place_order(
  p_stall_id     uuid,
  p_items        jsonb,
  p_payment_mode public.payment_mode,
  p_note         text default null
)
returns public.orders
language plpgsql security definer set search_path = public
as $$
declare
  v_user     uuid := auth.uid();
  v_stall    public.stalls;
  v_settings public.platform_settings;
  v_order    public.orders;
  v_subtotal integer := 0;
  v_percent  numeric;
  v_fee      integer;
  v_item     record;
  v_tok      record;
  v_lines    jsonb;
begin
  if v_user is null then
    raise exception 'You must be signed in to order' using errcode = '28000';
  end if;

  select * into v_stall from public.stalls where id = p_stall_id;
  if not found then
    raise exception 'Stall not found' using errcode = 'P0002';
  end if;
  if not v_stall.is_open then
    raise exception '% is closed right now', v_stall.name using errcode = 'P0001';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Your cart is empty' using errcode = '22023';
  end if;

  -- Validate every line against the live menu (price comes from the DB, never the client).
  -- Duplicate lines for the same item are merged.
  select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb) into v_lines
  from (
    select
      m.id                                   as menu_item_id,
      m.name                                 as name,
      m.price_paise                          as unit_price_paise,
      sum((li ->> 'quantity')::integer)::int as quantity,
      m.stall_id                             as stall_id,
      m.is_available                         as is_available
    from jsonb_array_elements(p_items) li
    left join public.menu_items m on m.id = (li ->> 'menu_item_id')::uuid
    group by m.id, m.name, m.price_paise, m.stall_id, m.is_available
  ) l;

  for v_item in
    select * from jsonb_to_recordset(v_lines) as x(
      menu_item_id uuid, name text, unit_price_paise int, quantity int, stall_id uuid, is_available boolean)
  loop
    if v_item.menu_item_id is null or v_item.stall_id <> p_stall_id then
      raise exception 'An item in your cart does not belong to this stall' using errcode = '22023';
    end if;
    if not v_item.is_available then
      raise exception '% is no longer available', v_item.name using errcode = 'P0001';
    end if;
    if v_item.quantity is null or v_item.quantity < 1 or v_item.quantity > 50 then
      raise exception 'Invalid quantity for %', v_item.name using errcode = '22023';
    end if;
    v_subtotal := v_subtotal + v_item.unit_price_paise * v_item.quantity;
  end loop;

  select * into v_settings from public.platform_settings where id;
  v_percent := case p_payment_mode
                 when 'online'  then v_settings.online_fee_percent
                 when 'offline' then v_settings.offline_fee_percent
               end;
  v_fee := public.compute_fee_paise(v_subtotal, v_percent);

  insert into public.orders (
    user_id, stall_id, status, payment_mode, payment_status,
    subtotal_paise, fee_percent, fee_paise, total_paise, note
  ) values (
    v_user, p_stall_id,
    case when p_payment_mode = 'offline' then 'placed'::public.order_status else 'pending_payment' end,
    p_payment_mode,
    case when p_payment_mode = 'offline' then 'pay_at_counter'::public.payment_status else 'pending' end,
    v_subtotal, v_percent, v_fee, v_subtotal + v_fee, nullif(trim(p_note), '')
  )
  returning * into v_order;

  insert into public.order_items (order_id, menu_item_id, name, unit_price_paise, quantity, line_total_paise)
  select v_order.id, x.menu_item_id, x.name, x.unit_price_paise, x.quantity, x.unit_price_paise * x.quantity
  from jsonb_to_recordset(v_lines) as x(menu_item_id uuid, name text, unit_price_paise int, quantity int);

  if p_payment_mode = 'offline' then
    select * into v_tok from public.next_token(p_stall_id);
    update public.orders set token_no = v_tok.token_no, token_day = v_tok.token_day
    where id = v_order.id
    returning * into v_order;
  end if;

  return v_order;
end;
$$;

-- =====================================================================
-- confirm_online_payment — called ONLY by Edge Functions (service role)
-- after the Razorpay signature has been verified. Idempotent.
-- =====================================================================
create or replace function public.confirm_online_payment(
  p_razorpay_order_id   text,
  p_razorpay_payment_id text
)
returns public.orders
language plpgsql security definer set search_path = public
as $$
declare
  v_order public.orders;
  v_tok   record;
begin
  select * into v_order from public.orders
  where razorpay_order_id = p_razorpay_order_id
  for update;

  if not found then
    raise exception 'Unknown Razorpay order %', p_razorpay_order_id using errcode = 'P0002';
  end if;

  if v_order.payment_status = 'paid' then
    return v_order; -- already confirmed (webhook + client verify can both arrive)
  end if;

  select * into v_tok from public.next_token(v_order.stall_id);

  update public.orders set
    payment_status      = 'paid',
    status              = case when status = 'pending_payment' then 'placed' else status end,
    razorpay_payment_id = p_razorpay_payment_id,
    token_no            = v_tok.token_no,
    token_day           = v_tok.token_day
  where id = v_order.id
  returning * into v_order;

  return v_order;
end;
$$;

-- Edge function stores the Razorpay order id it created.
create or replace function public.attach_razorpay_order(p_order_id uuid, p_razorpay_order_id text)
returns void
language sql security definer set search_path = public
as $$
  update public.orders set razorpay_order_id = p_razorpay_order_id
  where id = p_order_id and status = 'pending_payment';
$$;

-- =====================================================================
-- update_order_status — stall owner moves an order through the kitchen.
-- =====================================================================
create or replace function public.update_order_status(p_order_id uuid, p_status public.order_status)
returns public.orders
language plpgsql security definer set search_path = public
as $$
declare
  v_order public.orders;
  v_ok    boolean;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;

  if not (public.owns_stall(v_order.stall_id) or public.is_admin()) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  v_ok := case
    when v_order.status = 'placed'    and p_status in ('preparing', 'ready', 'cancelled') then true
    when v_order.status = 'preparing' and p_status in ('ready', 'cancelled')              then true
    when v_order.status = 'ready'     and p_status in ('completed', 'cancelled')          then true
    when v_order.status = 'pending_payment' and p_status = 'cancelled'                    then true
    else false
  end;
  if not v_ok then
    raise exception 'Cannot move order from % to %', v_order.status, p_status using errcode = 'P0001';
  end if;

  update public.orders set
    status = p_status,
    -- Handing over an offline order means the stall collected the cash.
    payment_status = case
      when p_status = 'completed' and payment_status = 'pay_at_counter' then 'paid'::public.payment_status
      when p_status = 'cancelled' and payment_status = 'paid'           then 'refunded'::public.payment_status
      else payment_status
    end
  where id = p_order_id
  returning * into v_order;

  return v_order;
end;
$$;

-- Student may cancel their own order only while no money has changed hands:
-- an unpaid online order, or a pay-at-counter order the kitchen hasn't started.
-- (Paid online orders must be cancelled by the stall, which triggers a refund.)
create or replace function public.cancel_my_order(p_order_id uuid)
returns public.orders
language plpgsql security definer set search_path = public
as $$
declare
  v_order public.orders;
begin
  update public.orders set status = 'cancelled'
  where id = p_order_id
    and user_id = auth.uid()
    and (
      status = 'pending_payment'
      or (status = 'placed' and payment_status = 'pay_at_counter')
    )
  returning * into v_order;

  if not found then
    raise exception 'This order can no longer be cancelled — please talk to the stall' using errcode = 'P0001';
  end if;
  return v_order;
end;
$$;

-- =====================================================================
-- Admin helpers
-- =====================================================================
-- Make an existing (signed-up) user the owner of a stall.
create or replace function public.admin_assign_stall_owner(p_stall_id uuid, p_owner_email text)
returns public.stalls
language plpgsql security definer set search_path = public
as $$
declare
  v_owner uuid;
  v_stall public.stalls;
begin
  if not public.is_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select id into v_owner from public.profiles where lower(email) = lower(trim(p_owner_email));
  if v_owner is null then
    raise exception 'No user with email % — ask them to sign in once first', p_owner_email using errcode = 'P0002';
  end if;
  update public.profiles set role = 'vendor' where id = v_owner and role = 'student';
  update public.stalls set owner_id = v_owner where id = p_stall_id returning * into v_stall;
  return v_stall;
end;
$$;

-- Platform-wide numbers for the admin dashboard.
create or replace function public.admin_stats()
returns table (
  total_orders      bigint,
  paid_orders       bigint,
  gmv_paise         bigint,  -- food value transacted
  fee_revenue_paise bigint,  -- what the platform earns
  online_orders     bigint,
  offline_orders    bigint
)
language sql stable security definer set search_path = public
as $$
  select
    count(*),
    count(*) filter (where payment_status = 'paid'),
    coalesce(sum(subtotal_paise) filter (where payment_status = 'paid'), 0),
    coalesce(sum(fee_paise)      filter (where payment_status = 'paid'), 0),
    count(*) filter (where payment_mode = 'online'  and payment_status = 'paid'),
    count(*) filter (where payment_mode = 'offline' and payment_status = 'paid')
  from public.orders
  where public.is_admin();
$$;

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.platform_settings    enable row level security;
alter table public.profiles             enable row level security;
alter table public.stalls               enable row level security;
alter table public.menu_items           enable row level security;
alter table public.orders               enable row level security;
alter table public.order_items          enable row level security;
alter table public.stall_token_counters enable row level security; -- no policies: functions only

-- platform_settings: everyone can read (to preview fees); admins edit
create policy "settings readable" on public.platform_settings for select using (true);
create policy "settings admin update" on public.platform_settings for update using (public.is_admin());

-- profiles
create policy "read own profile" on public.profiles for select
  using (id = auth.uid() or public.is_admin());
create policy "update own profile" on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());
create policy "admin updates profiles" on public.profiles for update using (public.is_admin());

-- Users may edit their name/phone but never promote themselves.
-- (auth.uid() is null in the SQL editor / service role, which is how you create the first admin.)
create or replace function public.guard_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null and not public.is_admin() then
    raise exception 'Only admins can change roles' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger profiles_guard_role before update on public.profiles
  for each row execute function public.guard_profile_role();

-- stalls: public catalogue
create policy "stalls readable" on public.stalls for select using (true);
create policy "owner updates stall" on public.stalls for update
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "admin manages stalls" on public.stalls for all
  using (public.is_admin()) with check (public.is_admin());

-- menu_items: public catalogue; stall owner manages their own menu
create policy "menu readable" on public.menu_items for select using (true);
create policy "owner inserts menu" on public.menu_items for insert with check (public.owns_stall(stall_id) or public.is_admin());
create policy "owner updates menu" on public.menu_items for update
  using (public.owns_stall(stall_id) or public.is_admin())
  with check (public.owns_stall(stall_id) or public.is_admin());
create policy "owner deletes menu" on public.menu_items for delete using (public.owns_stall(stall_id) or public.is_admin());

-- orders: read-only from clients; writes go through the functions above
create policy "student reads own orders" on public.orders for select using (user_id = auth.uid());
create policy "vendor reads stall orders" on public.orders for select using (public.owns_stall(stall_id));
create policy "admin reads orders" on public.orders for select using (public.is_admin());

create policy "order items readable with order" on public.order_items for select using (
  exists (
    select 1 from public.orders o
    where o.id = order_id
      and (o.user_id = auth.uid() or public.owns_stall(o.stall_id) or public.is_admin())
  )
);

-- Vendors need the customer's name on the order ticket.
create or replace function public.order_customer_name(p_order_id uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select coalesce(nullif(p.full_name, ''), split_part(p.email, '@', 1), 'Customer')
  from public.orders o join public.profiles p on p.id = o.user_id
  where o.id = p_order_id
    and (o.user_id = auth.uid() or public.owns_stall(o.stall_id) or public.is_admin());
$$;

-- Everything the stall dashboard needs in one call: today's confirmed
-- orders (plus anything older still open), with items and customer name.
create or replace function public.stall_orders_today(p_stall_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_result jsonb;
begin
  if not (public.owns_stall(p_stall_id) or public.is_admin()) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(row_to_json(x) order by x.created_at), '[]'::jsonb) into v_result
  from (
    select
      o.id, o.token_no, o.status, o.payment_mode, o.payment_status,
      o.subtotal_paise, o.fee_paise, o.total_paise, o.note, o.created_at,
      coalesce(nullif(p.full_name, ''), split_part(p.email, '@', 1), 'Customer') as customer_name,
      (select coalesce(jsonb_agg(jsonb_build_object('name', i.name, 'quantity', i.quantity)), '[]'::jsonb)
         from public.order_items i where i.order_id = o.id) as items
    from public.orders o
    join public.profiles p on p.id = o.user_id
    where o.stall_id = p_stall_id
      and o.status <> 'pending_payment'
      and (o.token_day = v_today or o.status in ('placed', 'preparing', 'ready'))
  ) x;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------
-- Table grants (explicit, so this works even when new tables are not
-- auto-exposed to the Data API). RLS above still decides which rows.
-- ---------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;
grant select on public.platform_settings, public.stalls, public.menu_items to anon, authenticated;
grant select, update on public.profiles to authenticated;
grant update on public.platform_settings to authenticated;
grant insert, update, delete on public.stalls, public.menu_items to authenticated;
grant select on public.orders, public.order_items to authenticated;
grant all on all tables in schema public to service_role;

-- ---------------------------------------------------------------------
-- Function permissions — lock down the server-only ones.
-- ---------------------------------------------------------------------
revoke execute on function public.confirm_online_payment(text, text)   from public, anon, authenticated;
revoke execute on function public.attach_razorpay_order(uuid, text)    from public, anon, authenticated;
revoke execute on function public.next_token(uuid)                     from public, anon, authenticated;
grant  execute on function public.confirm_online_payment(text, text)   to service_role;
grant  execute on function public.attach_razorpay_order(uuid, text)    to service_role;
grant  execute on function public.next_token(uuid)                     to service_role;

revoke execute on function public.place_order(uuid, jsonb, public.payment_mode, text) from public, anon;
grant  execute on function public.place_order(uuid, jsonb, public.payment_mode, text) to authenticated;

-- ---------------------------------------------------------------------
-- Realtime: stalls get new orders instantly, students see status changes.
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table public.orders;
