-- BunaLens admin reporting history. Additive only; existing production records are untouched.
create table if not exists public.admin_report_history (
  id uuid primary key default gen_random_uuid(),
  report_reference text not null unique,
  report_type text not null check (report_type in ('users','payments','directory','coffee_plants','climate','general')),
  period_start date not null,
  period_end date not null,
  record_count integer not null default 0 check (record_count >= 0),
  filters jsonb not null default '{}'::jsonb check (jsonb_typeof(filters) = 'object'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_by_label text not null,
  generation_status text not null default 'completed' check (generation_status in ('completed', 'failed')),
  created_at timestamptz not null default now(),
  constraint admin_report_history_period_valid check (period_end >= period_start)
);
create index if not exists admin_report_history_created_idx on public.admin_report_history(created_at desc);
create index if not exists admin_report_history_creator_idx on public.admin_report_history(created_by, created_at desc);
alter table public.admin_report_history enable row level security;
drop policy if exists "BunaLens admins read report history" on public.admin_report_history;
create policy "BunaLens admins read report history" on public.admin_report_history for select to authenticated using ((select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '')) = 'admin');
drop policy if exists "BunaLens admins create report history" on public.admin_report_history;
create policy "BunaLens admins create report history" on public.admin_report_history for insert to authenticated with check (created_by = (select auth.uid()) and (select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '')) = 'admin');
revoke all on public.admin_report_history from anon, authenticated;
grant select, insert on public.admin_report_history to authenticated;
