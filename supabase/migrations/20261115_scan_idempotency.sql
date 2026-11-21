-- Idempotent scan debit: one credit may be consumed at most once per capture.
drop function if exists public.consume_station_scan_credit(uuid);
create or replace function public.consume_station_scan_credit(p_station_id uuid,p_idempotency_key text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_station public.stations%rowtype;
begin
  if (select auth.uid()) is null then return false; end if;
  if p_idempotency_key is null or length(p_idempotency_key)<8 or length(p_idempotency_key)>128 then
    raise exception 'Invalid scan idempotency key';
  end if;
  select * into v_station from public.stations
   where id=p_station_id and owner_id=(select auth.uid()) for update;
  if not found then return false; end if;

  if exists(select 1 from public.station_credit_ledger
             where idempotency_key='scan:'||p_idempotency_key and station_id=p_station_id) then
    return true;
  end if;
  if v_station.pro_expires_at is not null and v_station.pro_expires_at>now() then
    return true;
  end if;
  if v_station.credits<1 then return false; end if;

  update public.stations set credits=credits-1 where id=p_station_id;
  insert into public.station_credit_ledger(station_id,idempotency_key,entry_type,credits_delta)
  values(p_station_id,'scan:'||p_idempotency_key,'scan_debit',-1);
  return true;
end;
$$;
revoke all on function public.consume_station_scan_credit(uuid,text) from public, anon;
grant execute on function public.consume_station_scan_credit(uuid,text) to authenticated;

alter table public.coffee_batches add column if not exists pricing_result jsonb;
