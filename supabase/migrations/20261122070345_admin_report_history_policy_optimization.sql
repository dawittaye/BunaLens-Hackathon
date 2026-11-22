-- Optimize admin report history RLS predicates by evaluating JWT functions once per statement.
drop policy if exists "BunaLens admins read report history" on public.admin_report_history;
create policy "BunaLens admins read report history"
on public.admin_report_history for select to authenticated
using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "BunaLens admins create report history" on public.admin_report_history;
create policy "BunaLens admins create report history"
on public.admin_report_history for insert to authenticated
with check (
  created_by = (select auth.uid())
  and ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin'
);