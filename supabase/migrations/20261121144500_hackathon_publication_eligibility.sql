-- Hackathon sprint addition (Phase 5): publication eligibility and review.
--
-- Outcomes: pass, fail, manual_review. They map to the existing
-- coffee_batches.eligibility_status values eligible, rejected, needs_review.
--
-- The thresholds below are a DEMO policy written for this sprint. They are
-- not Ethiopian standards, not export certification and not universal
-- quality limits. The official grade stays "Unclassified".
--
-- Kept separate: photo screening (grading_result.screening), listing
-- eligibility (this file), seller approval by an administrator
-- (stations.marketplace_seller_status), published state
-- (marketplace_listings.status) and official grade.

begin;

-- ---------------------------------------------------------------------------
-- Policy: configurable, versioned by id, one active at a time
-- ---------------------------------------------------------------------------
create table if not exists public.eligibility_policies (
  id text primary key,
  label text not null,
  is_demo boolean not null default true,
  active boolean not null default false,
  rationale text not null,
  rules jsonb not null check (jsonb_typeof(rules) = 'object'),
  created_at timestamptz not null default now()
);
create unique index if not exists eligibility_policies_one_active
  on public.eligibility_policies ((true)) where active;
alter table public.eligibility_policies enable row level security;
drop policy if exists "BunaLens signed-in read eligibility_policies" on public.eligibility_policies;
create policy "BunaLens signed-in read eligibility_policies" on public.eligibility_policies
  for select to authenticated using (true);
revoke all on public.eligibility_policies from anon, authenticated;
grant select on public.eligibility_policies to authenticated;

insert into public.eligibility_policies (id, label, is_demo, active, rationale, rules)
values (
  'demo-policy-2026-11-21',
  'DEMO listing policy (sprint thresholds, not a standard)',
  true,
  true,
  'Thresholds chosen for the hackathon demonstration so that a pass, a fail and a manual review can be shown. '
  || 'They have not been validated against any grading standard or buyer contract. '
  || 'Green beans: moisture window for dried beans in storage, a defect share from a hand-sorted weighed sample, a minimum screen from a sieve set. '
  || 'Red cherries: a defect share from a hand count; moisture and screen size are not applied because fresh cherries are not dried or screened. '
  || 'Visible damage or discolouration from a photo is an estimate, so it can only pass when low, fail when clearly high, and otherwise goes to a reviewer. '
  || 'Simulated evidence is accepted by this demo policy only; decisions that use it are flagged and the listing is marked as demo.',
  '{
    "accept_simulated_evidence": true,
    "green_bean": {
      "defect_pct": {"max": 8, "unit": "% by weight", "methods": ["hand_sort_weighed_sample"]},
      "bean_moisture_pct": {"min": 9, "max": 12, "unit": "%", "methods": ["moisture_meter"]},
      "screen_size": {"min": 14, "unit": "screen (1/64 inch)", "methods": ["screen_sieve_set"]},
      "visible_damage_pct": {"pass_max": 10, "fail_above": 25}
    },
    "red_cherry": {
      "defect_pct": {"max": 10, "unit": "% by count", "methods": ["hand_count_sample"]},
      "visible_damage_pct": {"pass_max": 10, "fail_above": 25}
    }
  }'::jsonb
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Evidence: one row per recorded reading. "Missing" is the absence of a row.
-- Visible damage is read from the saved photo screening, not stored here.
-- ---------------------------------------------------------------------------
create table if not exists public.lot_evidence (
  id uuid primary key default gen_random_uuid(),
  batch_id text not null references public.coffee_batches(id) on delete cascade,
  station_id uuid not null references public.stations(id) on delete cascade,
  kind text not null check (kind in ('defect_pct', 'bean_moisture_pct', 'screen_size')),
  value numeric not null check (value >= 0 and value <= 100),
  unit text not null check (length(unit) between 1 and 40),
  method text not null check (method ~ '^[a-z0-9_]+$' and length(method) between 3 and 60),
  source text not null check (source in ('measured', 'visually_estimated', 'reviewer_entered', 'simulated')),
  recorded_at timestamptz not null,
  recorded_by uuid references auth.users(id) on delete set null,
  verification_status text not null default 'unverified' check (verification_status in ('unverified', 'verified', 'rejected')),
  verified_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz,
  note text,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists lot_evidence_batch_kind_idx on public.lot_evidence (batch_id, kind, created_at desc);
alter table public.lot_evidence enable row level security;
drop policy if exists "BunaLens station staff read lot_evidence" on public.lot_evidence;
create policy "BunaLens station staff read lot_evidence" on public.lot_evidence
  for select to authenticated
  using (public.bunalens_owns_station(station_id) or public.bunalens_is_reviewer());
revoke all on public.lot_evidence from anon, authenticated;
grant select on public.lot_evidence to authenticated;

-- ---------------------------------------------------------------------------
-- Decision record: reuse lot_reviews, add what the audit needs
-- ---------------------------------------------------------------------------
alter table public.lot_reviews
  add column if not exists policy_id text references public.eligibility_policies(id),
  add column if not exists rule_outcome text check (rule_outcome in ('pass', 'fail', 'manual_review')),
  add column if not exists evidence_refs jsonb not null default '[]'::jsonb,
  add column if not exists evidence_fingerprint text,
  add column if not exists is_override boolean not null default false,
  add column if not exists uses_simulated_evidence boolean not null default false;

-- ---------------------------------------------------------------------------
-- Rule evaluation (internal, read only). Never reads warehouse sensor data:
-- room humidity is not bean moisture.
-- ---------------------------------------------------------------------------
create or replace function public.bunalens_compute_eligibility(p_batch_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lot public.coffee_batches%rowtype;
  v_policy public.eligibility_policies%rowtype;
  v_stage jsonb;
  v_rule jsonb;
  v_kind text;
  v_label text;
  v_stage_label text;
  v_ev public.lot_evidence%rowtype;
  v_checks jsonb := '[]'::jsonb;
  v_refs jsonb := '[]'::jsonb;
  v_fail text[] := '{}';
  v_review text[] := '{}';
  v_sim boolean := false;
  v_accept_sim boolean;
  v_status text;
  v_reason text;
  v_scr jsonb;
  v_damage numeric;
  v_source text;
  v_outcome text;
begin
  select * into v_lot from public.coffee_batches b where b.id = p_batch_id;
  if not found then
    raise exception 'Lot not found.' using errcode = '42501';
  end if;
  select * into v_policy from public.eligibility_policies p where p.active limit 1;
  if not found then
    raise exception 'No active eligibility policy is configured.' using errcode = '55000';
  end if;
  v_stage := v_policy.rules -> v_lot.sample_type;
  v_stage_label := case v_lot.sample_type when 'red_cherry' then 'red cherries' else 'green beans' end;
  v_accept_sim := coalesce((v_policy.rules ->> 'accept_simulated_evidence')::boolean, false);
  if v_stage is null then
    raise exception 'The active policy has no rules for this coffee stage.' using errcode = '55000';
  end if;

  foreach v_kind in array array['defect_pct', 'bean_moisture_pct', 'screen_size'] loop
    v_rule := v_stage -> v_kind;
    v_label := case v_kind when 'defect_pct' then 'Defect percentage' when 'bean_moisture_pct' then 'Bean moisture' else 'Bean size' end;
    if v_rule is null then
      v_checks := v_checks || jsonb_build_object('input', v_kind, 'label', v_label, 'status', 'not_applicable',
        'reason', v_label || ' is not applied to ' || v_stage_label || '.');
      continue;
    end if;
    select * into v_ev from public.lot_evidence e
     where e.batch_id = v_lot.id and e.kind = v_kind
     order by e.created_at desc, e.id desc limit 1;
    if not found then
      v_status := 'manual_review';
      v_reason := v_label || ': no reading is recorded. Accepted method: ' || (v_rule -> 'methods' ->> 0) || '.';
      v_review := v_review || v_reason;
      v_checks := v_checks || jsonb_build_object('input', v_kind, 'label', v_label, 'status', v_status, 'reason', v_reason,
        'source', 'missing', 'limit', v_rule);
      continue;
    end if;
    v_refs := v_refs || jsonb_build_object('type', 'lot_evidence', 'id', v_ev.id, 'kind', v_kind);
    if v_ev.verification_status = 'rejected' then
      v_status := 'manual_review';
      v_reason := v_label || ': the latest reading was rejected by a reviewer. Record a new reading.';
    elsif v_ev.source = 'visually_estimated' or not ((v_rule -> 'methods') ? v_ev.method) then
      v_status := 'manual_review';
      v_reason := v_label || ': method "' || v_ev.method || '" (' || replace(v_ev.source, '_', ' ') || ') is not accepted for this input. Accepted method: ' || (v_rule -> 'methods' ->> 0) || '.';
    elsif v_ev.unit <> (v_rule ->> 'unit') then
      v_status := 'manual_review';
      v_reason := v_label || ': unit "' || v_ev.unit || '" is not the unit this policy uses (' || (v_rule ->> 'unit') || ').';
    elsif v_ev.source = 'simulated' and not v_accept_sim then
      v_status := 'manual_review';
      v_reason := v_label || ': the reading is simulated and this policy does not accept simulated evidence.';
    elsif v_rule ? 'max' and v_ev.value > (v_rule ->> 'max')::numeric then
      v_status := 'fail';
      v_reason := v_label || ' ' || v_ev.value || ' ' || v_ev.unit || ' is above the policy limit of ' || (v_rule ->> 'max') || '.';
    elsif v_rule ? 'min' and v_ev.value < (v_rule ->> 'min')::numeric then
      v_status := 'fail';
      v_reason := v_label || ' ' || v_ev.value || ' ' || v_ev.unit || ' is below the policy minimum of ' || (v_rule ->> 'min') || '.';
    else
      v_status := 'pass';
      v_reason := v_label || ' ' || v_ev.value || ' ' || v_ev.unit || ' is within the policy limit.';
    end if;
    if v_status = 'fail' then v_fail := v_fail || v_reason; end if;
    if v_status = 'manual_review' then v_review := v_review || v_reason; end if;
    if v_ev.source = 'simulated' then v_sim := true; end if;
    v_checks := v_checks || jsonb_build_object('input', v_kind, 'label', v_label, 'status', v_status, 'reason', v_reason,
      'value', v_ev.value, 'unit', v_ev.unit, 'method', v_ev.method, 'source', v_ev.source,
      'recorded_at', v_ev.recorded_at, 'verification_status', v_ev.verification_status,
      'evidence_id', v_ev.id, 'limit', v_rule);
  end loop;

  -- Visible damage or discolouration: from the saved photo screening only.
  v_rule := v_stage -> 'visible_damage_pct';
  v_label := 'Visible damage or discolouration';
  v_scr := v_lot.grading_result -> 'screening';
  if v_rule is null then
    v_checks := v_checks || jsonb_build_object('input', 'visible_damage_pct', 'label', v_label, 'status', 'not_applicable',
      'reason', v_label || ' is not applied to ' || v_stage_label || '.');
  elsif v_scr is null or jsonb_typeof(v_scr) <> 'object' or jsonb_typeof(v_lot.grading_result -> 'breakdown') <> 'object' then
    v_reason := v_label || ': no photo screening is saved on this lot.';
    v_review := v_review || v_reason;
    v_checks := v_checks || jsonb_build_object('input', 'visible_damage_pct', 'label', v_label, 'status', 'manual_review',
      'reason', v_reason, 'source', 'missing', 'limit', v_rule);
  else
    v_damage := round(coalesce((v_lot.grading_result -> 'breakdown' ->> 'black_overfermented_pct')::numeric, 0)
                    + coalesce((v_lot.grading_result -> 'breakdown' ->> 'insect_broken_pct')::numeric, 0), 1);
    v_source := case when v_scr ->> 'source' = 'live_inference' then 'visually_estimated' else 'simulated' end;
    if v_source = 'simulated' then v_sim := true; end if;
    if v_source = 'simulated' and not v_accept_sim then
      v_status := 'manual_review';
      v_reason := v_label || ': the photo screening is a demo fixture and this policy does not accept simulated evidence.';
    elsif coalesce((v_scr -> 'photo' ->> 'usable')::boolean, false) is false
          or (v_source = 'visually_estimated' and coalesce((v_scr ->> 'needs_review')::boolean, true)) then
      v_status := 'manual_review';
      v_reason := v_label || ': the photo screening is marked as needing review or a retake.';
    elsif v_damage > (v_rule ->> 'fail_above')::numeric then
      v_status := 'fail';
      v_reason := v_label || ' is estimated at ' || v_damage || '% of the visible sample, above the policy limit of ' || (v_rule ->> 'fail_above') || '%.';
    elsif v_damage > (v_rule ->> 'pass_max')::numeric then
      v_status := 'manual_review';
      v_reason := v_label || ' is estimated at ' || v_damage || '% of the visible sample, between ' || (v_rule ->> 'pass_max') || '% and ' || (v_rule ->> 'fail_above') || '%. A reviewer must inspect the lot.';
    else
      v_status := 'pass';
      v_reason := v_label || ' is estimated at ' || v_damage || '% of the visible sample, within the policy limit.';
    end if;
    if v_status = 'fail' then v_fail := v_fail || v_reason; end if;
    if v_status = 'manual_review' then v_review := v_review || v_reason; end if;
    v_refs := v_refs || jsonb_build_object('type', 'photo_screening', 'capture_key', v_scr ->> 'capture_key',
      'assessed_at', v_scr ->> 'assessed_at', 'image_path', v_lot.image_path);
    v_checks := v_checks || jsonb_build_object('input', 'visible_damage_pct', 'label', v_label, 'status', v_status, 'reason', v_reason,
      'value', v_damage, 'unit', '% of visible sample (estimate)', 'method', 'photo_screening', 'source', v_source,
      'recorded_at', v_scr ->> 'assessed_at', 'verification_status', 'unverified',
      'capture_key', v_scr ->> 'capture_key', 'limit', v_rule);
  end if;

  v_outcome := case when cardinality(v_fail) > 0 then 'fail' when cardinality(v_review) > 0 then 'manual_review' else 'pass' end;
  return jsonb_build_object(
    'batch_id', v_lot.id,
    'station_id', v_lot.station_id,
    'sample_stage', v_lot.sample_type,
    'policy', jsonb_build_object('id', v_policy.id, 'label', v_policy.label, 'is_demo', v_policy.is_demo),
    'outcome', v_outcome,
    'reasons', to_jsonb(case v_outcome when 'fail' then v_fail when 'manual_review' then v_review
                        else array['All checks of the ' || v_policy.id || ' policy passed.'] end),
    'checks', v_checks,
    'evidence_refs', v_refs,
    'uses_simulated_evidence', v_sim,
    'fingerprint', md5(v_policy.id || '|' || v_lot.sample_type || '|' || v_checks::text),
    'official_grade', 'Unclassified',
    'note', 'Listing eligibility under a demo policy. Not an official grade, not export certification. Warehouse humidity is not used as bean moisture.'
  );
end;
$$;

revoke all on function public.bunalens_compute_eligibility(text) from public, anon, authenticated;
grant execute on function public.bunalens_compute_eligibility(text) to service_role;

-- ---------------------------------------------------------------------------
-- Record evidence. Station staff record their own readings; a reviewer from
-- outside the station records a reviewer-entered reading under their identity.
-- ---------------------------------------------------------------------------
create or replace function public.bunalens_record_lot_evidence(
  p_batch_id text, p_kind text, p_value numeric, p_unit text, p_method text,
  p_source text, p_recorded_at timestamptz, p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lot public.coffee_batches%rowtype;
  v_owner boolean;
  v_reviewer boolean := public.bunalens_is_reviewer();
  v_row public.lot_evidence%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in is required.' using errcode = '42501';
  end if;
  select * into v_lot from public.coffee_batches b where b.id = p_batch_id for update;
  if not found then
    raise exception 'Lot not found.' using errcode = '42501';
  end if;
  v_owner := public.bunalens_owns_station(v_lot.station_id);
  if not v_owner and not v_reviewer then
    raise exception 'Lot not found.' using errcode = '42501';
  end if;
  if v_owner and p_source not in ('measured', 'visually_estimated', 'simulated') then
    raise exception 'Station staff can record measured, visually estimated or simulated readings.' using errcode = '22023';
  end if;
  if not v_owner and p_source <> 'reviewer_entered' then
    raise exception 'A reviewer records readings with source reviewer_entered.' using errcode = '22023';
  end if;
  if p_recorded_at is null or p_recorded_at > now() + interval '5 minutes' then
    raise exception 'The reading time is missing or in the future.' using errcode = '22023';
  end if;
  insert into public.lot_evidence (batch_id, station_id, kind, value, unit, method, source, recorded_at, recorded_by,
                                   verification_status, verified_by, verified_at, note)
  values (v_lot.id, v_lot.station_id, p_kind, p_value, btrim(p_unit), p_method, p_source, p_recorded_at, (select auth.uid()),
          case when v_owner then 'unverified' else 'verified' end,
          case when v_owner then null else (select auth.uid()) end,
          case when v_owner then null else now() end,
          nullif(left(btrim(coalesce(p_note, '')), 500), ''))
  returning * into v_row;
  -- New evidence invalidates the previous eligibility decision.
  update public.coffee_batches b set eligibility_status = 'unreviewed', eligibility_updated_at = now()
   where b.id = v_lot.id and b.eligibility_status <> 'unreviewed';
  return to_jsonb(v_row);
end;
$$;

create or replace function public.bunalens_verify_lot_evidence(p_evidence_id uuid, p_status text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.lot_evidence%rowtype;
begin
  if not public.bunalens_is_reviewer() then
    raise exception 'Only a reviewer can verify evidence.' using errcode = '42501';
  end if;
  if p_status not in ('verified', 'rejected') then
    raise exception 'Status must be verified or rejected.' using errcode = '22023';
  end if;
  select * into v_row from public.lot_evidence e where e.id = p_evidence_id for update;
  if not found then
    raise exception 'Evidence not found.' using errcode = '42501';
  end if;
  if public.bunalens_owns_station(v_row.station_id) then
    raise exception 'A reviewer cannot verify evidence of their own station.' using errcode = '42501';
  end if;
  update public.lot_evidence e set verification_status = p_status, verified_by = (select auth.uid()), verified_at = now(),
         note = coalesce(nullif(left(btrim(coalesce(p_note, '')), 500), ''), e.note)
   where e.id = p_evidence_id returning * into v_row;
  update public.coffee_batches b set eligibility_status = 'unreviewed', eligibility_updated_at = now()
   where b.id = v_row.batch_id and b.eligibility_status <> 'unreviewed';
  return to_jsonb(v_row);
end;
$$;

-- ---------------------------------------------------------------------------
-- Apply the rules to a lot (station staff or reviewer)
-- ---------------------------------------------------------------------------
create or replace function public.bunalens_evaluate_lot_eligibility(p_batch_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lot public.coffee_batches%rowtype;
  v_eval jsonb;
  v_last public.lot_reviews%rowtype;
  v_decision text;
  v_kept boolean := false;
begin
  select * into v_lot from public.coffee_batches b where b.id = p_batch_id for update;
  if not found or (select auth.uid()) is null
     or not (public.bunalens_owns_station(v_lot.station_id) or public.bunalens_is_reviewer()) then
    raise exception 'Lot not found.' using errcode = '42501';
  end if;
  v_eval := public.bunalens_compute_eligibility(p_batch_id);
  v_decision := case v_eval ->> 'outcome' when 'pass' then 'eligible' when 'fail' then 'rejected' else 'needs_review' end;
  select * into v_last from public.lot_reviews r where r.batch_id = p_batch_id order by r.created_at desc, r.id desc limit 1;
  if found and v_last.evidence_fingerprint = v_eval ->> 'fingerprint' then
    -- Same evidence and policy as the last decision: keep it (including a reviewer decision).
    v_kept := true;
    v_decision := v_last.decision;
  else
    insert into public.lot_reviews (batch_id, decision, decided_by, reason, criteria_snapshot, policy_id, rule_outcome,
                                    evidence_refs, evidence_fingerprint, uses_simulated_evidence, created_at)
    values (p_batch_id, v_decision, 'rule',
            (select string_agg(x, ' ') from jsonb_array_elements_text(v_eval -> 'reasons') as t(x)),
            v_eval, v_eval -> 'policy' ->> 'id', v_eval ->> 'outcome', v_eval -> 'evidence_refs',
            v_eval ->> 'fingerprint', (v_eval ->> 'uses_simulated_evidence')::boolean, clock_timestamp())
    returning * into v_last;
  end if;
  update public.coffee_batches b set eligibility_status = v_decision, eligibility_updated_at = now()
   where b.id = p_batch_id and b.eligibility_status is distinct from v_decision;
  return jsonb_build_object('eligibility_status', v_decision, 'decided_by', v_last.decided_by, 'review_id', v_last.id,
                            'kept_previous_decision', v_kept, 'evaluation', v_eval);
end;
$$;

-- ---------------------------------------------------------------------------
-- Reviewer decision. Resolving a manual review needs the reviewer role.
-- Passing a lot that fails a rule is an override: administrator only,
-- explicitly requested, recorded as an override.
-- ---------------------------------------------------------------------------
create or replace function public.bunalens_review_lot(
  p_batch_id text, p_decision text, p_reason text, p_override boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lot public.coffee_batches%rowtype;
  v_eval jsonb;
  v_override boolean := false;
  v_row public.lot_reviews%rowtype;
begin
  if (select auth.uid()) is null or not public.bunalens_is_reviewer() then
    raise exception 'Only a reviewer can decide on a lot.' using errcode = '42501';
  end if;
  if p_decision not in ('eligible', 'rejected') then
    raise exception 'Decision must be eligible or rejected.' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Give a reason of at least 10 characters.' using errcode = '22023';
  end if;
  select * into v_lot from public.coffee_batches b where b.id = p_batch_id for update;
  if not found then
    raise exception 'Lot not found.' using errcode = '42501';
  end if;
  if public.bunalens_owns_station(v_lot.station_id) then
    raise exception 'A reviewer cannot decide on a lot of their own station.' using errcode = '42501';
  end if;
  v_eval := public.bunalens_compute_eligibility(p_batch_id);
  if v_eval ->> 'outcome' = 'fail' and p_decision = 'eligible' then
    if public.bunalens_jwt_role() <> 'admin' or not coalesce(p_override, false) then
      raise exception 'This lot fails a rule. Only an administrator can override a failed rule, and the override must be requested explicitly.' using errcode = '42501';
    end if;
    v_override := true;
  end if;
  insert into public.lot_reviews (batch_id, decision, decided_by, reviewer_id, reason, criteria_snapshot, policy_id, rule_outcome,
                                  evidence_refs, evidence_fingerprint, is_override, uses_simulated_evidence, created_at)
  values (p_batch_id, p_decision, 'reviewer', (select auth.uid()), left(btrim(p_reason), 1000), v_eval,
          v_eval -> 'policy' ->> 'id', v_eval ->> 'outcome', v_eval -> 'evidence_refs', v_eval ->> 'fingerprint',
          v_override, (v_eval ->> 'uses_simulated_evidence')::boolean, clock_timestamp())
  returning * into v_row;
  update public.coffee_batches b set eligibility_status = p_decision, eligibility_updated_at = now()
   where b.id = p_batch_id and b.eligibility_status is distinct from p_decision;
  return jsonb_build_object('eligibility_status', p_decision, 'review_id', v_row.id, 'reviewer_id', v_row.reviewer_id,
                            'decided_at', v_row.created_at, 'is_override', v_row.is_override,
                            'rule_outcome', v_row.rule_outcome, 'policy_id', v_row.policy_id);
end;
$$;

-- Read model for the lot screen: current rule result, last decision, and
-- whether that decision still matches the evidence.
create or replace function public.bunalens_lot_eligibility(p_batch_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lot public.coffee_batches%rowtype;
  v_eval jsonb;
  v_last public.lot_reviews%rowtype;
begin
  select * into v_lot from public.coffee_batches b where b.id = p_batch_id;
  if not found or (select auth.uid()) is null
     or not (public.bunalens_owns_station(v_lot.station_id) or public.bunalens_is_reviewer()) then
    raise exception 'Lot not found.' using errcode = '42501';
  end if;
  v_eval := public.bunalens_compute_eligibility(p_batch_id);
  select * into v_last from public.lot_reviews r where r.batch_id = p_batch_id order by r.created_at desc, r.id desc limit 1;
  return jsonb_build_object(
    'eligibility_status', v_lot.eligibility_status,
    'current_rule_result', v_eval,
    'last_decision', case when v_last.id is null then null else jsonb_build_object(
      'id', v_last.id, 'decision', v_last.decision, 'decided_by', v_last.decided_by, 'reviewer_id', v_last.reviewer_id,
      'reason', v_last.reason, 'policy_id', v_last.policy_id, 'rule_outcome', v_last.rule_outcome,
      'is_override', v_last.is_override, 'uses_simulated_evidence', v_last.uses_simulated_evidence,
      'decided_at', v_last.created_at,
      'matches_current_evidence', v_last.evidence_fingerprint is not distinct from v_eval ->> 'fingerprint') end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Administrative approval of a seller (separate from lot eligibility)
-- ---------------------------------------------------------------------------
create or replace function public.bunalens_set_seller_status(p_station_id uuid, p_status text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or public.bunalens_jwt_role() <> 'admin' then
    raise exception 'Only an administrator can approve or suspend a seller.' using errcode = '42501';
  end if;
  if p_status not in ('pending', 'approved', 'suspended') or length(btrim(coalesce(p_note, ''))) < 5 then
    raise exception 'Give a valid status and a note.' using errcode = '22023';
  end if;
  update public.stations s set marketplace_seller_status = p_status, marketplace_seller_reviewed_by = (select auth.uid()),
         marketplace_seller_reviewed_at = now(), marketplace_seller_note = left(btrim(p_note), 500)
   where s.id = p_station_id;
  if not found then
    raise exception 'Station not found.' using errcode = '42501';
  end if;
  return jsonb_build_object('station_id', p_station_id, 'marketplace_seller_status', p_status);
end;
$$;

-- ---------------------------------------------------------------------------
-- Publication: re-check the rules at the moment a listing becomes published.
-- Runs after marketplace_listings_enforce_rules (alphabetical trigger order).
-- ---------------------------------------------------------------------------
create or replace function public.bunalens_recheck_eligibility_on_publish()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_eval jsonb;
  v_last public.lot_reviews%rowtype;
begin
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    v_eval := public.bunalens_compute_eligibility(new.batch_id);
    select * into v_last from public.lot_reviews r where r.batch_id = new.batch_id order by r.created_at desc, r.id desc limit 1;
    if not found or v_last.decision <> 'eligible' then
      raise exception 'This lot has no eligible decision on record.' using errcode = '42501';
    end if;
    if v_last.evidence_fingerprint is distinct from v_eval ->> 'fingerprint' then
      raise exception 'Evidence or policy changed since the eligibility decision. Evaluate the lot again before publishing.' using errcode = '42501';
    end if;
    if v_last.decided_by = 'rule' and v_eval ->> 'outcome' <> 'pass' then
      raise exception 'This lot no longer passes the listing rules.' using errcode = '42501';
    end if;
    -- A listing that rests on simulated evidence is always shown as demo data.
    if (v_eval ->> 'uses_simulated_evidence')::boolean then
      new.is_demo := true;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.bunalens_recheck_eligibility_on_publish() from public, anon, authenticated;
drop trigger if exists marketplace_listings_recheck_eligibility on public.marketplace_listings;
create trigger marketplace_listings_recheck_eligibility
before insert or update on public.marketplace_listings
for each row execute function public.bunalens_recheck_eligibility_on_publish();

revoke all on function public.bunalens_record_lot_evidence(text, text, numeric, text, text, text, timestamptz, text) from public, anon;
revoke all on function public.bunalens_verify_lot_evidence(uuid, text, text) from public, anon;
revoke all on function public.bunalens_evaluate_lot_eligibility(text) from public, anon;
revoke all on function public.bunalens_review_lot(text, text, text, boolean) from public, anon;
revoke all on function public.bunalens_lot_eligibility(text) from public, anon;
revoke all on function public.bunalens_set_seller_status(uuid, text, text) from public, anon;
grant execute on function public.bunalens_record_lot_evidence(text, text, numeric, text, text, text, timestamptz, text) to authenticated;
grant execute on function public.bunalens_verify_lot_evidence(uuid, text, text) to authenticated;
grant execute on function public.bunalens_evaluate_lot_eligibility(text) to authenticated;
grant execute on function public.bunalens_review_lot(text, text, text, boolean) to authenticated;
grant execute on function public.bunalens_lot_eligibility(text) to authenticated;
grant execute on function public.bunalens_set_seller_status(uuid, text, text) to authenticated;

commit;
