-- Admin-controlled BunaLens certification, user notifications and public verification.
-- Existing scan records and storage objects are preserved. Historical records remain uncertified.

begin;

alter table public.coffee_batches
  add column if not exists certification_status text not null default 'pending_admin_review',
  add column if not exists certified_grade text,
  add column if not exists quality_classification text,
  add column if not exists certification_origin_zone text,
  add column if not exists certified_by uuid references auth.users(id),
  add column if not exists certified_at timestamptz,
  add column if not exists certification_note text;

alter table public.coffee_batches
  drop constraint if exists coffee_batches_certification_status_check,
  add constraint coffee_batches_certification_status_check
    check (certification_status in ('pending_admin_review','certified','rejected')),
  drop constraint if exists coffee_batches_certified_grade_check,
  add constraint coffee_batches_certified_grade_check
    check (certified_grade is null or certified_grade in ('Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6','Grade 7')),
  drop constraint if exists coffee_batches_quality_classification_check,
  add constraint coffee_batches_quality_classification_check
    check (quality_classification is null or quality_classification in ('Specialty Export','Commercial Export','Local Market Only','Reject / Re-sort'));

create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  batch_id text references public.coffee_batches(id) on delete cascade,
  notification_type text not null check (notification_type in ('certified','rejected','review_update')),
  title text not null,
  message text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

-- Certification fields are immutable to station users; only trusted admin RPCs may change them.
create or replace function public.bunalens_guard_certificate_fields()
returns trigger
language plpgsql
set search_path = ''
as $guard$
begin
  if tg_op = 'INSERT' then
    if coalesce(new.certification_status,'pending_admin_review') <> 'pending_admin_review'
       or new.certified_grade is not null or new.quality_classification is not null
       or new.certified_by is not null or new.certified_at is not null then
      if (select auth.uid()) is null or public.bunalens_jwt_role() <> 'admin' then
        raise exception 'Only an administrator can create a certified coffee record.' using errcode = '42501';
      end if;
    end if;
  elsif new.certification_status is distinct from old.certification_status
     or new.certified_grade is distinct from old.certified_grade
     or new.quality_classification is distinct from old.quality_classification
     or new.certification_origin_zone is distinct from old.certification_origin_zone
     or new.certified_by is distinct from old.certified_by
     or new.certified_at is distinct from old.certified_at
     or new.certification_note is distinct from old.certification_note then
    if (select auth.uid()) is null or public.bunalens_jwt_role() <> 'admin' then
      raise exception 'Only an administrator can change coffee certification fields.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$guard$;

drop trigger if exists coffee_batches_guard_certificate_fields on public.coffee_batches;
create trigger coffee_batches_guard_certificate_fields
before insert or update on public.coffee_batches
for each row execute function public.bunalens_guard_certificate_fields();

create index if not exists user_notifications_user_created_idx
  on public.user_notifications(user_id, created_at desc);
create index if not exists coffee_batches_certification_status_idx
  on public.coffee_batches(certification_status, created_at desc);

alter table public.user_notifications enable row level security;
revoke all on public.user_notifications from anon, public, authenticated;
grant select on public.user_notifications to authenticated;
grant update (read_at) on public.user_notifications to authenticated;
drop policy if exists "Users read their own notifications" on public.user_notifications;
create policy "Users read their own notifications"
  on public.user_notifications for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists "Users mark their own notifications read" on public.user_notifications;
create policy "Users mark their own notifications read"
  on public.user_notifications for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create or replace function public.bunalens_admin_certify_and_publish_lot(
  p_batch_id text,
  p_decision text,
  p_reason text,
  p_price_per_kg_etb numeric default null,
  p_certified_grade text default null,
  p_quality_classification text default null
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
  v_notification_type text;
  v_notification_title text;
  v_notification_message text;
  v_was_certified boolean;
begin
  if (select auth.uid()) is null or public.bunalens_jwt_role() <> 'admin' then
    raise exception 'Only an administrator can review and certify coffee scans.' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('eligible', 'rejected') then
    raise exception 'Decision must be eligible or rejected.' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Enter an administrator review note of at least 10 characters.' using errcode = '22023';
  end if;

  select * into v_lot from public.coffee_batches b where b.id = p_batch_id for update;
  if not found then raise exception 'Coffee scan not found.' using errcode = 'P0002'; end if;
  if v_lot.is_demo then raise exception 'Demonstration scans cannot be certified.' using errcode = '22023'; end if;
  v_was_certified := v_lot.certification_status = 'certified';
  select * into v_station from public.stations s where s.id = v_lot.station_id for update;
  if not found then raise exception 'The scan has no registered station.' using errcode = '23503'; end if;

  if p_decision = 'rejected' then
    v_review := public.bunalens_review_lot(p_batch_id, 'rejected', p_reason, false);
    update public.coffee_batches
      set certification_status = 'rejected',
          certified_grade = null,
          quality_classification = 'Reject / Re-sort',
          certified_by = (select auth.uid()),
          certified_at = now(),
          certification_note = left(btrim(p_reason), 1000)
      where id = p_batch_id;
    insert into public.user_notifications(user_id,batch_id,notification_type,title,message,metadata)
    values (v_station.owner_id,p_batch_id,'rejected','Coffee sample review update',
      'Your sample ' || v_lot.batch_code || ' was not certified. Review the administrator note and submit a new sample if needed.',
      jsonb_build_object('batch_code',v_lot.batch_code,'reason',left(btrim(p_reason),1000)));
    return jsonb_build_object('decision','rejected','review',v_review,'listing',null,'certification_status','rejected');
  end if;

  if p_certified_grade is null or p_certified_grade not in ('Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6','Grade 7') then
    raise exception 'Administrator must assign a valid coffee grade from Grade 1 to Grade 7.' using errcode = '22023';
  end if;
  if p_quality_classification is null or p_quality_classification not in ('Specialty Export','Commercial Export','Local Market Only','Reject / Re-sort') then
    raise exception 'Administrator must assign a valid quality classification.' using errcode = '22023';
  end if;
  if p_quality_classification = 'Reject / Re-sort' then
    raise exception 'A Reject / Re-sort classification cannot be certified or published. Use the rejection action.' using errcode = '22023';
  end if;
  if p_price_per_kg_etb is not null and (p_price_per_kg_etb <= 0
     or p_price_per_kg_etb > 100000 or p_price_per_kg_etb <> round(p_price_per_kg_etb, 2)) then
    raise exception 'Enter a valid public price per kg in ETB, or leave it blank to certify without publishing.' using errcode = '22023';
  end if;

  v_screening := v_lot.grading_result -> 'screening';
  if v_screening is null or v_screening ->> 'source' <> 'live_inference' then
    raise exception 'Only real scans with live AI screening can be certified.' using errcode = '22023';
  end if;
  if coalesce((v_screening -> 'photo' ->> 'usable')::boolean,false) is not true
     or coalesce((v_screening ->> 'needs_review')::boolean,true) is true then
    raise exception 'The sample photograph must pass the photo-quality check before certification.' using errcode = '22023';
  end if;

  v_review := public.bunalens_review_lot(p_batch_id, 'eligible', p_reason, false);
  update public.coffee_batches
    set certification_status = 'certified',
        certified_grade = p_certified_grade,
        ecx_grade = p_certified_grade,
        quality_classification = p_quality_classification,
        certification_origin_zone = coalesce(nullif(btrim(v_station.zone), ''),'Jimma'),
        certified_by = (select auth.uid()),
        certified_at = now(),
        certification_note = left(btrim(p_reason),1000),
        grading_result = jsonb_set(
          jsonb_set(coalesce(grading_result,'{}'::jsonb),'{administrator_certification}',
            jsonb_build_object('grade',p_certified_grade,'quality_classification',p_quality_classification,
              'origin_zone',coalesce(nullif(btrim(v_station.zone),''),'Jimma'),
              'certified_at',now(),'certified_by',(select auth.uid())),true),
          '{ecx_grade}',to_jsonb(p_certified_grade),true)
    where id = p_batch_id;

  v_summary := 'BunaLens administrator-certified coffee. Grade: ' || p_certified_grade ||
    '. Quality classification: ' || p_quality_classification || '. AI visual screening was reviewed by an administrator.';
  v_evidence := jsonb_build_object(
    'approval_type','administrator_certification',
    'approval_reason',left(btrim(p_reason),1000),
    'approved_at',now(),
    'certified_grade',p_certified_grade,
    'quality_classification',p_quality_classification,
    'origin_zone',coalesce(nullif(btrim(v_station.zone),''),'Jimma'),
    'screening_source','live_inference',
    'uses_simulated_evidence',false
  );

  if v_station.marketplace_seller_status = 'approved' and p_price_per_kg_etb is not null then
    insert into public.marketplace_listings as l (
      batch_id,station_id,seller_display_name,origin_woreda,coffee_stage,
      available_kg,price_per_kg_etb,screening_summary,assessed_at,
      is_demo,status,batch_code,evidence_summary
    ) values (
      v_lot.id,v_lot.station_id,
      coalesce(nullif(btrim(v_station.station_name),''),nullif(btrim(v_station.name),''),'Jimma Coffee Station'),
      v_lot.woreda,v_lot.sample_type,v_lot.lot_weight_kg,p_price_per_kg_etb,
      v_summary,nullif(v_screening ->> 'assessed_at','')::timestamptz,
      false,'published',v_lot.batch_code,v_evidence
    )
    on conflict (batch_id) do update set
      seller_display_name=excluded.seller_display_name,
      origin_woreda=excluded.origin_woreda,
      coffee_stage=excluded.coffee_stage,
      available_kg=excluded.available_kg,
      price_per_kg_etb=excluded.price_per_kg_etb,
      screening_summary=excluded.screening_summary,
      assessed_at=excluded.assessed_at,
      is_demo=false,status='published',batch_code=excluded.batch_code,
      evidence_summary=excluded.evidence_summary
    returning * into v_listing;
  else
    v_listing := null;
  end if;

  if not v_was_certified then
    insert into public.user_notifications(user_id,batch_id,notification_type,title,message,metadata)
    values (v_station.owner_id,v_lot.id,'certified','Your coffee sample is certified',
      'Your sample ' || v_lot.batch_code || ' has been verified by a BunaLens administrator. Your certificate is ready.',
      jsonb_build_object('batch_code',v_lot.batch_code,'grade',p_certified_grade,
        'quality_classification',p_quality_classification,
        'origin_zone',coalesce(nullif(btrim(v_station.zone),''),'Jimma')));
  end if;

  return jsonb_build_object('decision','eligible','review',v_review,'listing',to_jsonb(v_listing),
    'certification_status','certified','certified_grade',p_certified_grade,
    'quality_classification',p_quality_classification,
    'listing_published',v_listing.id is not null);
end;
$$;

revoke all on function public.bunalens_admin_certify_and_publish_lot(text,text,text,numeric,text,text) from public,anon;
grant execute on function public.bunalens_admin_certify_and_publish_lot(text,text,text,numeric,text,text) to authenticated;

-- Keep the legacy RPC safe: it can still reject, but cannot publish without admin certification fields.
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
begin
  if p_decision = 'rejected' then
    return public.bunalens_admin_certify_and_publish_lot(p_batch_id,p_decision,p_reason,null,null,null);
  end if;
  raise exception 'Use the administrator certification workflow with an assigned grade and quality classification.' using errcode = '22023';
end;
$$;

revoke all on function public.bunalens_admin_review_and_publish_lot(text,text,text,numeric) from public,anon;
grant execute on function public.bunalens_admin_review_and_publish_lot(text,text,text,numeric) to authenticated;

commit;
