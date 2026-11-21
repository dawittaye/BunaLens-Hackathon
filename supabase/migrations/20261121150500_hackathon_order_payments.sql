-- Hackathon sprint addition (Phase 7): Chapa payments for coffee orders.
--
-- Separate from station-credit payments: nothing here reads or writes
-- public.station_payments or apply_verified_chapa_payment.
--
-- Both functions are for server code only (service role). The Edge Function
-- chapa-order-payment calls them after it has talked to Chapa.
--
-- Order status and payment status stay separate. A payment can only move an
-- order's payment_status; it never accepts, cancels or fulfils an order.
--
-- Stock: an accepted order holds its kilograms while a checkout is open. An
-- open checkout expires 30 minutes after it was created; from then on the
-- order can be cancelled, which returns the kilograms. If Chapa later reports
-- success for a payment whose order is no longer accepted, the payment is
-- recorded as verified and flagged late_success for manual refund handling;
-- the order and the stock are not changed.

begin;

alter table public.coffee_order_payments
  add column if not exists failure_reason text,
  add column if not exists late_success boolean not null default false,
  add column if not exists expires_at timestamptz;

grant select (late_success, expires_at) on public.coffee_order_payments to authenticated;

-- Starts (or returns) the one open checkout of an accepted order. The amount
-- is the stored order total; the reference is generated here and bound to the order.
create or replace function public.bunalens_begin_order_payment(
  p_order_id uuid, p_buyer_id uuid, p_idempotency_key text, p_is_test boolean
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_o public.coffee_orders%rowtype;
  v_p public.coffee_order_payments%rowtype;
  v_reused boolean := false;
begin
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]+$' or length(p_idempotency_key) not between 8 and 128 then
    raise exception 'Invalid payment key.' using errcode = '22023';
  end if;
  select * into v_o from public.coffee_orders o where o.id = p_order_id for update;
  if not found or v_o.buyer_id is distinct from p_buyer_id then
    raise exception 'Order not found for this buyer.' using errcode = '42501';
  end if;
  if v_o.status <> 'accepted' then
    raise exception 'Only an accepted order can be paid. This order is %.', v_o.status using errcode = '22023';
  end if;
  if v_o.payment_status in ('paid', 'paid_test') then
    raise exception 'This order is already paid.' using errcode = '22023';
  end if;
  -- One open checkout per order: a retry gets the same reference back.
  select * into v_p from public.coffee_order_payments p
   where p.order_id = p_order_id and p.status = 'pending' and p.expires_at > now()
   order by p.created_at desc limit 1;
  if found then
    v_reused := true;
  else
    update public.coffee_order_payments p set status = 'expired', failure_reason = 'Checkout expired before payment was verified.'
     where p.order_id = p_order_id and p.status = 'pending';
    insert into public.coffee_order_payments (order_id, chapa_tx_ref, amount_etb, currency, status, is_test, idempotency_key, expires_at)
    values (p_order_id, 'BNLO-' || replace(gen_random_uuid()::text, '-', ''), v_o.total_etb, 'ETB', 'pending', p_is_test,
            p_idempotency_key || '-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'), now() + interval '30 minutes')
    returning * into v_p;
    update public.coffee_orders o set payment_status = 'pending' where o.id = p_order_id;
  end if;
  return jsonb_build_object('reused', v_reused, 'payment_id', v_p.id, 'tx_ref', v_p.chapa_tx_ref, 'amount_etb', v_p.amount_etb,
                            'currency', v_p.currency, 'checkout_url', v_p.checkout_url, 'is_test', v_p.is_test, 'expires_at', v_p.expires_at);
end;
$$;

-- The single place where a provider result changes a payment and its order.
-- p_provider_status is what Chapa's verify endpoint returned ('success',
-- 'failed', 'pending', ...), or 'init_failed' / 'not_found' from our own code.
create or replace function public.bunalens_apply_order_payment_result(
  p_tx_ref text, p_provider_status text, p_provider_tx_ref text, p_amount numeric, p_currency text, p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.coffee_order_payments%rowtype;
  v_o public.coffee_orders%rowtype;
  v_status text := lower(coalesce(p_provider_status, ''));
  v_reason text;
  v_result text;
begin
  select * into v_p from public.coffee_order_payments p where p.chapa_tx_ref = p_tx_ref for update;
  if not found then
    raise exception 'Payment reference not found.' using errcode = '42501';
  end if;
  select * into v_o from public.coffee_orders o where o.id = v_p.order_id for update;
  if v_p.status = 'verified' then
    return jsonb_build_object('result', 'already_verified', 'payment_status', v_p.status, 'order_payment_status', v_o.payment_status,
                              'late_success', v_p.late_success, 'tx_ref', v_p.chapa_tx_ref);
  end if;

  if v_status = 'success' then
    v_reason := case
      when p_provider_tx_ref is distinct from v_p.chapa_tx_ref then 'reference mismatch'
      when upper(coalesce(p_currency, '')) <> 'ETB' or v_p.currency <> 'ETB' then 'currency mismatch'
      when p_amount is null or p_amount <> v_p.amount_etb then 'amount mismatch'
      when v_p.amount_etb <> v_o.total_etb then 'stored amount no longer matches the order total'
      else null end;
    if v_reason is not null then
      -- Reported as paid, but not for this order's reference, amount and currency: rejected.
      update public.coffee_order_payments p set status = 'failed', failure_reason = 'Rejected: ' || v_reason, provider_payload = p_payload
       where p.id = v_p.id;
      update public.coffee_orders o set payment_status = 'failed' where o.id = v_o.id and o.payment_status = 'pending';
      v_result := 'rejected';
    elsif v_o.status in ('accepted', 'fulfilled') and v_o.payment_status not in ('paid', 'paid_test') then
      update public.coffee_order_payments p set status = 'verified', verified_at = now(), failure_reason = null, provider_payload = p_payload
       where p.id = v_p.id;
      update public.coffee_orders o set payment_status = case when v_p.is_test then 'paid_test' else 'paid' end where o.id = v_o.id;
      v_result := 'verified';
    else
      -- Money arrived for an order that is no longer accepted (its stock may be released),
      -- or that another payment already paid. Record it, flag it, and leave the order and the stock alone.
      update public.coffee_order_payments p set status = 'verified', verified_at = now(), late_success = true,
             failure_reason = case when v_o.status in ('accepted', 'fulfilled') then 'Verified, but the order was already paid by another payment.'
                                   else 'Verified after the order was ' || v_o.status || '.' end || ' Needs manual refund handling.',
             provider_payload = p_payload
       where p.id = v_p.id;
      v_result := 'late_success';
    end if;
  elsif v_status in ('failed', 'cancelled', 'canceled', 'init_failed') then
    update public.coffee_order_payments p set status = 'failed', failure_reason = 'Provider status: ' || v_status, provider_payload = p_payload
     where p.id = v_p.id and p.status = 'pending';
    update public.coffee_orders o set payment_status = 'failed' where o.id = v_o.id and o.payment_status = 'pending';
    v_result := 'failed';
  elsif v_p.status = 'pending' and v_p.expires_at <= now() then
    update public.coffee_order_payments p set status = 'expired', failure_reason = 'Checkout expired before payment was verified.'
     where p.id = v_p.id;
    update public.coffee_orders o set payment_status = 'failed' where o.id = v_o.id and o.payment_status = 'pending';
    v_result := 'expired';
  else
    v_result := 'pending';
  end if;

  select * into v_p from public.coffee_order_payments p where p.id = v_p.id;
  select * into v_o from public.coffee_orders o where o.id = v_o.id;
  return jsonb_build_object('result', v_result, 'reason', v_reason, 'payment_status', v_p.status, 'order_status', v_o.status,
                            'order_payment_status', v_o.payment_status, 'late_success', v_p.late_success, 'is_test', v_p.is_test,
                            'tx_ref', v_p.chapa_tx_ref, 'amount_etb', v_p.amount_etb);
end;
$$;

revoke all on function public.bunalens_begin_order_payment(uuid, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.bunalens_apply_order_payment_result(text, text, text, numeric, text, jsonb) from public, anon, authenticated;
grant execute on function public.bunalens_begin_order_payment(uuid, uuid, text, boolean) to service_role;
grant execute on function public.bunalens_apply_order_payment_result(text, text, text, numeric, text, jsonb) to service_role;

commit;
