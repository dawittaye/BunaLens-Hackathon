import { supabase } from '@/services/supabaseClient';

export type UserActivityEvent =
  | 'account_registered'
  | 'user_signed_in'
  | 'user_signed_out'
  | 'coffee_batch_submitted';

export async function logUserActivity(eventType: UserActivityEvent, metadata: Record<string, unknown> = {}) {
  if (!supabase) return;
  try {
    const { data } = await supabase.auth.getUser();
    if (!data.user) return;
    const { error } = await supabase.from('user_activity_logs').insert({
      user_id: data.user.id,
      event_type: eventType,
      metadata,
    });
    if (error) console.warn('BunaLens activity event was not recorded', error.code);
  } catch {
    // Activity logging must never block sign-in or coffee assessment.
  }
}
