-- BunaLens hackathon sprint: lot-to-order data foundation.
--
-- Additive only. No existing table, column, function, policy or grant is
-- dropped or redefined, so station-credit checkout keeps working unchanged.
--
-- One lot identifier is used throughout: public.coffee_batches.id.
--
-- Responsibilities and where authority comes from:
--   * seller / operator : owner of a station row (stations.owner_id), approved
--                         for the marketplace by an admin.
--   * reviewer / admin  : trusted JWT claim app_metadata.role, which only a
--                         project owner can set. user_metadata is never used.
--   * buyer             : any signed-in account; it only sees published
--                         listings and its own orders.
--
-- Client access follows the existing pattern: clients read through RLS, and
-- every write goes through server-side code (Edge Functions or RPCs added in
-- later phases). No client insert/update/delete grant is added here.

begin;

-- ---------------------------------------------------------------------------
-- Authorization helpers
-- ---------------------------------------------------------------------------
create or replace function public.bunalens_jwt_role()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '');
$$;

create or replace function public.bunalens_is_reviewer()
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.bunalens_jwt_role() in ('admin', 'reviewer');
$$;

-- Security definer so policies on other tables can test ownership without
-- depending on the caller's own access to public.stations.
create or replace function public.bunalens_owns_station(p_station_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.stations s
     where s.id = p_station_id and s.owner_id = (select auth.uid())
  );
$$;

revoke all on function public.bunalens_jwt_role() from public, anon;
revoke all on function public.bunalens_is_reviewer() from public, anon;
revoke all on function public.bunalens_owns_station(uuid) from public, anon;
grant execute on function public.bunalens_jwt_role() to authenticated, service_role;
grant execute on function public.bunalens_is_reviewer() to authenticated, service_role;
grant execute on function public.bunalens_owns_station(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Seller approval (reuses public.stations)
-- These columns are not in the client column grants, so only server-side code
-- can change them.
-- ---------------------------------------------------------------------------
alter table public.stations
  add column if not exists marketplace_seller_status text not null default 'pending',
  add column if not exists marketplace_seller_reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists marketplace_seller_reviewed_at timestamptz,
  add column if not exists marketplace_seller_note text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'stations_marketplace_seller_status_check') then
    alter table public.stations add constraint stations_marketplace_seller_status_check
      check (marketplace_seller_status in ('pending', 'approved', 'suspended'));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Lot fields (reuses public.coffee_batches as the lot record)
-- ---------------------------------------------------------------------------
alter table public.coffee_batches
  add column if not exists farmer_name text,
  add column if not exists farmer_phone text,
  add column if not exists moisture_pct numeric(4,1),
  add column if not exists screen_size numeric(4,1),
  add column if not exists measurements_recorded_at timestamptz,
  add column if not exists eligibility_status text not null default 'unreviewed',
  add column if not exists eligibility_updated_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'coffee_batches_moisture_pct_check') then
    alter table public.coffee_batches add constraint coffee_batches_moisture_pct_check
      check (moisture_pct is null or moisture_pct between 0 and 100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'coffee_batches_screen_size_check') then
    -- Screen size in 1/64 inch, the unit used for green-bean screens.
    alter table public.coffee_batches add constraint coffee_batches_screen_size_check
      check (screen_size is null or screen_size between 8 and 20);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'coffee_batches_eligibility_status_check') then
    alter table public.coffee_batches add constraint coffee_batches_eligibility_status_check
      check (eligibility_status in ('unreviewed', 'eligible', 'rejected', 'needs_review'));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Warehouse zones, devices, lot assignment and readings
-- ---------------------------------------------------------------------------
create table if not exists public.warehouse_zones (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references public.stations(id) on delete cascade,
  name text not null check (nullif(btrim(name), '') is not null),
  created_at timestamptz not null default now(),
  unique (station_id, name)
);

create table if not exists public.station_devices (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references public.stations(id) on delete cascade,
  zone_id uuid not null references public.warehouse_zones(id) on delete cascade,
  device_uid text not null unique check (device_uid ~ '^[A-Za-z0-9:_-]{4,64}$'),
  -- SHA-256 hex of the device token. The token itself is never stored.
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  label text,
  is_simulated boolean not null default false,
  is_active boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

-- One active device per warehouse zone.
create unique index if not exists station_devices_one_active_per_zone_uidx
  on public.station_devices(zone_id) where is_active;
create index if not exists station_devices_station_idx
  on public.station_devices(station_id);

create table if not exists public.lot_zone_assignments (
  id uuid primary key default gen_random_uuid(),
  batch_id text not null references public.coffee_batches(id) on delete cascade,
  zone_id uuid not null references public.warehouse_zones(id) on delete cascade,
  station_id uuid not null references public.stations(id) on delete cascade,
  assigned_by uuid references auth.users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  released_at timestamptz,
  constraint lot_zone_assignments_window_valid
    check (released_at is null or released_at >= assigned_at)
);

-- A lot is in at most one zone at a time. A zone can hold several lots.
create unique index if not exists lot_zone_assignments_one_open_per_lot_uidx
  on public.lot_zone_assignments(batch_id) where released_at is null;
create index if not exists lot_zone_assignments_zone_idx
  on public.lot_zone_assignments(zone_id, assigned_at desc);

create table if not exists public.device_readings (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.station_devices(id) on delete cascade,
  zone_id uuid not null references public.warehouse_zones(id) on delete cascade,
  station_id uuid not null references public.stations(id) on delete cascade,
  -- Chosen by the device; a retried message carries the same value.
  message_id text not null check (message_id ~ '^[A-Za-z0-9:_.-]{1,128}$'),
  recorded_at timestamptz not null,
  received_at timestamptz not null default now(),
  temperature_c numeric(5,2) not null check (temperature_c between -40 and 85),
  humidity_pct numeric(5,2) not null check (humidity_pct between 0 and 100),
  source text not null check (source in ('live', 'simulated')),
  constraint device_readings_message_unique unique (device_id, message_id),
  constraint device_readings_not_from_future
    check (recorded_at <= received_at + interval '5 minutes')
);

create index if not exists device_readings_zone_recorded_idx
  on public.device_readings(zone_id, recorded_at desc);

-- Readings for a lot are the readings of its zone during its assignment
-- window. security_invoker keeps the caller's RLS in force.
create or replace view public.lot_environment_readings
with (security_invoker = true)
as
select a.batch_id,
       a.zone_id,
       z.name as zone_name,
       r.id as reading_id,
       r.device_id,
       r.recorded_at,
       r.received_at,
       r.temperature_c,
       r.humidity_pct,
       r.source
  from public.lot_zone_assignments a
  join public.warehouse_zones z on z.id = a.zone_id
  join public.device_readings r
    on r.zone_id = a.zone_id
   and r.recorded_at >= a.assigned_at
   and (a.released_at is null or r.recorded_at <= a.released_at);

-- ---------------------------------------------------------------------------
-- Publication review (append-only decision log)
-- The photo assessment itself stays in coffee_batches.grading_result and
-- public.grading_results.
-- ---------------------------------------------------------------------------
create table if not exists public.lot_reviews (
  id uuid primary key default gen_random_uuid(),
  batch_id text not null references public.coffee_batches(id) on delete cascade,
  decision text not null check (decision in ('eligible', 'rejected', 'needs_review')),
  decided_by text not null check (decided_by in ('rule', 'reviewer')),
  reviewer_id uuid references auth.users(id) on delete set null,
  reason text not null check (nullif(btrim(reason), '') is not null),
  -- Inputs and limits used for the decision, kept for traceability.
  criteria_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(criteria_snapshot) = 'object'),
  created_at timestamptz not null default now(),
  constraint lot_reviews_reviewer_recorded
    check (decided_by <> 'reviewer' or reviewer_id is not null)
);

create index if not exists lot_reviews_batch_created_idx
  on public.lot_reviews(batch_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Marketplace listings: only buyer-facing fields live here.
-- ---------------------------------------------------------------------------
create table if not exists public.marketplace_listings (
  id uuid primary key default gen_random_uuid(),
  batch_id text not null unique references public.coffee_batches(id) on delete cascade,
  station_id uuid not null references public.stations(id) on delete cascade,
  seller_display_name text not null check (nullif(btrim(seller_display_name), '') is not null),
  origin_woreda text not null,
  coffee_stage text not null check (coffee_stage in ('red_cherry', 'green_bean')),
  available_kg numeric(12,2) not null check (available_kg >= 0),
  price_per_kg_etb numeric(12,2) not null check (price_per_kg_etb > 0),
  screening_summary text not null default '',
  assessed_at timestamptz,
  is_demo boolean not null default false,
  status text not null default 'draft'
    check (status in ('draft', 'published', 'paused', 'sold_out', 'withdrawn')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists marketplace_listings_browse_idx
  on public.marketplace_listings(status, origin_woreda, coffee_stage, price_per_kg_etb);
create index if not exists marketplace_listings_station_idx
  on public.marketplace_listings(station_id);

drop trigger if exists marketplace_listings_set_updated_at on public.marketplace_listings;
create trigger marketplace_listings_set_updated_at
before update on public.marketplace_listings
for each row execute function public.set_updated_at();

-- A listing must belong to the lot's station, and can be published only while
-- the lot is eligible and the seller is approved. This holds for every
-- writer, including the service role.
create or replace function public.bunalens_enforce_listing_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_station_id uuid;
  v_eligibility text;
  v_seller_status text;
begin
  select b.station_id, b.eligibility_status, s.marketplace_seller_status
    into v_station_id, v_eligibility, v_seller_status
    from public.coffee_batches b
    join public.stations s on s.id = b.station_id
   where b.id = new.batch_id;
  if not found then
    raise exception 'Lot not found for listing' using errcode = '23503';
  end if;
  if v_station_id is distinct from new.station_id then
    raise exception 'Listing station does not own this lot' using errcode = '42501';
  end if;
  if new.status = 'published' then
    if v_eligibility <> 'eligible' then
      raise exception 'Lot is not eligible for listing' using errcode = '42501';
    end if;
    if v_seller_status <> 'approved' then
      raise exception 'Seller is not approved for the marketplace' using errcode = '42501';
    end if;
    if new.available_kg <= 0 then
      raise exception 'A published listing needs available stock' using errcode = '23514';
    end if;
    new.published_at := coalesce(new.published_at, now());
  end if;
  return new;
end;
$$;

revoke all on function public.bunalens_enforce_listing_rules() from public, anon, authenticated;
drop trigger if exists marketplace_listings_enforce_rules on public.marketplace_listings;
create trigger marketplace_listings_enforce_rules
before insert or update on public.marketplace_listings
for each row execute function public.bunalens_enforce_listing_rules();

-- Losing eligibility or seller approval takes published listings off the
-- marketplace immediately.
create or replace function public.bunalens_pause_listings_for_lot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.eligibility_status <> 'eligible' then
    update public.marketplace_listings
       set status = 'paused'
     where batch_id = new.id and status = 'published';
  end if;
  return new;
end;
$$;

revoke all on function public.bunalens_pause_listings_for_lot() from public, anon, authenticated;
drop trigger if exists coffee_batches_pause_listings on public.coffee_batches;
create trigger coffee_batches_pause_listings
after update of eligibility_status on public.coffee_batches
for each row execute function public.bunalens_pause_listings_for_lot();

create or replace function public.bunalens_pause_listings_for_station()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.marketplace_seller_status <> 'approved' then
    update public.marketplace_listings
       set status = 'paused'
     where station_id = new.id and status = 'published';
  end if;
  return new;
end;
$$;

revoke all on function public.bunalens_pause_listings_for_station() from public, anon, authenticated;
drop trigger if exists stations_pause_listings on public.stations;
create trigger stations_pause_listings
after update of marketplace_seller_status on public.stations
for each row execute function public.bunalens_pause_listings_for_station();

-- ---------------------------------------------------------------------------
-- Orders and coffee-order payment references
-- Kept separate from station_payments so the credit checkout and
-- apply_verified_chapa_payment are untouched.
-- ---------------------------------------------------------------------------
create table if not exists public.coffee_orders (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.marketplace_listings(id) on delete restrict,
  batch_id text not null references public.coffee_batches(id) on delete restrict,
  station_id uuid not null references public.stations(id) on delete restrict,
  buyer_id uuid not null references auth.users(id) on delete restrict,
  buyer_name text not null check (nullif(btrim(buyer_name), '') is not null),
  buyer_phone text,
  quantity_kg numeric(12,2) not null check (quantity_kg > 0),
  -- Price is copied from the listing when the order is submitted.
  price_per_kg_etb numeric(12,2) not null check (price_per_kg_etb > 0),
  total_etb numeric(14,2) generated always as (round(quantity_kg * price_per_kg_etb, 2)) stored,
  status text not null default 'submitted'
    check (status in ('submitted', 'accepted', 'declined', 'cancelled', 'fulfilled')),
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'pending', 'paid_test', 'paid', 'failed')),
  idempotency_key text not null check (length(idempotency_key) between 8 and 128),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz,
  constraint coffee_orders_buyer_idempotency_unique unique (buyer_id, idempotency_key)
);

create index if not exists coffee_orders_buyer_idx
  on public.coffee_orders(buyer_id, created_at desc);
create index if not exists coffee_orders_station_idx
  on public.coffee_orders(station_id, created_at desc);
create index if not exists coffee_orders_listing_idx
  on public.coffee_orders(listing_id);

drop trigger if exists coffee_orders_set_updated_at on public.coffee_orders;
create trigger coffee_orders_set_updated_at
before update on public.coffee_orders
for each row execute function public.set_updated_at();

create table if not exists public.coffee_order_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.coffee_orders(id) on delete restrict,
  chapa_tx_ref text not null unique,
  amount_etb numeric(14,2) not null check (amount_etb > 0),
  currency text not null default 'ETB' check (currency = 'ETB'),
  status text not null default 'pending'
    check (status in ('pending', 'verified', 'failed', 'expired')),
  -- True when the payment was created with a Chapa test-mode key.
  is_test boolean not null,
  idempotency_key text not null check (length(idempotency_key) between 8 and 128),
  checkout_url text,
  provider_payload jsonb,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  constraint coffee_order_payments_order_idempotency_unique unique (order_id, idempotency_key),
  constraint coffee_order_payments_verified_timestamp
    check (status <> 'verified' or verified_at is not null)
);

create index if not exists coffee_order_payments_order_idx
  on public.coffee_order_payments(order_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.warehouse_zones enable row level security;
alter table public.station_devices enable row level security;
alter table public.lot_zone_assignments enable row level security;
alter table public.device_readings enable row level security;
alter table public.lot_reviews enable row level security;
alter table public.marketplace_listings enable row level security;
alter table public.coffee_orders enable row level security;
alter table public.coffee_order_payments enable row level security;

-- Station-scoped tables: the owner and reviewers/admins can read.
do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'warehouse_zones', 'station_devices', 'lot_zone_assignments', 'device_readings'
  ] loop
    execute format('drop policy if exists "BunaLens station staff read %1$s" on public.%1$I', target_table);
    execute format(
      'create policy "BunaLens station staff read %1$s" on public.%1$I for select to authenticated using (public.bunalens_owns_station(station_id) or public.bunalens_is_reviewer())',
      target_table
    );
  end loop;
end;
$$;

drop policy if exists "BunaLens station staff read lot_reviews" on public.lot_reviews;
create policy "BunaLens station staff read lot_reviews" on public.lot_reviews
  for select to authenticated
  using (
    public.bunalens_is_reviewer()
    or exists (
      select 1 from public.coffee_batches b
       where b.id = batch_id and public.bunalens_owns_station(b.station_id)
    )
  );

-- Reviewers need to read the lots and assessments they review. Admin read
-- access already exists from the admin dashboard migration.
drop policy if exists "BunaLens reviewers read all coffee_batches" on public.coffee_batches;
create policy "BunaLens reviewers read all coffee_batches" on public.coffee_batches
  for select to authenticated
  using (public.bunalens_is_reviewer());

drop policy if exists "BunaLens reviewers read all grading_results" on public.grading_results;
create policy "BunaLens reviewers read all grading_results" on public.grading_results
  for select to authenticated
  using (public.bunalens_is_reviewer());

-- Listings: published rows are public; sellers and reviewers see the rest.
drop policy if exists "BunaLens public read published listings" on public.marketplace_listings;
create policy "BunaLens public read published listings" on public.marketplace_listings
  for select to anon, authenticated
  using (status = 'published');

drop policy if exists "BunaLens station staff read marketplace_listings" on public.marketplace_listings;
create policy "BunaLens station staff read marketplace_listings" on public.marketplace_listings
  for select to authenticated
  using (public.bunalens_owns_station(station_id) or public.bunalens_is_reviewer());

-- Orders: the buyer, the selling station and admins.
drop policy if exists "BunaLens order parties read coffee_orders" on public.coffee_orders;
create policy "BunaLens order parties read coffee_orders" on public.coffee_orders
  for select to authenticated
  using (
    buyer_id = (select auth.uid())
    or public.bunalens_owns_station(station_id)
    or public.bunalens_jwt_role() = 'admin'
  );

drop policy if exists "BunaLens order parties read coffee_order_payments" on public.coffee_order_payments;
create policy "BunaLens order parties read coffee_order_payments" on public.coffee_order_payments
  for select to authenticated
  using (
    public.bunalens_jwt_role() = 'admin'
    or exists (
      select 1 from public.coffee_orders o
       where o.id = order_id
         and (o.buyer_id = (select auth.uid()) or public.bunalens_owns_station(o.station_id))
    )
  );

-- ---------------------------------------------------------------------------
-- Grants. RLS still governs rows. Clients get read access only.
-- ---------------------------------------------------------------------------
revoke all on public.warehouse_zones from anon, authenticated;
revoke all on public.station_devices from anon, authenticated;
revoke all on public.lot_zone_assignments from anon, authenticated;
revoke all on public.device_readings from anon, authenticated;
revoke all on public.lot_environment_readings from anon, authenticated;
revoke all on public.lot_reviews from anon, authenticated;
revoke all on public.marketplace_listings from anon, authenticated;
revoke all on public.coffee_orders from anon, authenticated;
revoke all on public.coffee_order_payments from anon, authenticated;

grant select on public.warehouse_zones to authenticated;
-- token_hash is deliberately not readable by clients.
grant select (id, station_id, zone_id, device_uid, label, is_simulated, is_active, last_seen_at, created_at)
  on public.station_devices to authenticated;
grant select on public.lot_zone_assignments to authenticated;
grant select on public.device_readings to authenticated;
grant select on public.lot_environment_readings to authenticated;
grant select on public.lot_reviews to authenticated;
grant select on public.marketplace_listings to anon, authenticated;
grant select on public.coffee_orders to authenticated;
-- provider_payload is deliberately not readable by clients.
grant select (id, order_id, chapa_tx_ref, amount_etb, currency, status, is_test, checkout_url, verified_at, created_at)
  on public.coffee_order_payments to authenticated;

grant all on public.warehouse_zones, public.station_devices, public.lot_zone_assignments,
  public.device_readings, public.lot_reviews, public.marketplace_listings,
  public.coffee_orders, public.coffee_order_payments to service_role;
grant select on public.lot_environment_readings to service_role;

commit;
