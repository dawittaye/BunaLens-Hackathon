begin;

-- Prevent a client from replacing the bytes that a certificate was issued for.
-- The service writes each live capture to a fresh path in a reserved folder.
create policy "BunaLens reserve live capture paths" on storage.objects
  as restrictive for insert to authenticated
  with check (bucket_id <> 'coffee-samples' or (storage.foldername(name))[2] is distinct from 'server-captures');

create policy "BunaLens make sample photographs immutable" on storage.objects
  as restrictive for update to authenticated
  using (bucket_id <> 'coffee-samples')
  with check (bucket_id <> 'coffee-samples');

create policy "BunaLens preserve sample photographs" on storage.objects
  as restrictive for delete to authenticated using (bucket_id <> 'coffee-samples');

create policy "BunaLens administrators read sample photographs" on storage.objects
  for select to authenticated
  using (bucket_id = 'coffee-samples' and public.bunalens_jwt_role() = 'admin');

-- Invalidate the verification link whenever certified evidence is replaced
-- or the certificate is withdrawn. A later decision must issue a new link.
create function public.bunalens_rotate_certificate_link()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.certification_status = 'certified'
     and (new.certification_status <> 'certified' or new.image_path is distinct from old.image_path) then
    new.verification_id := gen_random_uuid();
  end if;
  if new.certification_status = 'certified'
     and old.certification_status = 'certified'
     and new.image_path is distinct from old.image_path then
    raise exception 'Reset certification before replacing the reviewed photograph.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.bunalens_rotate_certificate_link() from public, anon, authenticated;
create trigger coffee_batches_rotate_certificate_link
  before update of certification_status, image_path on public.coffee_batches
  for each row execute function public.bunalens_rotate_certificate_link();

create function public.bunalens_require_listing_certificate()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_remaining numeric;
begin
  new.evidence_summary := new.evidence_summary - 'approval_reason';
  if new.status = 'published' and not exists (
    select 1 from public.coffee_batches b where b.id = new.batch_id
      and b.certification_status = 'certified'
      and b.certified_grade is not null and b.quality_classification is not null
  ) then
    raise exception 'This lot must be certified by a BunaLens administrator before it can be published.' using errcode = '42501';
  end if;
  -- The admin publish RPC uses an upsert, including on recertification.
  if tg_op = 'INSERT' and new.status = 'published' then
    select b.lot_weight_kg - coalesce((select sum(o.quantity_kg)
      from public.coffee_orders o where o.batch_id = b.id and o.status in ('accepted', 'fulfilled')), 0)
      into v_remaining from public.coffee_batches b where b.id = new.batch_id;
    if v_remaining <= 0 then
      raise exception 'This lot has no stock left to publish.' using errcode = '22023';
    end if;
    new.available_kg := least(new.available_kg, v_remaining);
  end if;
  return new;
end;
$$;
revoke all on function public.bunalens_require_listing_certificate() from public, anon, authenticated;
create trigger marketplace_listings_require_certificate
  before insert or update on public.marketplace_listings
  for each row execute function public.bunalens_require_listing_certificate();

-- Pause in place. Orders, filled stock and listing IDs are preserved.
update public.marketplace_listings l set status = 'paused'
where l.status = 'published' and not exists (
  select 1 from public.coffee_batches b where b.id = l.batch_id
    and b.certification_status = 'certified' and b.certified_grade is not null
    and b.quality_classification is not null and b.eligibility_status = 'eligible'
);
update public.marketplace_listings l set evidence_summary = l.evidence_summary - 'approval_reason'
where l.evidence_summary ? 'approval_reason';

create or replace function public.bunalens_pause_listings_for_lot()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.eligibility_status <> 'eligible' or new.certification_status <> 'certified'
     or new.certified_grade is null or new.quality_classification is null then
    update public.marketplace_listings set status = 'paused'
    where batch_id = new.id and status = 'published';
  end if;
  return new;
end;
$$;
drop trigger coffee_batches_pause_listings on public.coffee_batches;
create trigger coffee_batches_pause_listings
  after update of eligibility_status, certification_status, certified_grade, quality_classification on public.coffee_batches
  for each row execute function public.bunalens_pause_listings_for_lot();

-- Compare the photograph the admin opened with the current evidence under
-- the same row lock used by the existing certification transaction.
create function public.bunalens_admin_certify_reviewed_scan(
  p_batch_id text, p_image_path text, p_decision text, p_reason text,
  p_price_per_kg_etb numeric, p_certified_grade text, p_quality_classification text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_lot public.coffee_batches%rowtype;
  v_result jsonb;
begin
  if (select auth.uid()) is null or public.bunalens_jwt_role() <> 'admin' then
    raise exception 'Only an administrator can review and certify coffee scans.' using errcode = '42501';
  end if;
  select * into v_lot from public.coffee_batches where id = p_batch_id for update;
  if not found then raise exception 'Coffee scan not found.' using errcode = 'P0002'; end if;
  if v_lot.image_path is distinct from p_image_path then
    raise exception 'A newer photograph was submitted. Refresh and review the new scan.' using errcode = '40001';
  end if;
  if p_decision = 'eligible' and not exists (
    select 1 from storage.objects o where o.bucket_id = 'coffee-samples' and o.name = p_image_path
  ) then
    raise exception 'The reviewed sample photograph is unavailable.' using errcode = '22023';
  end if;
  if p_decision = 'eligible' and exists (
    select 1 from public.user_notifications n where n.batch_id = p_batch_id
      and n.notification_type = 'review_update' and n.metadata ->> 'action' = 'request_rescan'
      and (n.metadata ->> 'image_path') is not distinct from p_image_path
  ) then
    raise exception 'A fresh photograph is required before this lot can be certified again.' using errcode = '22023';
  end if;
  v_result := public.bunalens_admin_certify_and_publish_lot(
    p_batch_id, p_decision, p_reason, p_price_per_kg_etb, p_certified_grade, p_quality_classification
  );
  if v_result -> 'listing' -> 'evidence_summary' ? 'approval_reason' then
    v_result := v_result #- '{listing,evidence_summary,approval_reason}';
  end if;
  return v_result;
end;
$$;

revoke all on function public.bunalens_admin_certify_and_publish_lot(text,text,text,numeric,text,text) from public, anon, authenticated;
revoke all on function public.bunalens_admin_review_and_publish_lot(text,text,text,numeric) from public, anon, authenticated;
revoke all on function public.bunalens_admin_certify_reviewed_scan(text,text,text,text,numeric,text,text) from public, anon;
grant execute on function public.bunalens_admin_certify_reviewed_scan(text,text,text,text,numeric,text,text) to authenticated;

create function public.bunalens_admin_request_rescan(p_batch_id text, p_image_path text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_lot public.coffee_batches%rowtype;
  v_owner uuid;
  v_reason text := btrim(coalesce(p_reason,''));
begin
  if (select auth.uid()) is null or public.bunalens_jwt_role() <> 'admin' then
    raise exception 'Only an administrator can request a rescan.' using errcode = '42501';
  end if;
  if length(v_reason) not between 10 and 1000 then
    raise exception 'Enter a rescan note between 10 and 1,000 characters.' using errcode = '22023';
  end if;
  select * into v_lot from public.coffee_batches where id = p_batch_id for update;
  if not found then raise exception 'Coffee scan not found.' using errcode = 'P0002'; end if;
  if v_lot.image_path is distinct from p_image_path then
    raise exception 'A newer photograph was submitted. Refresh and review the new scan.' using errcode = '40001';
  end if;
  select owner_id into v_owner from public.stations where id = v_lot.station_id;
  if v_owner is null or v_owner = (select auth.uid()) then
    raise exception 'A rescan requires another registered station owner.' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.user_notifications n where n.user_id = v_owner and n.batch_id = p_batch_id
      and n.notification_type = 'review_update' and n.metadata ->> 'action' = 'request_rescan'
      and (n.metadata ->> 'image_path') is not distinct from p_image_path
      and n.created_at > now() - interval '24 hours'
  ) then
    return jsonb_build_object('already_notified', true);
  end if;
  update public.coffee_batches
    set certification_status = 'pending_admin_review', certified_grade = null,
        quality_classification = null, certification_origin_zone = null,
        certification_note = v_reason, certified_by = null, certified_at = null,
        ecx_grade = 'Unclassified',
        grading_result = grading_result - 'administrator_certification',
        eligibility_status = 'needs_review', eligibility_updated_at = now()
    where id = p_batch_id;
  insert into public.lot_reviews(batch_id, decision, decided_by, reviewer_id, reason)
    values (p_batch_id, 'needs_review', 'reviewer', (select auth.uid()), v_reason);
  insert into public.user_notifications(user_id,batch_id,notification_type,title,message,metadata)
    values (v_owner,p_batch_id,'review_update','New coffee scan requested',
      'Submit a fresh photograph for ' || v_lot.batch_code || '. ' || v_reason,
      jsonb_build_object('action','request_rescan','image_path',p_image_path));
  return jsonb_build_object('already_notified', false);
end;
$$;
revoke all on function public.bunalens_admin_request_rescan(text,text,text) from public, anon;
grant execute on function public.bunalens_admin_request_rescan(text,text,text) to authenticated;

notify pgrst, 'reload schema';
commit;
