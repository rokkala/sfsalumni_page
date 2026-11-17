import { NextResponse } from 'next/server';
import { listPendingGiftsWithoutProof } from '@/lib/admin/pending-gift-queue';
import { requireVerifiedAdmin } from '@/lib/auth/admin-guard';
import { signedProofUrl } from '@/lib/payments/proof-storage';
import { createAdminClient } from '@/lib/supabase-admin';

const PROOF_COLUMNS =
  'id,source_type,registration_id,donation_id,account_id,payment_account_id,amount_paise,utr,screenshot_path,remittance_method,payment_date,remittance_meta,status,admin_note,created_at,updated_at,reviewed_at';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const me = await requireVerifiedAdmin();
  if (!me) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const url = new URL(request.url);
  const status = String(url.searchParams.get('status') || 'pending').trim();
  const allowed = new Set(['pending', 'approved', 'rejected', 'all']);
  if (!allowed.has(status)) {
    return NextResponse.json({ error: 'Invalid status filter' }, { status: 400 });
  }

  const admin = createAdminClient();
  let q = admin
    .from('offline_payment_proofs')
    .select(PROOF_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(100);

  if (status !== 'all') q = q.eq('status', status);

  const { data, error } = await q;
  if (error) {
    console.error('admin offline proofs', error);
    const missing =
      error.code === 'PGRST205' ||
      error.code === '42P01' ||
      /offline_payment_proofs/i.test(error.message || '') ||
      /remittance_method/i.test(error.message || '') ||
      /schema cache/i.test(error.message || '');
    return NextResponse.json(
      {
        error: missing
          ? 'offline_payment_proofs is not set up yet. Run migrations through 20261117100000_offline_proofs_remittance.sql in Supabase.'
          : 'Could not load proofs',
      },
      { status: missing ? 503 : 500 }
    );
  }

  const rows = data || [];
  const accountIds = [...new Set(rows.map((r) => r.account_id).filter(Boolean))] as string[];
  const payAccountIds = [
    ...new Set(rows.map((r) => r.payment_account_id).filter(Boolean)),
  ] as string[];

  const [{ data: accounts }, { data: payAccounts }] = await Promise.all([
    accountIds.length
      ? admin.from('alumni_accounts').select('id,full_name,email').in('id', accountIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string; email: string }[] }),
    payAccountIds.length
      ? admin.from('payment_accounts').select('id,label').in('id', payAccountIds)
      : Promise.resolve({ data: [] as { id: string; label: string }[] }),
  ]);

  const accountById = new Map(
    (accounts || []).map((a) => [a.id, { full_name: a.full_name, email: a.email }])
  );
  const payAccountById = new Map((payAccounts || []).map((a) => [a.id, a.label]));

  const proofs = await Promise.all(
    rows.map(async (row) => {
      const screenshot_url = await signedProofUrl(admin, row.screenshot_path as string | null);
      const account = accountById.get(row.account_id);
      const payLabel = row.payment_account_id
        ? payAccountById.get(row.payment_account_id) ?? null
        : null;
      return {
        id: row.id,
        source_type: row.source_type,
        registration_id: row.registration_id,
        donation_id: row.donation_id,
        amount_paise: row.amount_paise,
        utr: row.utr,
        remittance_method: row.remittance_method,
        payment_date: row.payment_date,
        remittance_meta: row.remittance_meta,
        status: row.status,
        admin_note: row.admin_note,
        created_at: row.created_at,
        reviewed_at: row.reviewed_at,
        screenshot_url,
        donor_name: account?.full_name || '—',
        donor_email: account?.email || '—',
        payment_account_label: payLabel,
      };
    })
  );

  const pendingGiftsWithoutProof =
    status === 'pending' ? (await listPendingGiftsWithoutProof(admin)).gifts : [];

  return NextResponse.json({ proofs, pending_gifts_without_proof: pendingGiftsWithoutProof });
}
