import { NextResponse } from 'next/server';
import { requireVerifiedAdmin } from '@/lib/auth/admin-guard';
import { decideOfflineProof } from '@/lib/admin/decide-offline-proof';
import { signedProofUrl } from '@/lib/payments/proof-storage';
import { createAdminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PROOF_COLUMNS =
  'id,source_type,registration_id,donation_id,account_id,payment_account_id,amount_paise,utr,screenshot_path,remittance_method,payment_date,remittance_meta,status,admin_note,created_at,updated_at,reviewed_at';

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const me = await requireVerifiedAdmin();
  if (!me) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const id = String(params.id || '');
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from('offline_payment_proofs')
    .select(PROOF_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) {
    console.error('admin offline proof get', error);
    return NextResponse.json({ error: 'Could not load proof' }, { status: 500 });
  }
  if (!row) return NextResponse.json({ error: 'Proof not found' }, { status: 404 });

  const [{ data: account }, { data: payAccount }] = await Promise.all([
    row.account_id
      ? admin.from('alumni_accounts').select('full_name,email').eq('id', row.account_id).maybeSingle()
      : Promise.resolve({ data: null }),
    row.payment_account_id
      ? admin.from('payment_accounts').select('label').eq('id', row.payment_account_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const screenshot_url = await signedProofUrl(admin, row.screenshot_path as string | null);

  return NextResponse.json({
    id: row.id,
    source_type: row.source_type,
    amount_paise: row.amount_paise,
    utr: row.utr,
    remittance_method: row.remittance_method,
    payment_date: row.payment_date,
    remittance_meta: row.remittance_meta,
    status: row.status,
    admin_note: row.admin_note,
    screenshot_url,
    donor_name: account?.full_name || '—',
    donor_email: account?.email || '—',
    payment_account_label: payAccount?.label ?? null,
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const me = await requireVerifiedAdmin();
  if (!me) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const id = String(params.id || '');
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const decision = String(body.status || '').trim();
  if (decision !== 'approved' && decision !== 'rejected') {
    return NextResponse.json({ error: 'status must be approved or rejected' }, { status: 400 });
  }
  const adminNote = String(body.adminNote ?? body.admin_note ?? '').trim() || null;

  const result = await decideOfflineProof({
    id,
    status: decision,
    adminNote,
    reviewedBy: me.id,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ proof: result.proof });
}
