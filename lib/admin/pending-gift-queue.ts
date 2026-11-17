import { createAdminClient } from '@/lib/supabase-admin';

export type PendingGiftWithoutProof = {
  id: string;
  amount_paise: number;
  created_at: string;
  donor_name: string;
  donor_email: string;
  label: string;
  kind: 'cause' | 'event';
};

function isMissingSchema(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    /schema cache/i.test(error.message || '') ||
    /donations/i.test(error.message || '')
  );
}

/** Pending donation rows with no matching pending offline proof (members still need to pay / upload). */
export async function listPendingGiftsWithoutProof(
  admin: ReturnType<typeof createAdminClient> = createAdminClient()
): Promise<{ gifts: PendingGiftWithoutProof[]; loadError: string | null }> {
  const { data: donations, error: donErr } = await admin
    .from('donations')
    .select(
      'id,amount_paise,created_at,account_id,cause_id,event_id,donation_causes(title),event_catalog(title)'
    )
    .eq('payment_status', 'pending')
    .order('created_at', { ascending: false })
    .limit(50);

  if (donErr) {
    if (isMissingSchema(donErr)) return { gifts: [], loadError: null };
    console.error('pending gifts donations', donErr);
    return { gifts: [], loadError: 'Could not load pending gifts' };
  }

  const { data: proofRows, error: proofErr } = await admin
    .from('offline_payment_proofs')
    .select('donation_id')
    .eq('status', 'pending')
    .not('donation_id', 'is', null);

  if (proofErr && !isMissingSchema(proofErr)) {
    console.error('pending gifts proofs', proofErr);
    return { gifts: [], loadError: 'Could not load pending gifts' };
  }

  const queuedDonationIds = new Set(
    (proofRows || []).map((r) => r.donation_id).filter(Boolean) as string[]
  );
  const orphans = (donations || []).filter((d) => !queuedDonationIds.has(d.id));
  if (!orphans.length) return { gifts: [], loadError: null };

  const accountIds = [...new Set(orphans.map((d) => d.account_id).filter(Boolean))];
  const { data: accounts } = await admin
    .from('alumni_accounts')
    .select('id,full_name,email')
    .in('id', accountIds);

  const byAccount = new Map(
    (accounts || []).map((a) => [a.id, { full_name: a.full_name, email: a.email }])
  );

  const gifts: PendingGiftWithoutProof[] = orphans.map((row) => {
    const cause = Array.isArray(row.donation_causes)
      ? row.donation_causes[0]
      : row.donation_causes;
    const event = Array.isArray(row.event_catalog) ? row.event_catalog[0] : row.event_catalog;
    const acct = byAccount.get(row.account_id);
    const kind: 'cause' | 'event' = row.event_id ? 'event' : 'cause';
    const label =
      kind === 'event'
        ? `Event gift · ${(event as { title?: string } | null)?.title || 'Jubilee'}`
        : (cause as { title?: string } | null)?.title || 'Cause gift';
    return {
      id: row.id,
      amount_paise: row.amount_paise,
      created_at: row.created_at,
      donor_name: acct?.full_name || '—',
      donor_email: acct?.email || '—',
      label,
      kind,
    };
  });

  return { gifts, loadError: null };
}