import type { createAdminClient } from '@/lib/supabase-admin';

/** Member edits registration while a Bank / UPI proof is still pending. */

export const WITHDRAWN_PROOF_ADMIN_NOTE = 'Withdrawn: member updated registration.';

/** Rejects pending proofs so the member can save new choices and submit fresh proof. */
export async function withdrawPendingRegistrationProofs(
  admin: ReturnType<typeof createAdminClient>,
  registrationId: string
): Promise<number> {
  const { data } = await admin
    .from('offline_payment_proofs')
    .update({
      status: 'rejected',
      admin_note: WITHDRAWN_PROOF_ADMIN_NOTE,
      updated_at: new Date().toISOString(),
    })
    .eq('registration_id', registrationId)
    .eq('status', 'pending')
    .select('id');
  return Array.isArray(data) ? data.length : 0;
}