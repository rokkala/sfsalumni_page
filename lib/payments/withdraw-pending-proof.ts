import type { createAdminClient } from '@/lib/supabase-admin';

/** Member edits registration while a Bank / UPI proof is still pending. */

export const WITHDRAWN_PROOF_ADMIN_NOTE = 'Withdrawn: member updated registration.';

export type WithdrawnRegistrationProof = {
  count: number;
  amountPaise: number;
};

/** Rejects pending proofs so the member can save new choices and submit fresh proof. */
export async function withdrawPendingRegistrationProofs(
  admin: ReturnType<typeof createAdminClient>,
  registrationId: string
): Promise<WithdrawnRegistrationProof> {
  const { data: pending } = await admin
    .from('offline_payment_proofs')
    .select('id,amount_paise')
    .eq('registration_id', registrationId)
    .eq('status', 'pending');
  const rows = Array.isArray(pending) ? pending : [];
  if (rows.length === 0) return { count: 0, amountPaise: 0 };

  const amountPaise = rows.reduce(
    (sum, row) => sum + Math.max(0, Math.floor(Number(row.amount_paise) || 0)),
    0
  );

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

  return {
    count: Array.isArray(data) ? data.length : rows.length,
    amountPaise,
  };
}