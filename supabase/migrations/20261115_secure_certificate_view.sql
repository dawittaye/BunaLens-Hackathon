-- The certificate verification Edge Function is the only public lookup surface.
create or replace view public.public_certificate_verification
with (security_invoker = true)
as
select b.verification_id,b.batch_code,b.sample_type,b.woreda,b.created_at,
       b.grading_result->>'ecx_grade' as estimated_grade,
       b.grading_result->>'quality_score' as quality_score,
       b.lot_weight_kg
from public.coffee_batches b;
revoke all on public.public_certificate_verification from public, anon, authenticated;
