-- Hackathon sprint addition (Phase 4): attach a DEMO-FIXTURE photo assessment
-- to an existing registered lot.
--
-- Live assessments are written only by the coffee-sync Edge Function after the
-- server-side model call. This function exists so the lot journey can be shown
-- when no model credential is configured. It cannot produce a record that
-- looks like live inference: the server forces the source, provider, model,
-- grade and review flag, and marks the lot as demo data.

begin;

create or replace function public.bunalens_attach_demo_assessment(
  p_batch_id text,
  p_capture_key text,
  p_assessment jsonb,
  p_image_path text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_station uuid := public.bunalens_my_station_id();
  v_lot public.coffee_batches%rowtype;
  v_screening jsonb;
  v_result jsonb;
  v_saved boolean := false;
begin
  if (select auth.uid()) is null or v_station is null then
    raise exception 'Sign in with a registered station account.' using errcode = '42501';
  end if;
  if p_capture_key is null or p_capture_key !~ '^[A-Za-z0-9_-]{8,128}$' then
    raise exception 'Invalid capture key.' using errcode = '22023';
  end if;

  select * into v_lot from public.coffee_batches b
   where b.id = p_batch_id and b.station_id = v_station
   for update;
  if not found then
    raise exception 'Lot not found for this station.' using errcode = '42501';
  end if;

  -- A retry of the same capture returns the saved record unchanged.
  if v_lot.grading_result -> 'screening' ->> 'capture_key' = p_capture_key then
    v_saved := true;
  else
    if v_lot.grading_result -> 'screening' ->> 'source' = 'live_inference' then
      raise exception 'This lot already has a live photo assessment. A demo fixture cannot replace it.' using errcode = '22023';
    end if;
    if p_assessment is null or jsonb_typeof(p_assessment) <> 'object'
       or jsonb_typeof(p_assessment -> 'breakdown') is distinct from 'object'
       or jsonb_typeof(p_assessment -> 'screening') is distinct from 'object'
       or jsonb_typeof(p_assessment -> 'quality_score') is distinct from 'number'
       or jsonb_typeof(p_assessment -> 'confidence_score') is distinct from 'number'
       or length(p_assessment::text) > 20000 then
      raise exception 'Invalid demo assessment.' using errcode = '22023';
    end if;
    -- Red-cherry and green-bean assessments stay separate.
    if p_assessment -> 'screening' ->> 'sample_stage' is distinct from v_lot.sample_type then
      raise exception 'The assessment stage does not match the stage this lot was registered with.' using errcode = '22023';
    end if;
    if p_image_path is not null then
      if length(p_image_path) not between 10 and 300 or p_image_path !~ '^[A-Za-z0-9_./-]+$' or position('..' in p_image_path) > 0
         or split_part(p_image_path, '/', 1) <> v_station::text
         or not exists (select 1 from storage.objects o where o.bucket_id = 'coffee-samples' and o.name = p_image_path) then
        raise exception 'The photo reference is not a stored photo of this station.' using errcode = '22023';
      end if;
    end if;

    v_screening := (p_assessment -> 'screening') || jsonb_build_object(
      'source', 'demo_fixture',
      'provider', 'bunalens-demo-fixture',
      'model', 'none (preset values; the photo was not analysed)',
      'assessed_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'sample_stage', v_lot.sample_type,
      'official_grade', 'Unclassified',
      'needs_review', true,
      'capture_key', p_capture_key
    );
    v_result := p_assessment || jsonb_build_object(
      'ecx_grade', 'Unclassified',
      'estimated_price_per_feresula_etb', 0,
      'potential_gain_if_sorted_etb', 0,
      'screening', v_screening
    );

    update public.coffee_batches b set
      grading_result = v_result,
      grading_status = 'demo',
      is_demo = true,
      ecx_grade = 'Unclassified',
      quality_score = least(100, greatest(0, (p_assessment ->> 'quality_score')::numeric)),
      confidence_score = least(100, greatest(0, (p_assessment ->> 'confidence_score')::numeric)),
      image_path = coalesce(p_image_path, b.image_path),
      -- A new assessment invalidates any earlier eligibility decision.
      eligibility_status = 'unreviewed',
      eligibility_updated_at = now()
    where b.id = v_lot.id
    returning * into v_lot;
  end if;

  return jsonb_build_object(
    'already_saved', v_saved,
    'lot', jsonb_build_object(
      'id', v_lot.id, 'batch_code', v_lot.batch_code, 'station_id', v_lot.station_id,
      'sample_type', v_lot.sample_type, 'grading_status', v_lot.grading_status,
      'is_demo', v_lot.is_demo, 'image_path', v_lot.image_path,
      'eligibility_status', v_lot.eligibility_status,
      'screening', v_lot.grading_result -> 'screening'
    )
  );
end;
$$;

revoke all on function public.bunalens_attach_demo_assessment(text, text, jsonb, text) from public, anon;
grant execute on function public.bunalens_attach_demo_assessment(text, text, jsonb, text) to authenticated;

commit;
