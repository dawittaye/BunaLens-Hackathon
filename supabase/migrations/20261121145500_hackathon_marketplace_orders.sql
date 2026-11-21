-- Hackathon sprint addition (Phase 6): seller listings and buyer orders.
--
-- Clients still have no write access to marketplace_listings or coffee_orders.
-- Every write goes through the functions below, which check ownership,
-- listing state, quantity and stock on the server.
--
-- Order states (coffee_orders.status): submitted, accepted, declined (shown
-- as "rejected"), cancelled, fulfilled. Payment is tracked separately in
-- coffee_orders.payment_status and is never implied by acceptance.
--
-- Stock: submitting an order does not hold stock. Accepting an order
-- decrements marketplace_listings.available_kg in the same transaction,
-- under a row lock on the listing. Cancelling an accepted, unpaid order puts
-- the kilograms back.

begin;

alter table public.marketplace_listings
  add column if not exists batch_code text,
  add column if not exists evidence_summary jsonb not null default '{}'::jsonb;

alter table public.coffee_orders
  add column if not exists listing_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists decision_note text,
  add column if not exists fulfilled_at timestamptz,
  add column if not exists fulfillment_note text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists stock_released_at timestamptz;

grant select (batch_code, evidence_summary) on public.marketplace_listings to anon, authenticated;
grant select (listing_snapshot, decision_note, fulfilled_at, fulfillment_note, cancelled_at, stock_released_at)
  on public.coffee_orders to authenticated;

-- ---------------------------------------------------------------------------
-- Seller: create, update, publish, pause or withdraw the listing of a lot.
-- Name, origin, stage, screening summary and evidence provenance are taken
-- from the lot record on the server, never from the request.
-- ---------------------------------------------------------------------------
create or replace function public.bunalens_save_listing(
  p_batch_id text, p_available_kg numeric, p_price_per_kg_etb numeric, p_status text default 'draft'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_station uuid := public.bunalens_my_station_id();
  v_lot public.coffee_batches%rowtype;
  v_name text;
  v_eval jsonb;
  v_last public.lot_reviews%rowtype;
  v_scr jsonb;
  v_summary text;
  v_evidence jsonb;
  v_reserved numeric;
  v_row public.marketplace_listings%rowtype;
begin
  if (select auth.uid()) is null or v_station is null then
    raise exception 'Sign in with a registered station account.' using errcode = '42501';
  end if;
  if p_status not in ('draft', 'published', 'paused', 'withdrawn') then
    raise exception 'Status must be draft, published, paused or withdrawn.' using errcode = '22023';
  end if;
  select * into v_lot from public.coffee_batches b where b.id = p_batch_id and b.station_id = v_station for update;
  if not found then
    raise exception 'Lot not found for this station.' using errcode = '42501';
  end if;
  select coalesce(sum(o.quantity_kg), 0) into v_reserved from public.coffee_orders o
   where o.batch_id = p_batch_id and o.status in ('accepted', 'fulfilled');
  if p_available_kg is null or p_available_kg <= 0 or p_available_kg <> round(p_available_kg, 2)
     or p_available_kg + v_reserved > v_lot.lot_weight_kg then
    raise exception 'Available kilograms must be above 0 and, with the % kg already accepted, no more than the lot weight of % kg.', v_reserved, v_lot.lot_weight_kg using errcode = '22023';
  end if;
  if p_price_per_kg_etb is null or p_price_per_kg_etb <= 0 or p_price_per_kg_etb > 100000
     or p_price_per_kg_etb <> round(p_price_per_kg_etb, 2) then
    raise exception 'Price per kilogram must be above 0 ETB, with at most two decimals.' using errcode = '22023';
  end if;

  select coalesce(nullif(btrim(s.station_name), ''), s.name) into v_name from public.stations s where s.id = v_station;
  v_eval := public.bunalens_compute_eligibility(p_batch_id);
  select * into v_last from public.lot_reviews r where r.batch_id = p_batch_id order by r.created_at desc, r.id desc limit 1;
  v_scr := v_lot.grading_result -> 'screening';
  v_summary := case
    when v_scr is null or jsonb_typeof(v_scr) <> 'object' then 'No photo screening is saved for this lot.'
    else (case when v_scr ->> 'source' = 'live_inference'
               then 'Photo screening by ' || coalesce(v_scr ->> 'model', 'a model') || '. '
               else 'DEMO FIXTURE screening: preset values, the photo was not analysed. ' end)
         || coalesce((select string_agg(x, ' ') from (select x from jsonb_array_elements_text(v_scr -> 'observations') with ordinality as t(x, n) where n <= 3 order by n) q), '')
  end;
  -- Buyer-facing provenance only: no reviewer identity, notes, evidence ids or photo paths.
  v_evidence := jsonb_build_object(
    'policy_id', v_eval -> 'policy' ->> 'id',
    'policy_is_demo', (v_eval -> 'policy' ->> 'is_demo')::boolean,
    'eligibility_status', v_lot.eligibility_status,
    'decided_by', v_last.decided_by,
    'decided_at', v_last.created_at,
    'is_override', coalesce(v_last.is_override, false),
    'uses_simulated_evidence', (v_eval ->> 'uses_simulated_evidence')::boolean,
    'official_grade', 'Unclassified',
    'inputs', (select jsonb_agg(jsonb_build_object(
        'input', c ->> 'input', 'label', c ->> 'label', 'status', c ->> 'status', 'value', c -> 'value', 'unit', c ->> 'unit',
        'method', c ->> 'method', 'source', c ->> 'source', 'recorded_at', c ->> 'recorded_at',
        'verification_status', c ->> 'verification_status'))
      from jsonb_array_elements(v_eval -> 'checks') as t(c)),
    'screening', case when v_scr is null or jsonb_typeof(v_scr) <> 'object' then null else jsonb_build_object(
        'source', v_scr ->> 'source', 'provider', v_scr ->> 'provider', 'model', v_scr ->> 'model',
        'assessed_at', v_scr ->> 'assessed_at', 'suspected_defects', v_scr -> 'suspected_defects',
        'not_assessed', v_scr -> 'not_assessed') end
  );

  insert into public.marketplace_listings as l (batch_id, station_id, seller_display_name, origin_woreda, coffee_stage,
      available_kg, price_per_kg_etb, screening_summary, assessed_at, is_demo, status, batch_code, evidence_summary)
  values (v_lot.id, v_station, v_name, v_lot.woreda, v_lot.sample_type, p_available_kg, p_price_per_kg_etb,
      left(v_summary, 900), nullif(v_scr ->> 'assessed_at', '')::timestamptz,
      v_lot.is_demo or (v_eval ->> 'uses_simulated_evidence')::boolean, p_status, v_lot.batch_code, v_evidence)
  on conflict (batch_id) do update set
      seller_display_name = excluded.seller_display_name, origin_woreda = excluded.origin_woreda,
      coffee_stage = excluded.coffee_stage, available_kg = excluded.available_kg,
      price_per_kg_etb = excluded.price_per_kg_etb, screening_summary = excluded.screening_summary,
      assessed_at = excluded.assessed_at, is_demo = excluded.is_demo, status = excluded.status,
      batch_code = excluded.batch_code, evidence_summary = excluded.evidence_summary
  returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

-- ---------------------------------------------------------------------------
-- Buyer: submit an order. Price and listing details are copied from the
-- listing on the server. The total is the generated column total_etb.
-- ---------------------------------------------------------------------------
create or replace function public.bunalens_submit_order(
  p_listing_id uuid, p_quantity_kg numeric, p_idempotency_key text, p_buyer_name text, p_buyer_phone text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_buyer uuid := (select auth.uid());
  v_l public.marketplace_listings%rowtype;
  v_row public.coffee_orders%rowtype;
begin
  if v_buyer is null then
    raise exception 'Sign in to place an order.' using errcode = '42501';
  end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]+$' or length(p_idempotency_key) not between 8 and 128 then
    raise exception 'Invalid order key.' using errcode = '22023';
  end if;
  select * into v_row from public.coffee_orders o where o.buyer_id = v_buyer and o.idempotency_key = p_idempotency_key;
  if found then
    if v_row.listing_id is distinct from p_listing_id or v_row.quantity_kg is distinct from p_quantity_kg then
      raise exception 'This order key was already used for a different order.' using errcode = '22023';
    end if;
    return jsonb_build_object('already_submitted', true, 'order', to_jsonb(v_row));
  end if;
  if length(btrim(coalesce(p_buyer_name, ''))) not between 2 and 120 then
    raise exception 'Enter the buyer name.' using errcode = '22023';
  end if;
  if p_quantity_kg is null or p_quantity_kg <= 0 or p_quantity_kg <> round(p_quantity_kg, 2) then
    raise exception 'Quantity must be above 0 kg, with at most two decimals.' using errcode = '22023';
  end if;
  select * into v_l from public.marketplace_listings l where l.id = p_listing_id for share;
  if not found or v_l.status <> 'published' then
    raise exception 'This listing is not open for orders.' using errcode = '42501';
  end if;
  if public.bunalens_owns_station(v_l.station_id) then
    raise exception 'You cannot order from your own station.' using errcode = '42501';
  end if;
  if p_quantity_kg > v_l.available_kg then
    raise exception 'Only % kg are available on this listing.', v_l.available_kg using errcode = '22023';
  end if;
  begin
    insert into public.coffee_orders (listing_id, batch_id, station_id, buyer_id, buyer_name, buyer_phone, quantity_kg,
        price_per_kg_etb, idempotency_key, listing_snapshot)
    values (v_l.id, v_l.batch_id, v_l.station_id, v_buyer, left(btrim(p_buyer_name), 120),
        nullif(left(btrim(coalesce(p_buyer_phone, '')), 30), ''), p_quantity_kg, v_l.price_per_kg_etb, p_idempotency_key,
        jsonb_build_object('seller_display_name', v_l.seller_display_name, 'origin_woreda', v_l.origin_woreda,
          'coffee_stage', v_l.coffee_stage, 'batch_code', v_l.batch_code, 'screening_summary', v_l.screening_summary,
          'assessed_at', v_l.assessed_at, 'is_demo', v_l.is_demo, 'policy_id', v_l.evidence_summary ->> 'policy_id',
          'price_per_kg_etb', v_l.price_per_kg_etb, 'captured_at', now()))
    returning * into v_row;
  exception when unique_violation then
    -- A retry that raced with the first request.
    select * into v_row from public.coffee_orders o where o.buyer_id = v_buyer and o.idempotency_key = p_idempotency_key;
    return jsonb_build_object('already_submitted', true, 'order', to_jsonb(v_row));
  end;
  return jsonb_build_object('already_submitted', false, 'order', to_jsonb(v_row));
end;
$$;

-- ---------------------------------------------------------------------------
-- Seller: accept or reject. Acceptance and the stock decrement are one
-- transaction under a row lock on the listing, so concurrent acceptances
-- cannot exceed the stock.
-- ---------------------------------------------------------------------------
create or replace function public.bunalens_decide_order(p_order_id uuid, p_action text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_o public.coffee_orders%rowtype;
  v_l public.marketplace_listings%rowtype;
  v_target text;
begin
  if p_action not in ('accept', 'reject') then
    raise exception 'Action must be accept or reject.' using errcode = '22023';
  end if;
  v_target := case p_action when 'accept' then 'accepted' else 'declined' end;
  select * into v_o from public.coffee_orders o where o.id = p_order_id for update;
  if not found or (select auth.uid()) is null or not public.bunalens_owns_station(v_o.station_id) then
    raise exception 'Order not found for this station.' using errcode = '42501';
  end if;
  if v_o.status = v_target then
    return jsonb_build_object('already_decided', true, 'order', to_jsonb(v_o)); -- safe retry
  end if;
  if v_o.status <> 'submitted' then
    raise exception 'This order is % and can no longer be accepted or rejected.', v_o.status using errcode = '22023';
  end if;
  if p_action = 'accept' then
    select * into v_l from public.marketplace_listings l where l.id = v_o.listing_id for update;
    if v_l.status <> 'published' then
      raise exception 'The listing is not published. Publish it again before accepting orders.' using errcode = '22023';
    end if;
    if v_l.available_kg < v_o.quantity_kg then
      raise exception 'Not enough stock: % kg left, the order is for % kg.', v_l.available_kg, v_o.quantity_kg using errcode = '22023';
    end if;
    update public.marketplace_listings l
       set available_kg = l.available_kg - v_o.quantity_kg,
           status = case when l.available_kg - v_o.quantity_kg = 0 then 'sold_out' else l.status end
     where l.id = v_l.id;
  end if;
  update public.coffee_orders o set status = v_target, decided_at = now(),
         decision_note = nullif(left(btrim(coalesce(p_note, '')), 500), '')
   where o.id = p_order_id returning * into v_o;
  return jsonb_build_object('already_decided', false, 'order', to_jsonb(v_o));
end;
$$;

-- Buyer or seller: cancel. A submitted order holds no stock. An accepted
-- order that is not paid gives its kilograms back. A paid or fulfilled order
-- cannot be cancelled here (refunds are out of scope).
create or replace function public.bunalens_cancel_order(p_order_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_o public.coffee_orders%rowtype;
  v_release boolean := false;
begin
  select * into v_o from public.coffee_orders o where o.id = p_order_id for update;
  if not found or (select auth.uid()) is null
     or not (v_o.buyer_id = (select auth.uid()) or public.bunalens_owns_station(v_o.station_id)) then
    raise exception 'Order not found.' using errcode = '42501';
  end if;
  if v_o.status = 'cancelled' then
    return jsonb_build_object('already_cancelled', true, 'order', to_jsonb(v_o));
  end if;
  if v_o.status not in ('submitted', 'accepted') then
    raise exception 'This order is % and cannot be cancelled.', v_o.status using errcode = '22023';
  end if;
  if v_o.payment_status not in ('unpaid', 'failed') then
    raise exception 'This order has a payment in progress or completed and cannot be cancelled here.' using errcode = '22023';
  end if;
  if v_o.status = 'accepted' then
    v_release := true;
    -- Stock comes back. A sold-out listing returns as paused; the seller publishes it again.
    update public.marketplace_listings l
       set available_kg = l.available_kg + v_o.quantity_kg,
           status = case when l.status = 'sold_out' then 'paused' else l.status end
     where l.id = v_o.listing_id;
  end if;
  update public.coffee_orders o set status = 'cancelled', cancelled_at = now(),
         stock_released_at = case when v_release then now() else null end,
         decision_note = coalesce(nullif(left(btrim(coalesce(p_note, '')), 500), ''), o.decision_note)
   where o.id = p_order_id returning * into v_o;
  return jsonb_build_object('already_cancelled', false, 'stock_released', v_release, 'order', to_jsonb(v_o));
end;
$$;

-- Seller: record that an accepted order was handed over. Payment status is
-- not changed and not required here; it stays visible next to the order.
create or replace function public.bunalens_fulfill_order(p_order_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_o public.coffee_orders%rowtype;
begin
  select * into v_o from public.coffee_orders o where o.id = p_order_id for update;
  if not found or (select auth.uid()) is null or not public.bunalens_owns_station(v_o.station_id) then
    raise exception 'Order not found for this station.' using errcode = '42501';
  end if;
  if v_o.status = 'fulfilled' then
    return jsonb_build_object('already_fulfilled', true, 'order', to_jsonb(v_o));
  end if;
  if v_o.status <> 'accepted' then
    raise exception 'Only an accepted order can be recorded as fulfilled.' using errcode = '22023';
  end if;
  update public.coffee_orders o set status = 'fulfilled', fulfilled_at = now(),
         fulfillment_note = nullif(left(btrim(coalesce(p_note, '')), 500), '')
   where o.id = p_order_id returning * into v_o;
  return jsonb_build_object('already_fulfilled', false, 'order', to_jsonb(v_o));
end;
$$;

revoke all on function public.bunalens_save_listing(text, numeric, numeric, text) from public, anon;
revoke all on function public.bunalens_submit_order(uuid, numeric, text, text, text) from public, anon;
revoke all on function public.bunalens_decide_order(uuid, text, text) from public, anon;
revoke all on function public.bunalens_cancel_order(uuid, text) from public, anon;
revoke all on function public.bunalens_fulfill_order(uuid, text) from public, anon;
grant execute on function public.bunalens_save_listing(text, numeric, numeric, text) to authenticated;
grant execute on function public.bunalens_submit_order(uuid, numeric, text, text, text) to authenticated;
grant execute on function public.bunalens_decide_order(uuid, text, text) to authenticated;
grant execute on function public.bunalens_cancel_order(uuid, text) to authenticated;
grant execute on function public.bunalens_fulfill_order(uuid, text) to authenticated;

commit;
