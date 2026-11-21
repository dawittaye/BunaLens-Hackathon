-- Admin-controlled scan review and one-step public listing publication.
-- Existing scans remain in coffee_batches; no records are deleted or rewritten.

begin;

create or replace function public.bunalens_admin_review_and_publish_lot(
  p_batch_id text,
  p_decision text,
  p_reason text,
  p_price_per_kg_etb numeric default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lot public.coffee_batches%rowtype;
  v_station public.stations%rowtype;
  v_review jsonb;
  v_listing public.marketplace_listings%rowtype;
  v_screening jsonb;
  v_summary text;
  v_evidence jsonb;
begin
  if (select auth.uid()) is null or public.bunalens_jwt_role() <> 'admin' then
    raise exception 'Only an administrator can review and publish coffee scans.' using errcode = '42501';
  end if;

  if p_decision not in ('eligible', 'rejected') then
    raise exception 'Decision must be eligible or rejected.' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Enter a review reason of at least 10 characters.' using errcode = '22023';
  end if;

  select * into v_lot from public.coffee_batches b where b.id = p_batch_id for update;
  if not found then
    raise exception 'Coffee scan not found.' using errcode = 'P0002';
  end if;
  if v_lot.is_demo then
    raise exception 'Demonstration scans cannot be approved or published as real coffee.' using errcode = '22023';
  end if;

  if p_decision = 'rejected' then
    v_review := public.bunalens_review_lot(p_batch_id, 'rejected', p_reason, false);
    return jsonb_build_object('decision', 'rejected', 'review', v_review, 'listing', null);
  end if;

  if p_price_per_kg_etb is null or p_price_per_kg_etb <= 0
     or p_price_per_kg_etb > 100000 or p_price_per_kg_etb <> round(p_price_per_kg_etb, 2) then
    raise exception 'Set a valid public price per kg in ETB before publishing.' using errcode = '22023';
  end if;

  select * into v_station from public.stations s where s.id = v_lot.station_id for update;
  if not found then
    raise exception 'The scan has no registered station.' using errcode = '23503';
  end if;
  if v_station.marketplace_seller_status <> 'approved' then
    raise exception 'Approve this station as a marketplace seller before publishing its scans.' using errcode = '42501';
  end if;

  v_review := public.bunalens_review_lot(p_batch_id, 'eligible', p_reason, false);
  v_screening := v_lot.grading_result -> 'screening';
  v_summary := case
    when v_screening is null or jsonb_typeof(v_screening) <> 'object'
      then 'Administrator-reviewed coffee scan. No structured photo-screening summary is available.'
    when v_screening ->> 'source' = 'live_inference'
      then 'AI-assisted visual screening; manually reviewed and approved by BunaLens administrator.'
    else 'Simulated screening evidence; this lot must not be represented as real verified coffee.'
  end;
  if v_screening is not null and v_screening ->> 'source' <> 'live_inference' then
    raise exception 'Only live, non-simulated scan evidence can be published.' using errcode = '22023';
  end if;

  v_evidence := jsonb_build_object(
    'approval_type', 'administrator_scan_review',
    'approval_reason', left(btrim(p_reason), 1000),
    'approved_at', now(),
    'official_grade', 'Unclassified',
    'screening_source', coalesce(v_screening ->> 'source', 'not_available'),
    'uses_simulated_evidence', false
  );

  insert into public.marketplace_listings as l (
    batch_id, station_id, seller_display_name, origin_woreda, coffee_stage,
    available_kg, price_per_kg_etb, screening_summary, assessed_at,
    is_demo, status, batch_code, evidence_summary
  )
  values (
    v_lot.id, v_lot.station_id,
    coalesce(nullif(btrim(v_station.station_name), ''), nullif(btrim(v_station.name), ''), 'Jimma Coffee Station'),
    v_lot.woreda, v_lot.sample_type, v_lot.lot_weight_kg, p_price_per_kg_etb,
    v_summary, nullif(v_screening ->> 'assessed_at', '')::timestamptz,
    false, 'published', v_lot.batch_code, v_evidence
  )
  on conflict (batch_id) do update set
    seller_display_name = excluded.seller_display_name,
    origin_woreda = excluded.origin_woreda,
    coffee_stage = excluded.coffee_stage,
    available_kg = excluded.available_kg,
    price_per_kg_etb = excluded.price_per_kg_etb,
    screening_summary = excluded.screening_summary,
    assessed_at = excluded.assessed_at,
    is_demo = false,
    status = 'published',
    batch_code = excluded.batch_code,
    evidence_summary = excluded.evidence_summary
  returning * into v_listing;

  return jsonb_build_object('decision', 'eligible', 'review', v_review, 'listing', to_jsonb(v_listing));
end;
$$;

revoke all on function public.bunalens_admin_review_and_publish_lot(text, text, text, numeric) from public, anon;
grant execute on function public.bunalens_admin_review_and_publish_lot(text, text, text, numeric) to authenticated;

commit;
