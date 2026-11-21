-- BunaLens user monitoring.
-- Authentication records remain in Supabase Auth; this table stores only
-- application activity events that users are allowed to write about themselves.

create table if not exists public.user_activity_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in (
    'account_registered',
    'user_signed_in',
    'user_signed_out',
    'coffee_batch_submitted',
    'admin_action'
  )),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists user_activity_logs_user_created_idx
  on public.user_activity_logs(user_id, created_at desc);
create index if not exists user_activity_logs_created_idx
  on public.user_activity_logs(created_at desc);

alter table public.user_activity_logs enable row level security;

drop policy if exists "Users record their own activity" on public.user_activity_logs;
create policy "Users record their own activity"
on public.user_activity_logs
for insert to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "BunaLens admins read all user activity" on public.user_activity_logs;
create policy "BunaLens admins read all user activity"
on public.user_activity_logs
for select to authenticated
using ((select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '')) = 'admin');

revoke all on public.user_activity_logs from anon, authenticated;
grant insert (user_id, event_type, metadata) on public.user_activity_logs to authenticated;
grant select on public.user_activity_logs to authenticated;
