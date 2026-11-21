-- BunaLens business rules, idempotency and certificate verification extensions.
alter table public.stations add column if not exists pro_expires_at timestamptz;
alter table public.coffee_batches add column if not exists idempotency_key text;
alter table public.coffee_batches add column if not exists verification_id uuid not null default gen_random_uuid();
create unique index if not exists coffee_batches_station_idempotency_uq on public.coffee_batches(station_id,idempotency_key) where idempotency_key is not null;
create unique index if not exists coffee_batches_verification_id_uq on public.coffee_batches(verification_id);

create table if not exists public.market_benchmarks(
 id text primary key,
 sample_type text not null check(sample_type in('red_cherry','green_bean')),
 ecx_style_grade text not null,
 min_etb_per_feresula numeric(12,2) not null check(min_etb_per_feresula>=0),
 max_etb_per_feresula numeric(12,2) not null check(max_etb_per_feresula>=min_etb_per_feresula),
 source_label text not null,
 effective_date date not null,
 is_demo boolean not null default false,
 active boolean not null default true,
 created_at timestamptz not null default now()
);
alter table public.market_benchmarks enable row level security;
create policy "authenticated read active benchmarks" on public.market_benchmarks for select to authenticated using(active=true);

create table if not exists public.station_payments(
 id uuid primary key default gen_random_uuid(),
 station_id uuid not null references public.stations(id) on delete cascade,
 package_id text not null check(package_id in('starter_50','station_pro_monthly')),
 amount_etb numeric(12,2) not null check(amount_etb>0),
 currency text not null default 'ETB' check(currency='ETB'),
 chapa_tx_ref text not null unique,
 status text not null default 'pending' check(status in('pending','verified','failed','expired')),
 verified_at timestamptz,
 provider_payload jsonb,
 created_at timestamptz not null default now()
);
alter table public.station_payments enable row level security;
create policy "station owners read own payments" on public.station_payments for select to authenticated using(exists(select 1 from public.stations s where s.id=station_id and s.owner_id=(select auth.uid())));

create table if not exists public.station_credit_ledger(
 id uuid primary key default gen_random_uuid(),
 station_id uuid not null references public.stations(id) on delete cascade,
 payment_id uuid references public.station_payments(id),
 idempotency_key text not null unique,
 entry_type text not null check(entry_type in('starter_purchase','scan_debit','admin_adjustment')),
 credits_delta integer not null check(credits_delta<>0),
 created_at timestamptz not null default now()
);
alter table public.station_credit_ledger enable row level security;
create policy "station owners read own credit ledger" on public.station_credit_ledger for select to authenticated using(exists(select 1 from public.stations s where s.id=station_id and s.owner_id=(select auth.uid())));

-- This public-safe view exposes only certificate verification fields, not images,
-- personal data, GPS coordinates, or payment information.
create or replace view public.public_certificate_verification as
select b.verification_id,b.batch_code,b.sample_type,b.woreda,b.created_at,
       b.grading_result->>'ecx_grade' as estimated_grade,
       b.grading_result->>'quality_score' as quality_score,
       b.lot_weight_kg
from public.coffee_batches b;

-- Server-side service role must atomically:
-- (a) verify Chapa with Chapa's verification API,
-- (b) mark station_payments.status='verified',
-- (c) add a unique ledger entry and update stations.credits or pro_expires_at.
-- Mobile clients intentionally have no insert/update policy on payment or ledger tables.
