import { NextResponse } from 'next/server';
import { parseReceivableLineKey } from '@/lib/admin/receivable-lines';
import { decideOfflineProof } from '@/lib/admin/decide-offline-proof';
import { requireVerifiedAdmin } from '@/lib/auth/admin-guard';
import { applyDonationPayment } from '@/lib/donations/mark-paid';
import {
  applyRegistrationDonationPayment,
  applyRegistrationFeePayment,
} from '@/lib/events/mark-paid';
import { createAdminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

type ApplyRow = { line_key?: unknown; action?: unknown };

async function donationLinkedToRegistration(donationId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('event_registrations')
    .select('id')
    .eq('donation_id', donationId)
    .maybeSingle();
  return Boolean(data?.id);
}

export async function POST(request: Request) {
  const me = await requireVerifiedAdmin();
  if (!me) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const rows = Array.isArray(body.rows) ? (body.rows as ApplyRow[]) : [];
  if (!rows.length) {
    return NextResponse.json({ error: 'Select at least one match to apply' }, { status: 400 });
  }

  const applied: string[] = [];
  const skipped: { line_key: string; error: string }[] = [];

  for (const row of rows.slice(0, 50)) {
    const lineKey = String(row.line_key || '').trim();
    const action = String(row.action || 'auto').trim();
    const parsed = parseReceivableLineKey(lineKey);
    if (!parsed) {
      skipped.push({ line_key: lineKey, error: 'Invalid line' });
      continue;
    }

    const admin = createAdminClient();
    let proofId: string | null = null;

    if (parsed.kind === 'fee') {
      const { data: regProof } = await admin
        .from('offline_payment_proofs')
        .select('id,status')
        .eq('registration_id', parsed.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      proofId = regProof?.id ?? null;
    } else {
      const { data: donProof } = await admin
        .from('offline_payment_proofs')
        .select('id,status')
        .eq('donation_id', parsed.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      proofId = donProof?.id ?? null;
    }

    const note = 'Bank statement reconciliation';

    if (proofId && action !== 'mark_paid_only') {
      const decision = await decideOfflineProof({
        id: proofId,
        status: 'approved',
        adminNote: note,
        reviewedBy: me.id,
      });
      if (!decision.ok) {
        skipped.push({ line_key: lineKey, error: decision.error });
        continue;
      }
      applied.push(lineKey);
      continue;
    }

    if (parsed.kind === 'fee') {
      const result = await applyRegistrationFeePayment({ registrationId: parsed.id });
      if (!result.ok) {
        skipped.push({ line_key: lineKey, error: result.error || 'Fee not updated' });
        continue;
      }
    } else {
      const linked = await donationLinkedToRegistration(parsed.id);
      const result = linked
        ? await applyRegistrationDonationPayment({ donationId: parsed.id })
        : await applyDonationPayment({ donationId: parsed.id });
      if (!result.ok) {
        skipped.push({ line_key: lineKey, error: result.error || 'Donation not updated' });
        continue;
      }
    }
    applied.push(lineKey);
  }

  return NextResponse.json({
    applied_count: applied.length,
    applied,
    skipped,
  });
}