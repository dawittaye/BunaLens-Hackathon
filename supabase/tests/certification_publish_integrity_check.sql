-- Disposable local database only. Uses synthetic rows and rolls everything back.
begin;

insert into auth.users(id,email) values
 ('afca0000-0000-4000-8000-000000000001','certification-station@example.test'),
 ('afca0000-0000-4000-8000-000000000002','certification-admin@example.test');
insert into public.stations(id,owner_id,name,manager,woreda,marketplace_seller_status)
  values ('afca0000-0000-4000-8000-000000000003','afca0000-0000-4000-8000-000000000001','Certification test station','Test manager','Gomma','approved');

insert into public.coffee_batches(id,idempotency_key,station_id,batch_code,sample_type,woreda,lot_weight_kg,image_path,grading_result,grading_status)
  values ('integrity-lot','integrity-test-capture','afca0000-0000-4000-8000-000000000003','BNL-JMA-T001','red_cherry','Gomma',170,
   'afca0000-0000-4000-8000-000000000003/server-captures/photo-one.jpg',
   '{"screening":{"source":"live_inference","needs_review":false,"photo":{"usable":true}}}','completed');
insert into storage.objects(bucket_id,name) values ('coffee-samples','afca0000-0000-4000-8000-000000000003/server-captures/photo-one.jpg');

select set_config('bunalens.test.old_verification_id', verification_id::text, true)
  from public.coffee_batches where id = 'integrity-lot';

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"afca0000-0000-4000-8000-000000000001","app_metadata":{}}',true),
       set_config('request.jwt.claim.sub','afca0000-0000-4000-8000-000000000001',true);
do $$
declare
  v_count int;
begin
  begin
    perform public.bunalens_admin_request_rescan('integrity-lot',null,'I am not an administrator');
    raise exception 'A station owner could request a rescan as admin';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.bunalens_save_listing('integrity-lot',170,200,'published');
    raise exception 'A station owner published an uncertified lot';
  exception when insufficient_privilege then null;
  end;
  update storage.objects set name = name || '.renamed'
    where name = 'afca0000-0000-4000-8000-000000000003/server-captures/photo-one.jpg';
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'A station owner could replace the reviewed photograph'; end if;
  begin
    insert into storage.objects(bucket_id,name)
      values ('coffee-samples','afca0000-0000-4000-8000-000000000003/server-captures/client.jpg');
    raise exception 'A station owner could write to the service capture folder';
  exception when insufficient_privilege then null;
  end;
end;
$$;

select set_config('request.jwt.claims','{"sub":"afca0000-0000-4000-8000-000000000002","app_metadata":{"role":"admin"}}',true),
       set_config('request.jwt.claim.sub','afca0000-0000-4000-8000-000000000002',true);
do $$
declare
  v_result jsonb;
  v_image text := 'afca0000-0000-4000-8000-000000000003/server-captures/photo-one.jpg';
begin
  begin
    perform public.bunalens_admin_certify_reviewed_scan('integrity-lot','stale.jpg','eligible','Internal certification audit note.',200,'Grade 2','Local Market Only');
    raise exception 'An admin could certify a stale capture';
  exception when serialization_failure then null;
  end;
  v_result := public.bunalens_admin_certify_reviewed_scan('integrity-lot',v_image,'eligible','Internal certification audit note.',200,'Grade 2','Local Market Only');
  if v_result -> 'listing' ->> 'status' is distinct from 'published'
     or v_result -> 'listing' -> 'evidence_summary' ? 'approval_reason' then
    raise exception 'Expected a published listing with the private note removed';
  end if;
  if (public.bunalens_admin_request_rescan('integrity-lot',v_image,'Please submit a new and clearer photo.') ->> 'already_notified')::boolean is distinct from false then
    raise exception 'First rescan request did not report sent';
  end if;
  if (public.bunalens_admin_request_rescan('integrity-lot',v_image,'Please submit a new and clearer photo.') ->> 'already_notified')::boolean is distinct from true then
    raise exception 'Repeated rescan request did not report deduplication';
  end if;
  begin
    perform public.bunalens_admin_certify_reviewed_scan('integrity-lot',v_image,'eligible','Attempt to review the old photo.',200,'Grade 2','Local Market Only');
    raise exception 'An old photograph could be recertified after requesting a rescan';
  exception when invalid_parameter_value then null;
  end;
end;
$$;

reset role;
do $$
begin
  if (select status from public.marketplace_listings where batch_id = 'integrity-lot') is distinct from 'paused'
     or (select certification_status from public.coffee_batches where id = 'integrity-lot') is distinct from 'pending_admin_review'
     or (select verification_id::text from public.coffee_batches where id = 'integrity-lot') = current_setting('bunalens.test.old_verification_id')
     or (select count(*) from public.user_notifications where batch_id = 'integrity-lot' and notification_type = 'review_update') <> 1
     or (select count(*) from public.lot_reviews where batch_id = 'integrity-lot' and decision = 'needs_review') <> 1 then
    raise exception 'Rescan must atomically pause the listing, revoke certification, and audit one notification';
  end if;
end;
$$;

rollback;
