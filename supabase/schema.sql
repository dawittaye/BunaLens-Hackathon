-- BunaLens base database schema
-- PostgreSQL 15+ / Supabase
-- Apply this file once in Supabase SQL Editor, then apply the ordered files
-- in supabase/migrations/ (which add app-specific payment, benchmark and RPC
-- compatibility objects used by the current Edge Functions).
--
-- Security model:
--   * stations.owner_id is the authenticated owner identity.
--   * client reads are scoped through station ownership.
--   * grading, pricing, credit and payment writes are server-owned.
--   * service-role credentials must never be shipped in the mobile app.

begin;

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Stations
-- ---------------------------------------------------------------------------
create table if not exists public.stations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  station_name text,
  name text, -- legacy app/Edge Function alias; kept during client migration
  owner_name text,
  manager text, -- legacy app alias
  email text,
  phone text,
  woreda text not null check (woreda in (
    'Gomma', 'Limmu Kossa', 'Mana', 'Seka Chekorsa',
    'Gera', 'Kersa', 'Jimma Town'
  )),
  zone text not null default 'Jimma',
  credits integer not null default 10 check (credits >= 0),
  pro_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stations_name_present check (
    nullif(btrim(coalesce(station_name, name)), '') is not null
  )
);

-- Upgrade path for projects that previously ran the minimal BunaLens schema.
alter table public.stations add column if not exists station_name text;
alter table public.stations add column if not exists owner_name text;
alter table public.stations add column if not exists email text;
alter table public.stations add column if not exists phone text;
alter table public.stations add column if not exists zone text not null default 'Jimma';
alter table public.stations add column if not exists pro_expires_at timestamptz;
alter table public.stations add column if not exists updated_at timestamptz not null default now();
update public.stations
   set station_name = coalesce(station_name, name),
       owner_name = coalesce(owner_name, manager)
 where station_name is null or owner_name is null;

-- Keep the two station-name fields compatible with the currently deployed
-- mobile/Edge Function contract while the app transitions to station_name.
create or replace function public.sync_station_name_aliases()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if tg_op = 'UPDATE' then
    if new.name is distinct from old.name
       and new.station_name is not distinct from old.station_name then
      new.station_name := new.name;
    elsif new.station_name is distinct from old.station_name
       and new.name is not distinct from old.name then
      new.name := new.station_name;
    end if;
    if new.manager is distinct from old.manager
       and new.owner_name is not distinct from old.owner_name then
      new.owner_name := new.manager;
    elsif new.owner_name is distinct from old.owner_name
       and new.manager is not distinct from old.manager then
      new.manager := new.owner_name;
    end if;
  end if;
  if new.station_name is null then new.station_name := new.name; end if;
  if new.name is null then new.name := new.station_name; end if;
  if new.owner_name is null then new.owner_name := new.manager; end if;
  if new.manager is null then new.manager := new.owner_name; end if;
  return new;
end;
$$;

drop trigger if exists stations_sync_name_aliases on public.stations;
create trigger stations_sync_name_aliases
before insert or update on public.stations
for each row execute function public.sync_station_name_aliases();

drop trigger if exists stations_set_updated_at on public.stations;
create trigger stations_set_updated_at
before update on public.stations
for each row execute function public.set_updated_at();

create index if not exists stations_owner_id_idx
  on public.stations(owner_id);
create index if not exists stations_woreda_idx
  on public.stations(woreda);

-- ---------------------------------------------------------------------------
-- Station credits: authoritative entitlement ledger snapshot
-- ---------------------------------------------------------------------------
create table if not exists public.station_credits (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null unique references public.stations(id) on delete cascade,
  available_credits integer not null default 10 check (available_credits >= 0),
  subscription_type text not null default 'free'
    check (subscription_type in ('free', 'starter', 'pro')),
  subscription_expires_at timestamptz,
  updated_at timestamptz not null default now()
);

drop trigger if exists station_credits_set_updated_at on public.station_credits;
create trigger station_credits_set_updated_at
before update on public.station_credits
for each row execute function public.set_updated_at();

-- Keep the normalized credit snapshot synchronized with the legacy station
-- entitlement fields used by the current mobile app and Chapa migrations.
create or replace function public.sync_station_entitlements()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.station_credits(
    station_id, available_credits, subscription_type, subscription_expires_at
  )
  values (
    new.id,
    new.credits,
    case when new.pro_expires_at > now() then 'pro' else 'free' end,
    new.pro_expires_at
  )
  on conflict (station_id) do update
    set available_credits = excluded.available_credits,
        subscription_type = case
          when excluded.subscription_expires_at is not null then
            case when excluded.subscription_expires_at > now() then 'pro' else 'free' end
          else public.station_credits.subscription_type
        end,
        subscription_expires_at = excluded.subscription_expires_at,
        updated_at = now();
  return new;
end;
$$;

revoke all on function public.sync_station_entitlements() from public, anon, authenticated;
drop trigger if exists stations_sync_entitlements on public.stations;
create trigger stations_sync_entitlements
after insert or update of credits, pro_expires_at on public.stations
for each row execute function public.sync_station_entitlements();

create or replace function public.initialize_station_credits()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.station_credits(station_id, available_credits)
  values (new.id, new.credits)
  on conflict (station_id) do nothing;
  return new;
end;
$$;

revoke all on function public.initialize_station_credits() from public, anon, authenticated;
drop trigger if exists stations_initialize_credits on public.stations;
create trigger stations_initialize_credits
after insert on public.stations
for each row execute function public.initialize_station_credits();

-- Backfill the entitlement snapshot for stations created before this schema.
insert into public.station_credits(station_id, available_credits)
select id, credits from public.stations
on conflict (station_id) do nothing;

-- ---------------------------------------------------------------------------
-- Coffee batches
-- ---------------------------------------------------------------------------
create table if not exists public.coffee_batches (
  -- text ID is retained for compatibility with the app's stable capture key.
  id text primary key,
  batch_code text not null unique
    check (batch_code ~ '^BNL-JMA-[A-Z0-9]{4}$'),
  station_id uuid not null references public.stations(id) on delete cascade,
  idempotency_key text not null,
  sample_type text not null check (sample_type in ('red_cherry', 'green_bean')),
  woreda text not null check (woreda in (
    'Gomma', 'Limmu Kossa', 'Mana', 'Seka Chekorsa',
    'Gera', 'Kersa', 'Jimma Town'
  )),
  latitude double precision check (latitude is null or latitude between -90 and 90),
  longitude double precision check (longitude is null or longitude between -180 and 180),
  gps_latitude double precision check (gps_latitude is null or gps_latitude between -90 and 90),
  gps_longitude double precision check (gps_longitude is null or gps_longitude between -180 and 180),
  -- The mobile contract sends kg. Feresula is stored as a generated conversion.
  lot_weight_kg numeric(12,2) not null check (lot_weight_kg > 0),
  lot_weight_feresula numeric(12,4)
    generated always as (round(lot_weight_kg / 17.0, 4)) stored,
  image_path text,
  grading_status text not null default 'completed'
    check (grading_status in ('queued', 'processing', 'completed', 'failed', 'demo')),
  ecx_grade text not null default 'Unclassified'
    check (ecx_grade in ('Unclassified', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7')),
  quality_score numeric(5,2) check (quality_score is null or quality_score between 0 and 100),
  confidence_score numeric(5,2) check (confidence_score is null or confidence_score between 0 and 100),
  estimated_price_per_feresula_etb numeric(14,2)
    check (estimated_price_per_feresula_etb is null or estimated_price_per_feresula_etb >= 0),
  total_estimated_value_etb numeric(16,2)
    check (total_estimated_value_etb is null or total_estimated_value_etb >= 0),
  potential_gain_if_sorted_etb numeric(16,2)
    check (potential_gain_if_sorted_etb is null or potential_gain_if_sorted_etb >= 0),
  grading_result jsonb not null default '{}'::jsonb,
  pricing_result jsonb,
  verification_id uuid not null default gen_random_uuid(),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coffee_batches_geo_pair check (
    (coalesce(latitude, gps_latitude) is null and coalesce(longitude, gps_longitude) is null)
    or (coalesce(latitude, gps_latitude) is not null and coalesce(longitude, gps_longitude) is not null)
  )
);

-- Add the canonical columns when upgrading an installation that already has
-- the original compact coffee_batches table.
alter table public.coffee_batches add column if not exists idempotency_key text;
update public.coffee_batches set idempotency_key = id where idempotency_key is null;
alter table public.coffee_batches alter column idempotency_key set not null;
create unique index if not exists coffee_batches_station_idempotency_uidx
  on public.coffee_batches(station_id, idempotency_key);
alter table public.coffee_batches add column if not exists latitude double precision;
alter table public.coffee_batches add column if not exists longitude double precision;
alter table public.coffee_batches add column if not exists gps_latitude double precision;
alter table public.coffee_batches add column if not exists gps_longitude double precision;
alter table public.coffee_batches add column if not exists lot_weight_feresula numeric(12,4)
  generated always as (round(lot_weight_kg / 17.0, 4)) stored;
alter table public.coffee_batches add column if not exists grading_status text not null default 'completed';
alter table public.coffee_batches add column if not exists ecx_grade text not null default 'Unclassified';
alter table public.coffee_batches add column if not exists quality_score numeric(5,2);
alter table public.coffee_batches add column if not exists confidence_score numeric(5,2);
alter table public.coffee_batches add column if not exists estimated_price_per_feresula_etb numeric(14,2);
alter table public.coffee_batches add column if not exists total_estimated_value_etb numeric(16,2);
alter table public.coffee_batches add column if not exists potential_gain_if_sorted_etb numeric(16,2);
alter table public.coffee_batches add column if not exists pricing_result jsonb;
alter table public.coffee_batches add column if not exists verification_id uuid default gen_random_uuid();
alter table public.coffee_batches add column if not exists is_demo boolean not null default false;
alter table public.coffee_batches add column if not exists updated_at timestamptz not null default now();
update public.coffee_batches set verification_id = gen_random_uuid() where verification_id is null;
alter table public.coffee_batches alter column verification_id set not null;
create unique index if not exists coffee_batches_verification_id_uidx
  on public.coffee_batches(verification_id);

create index if not exists coffee_batches_station_created_idx
  on public.coffee_batches(station_id, created_at desc);
create index if not exists coffee_batches_station_grade_idx
  on public.coffee_batches(station_id, ecx_grade, created_at desc);
create index if not exists coffee_batches_woreda_created_idx
  on public.coffee_batches(woreda, created_at desc);
create index if not exists coffee_batches_status_idx
  on public.coffee_batches(grading_status);
create index if not exists coffee_batches_grading_result_gin_idx
  on public.coffee_batches using gin(grading_result);

-- Compatibility with the current sync Edge Function, which writes gps_latitude /
-- gps_longitude while the canonical schema exposes latitude / longitude.
create or replace function public.sync_batch_coordinate_aliases()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.latitude is null then new.latitude := new.gps_latitude; end if;
  if new.longitude is null then new.longitude := new.gps_longitude; end if;
  if new.gps_latitude is null then new.gps_latitude := new.latitude; end if;
  if new.gps_longitude is null then new.gps_longitude := new.longitude; end if;
  return new;
end;
$$;

drop trigger if exists coffee_batches_sync_coordinate_aliases on public.coffee_batches;
create trigger coffee_batches_sync_coordinate_aliases
before insert or update on public.coffee_batches
for each row execute function public.sync_batch_coordinate_aliases();

drop trigger if exists coffee_batches_set_updated_at on public.coffee_batches;
create trigger coffee_batches_set_updated_at
before update on public.coffee_batches
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Normalized grading result (one result per batch)
-- ---------------------------------------------------------------------------
create table if not exists public.grading_results (
  id uuid primary key default gen_random_uuid(),
  batch_id text not null unique references public.coffee_batches(id) on delete cascade,
  breakdown jsonb not null default '{}'::jsonb,
  export_readiness text not null default 'Insufficient Evidence'
    check (export_readiness in (
      'Specialty Export', 'Commercial Export', 'Local Market Only',
      'Reject / Re-sort', 'Insufficient Evidence'
    )),
  sorting_action_advice text not null default '',
  assessment_limitations jsonb not null default '[]'::jsonb
    check (jsonb_typeof(assessment_limitations) = 'array'),
  assessment_method text not null default 'ai_visual_estimate'
    check (assessment_method in ('ai_visual_estimate', 'human_assessment', 'imported')),
  model_version text,
  created_at timestamptz not null default now(),
  constraint grading_results_breakdown_object check (jsonb_typeof(breakdown) = 'object')
);

create index if not exists grading_results_created_idx
  on public.grading_results(created_at desc);

-- Project the JSON assessment returned by the current Edge Function into the
-- typed batch columns and normalized grading_results relation.
create or replace function public.project_batch_assessment()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_quality text;
  v_confidence text;
  v_price text;
  v_value text;
  v_gain text;
begin
  if new.grading_result is not null then
    new.ecx_grade := coalesce(nullif(new.grading_result->>'ecx_grade', ''), 'Unclassified');
    v_quality := new.grading_result->>'quality_score';
    v_confidence := new.grading_result->>'confidence_score';
    if v_quality ~ '^[0-9]+(\.[0-9]+)?$' then new.quality_score := v_quality::numeric; end if;
    if v_confidence ~ '^[0-9]+(\.[0-9]+)?$' then new.confidence_score := v_confidence::numeric; end if;
    if new.grading_result->>'export_readiness' is not null then
      -- The normalized row is written by the AFTER trigger below.
      null;
    end if;
  end if;
  if new.pricing_result is not null then
    v_price := new.pricing_result->>'estimated_price_per_feresula_etb';
    v_value := coalesce(new.pricing_result->>'estimated_lot_value_etb',
                        new.pricing_result->>'total_estimated_value_etb');
    v_gain := coalesce(new.pricing_result->>'potential_sorting_gain_etb',
                       new.pricing_result->>'potential_gain_if_sorted_etb');
    if v_price ~ '^[0-9]+(\.[0-9]+)?$' then new.estimated_price_per_feresula_etb := v_price::numeric; end if;
    if v_value ~ '^[0-9]+(\.[0-9]+)?$' then new.total_estimated_value_etb := v_value::numeric; end if;
    if v_gain ~ '^[0-9]+(\.[0-9]+)?$' then new.potential_gain_if_sorted_etb := v_gain::numeric; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists coffee_batches_project_assessment on public.coffee_batches;
create trigger coffee_batches_project_assessment
before insert or update of grading_result, pricing_result on public.coffee_batches
for each row execute function public.project_batch_assessment();

create or replace function public.upsert_normalized_grading_result()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  insert into public.grading_results(
    batch_id, breakdown, export_readiness, sorting_action_advice,
    assessment_limitations, assessment_method, model_version
  )
  values (
    new.id,
    coalesce(new.grading_result->'breakdown', '{}'::jsonb),
    coalesce(new.grading_result->>'export_readiness', 'Insufficient Evidence'),
    coalesce(new.grading_result->>'sorting_action_advice', ''),
    case when jsonb_typeof(new.grading_result->'assessment_limitations') = 'array'
      then new.grading_result->'assessment_limitations' else '[]'::jsonb end,
    coalesce(new.grading_result->>'assessment_method', 'ai_visual_estimate'),
    new.grading_result->>'model_version'
  )
  on conflict (batch_id) do update
    set breakdown = excluded.breakdown,
        export_readiness = excluded.export_readiness,
        sorting_action_advice = excluded.sorting_action_advice,
        assessment_limitations = excluded.assessment_limitations,
        assessment_method = excluded.assessment_method,
        model_version = excluded.model_version;
  return new;
end;
$$;

drop trigger if exists coffee_batches_upsert_grading_result on public.coffee_batches;
create trigger coffee_batches_upsert_grading_result
after insert or update of grading_result on public.coffee_batches
for each row execute function public.upsert_normalized_grading_result();

-- Backfill normalized results for batches that predate this schema.
insert into public.grading_results(
  batch_id, breakdown, export_readiness, sorting_action_advice,
  assessment_limitations, assessment_method, model_version
)
select
  b.id,
  coalesce(b.grading_result->'breakdown', '{}'::jsonb),
  coalesce(b.grading_result->>'export_readiness', 'Insufficient Evidence'),
  coalesce(b.grading_result->>'sorting_action_advice', ''),
  case when jsonb_typeof(b.grading_result->'assessment_limitations') = 'array'
    then b.grading_result->'assessment_limitations' else '[]'::jsonb end,
  coalesce(b.grading_result->>'assessment_method', 'ai_visual_estimate'),
  b.grading_result->>'model_version'
from public.coffee_batches b
on conflict (batch_id) do nothing;

-- ---------------------------------------------------------------------------
-- Payment transactions. Only a trusted server may create or verify payments.
-- ---------------------------------------------------------------------------
create table if not exists public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references public.stations(id) on delete cascade,
  transaction_reference text not null unique,
  idempotency_key text not null,
  package_type text not null check (package_type in ('starter_50', 'station_pro_monthly')),
  amount_etb numeric(12,2) not null check (amount_etb > 0),
  currency text not null default 'ETB' check (currency = 'ETB'),
  payment_status text not null default 'pending'
    check (payment_status in ('pending', 'verified', 'failed', 'cancelled')),
  credits_granted integer not null default 0 check (credits_granted >= 0),
  checkout_url text,
  provider_payload jsonb,
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  constraint payment_transactions_station_idempotency_unique
    unique (station_id, idempotency_key),
  constraint payment_transactions_verified_timestamp check (
    (payment_status = 'verified' and verified_at is not null)
    or payment_status <> 'verified'
  )
);

create index if not exists payment_transactions_station_created_idx
  on public.payment_transactions(station_id, created_at desc);
create index if not exists payment_transactions_status_idx
  on public.payment_transactions(payment_status, created_at desc);

-- ---------------------------------------------------------------------------
-- Market price reference data. Public to signed-in users, writes server-only.
-- ---------------------------------------------------------------------------
create table if not exists public.market_prices (
  id uuid primary key default gen_random_uuid(),
  woreda text not null check (woreda in (
    'Gomma', 'Limmu Kossa', 'Mana', 'Seka Chekorsa',
    'Gera', 'Kersa', 'Jimma Town', 'Jimma Zone'
  )),
  coffee_type text not null check (coffee_type in ('red_cherry', 'green_bean')),
  sample_type text generated always as (coffee_type) stored,
  grade text not null default 'Unclassified',
  price_per_feresula_etb numeric(14,2) not null
    check (price_per_feresula_etb >= 0),
  min_etb_per_feresula numeric(14,2)
    check (min_etb_per_feresula is null or min_etb_per_feresula >= 0),
  max_etb_per_feresula numeric(14,2)
    check (max_etb_per_feresula is null or max_etb_per_feresula >= 0),
  source text not null,
  source_label text,
  effective_date date not null,
  active boolean not null default true,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  constraint market_prices_range_valid check (
    min_etb_per_feresula is null or max_etb_per_feresula is null
    or min_etb_per_feresula <= max_etb_per_feresula
  )
);

create index if not exists market_prices_lookup_idx
  on public.market_prices(coffee_type, grade, woreda, effective_date desc)
  where active = true;
create index if not exists market_prices_effective_idx
  on public.market_prices(effective_date desc);

-- ---------------------------------------------------------------------------
-- Atomic payment application. The Chapa Edge Function calls this only after
-- independently verifying reference, amount, currency and success status.
-- ---------------------------------------------------------------------------
create or replace function public.apply_verified_payment_transaction(
  p_tx_ref text,
  p_provider_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_payment public.payment_transactions%rowtype;
  v_new_credits integer;
  v_new_expiry timestamptz;
begin
  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  select * into v_payment
    from public.payment_transactions
   where transaction_reference = p_tx_ref
   for update;

  if not found then
    raise exception 'Payment transaction not found' using errcode = 'P0002';
  end if;

  if v_payment.payment_status = 'verified' then
    return jsonb_build_object(
      'transaction_reference', v_payment.transaction_reference,
      'status', 'verified',
      'already_applied', true
    );
  end if;

  if v_payment.payment_status <> 'pending' then
    raise exception 'Payment is not pending' using errcode = '55000';
  end if;

  update public.payment_transactions
     set payment_status = 'verified',
         verified_at = now(),
         provider_payload = coalesce(p_provider_payload, '{}'::jsonb),
         credits_granted = case
           when package_type = 'starter_50' then 50 else 0 end
   where id = v_payment.id;

  if v_payment.package_type = 'starter_50' then
    insert into public.station_credits(station_id, available_credits, subscription_type)
    values (v_payment.station_id, 50, 'starter')
    on conflict (station_id) do update
      set available_credits = public.station_credits.available_credits + 50,
          updated_at = now();
    select available_credits into v_new_credits
      from public.station_credits where station_id = v_payment.station_id;
    update public.stations set credits = v_new_credits
      where id = v_payment.station_id;
  elsif v_payment.package_type = 'station_pro_monthly' then
    insert into public.station_credits(station_id, available_credits, subscription_type)
    values (v_payment.station_id, 10, 'pro')
    on conflict (station_id) do nothing;
    update public.station_credits
       set subscription_type = 'pro',
           subscription_expires_at = greatest(
             coalesce(subscription_expires_at, now()), now()
           ) + interval '30 days',
           updated_at = now()
     where station_id = v_payment.station_id
     returning subscription_expires_at into v_new_expiry;
    update public.stations set pro_expires_at = v_new_expiry
      where id = v_payment.station_id;
  end if;

  return jsonb_build_object(
    'transaction_reference', v_payment.transaction_reference,
    'status', 'verified',
    'credits_granted', case when v_payment.package_type = 'starter_50' then 50 else 0 end,
    'subscription_expires_at', v_new_expiry,
    'already_applied', false
  );
end;
$$;

revoke all on function public.apply_verified_payment_transaction(text, jsonb) from public, anon, authenticated;
grant execute on function public.apply_verified_payment_transaction(text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.stations enable row level security;
alter table public.station_credits enable row level security;
alter table public.coffee_batches enable row level security;
alter table public.grading_results enable row level security;
alter table public.payment_transactions enable row level security;
alter table public.market_prices enable row level security;

drop policy if exists "station owners read" on public.stations;
create policy "station owners read" on public.stations
  for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists "station owners insert" on public.stations;
create policy "station owners insert" on public.stations
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

drop policy if exists "station owners update" on public.stations;
create policy "station owners update" on public.stations
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists "station owners read credits" on public.station_credits;
create policy "station owners read credits" on public.station_credits
  for select to authenticated
  using (exists (
    select 1 from public.stations s
     where s.id = station_id and s.owner_id = (select auth.uid())
  ));

drop policy if exists "station owners read batches" on public.coffee_batches;
create policy "station owners read batches" on public.coffee_batches
  for select to authenticated
  using (exists (
    select 1 from public.stations s
     where s.id = station_id and s.owner_id = (select auth.uid())
  ));

drop policy if exists "station owners read grading results" on public.grading_results;
create policy "station owners read grading results" on public.grading_results
  for select to authenticated
  using (exists (
    select 1
      from public.coffee_batches b
      join public.stations s on s.id = b.station_id
     where b.id = batch_id and s.owner_id = (select auth.uid())
  ));

drop policy if exists "station owners read payments" on public.payment_transactions;
create policy "station owners read payments" on public.payment_transactions
  for select to authenticated
  using (exists (
    select 1 from public.stations s
     where s.id = station_id and s.owner_id = (select auth.uid())
  ));

drop policy if exists "authenticated read market prices" on public.market_prices;
create policy "authenticated read market prices" on public.market_prices
  for select to authenticated
  using (active = true);

-- Explicit grants: RLS still governs rows. No client-side entitlement,
-- payment, batch, grading or market-price writes are granted.
-- Restrict station writes to profile fields. In particular, credits and Pro
-- entitlement columns are not writable by the mobile client.
revoke all on public.stations from anon, authenticated;
grant select on public.stations to authenticated;
grant insert (owner_id, station_name, name, owner_name, manager, email, phone, woreda, zone)
  on public.stations to authenticated;
grant update (station_name, name, owner_name, manager, email, phone, woreda, zone)
  on public.stations to authenticated;
revoke all on public.station_credits from anon, authenticated;
revoke all on public.coffee_batches from anon, authenticated;
revoke all on public.grading_results from anon, authenticated;
revoke all on public.payment_transactions from anon, authenticated;
revoke all on public.market_prices from anon, authenticated;

grant select on public.station_credits to authenticated;
grant select on public.coffee_batches to authenticated;
grant select on public.grading_results to authenticated;
grant select on public.payment_transactions to authenticated;
grant select on public.market_prices to authenticated;

-- ---------------------------------------------------------------------------
-- Private sample-image bucket. Object path must start with station UUID.
-- Storage upsert requires INSERT + SELECT + UPDATE policies.
-- ---------------------------------------------------------------------------
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'coffee-samples',
  'coffee-samples',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = false,
      file_size_limit = 10485760,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "owner upload sample" on storage.objects;
create policy "owner upload sample" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'coffee-samples'
    and (storage.foldername(name))[1] in (
      select s.id::text from public.stations s
       where s.owner_id = (select auth.uid())
    )
  );

drop policy if exists "owner read sample" on storage.objects;
create policy "owner read sample" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'coffee-samples'
    and (storage.foldername(name))[1] in (
      select s.id::text from public.stations s
       where s.owner_id = (select auth.uid())
    )
  );

drop policy if exists "owner update sample" on storage.objects;
create policy "owner update sample" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'coffee-samples'
    and (storage.foldername(name))[1] in (
      select s.id::text from public.stations s
       where s.owner_id = (select auth.uid())
    )
  )
  with check (
    bucket_id = 'coffee-samples'
    and (storage.foldername(name))[1] in (
      select s.id::text from public.stations s
       where s.owner_id = (select auth.uid())
    )
  );

commit;

-- Setup notes:
-- 1. Run this file in Supabase Dashboard -> SQL Editor using the project owner.
-- 2. Then apply supabase/migrations/*.sql in filename order. Those migrations
--    provide the current app's market_benchmarks / station_payments compatibility
--    tables and any later production hardening.
-- 3. Deploy Edge Functions and configure secrets server-side only.
-- 4. Mobile app receives only SUPABASE_URL + anon/publishable key. Never expose
--    SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY or CHAPA_SECRET_KEY.
