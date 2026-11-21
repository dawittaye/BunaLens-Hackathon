-- BunaLens admin dashboard read access.
-- Admin authorization is sourced only from trusted app_metadata claims. The
-- role must be set by a project owner through Supabase Auth Admin; never put
-- authorization roles in user_metadata, which end users can edit themselves.

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'stations',
    'station_credits',
    'coffee_batches',
    'grading_results',
    'payment_transactions',
    'station_payments',
    'station_credit_ledger'
  ] loop
    execute format('alter table public.%I enable row level security', target_table);
    execute format('drop policy if exists "BunaLens admins read all %1$s" on public.%1$I', target_table);
    execute format(
      'create policy "BunaLens admins read all %1$s" on public.%1$I for select to authenticated using ((select coalesce(auth.jwt() -> ''app_metadata'' ->> ''role'', '''')) = ''admin'')',
      target_table
    );
  end loop;
end;
$$;

-- Existing column-level grants are preserved. No admin write policy or grant
-- is added: entitlement, payment and grading changes remain server-owned.
