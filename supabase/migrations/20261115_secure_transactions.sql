-- Secure station credits and Chapa payment processing.
alter table public.stations add column if not exists pro_expires_at timestamptz;
alter table public.station_payments add column if not exists idempotency_key text;
alter table public.station_payments add column if not exists checkout_url text;
create unique index if not exists station_payments_idempotency_uq on public.station_payments(station_id,idempotency_key) where idempotency_key is not null;

-- Preserve profile editing without allowing mobile clients to mint credits or
-- alter Pro expiry. The owner_id and station ownership are guarded by RLS.
revoke insert,update on public.stations from anon, authenticated;
grant select on public.stations to authenticated;
grant insert(owner_id,name,manager,woreda) on public.stations to authenticated;
grant update(name,manager,woreda,phone,email) on public.stations to authenticated;
grant select on public.coffee_batches to authenticated;
grant select on public.market_benchmarks to authenticated;
grant select on public.station_payments to authenticated;
grant select on public.station_credit_ledger to authenticated;

create or replace function public.consume_station_scan_credit(p_station_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_pro_active boolean := false;
begin
  update public.stations
     set credits = credits - 1
   where id = p_station_id
     and owner_id = (select auth.uid())
     and credits > 0
     and (pro_expires_at is null or pro_expires_at <= now());
  if found then return true; end if;

  select coalesce(pro_expires_at > now(), false)
    into v_pro_active
    from public.stations
   where id = p_station_id and owner_id = (select auth.uid());
  return coalesce(v_pro_active, false);
end;
$$;
revoke all on function public.consume_station_scan_credit(uuid) from public, anon;
grant execute on function public.consume_station_scan_credit(uuid) to authenticated;

create or replace function public.apply_verified_chapa_payment(p_tx_ref text,p_provider_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_payment public.station_payments%rowtype;
begin
  select * into v_payment from public.station_payments
   where chapa_tx_ref = p_tx_ref for update;
  if not found then raise exception 'Payment reference not found'; end if;
  if v_payment.status = 'verified' then
    return jsonb_build_object('ok',true,'already_applied',true,'payment_id',v_payment.id);
  end if;
  if v_payment.status <> 'pending' then raise exception 'Payment is not pending'; end if;

  update public.station_payments
     set status='verified',verified_at=now(),provider_payload=p_provider_payload
   where id=v_payment.id;

  if v_payment.package_id = 'starter_50' then
    update public.stations set credits=credits+50 where id=v_payment.station_id;
    insert into public.station_credit_ledger(station_id,payment_id,idempotency_key,entry_type,credits_delta)
    values(v_payment.station_id,v_payment.id,'chapa:'||p_tx_ref,'starter_purchase',50)
    on conflict(idempotency_key) do nothing;
  elsif v_payment.package_id = 'station_pro_monthly' then
    update public.stations
       set pro_expires_at = greatest(coalesce(pro_expires_at,now()),now()) + interval '30 days'
     where id=v_payment.station_id;
  else
    raise exception 'Unsupported payment package';
  end if;
  return jsonb_build_object('ok',true,'already_applied',false,'payment_id',v_payment.id);
end;
$$;
revoke all on function public.apply_verified_chapa_payment(text,jsonb) from public, anon, authenticated;
grant execute on function public.apply_verified_chapa_payment(text,jsonb) to service_role;
