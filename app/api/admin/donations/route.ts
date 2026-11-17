import { NextResponse } from 'next/server';
import {
  deriveDonationReconMeta,
  donationKind,
} from '@/lib/admin/donation-recon-meta';
import { requireVerifiedAdmin } from '@/lib/auth/admin-guard';
import { createAdminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const me = await requireVerifiedAdmin();
  if (!me) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const url = new URL(request.url);
  const status = String(url.searchParams.get('status') || '').trim();

  const admin = createAdminClient();
  let q = admin
    .from('donations')
    .select(
      'id,amount_paise,message,payment_status,razorpay_payment_id,razorpay_order_id,created_at,cause_id,event_id,account_id,donation_causes(title),event_catalog(title)'
    )
    .order('created_at', { ascending: false })
    .limit(200);

  if (status === 'pending' || status === 'paid' || status === 'failed') {
    q = q.eq('payment_status', status);
  }

  const { data, error } = await q;
  if (error) {
    console.error('admin donations', error);
    return NextResponse.json({ error: 'Could not load donations' }, { status: 500 });
  }

  const rows = data || [];
  const donationIds = rows.map((r) => r.id);
  const accountIds = [...new Set(rows.map((r) => r.account_id).filter(Boolean))] as string[];

  const [{ data: accounts }, { data: proofRows }] = await Promise.all([
    accountIds.length
      ? admin.from('alumni_accounts').select('id,full_name,email').in('id', accountIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string; email: string }[] }),
    donationIds.length
      ? admin
          .from('offline_payment_proofs')
          .select('id,donation_id,status,created_at')
          .in('donation_id', donationIds)
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [] as { id: string; donation_id: string; status: string }[] }),
  ]);

  const accountById = new Map(
    (accounts || []).map((a) => [a.id, { full_name: a.full_name, email: a.email }])
  );
  const proofByDonation = new Map<string, { id: string; status: string }>();
  for (const p of proofRows || []) {
    if (!p.donation_id) continue;
    const prev = proofByDonation.get(p.donation_id);
    if (!prev) {
      proofByDonation.set(p.donation_id, { id: p.id, status: p.status });
      continue;
    }
    if (p.status === 'pending' && prev.status !== 'pending') {
      proofByDonation.set(p.donation_id, { id: p.id, status: p.status });
    }
  }

  const donations = rows.map((row) => {
    const cause = row.donation_causes as { title?: string } | { title?: string }[] | null;
    const event = row.event_catalog as { title?: string } | { title?: string }[] | null;
    const causeRow = Array.isArray(cause) ? cause[0] : cause;
    const eventRow = Array.isArray(event) ? event[0] : event;
    const account = accountById.get(row.account_id);
    const proof = proofByDonation.get(row.id) ?? null;
    const kind = donationKind(row.event_id);
    const title =
      kind === 'event'
        ? `Event donation · ${eventRow?.title || 'Jubilee'}`
        : causeRow?.title || 'Cause donation';
    const recon = deriveDonationReconMeta({
      payment_status: row.payment_status,
      event_id: row.event_id,
      razorpay_order_id: row.razorpay_order_id,
      razorpay_payment_id: row.razorpay_payment_id,
      proof,
    });
    return {
      id: row.id,
      amount_paise: row.amount_paise,
      message: row.message,
      payment_status: row.payment_status,
      razorpay_payment_id: row.razorpay_payment_id,
      razorpay_order_id: row.razorpay_order_id,
      created_at: row.created_at,
      kind,
      cause_title: title,
      donor_name: account?.full_name || '—',
      donor_email: account?.email || '—',
      channel: recon.channel,
      channel_label: recon.channel_label,
      recon_hint: recon.recon_hint,
      proof_id: proof?.status === 'pending' ? proof.id : null,
      proof_status: proof?.status ?? null,
    };
  });

  return NextResponse.json({ donations });
}
