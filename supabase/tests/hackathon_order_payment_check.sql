-- Phase 7 database checks for coffee-order payments. LOCAL/TEST database only.
--
--   docker cp supabase/tests/hackathon_order_payment_check.sql <db container>:/tmp/pay.sql
--   docker exec <db container> psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f /tmp/pay.sql
--
-- Everything runs in one transaction that is ROLLED BACK. The provider answers
-- below are SIMULATED inputs to the database function; no call to Chapa is
-- made and no payment record is left behind. A check that fails raises an
-- error and stops the script.

begin;

create temp table t_ctx on commit drop as
select l.id as listing_id, l.batch_id, l.station_id, l.available_kg as kg_before,
       (select u.id from auth.users u where u.email = 'demo-buyer@bunalens.test') as buyer_id,
       (select u.id from auth.users u where u.email = 'demo-buyer-b@bunalens.test') as other_buyer_id
  from public.marketplace_listings l
 where l.status = 'published' and l.coffee_stage = 'green_bean' and l.available_kg >= 60
 order by l.price_per_kg_etb limit 1;

do $$
declare
  c record;
  v_order uuid;
  v_pay jsonb;
  v_res jsonb;
  v_ref text;
  v_total numeric;
  v_kg numeric;
begin
  select * into c from t_ctx;
  if c.listing_id is null or c.buyer_id is null then
    raise exception 'Run scripts/hackathon/verify-marketplace.mjs first: demo listing or demo buyer missing.';
  end if;

  -- ---- order 1: success path --------------------------------------------------
  insert into public.coffee_orders (listing_id, batch_id, station_id, buyer_id, buyer_name, quantity_kg, price_per_kg_etb, idempotency_key, status)
  select c.listing_id, c.batch_id, c.station_id, c.buyer_id, 'ROLLBACK TEST', 10, l.price_per_kg_etb, 'paytest-' || gen_random_uuid(), 'submitted'
    from public.marketplace_listings l where l.id = c.listing_id returning id, total_etb into v_order, v_total;

  begin
    perform public.bunalens_begin_order_payment(v_order, c.buyer_id, 'paykey-00000001', true);
    raise exception 'CHECK FAILED: a submitted order could start a payment';
  exception when sqlstate '22023' then raise notice 'PASS  an order that is not accepted cannot start a payment';
  end;
  update public.coffee_orders set status = 'accepted', decided_at = now() where id = v_order;
  begin
    perform public.bunalens_begin_order_payment(v_order, c.other_buyer_id, 'paykey-00000001', true);
    raise exception 'CHECK FAILED: another buyer could start a payment';
  exception when sqlstate '42501' then raise notice 'PASS  another buyer cannot start a payment for this order';
  end;

  v_pay := public.bunalens_begin_order_payment(v_order, c.buyer_id, 'paykey-00000001', true);
  v_ref := v_pay ->> 'tx_ref';
  if (v_pay ->> 'amount_etb')::numeric <> v_total or v_pay ->> 'currency' <> 'ETB' or v_ref !~ '^BNLO-[0-9a-f]{32}$'
     or (select payment_status from public.coffee_orders where id = v_order) <> 'pending' then
    raise exception 'CHECK FAILED: payment start %', v_pay;
  end if;
  raise notice 'PASS  payment starts with the stored order total in ETB, a bound reference, and order payment pending';
  if public.bunalens_begin_order_payment(v_order, c.buyer_id, 'paykey-00000002', true) ->> 'tx_ref' <> v_ref
     or (select count(*) from public.coffee_order_payments where order_id = v_order) <> 1 then
    raise exception 'CHECK FAILED: a retry created a second open checkout';
  end if;
  raise notice 'PASS  a retry returns the same open checkout';

  v_res := public.bunalens_apply_order_payment_result(v_ref, 'pending', null, null, null, '{"simulated":true}');
  if v_res ->> 'result' <> 'pending' or v_res ->> 'order_payment_status' <> 'pending' then raise exception 'CHECK FAILED: pending %', v_res; end if;
  raise notice 'PASS  an unpaid checkout stays pending';

  v_res := public.bunalens_apply_order_payment_result(v_ref, 'success', v_ref, v_total + 1, 'ETB', '{"simulated":true}');
  if v_res ->> 'result' <> 'rejected' or v_res ->> 'reason' <> 'amount mismatch' or v_res ->> 'order_payment_status' <> 'failed' then raise exception 'CHECK FAILED: amount %', v_res; end if;
  raise notice 'PASS  success with a different amount is rejected';
  v_res := public.bunalens_apply_order_payment_result(v_ref, 'success', v_ref, v_total, 'USD', '{"simulated":true}');
  if v_res ->> 'result' <> 'rejected' or v_res ->> 'reason' <> 'currency mismatch' then raise exception 'CHECK FAILED: currency %', v_res; end if;
  raise notice 'PASS  success in another currency is rejected';
  v_res := public.bunalens_apply_order_payment_result(v_ref, 'success', 'BNLO-00000000000000000000000000000000', v_total, 'ETB', '{"simulated":true}');
  if v_res ->> 'result' <> 'rejected' or v_res ->> 'reason' <> 'reference mismatch' then raise exception 'CHECK FAILED: reference %', v_res; end if;
  raise notice 'PASS  success for another reference is rejected';
  if (select payment_status from public.coffee_orders where id = v_order) in ('paid', 'paid_test') then raise exception 'CHECK FAILED: rejected results paid the order'; end if;

  v_res := public.bunalens_apply_order_payment_result(v_ref, 'success', v_ref, v_total, 'ETB', '{"simulated":true}');
  if v_res ->> 'result' <> 'verified' or v_res ->> 'order_payment_status' <> 'paid_test' or v_res ->> 'order_status' <> 'accepted' then raise exception 'CHECK FAILED: success %', v_res; end if;
  raise notice 'PASS  matching success marks the payment verified and the order paid_test; the order status stays accepted';
  v_res := public.bunalens_apply_order_payment_result(v_ref, 'success', v_ref, v_total, 'ETB', '{"simulated":true}');
  if v_res ->> 'result' <> 'already_verified' then raise exception 'CHECK FAILED: duplicate %', v_res; end if;
  v_res := public.bunalens_apply_order_payment_result(v_ref, 'failed', v_ref, v_total, 'ETB', '{"simulated":true}');
  if v_res ->> 'result' <> 'already_verified' or (select payment_status from public.coffee_orders where id = v_order) <> 'paid_test' then raise exception 'CHECK FAILED: late failure %', v_res; end if;
  raise notice 'PASS  duplicate and later contradictory callbacks change nothing';
  begin
    perform public.bunalens_begin_order_payment(v_order, c.buyer_id, 'paykey-00000003', true);
    raise exception 'CHECK FAILED: a paid order could start another payment';
  exception when sqlstate '22023' then raise notice 'PASS  a paid order cannot start another payment';
  end;

  -- ---- order 2: failed payment, cancel, late success ---------------------------
  insert into public.coffee_orders (listing_id, batch_id, station_id, buyer_id, buyer_name, quantity_kg, price_per_kg_etb, idempotency_key, status, decided_at)
  select c.listing_id, c.batch_id, c.station_id, c.buyer_id, 'ROLLBACK TEST', 50, l.price_per_kg_etb, 'paytest-' || gen_random_uuid(), 'accepted', now()
    from public.marketplace_listings l where l.id = c.listing_id returning id, total_etb into v_order, v_total;
  update public.marketplace_listings set available_kg = available_kg - 50 where id = c.listing_id; -- what acceptance does
  v_ref := public.bunalens_begin_order_payment(v_order, c.buyer_id, 'paykey-00000004', true) ->> 'tx_ref';

  perform set_config('request.jwt.claims', json_build_object('sub', c.buyer_id, 'role', 'authenticated')::text, true);
  begin
    perform public.bunalens_cancel_order(v_order, null);
    raise exception 'CHECK FAILED: an order with an open checkout was cancelled';
  exception when sqlstate '22023' then raise notice 'PASS  an order with an open checkout cannot be cancelled; its stock stays reserved';
  end;

  update public.coffee_order_payments set expires_at = now() - interval '1 minute' where chapa_tx_ref = v_ref; -- time passes
  v_res := public.bunalens_apply_order_payment_result(v_ref, 'pending', null, null, null, '{"simulated":true}');
  if v_res ->> 'result' <> 'expired' or v_res ->> 'order_payment_status' <> 'failed' then raise exception 'CHECK FAILED: expiry %', v_res; end if;
  raise notice 'PASS  an unpaid checkout expires after its window and the order payment becomes failed';

  select available_kg into v_kg from public.marketplace_listings where id = c.listing_id;
  v_res := public.bunalens_cancel_order(v_order, null);
  if (v_res ->> 'stock_released')::boolean is not true
     or (select available_kg from public.marketplace_listings where id = c.listing_id) <> v_kg + 50 then
    raise exception 'CHECK FAILED: stock release %', v_res;
  end if;
  raise notice 'PASS  cancelling after a failed or expired payment returns the kilograms';

  v_res := public.bunalens_apply_order_payment_result(v_ref, 'success', v_ref, v_total, 'ETB', '{"simulated":true}');
  if v_res ->> 'result' <> 'late_success' or (v_res ->> 'late_success')::boolean is not true or v_res ->> 'order_status' <> 'cancelled'
     or v_res ->> 'order_payment_status' in ('paid', 'paid_test')
     or (select available_kg from public.marketplace_listings where id = c.listing_id) <> v_kg + 50 then
    raise exception 'CHECK FAILED: late success %', v_res;
  end if;
  raise notice 'PASS  success arriving after cancellation is recorded and flagged; the order stays cancelled and the stock is unchanged';

  -- ---- order 3: provider reports failure, buyer retries --------------------------
  insert into public.coffee_orders (listing_id, batch_id, station_id, buyer_id, buyer_name, quantity_kg, price_per_kg_etb, idempotency_key, status, decided_at)
  select c.listing_id, c.batch_id, c.station_id, c.buyer_id, 'ROLLBACK TEST', 5, l.price_per_kg_etb, 'paytest-' || gen_random_uuid(), 'accepted', now()
    from public.marketplace_listings l where l.id = c.listing_id returning id, total_etb into v_order, v_total;
  v_ref := public.bunalens_begin_order_payment(v_order, c.buyer_id, 'paykey-00000005', true) ->> 'tx_ref';
  v_res := public.bunalens_apply_order_payment_result(v_ref, 'failed', v_ref, v_total, 'ETB', '{"simulated":true}');
  if v_res ->> 'result' <> 'failed' or v_res ->> 'order_payment_status' <> 'failed' or v_res ->> 'order_status' <> 'accepted' then raise exception 'CHECK FAILED: failed %', v_res; end if;
  raise notice 'PASS  a failed payment sets the order payment to failed and leaves the order accepted';
  if public.bunalens_begin_order_payment(v_order, c.buyer_id, 'paykey-00000005', true) ->> 'tx_ref' = v_ref then raise exception 'CHECK FAILED: retry reused a failed reference'; end if;
  raise notice 'PASS  after a failure the buyer gets a new checkout with a new reference';

  begin
    perform public.bunalens_apply_order_payment_result('BNLO-ffffffffffffffffffffffffffffffff', 'success', 'BNLO-ffffffffffffffffffffffffffffffff', 1, 'ETB', '{}');
    raise exception 'CHECK FAILED: an unknown reference was accepted';
  exception when sqlstate '42501' then raise notice 'PASS  an unknown reference is refused';
  end;

end;
$$;

-- Client roles cannot call the payment functions or write payment rows.
select case when has_function_privilege('authenticated', 'public.bunalens_begin_order_payment(uuid, uuid, text, boolean)', 'execute')
              or has_function_privilege('authenticated', 'public.bunalens_apply_order_payment_result(text, text, text, numeric, text, jsonb)', 'execute')
              or has_function_privilege('anon', 'public.bunalens_apply_order_payment_result(text, text, text, numeric, text, jsonb)', 'execute')
              or has_table_privilege('authenticated', 'public.coffee_order_payments', 'insert')
              or has_table_privilege('authenticated', 'public.coffee_order_payments', 'update')
            then 'FAIL  client roles can reach payment writes' else 'PASS  client roles cannot call the payment functions or write payment rows' end;

rollback;
