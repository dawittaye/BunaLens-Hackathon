-- Mobile clients may read their own data, but must not mint credits or write grading records.
revoke insert,update,delete on public.stations from authenticated;
revoke insert,update,delete on public.coffee_batches from authenticated;
grant select on public.stations to authenticated;
grant insert(owner_id,name,manager,woreda) on public.stations to authenticated;
grant update(name,manager,woreda) on public.stations to authenticated;
grant select on public.coffee_batches to authenticated;
revoke insert,update,delete on public.station_payments from authenticated;
revoke insert,update,delete on public.station_credit_ledger from authenticated;
grant select on public.station_payments to authenticated;
grant select on public.station_credit_ledger to authenticated;
