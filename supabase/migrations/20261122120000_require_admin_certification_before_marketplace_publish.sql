-- Seller-side listing actions may publish only an administrator-certified, eligible lot.
create or replace function public.bunalens_save_listing(
  p_batch_id text,
  p_available_kg numeric,
  p_price_per_kg_etb numeric,
  p_status text default 'draft'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $listing$
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
  v_seller_status text;
begin
  if (select auth.uid()) is null or v_station is null then
    raise exception 'Sign in with a registered station account.' using errcode = '42501';
  end if;
  if p_status not in ('draft', 'published', 'paused', 'withdrawn') then
    raise exception 'Status must be draft, published, paused or withdrawn.' using errcode = '22023';
  end if;
  select * into v_lot from public.coffee_batches b where b.id = p_batch_id and b.station_id = v_station for update;
  if not found then raise exception 'Lot not found for this station.' using errcode = '42501'; end if;

  if p_status = 'published' then
    if v_lot.certification_status <> 'certified'
       or v_lot.certified_grade is null
       or v_lot.quality_classification is null then
      raise exception 'This lot must be certified by a BunaLens administrator before it can be published.' using errcode = '42501';
    end if;
    if v_lot.eligibility_status <> 'eligible' then
      raise exception 'This lot must pass administrator review before it can be published.' using errcode = '42501';
    end if;
    select s.marketplace_seller_status into v_seller_status from public.stations s where s.id = v_station;
    if v_seller_status <> 'approved' then
      raise exception 'Your station must be approved as a marketplace seller before publishing.' using errcode = '42501';
    end if;
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
  if p_status = 'published' then
    v_summary := left(v_summary || ' BunaLens administrator-certified: ' || v_lot.certified_grade ||
      ' · ' || v_lot.quality_classification || ' · ' || coalesce(v_lot.certification_origin_zone,'Jimma') ||
      ' Zone, ' || v_lot.woreda || ' Woreda.', 900);
  end if;

  v_evidence := jsonb_build_object(
    'policy_id', v_eval -> 'policy' ->> 'id',
    'policy_is_demo', (v_eval -> 'policy' ->> 'is_demo')::boolean,
    'eligibility_status', v_lot.eligibility_status,
    'decided_by', v_last.decided_by,
    'decided_at', v_last.created_at,
    'is_override', coalesce(v_last.is_override, false),
    'uses_simulated_evidence', (v_eval ->> 'uses_simulated_evidence')::boolean,
    'official_grade', coalesce(v_lot.certified_grade,'Unclassified'),
    'certification_status', v_lot.certification_status,
    'quality_classification', v_lot.quality_classification,
    'certification_origin_zone', v_lot.certification_origin_zone,
    'certified_at', v_lot.certified_at,
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
$listing$;

revoke all on function public.bunalens_save_listing(text,numeric,numeric,text) from public,anon;
grant execute on function public.bunalens_save_listing(text,numeric,numeric,text) to authenticated;
