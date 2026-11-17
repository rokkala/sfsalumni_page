import { listPendingGiftsWithoutProof } from '@/lib/admin/pending-gift-queue';
import { summarizeOverviewStats } from '@/lib/admin/registration-ledger';
import { loadRegistrationRows, one } from '@/lib/admin/registration-rows';
import { createAdminClient } from '@/lib/supabase-admin';

export type ReconciliationSnapshot = {
  pending_utr_proofs: number;
  pending_gifts_without_proof: number;
  pending_cause_gifts_queued: number;
  unpaid_registrations: number;
  action_total: number;
};

function missingProofsTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    /offline_payment_proofs/i.test(error.message || '') ||
    /schema cache/i.test(error.message || '')
  );
}

/** One committee queue: proofs to review, gifts without proof, unpaid regs (separate workflows). */
export async function loadReconciliationSnapshot(
  admin: ReturnType<typeof createAdminClient> = createAdminClient()
): Promise<ReconciliationSnapshot> {
  const [{ count: proofCount, error: proofErr }, orphans, { rows }] = await Promise.all([
    admin
      .from('offline_payment_proofs')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending'),
    listPendingGiftsWithoutProof(admin),
    loadRegistrationRows(''),
  ]);

  const pendingUtr = !proofErr ? proofCount || 0 : missingProofsTable(proofErr) ? 0 : 0;
  if (proofErr && !missingProofsTable(proofErr)) {
    console.error('reconciliation pending proofs', proofErr);
  }

  const unpaid = summarizeOverviewStats(
    rows.map((r) => ({
      payment_status: r.payment_status,
      total_cost_paise: r.total_cost_paise,
      amount_paid_paise: r.amount_paid_paise,
      core_committee_manually_verified: r.core_committee_manually_verified,
      bank_reference: r.bank_reference,
      donation: one(r.donation),
    }))
  ).unpaidRegistrations;

  const { count: donationProofCount } = await admin
    .from('offline_payment_proofs')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
    .eq('source_type', 'donation');

  const giftsNoProof = orphans.gifts.length;

  return {
    pending_utr_proofs: pendingUtr,
    pending_gifts_without_proof: giftsNoProof,
    pending_cause_gifts_queued: donationProofCount ?? 0,
    unpaid_registrations: unpaid,
    action_total: pendingUtr + giftsNoProof + unpaid,
  };
}