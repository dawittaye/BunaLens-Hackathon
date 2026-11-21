-- Do not let arbitrary SECURITY DEFINER RPCs bypass the certification guard.
-- Only an admin JWT or the trusted service_role sync path may change certification fields.
create or replace function public.bunalens_guard_certificate_fields()
returns trigger
language plpgsql
set search_path = ''
as $guard$
declare
  v_trusted boolean := current_user = 'service_role';
begin
  if tg_op = 'INSERT' then
    if coalesce(new.certification_status,'pending_admin_review') <> 'pending_admin_review'
       or new.certified_grade is not null
       or new.ecx_grade <> 'Unclassified'
       or new.quality_classification is not null
       or new.certification_origin_zone is not null
       or new.certified_by is not null
       or new.certified_at is not null
       or new.certification_note is not null
       or new.grading_result ? 'administrator_certification' then
      if not v_trusted and ((select auth.uid()) is null or public.bunalens_jwt_role() <> 'admin') then
        raise exception 'Only an administrator can create a certified coffee record.' using errcode = '42501';
      end if;
    end if;
  elsif new.certification_status is distinct from old.certification_status
     or new.certified_grade is distinct from old.certified_grade
     or new.ecx_grade is distinct from old.ecx_grade
     or new.quality_classification is distinct from old.quality_classification
     or new.certification_origin_zone is distinct from old.certification_origin_zone
     or new.certified_by is distinct from old.certified_by
     or new.certified_at is distinct from old.certified_at
     or new.certification_note is distinct from old.certification_note
     or (new.grading_result -> 'administrator_certification') is distinct from (old.grading_result -> 'administrator_certification') then
    if not v_trusted and ((select auth.uid()) is null or public.bunalens_jwt_role() <> 'admin') then
      raise exception 'Only an administrator can change coffee certification fields.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$guard$;
