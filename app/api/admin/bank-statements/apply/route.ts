import { NextResponse } from 'next/server';
import { parseReceivableLineKey } from '@/lib/admin/receivable-lines';
import { decideOfflineProof } from '@/lib/admin/decide-offline-proof';
import { isBankStatementReconcileEnabled } from '@/lib/admin/bank-statement-feature';
import { requireVerifiedAdmin } from '@/lib/auth/admin-guard';
import { applyDonationPayment } from '@/lib/donations/mark-paid';
import {
  applyRegistrationDonationPayment,
  applyRegistrationFeePayment,
} from '@/lib/events/mark-paid';
import { recordSettledCreditFingerprints } from '@/lib/admin/bank-statement-skip-settled';
import { createAdminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

type ApplyRow = {
  line_key?: unknown;
  action?: unknown;
  fingerprint?: unknown;
  stmt_date?: unknown;
  amount_paise?: unknown;
  rrn?: unknown;
};

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

  if (!(await isBankStatementReconcileEnabled())) {
    return NextResponse.json(
      { error: 'Bank statement reconciliation is turned off.' },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const rows = Array.isArray(body.rows) ? (body.rows as ApplyRow[]) : [];
  if (!rows.length) {
    return NextResponse.json({ error: 'Select at least one match to apply' }, { status: 400 });
  }

  const applied: string[] = [];
  const skipped: { line_key: string; error: string }[] = [];
  const fingerprintRows: {
    fingerprint: string;
    stmt_date: string;
    amount_paise: number;
    rrn: string | null;
    line_key: string | null;
  }[] = [];

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
      recordFingerprintRow(row, lineKey, fingerprintRows);
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
    recordFingerprintRow(row, lineKey, fingerprintRows);
  }

  await recordSettledCreditFingerprints(fingerprintRows);

  return NextResponse.json({
    applied_count: applied.length,
    applied,
    skipped,
  });
}

function recordFingerprintRow(
  row: ApplyRow,
  lineKey: string,
  out: {
    fingerprint: string;
    stmt_date: string;
    amount_paise: number;
    rrn: string | null;
    line_key: string | null;
  }[]
): void {
  const fingerprint = String(row.fingerprint || '').trim();
  if (!fingerprint) return;
  const amount = Math.floor(Number(row.amount_paise) || 0);
  if (amount < 1) return;
  out.push({
    fingerprint,
    stmt_date: String(row.stmt_date || '').trim() || '—',
    amount_paise: amount,
    rrn: row.rrn ? String(row.rrn) : null,
    line_key: lineKey,
  });
}