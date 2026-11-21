-- BunaLens hackathon foundation checks.
--
-- Run against a LOCAL or TEST database only, as a superuser, with
-- ON_ERROR_STOP enabled:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/hackathon_foundation_check.sql
--
-- Everything runs in one transaction that is rolled back, so no row is left
-- behind. Sessions are simulated by switching to the anon / authenticated /
-- service_role database roles and setting the JWT claims PostgREST would set.
-- This checks RLS, grants and triggers; it is not a substitute for signing in
-- through the app.

begin;

-- ---- fixtures (superuser) -------------------------------------------------
insert into auth.users(id, email) values
  ('a0000000-0000-4000-8000-000000000001', 'check-seller-a@bunalens.test'),
  ('b0000000-0000-4000-8000-000000000002', 'check-seller-b@bunalens.test'),
  ('c0000000-0000-4000-8000-000000000003', 'check-buyer@bunalens.test'),
  ('d0000000-0000-4000-8000-000000000004', 'check-reviewer@bunalens.test');

insert into public.stations(id, owner_id, station_name, owner_name, woreda) values
  ('a1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Check Station A', 'Seller A', 'Gomma'),
  ('b1000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002', 'Check Station B', 'Seller B', 'Mana');

insert into public.coffee_batches(id, batch_code, station_id, idempotency_key, sample_type, woreda, lot_weight_kg, grading_status) values
  ('check-lot-a-0001', 'BNL-JMA-CHKA', 'a1000000-0000-4000-8000-000000000001', 'check-lot-a-0001', 'green_bean', 'Gomma', 600, 'queued'),
  ('check-lot-b-0001', 'BNL-JMA-CHKB', 'b1000000-0000-4000-8000-000000000002', 'check-lot-b-0001', 'red_cherry', 'Mana', 300, 'queued');

insert into public.warehouse_zones(id, station_id, name) values
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'Zone 1');

insert into public.station_devices(id, station_id, zone_id, device_uid, token_hash, is_simulated) values
  ('a3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001',
   'a2000000-0000-4000-8000-000000000001', 'esp32-check-0001',
   encode(sha256('check-token'::bytea), 'hex'), true);

insert into public.lot_zone_assignments(batch_id, zone_id, station_id, assigned_at) values
  ('check-lot-a-0001', 'a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', now() - interval '1 hour');

\echo CHECK 1: a retried device message does not create a duplicate reading
insert into public.device_readings(device_id, zone_id, station_id, message_id, recorded_at, temperature_c, humidity_pct, source) values
  ('a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'msg-0001', now() - interval '10 minutes', 22.5, 61.0, 'simulated'),
  ('a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'msg-0000', now() - interval '2 hours', 21.0, 60.0, 'simulated');
insert into public.device_readings(device_id, zone_id, station_id, message_id, recorded_at, temperature_c, humidity_pct, source) values
  ('a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'msg-0001', now() - interval '10 minutes', 22.5, 61.0, 'simulated')
on conflict (device_id, message_id) do nothing;
do $$ begin
  if (select count(*) from public.device_readings where message_id = 'msg-0001') <> 1 then
    raise exception 'FAIL: duplicate reading stored';
  end if;
  -- Only the reading inside the assignment window belongs to the lot.
  if (select count(*) from public.lot_environment_readings where batch_id = 'check-lot-a-0001') <> 1 then
    raise exception 'FAIL: lot reading window is wrong';
  end if;
end $$;

\echo CHECK 2: out-of-range and future readings are rejected
do $$ begin
  begin
    insert into public.device_readings(device_id, zone_id, station_id, message_id, recorded_at, temperature_c, humidity_pct, source)
    values ('a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'msg-bad-1', now(), 22, 140, 'simulated');
    raise exception 'FAIL: humidity 140 accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.device_readings(device_id, zone_id, station_id, message_id, recorded_at, temperature_c, humidity_pct, source)
    values ('a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'msg-bad-2', now() + interval '1 day', 22, 60, 'simulated');
    raise exception 'FAIL: future reading accepted';
  exception when check_violation then null;
  end;
end $$;

\echo CHECK 3: an unreviewed lot cannot be published, even by a privileged writer
do $$ begin
  begin
    insert into public.marketplace_listings(batch_id, station_id, seller_display_name, origin_woreda, coffee_stage, available_kg, price_per_kg_etb, status)
    values ('check-lot-a-0001', 'a1000000-0000-4000-8000-000000000001', 'Check Station A', 'Gomma', 'green_bean', 500, 250, 'published');
    raise exception 'FAIL: unreviewed lot was published';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.marketplace_listings(batch_id, station_id, seller_display_name, origin_woreda, coffee_stage, available_kg, price_per_kg_etb)
    values ('check-lot-a-0001', 'b1000000-0000-4000-8000-000000000002', 'Check Station B', 'Gomma', 'green_bean', 500, 250);
    raise exception 'FAIL: another station listed this lot';
  exception when insufficient_privilege then null;
  end;
end $$;

\echo CHECK 4: an eligible lot from an approved seller can be published
update public.stations set marketplace_seller_status = 'approved',
       marketplace_seller_reviewed_at = now()
 where id = 'a1000000-0000-4000-8000-000000000001';
update public.coffee_batches set eligibility_status = 'eligible', eligibility_updated_at = now()
 where id = 'check-lot-a-0001';
insert into public.lot_reviews(batch_id, decision, decided_by, reviewer_id, reason)
values ('check-lot-a-0001', 'eligible', 'reviewer', 'd0000000-0000-4000-8000-000000000004', 'Foundation check');
insert into public.marketplace_listings(id, batch_id, station_id, seller_display_name, origin_woreda, coffee_stage, available_kg, price_per_kg_etb, status)
values ('a4000000-0000-4000-8000-000000000001', 'check-lot-a-0001', 'a1000000-0000-4000-8000-000000000001', 'Check Station A', 'Gomma', 'green_bean', 500, 250, 'published');
insert into public.marketplace_listings(batch_id, station_id, seller_display_name, origin_woreda, coffee_stage, available_kg, price_per_kg_etb)
values ('check-lot-b-0001', 'b1000000-0000-4000-8000-000000000002', 'Check Station B', 'Mana', 'red_cherry', 300, 90);
insert into public.coffee_orders(id, listing_id, batch_id, station_id, buyer_id, buyer_name, quantity_kg, price_per_kg_etb, idempotency_key)
values ('a5000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', 'check-lot-a-0001',
        'a1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000003', 'Check Buyer', 10, 250, 'check-order-0001');
insert into public.coffee_order_payments(order_id, chapa_tx_ref, amount_etb, is_test, idempotency_key, provider_payload)
values ('a5000000-0000-4000-8000-000000000001', 'BNLO-check-0001', 2500, true, 'check-pay-0001', '{"private":true}');
do $$ begin
  if (select total_etb from public.coffee_orders where id = 'a5000000-0000-4000-8000-000000000001') <> 2500 then
    raise exception 'FAIL: order total is wrong';
  end if;
end $$;

\echo CHECK 5: anonymous visitors see published listings only
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$ begin
  if (select count(*) from public.marketplace_listings) <> 1 then
    raise exception 'FAIL: anon listing visibility is wrong';
  end if;
  begin perform 1 from public.coffee_batches; raise exception 'FAIL: anon read lots';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.coffee_orders; raise exception 'FAIL: anon read orders';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.device_readings; raise exception 'FAIL: anon read readings';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

\echo CHECK 6: an unrelated seller cannot see or change records of another station
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{},"user_metadata":{"role":"admin"}}', true);
do $$ begin
  if public.bunalens_is_reviewer() then
    raise exception 'FAIL: user_metadata granted a privileged role';
  end if;
  if (select count(*) from public.warehouse_zones) <> 0
     or (select count(*) from public.device_readings) <> 0
     or (select count(*) from public.lot_zone_assignments) <> 0
     or (select count(*) from public.lot_reviews) <> 0
     or (select count(*) from public.coffee_orders) <> 0
     or (select count(*) from public.coffee_order_payments) <> 0
     or (select count(*) from public.coffee_batches where id = 'check-lot-a-0001') <> 0 then
    raise exception 'FAIL: seller B can read station A records';
  end if;
  -- Seller B sees the published listing of A and its own draft, nothing else.
  if (select count(*) from public.marketplace_listings) <> 2 then
    raise exception 'FAIL: seller B listing visibility is wrong';
  end if;
  begin
    update public.marketplace_listings set price_per_kg_etb = 1;
    raise exception 'FAIL: client updated a listing';
  exception when insufficient_privilege then null; end;
  begin
    update public.coffee_orders set status = 'accepted';
    raise exception 'FAIL: client updated an order';
  exception when insufficient_privilege then null; end;
  begin
    update public.coffee_batches set eligibility_status = 'eligible';
    raise exception 'FAIL: client approved a lot';
  exception when insufficient_privilege then null; end;
  begin
    update public.stations set marketplace_seller_status = 'approved';
    raise exception 'FAIL: client approved itself as seller';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

\echo CHECK 7: the owning seller reads its records but not device credentials
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{}}', true);
do $$ begin
  if (select count(*) from public.warehouse_zones) <> 1
     or (select count(*) from public.lot_environment_readings where batch_id = 'check-lot-a-0001') <> 1
     or (select count(*) from public.lot_reviews) <> 1
     or (select count(*) from public.coffee_orders) <> 1
     or (select count(*) from public.station_devices) <> 1 then
    raise exception 'FAIL: seller A cannot read its own records';
  end if;
  begin perform token_hash from public.station_devices; raise exception 'FAIL: token hash readable';
  exception when insufficient_privilege then null; end;
  begin perform provider_payload from public.coffee_order_payments; raise exception 'FAIL: provider payload readable';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

\echo CHECK 8: the buyer sees its own order and cannot write orders directly
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{}}', true);
do $$ begin
  if (select count(*) from public.coffee_orders) <> 1
     or (select count(*) from public.coffee_order_payments) <> 1
     or (select count(*) from public.device_readings) <> 0 then
    raise exception 'FAIL: buyer visibility is wrong';
  end if;
  begin
    insert into public.coffee_orders(listing_id, batch_id, station_id, buyer_id, buyer_name, quantity_kg, price_per_kg_etb, idempotency_key)
    values ('a4000000-0000-4000-8000-000000000001', 'check-lot-a-0001', 'a1000000-0000-4000-8000-000000000001',
            'c0000000-0000-4000-8000-000000000003', 'Check Buyer', 1, 1, 'check-order-0002');
    raise exception 'FAIL: client inserted an order directly';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

\echo CHECK 9: a reviewer claim from app_metadata can read lots and reviews
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000004","role":"authenticated","app_metadata":{"role":"reviewer"}}', true);
do $$ begin
  if (select count(*) from public.coffee_batches where id like 'check-lot-%') <> 2
     or (select count(*) from public.lot_reviews) <> 1
     or (select count(*) from public.lot_environment_readings) <> 1 then
    raise exception 'FAIL: reviewer cannot read review inputs';
  end if;
  -- Orders are for the parties and admins, not reviewers.
  if (select count(*) from public.coffee_orders) <> 0 then
    raise exception 'FAIL: reviewer can read orders';
  end if;
end $$;
reset role;

\echo CHECK 10: losing eligibility or seller approval unpublishes the listing
update public.coffee_batches set eligibility_status = 'rejected' where id = 'check-lot-a-0001';
do $$ begin
  if (select status from public.marketplace_listings where batch_id = 'check-lot-a-0001') <> 'paused' then
    raise exception 'FAIL: listing stayed published after rejection';
  end if;
end $$;
update public.coffee_batches set eligibility_status = 'eligible' where id = 'check-lot-a-0001';
update public.marketplace_listings set status = 'published' where batch_id = 'check-lot-a-0001';
update public.stations set marketplace_seller_status = 'suspended' where id = 'a1000000-0000-4000-8000-000000000001';
do $$ begin
  if (select status from public.marketplace_listings where batch_id = 'check-lot-a-0001') <> 'paused' then
    raise exception 'FAIL: listing stayed published after seller suspension';
  end if;
end $$;

\echo CHECK 11: existing scan-credit debit still works and stays idempotent
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{}}', true);
do $$ begin
  if not public.consume_station_scan_credit('a1000000-0000-4000-8000-000000000001'::uuid, 'check-scan-0001')
     or not public.consume_station_scan_credit('a1000000-0000-4000-8000-000000000001'::uuid, 'check-scan-0001') then
    raise exception 'FAIL: scan credit debit refused';
  end if;
  if (select credits from public.stations where id = 'a1000000-0000-4000-8000-000000000001') <> 9 then
    raise exception 'FAIL: scan credit debited more than once';
  end if;
end $$;
reset role;

\echo CHECK 12: existing Chapa credit application still works for the service role
insert into public.station_payments(station_id, package_id, amount_etb, chapa_tx_ref, idempotency_key)
values ('a1000000-0000-4000-8000-000000000001', 'starter_50', 500, 'BNL-check-credit-0001', 'check-credit-0001');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$ begin
  perform public.apply_verified_chapa_payment('BNL-check-credit-0001', '{"check":true}'::jsonb);
  perform public.apply_verified_chapa_payment('BNL-check-credit-0001', '{"check":true}'::jsonb);
  if (select credits from public.stations where id = 'a1000000-0000-4000-8000-000000000001') <> 59 then
    raise exception 'FAIL: credit top-up was not applied exactly once';
  end if;
end $$;
reset role;

\echo ALL FOUNDATION CHECKS PASSED (transaction will be rolled back)
rollback;
