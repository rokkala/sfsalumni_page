import { NextResponse } from 'next/server';
import {
  extractStatementPdfText,
  parseStatementAccountNumber,
} from '@/lib/admin/sib-statement-pdf';
import { parseSibStatementCredits } from '@/lib/admin/sib-statement-parse';
import { bankStatementCreditFingerprint } from '@/lib/admin/bank-statement-credit-fingerprint';
import { matchStatementCredits } from '@/lib/admin/bank-statement-match';
import { partitionSettledCredits } from '@/lib/admin/bank-statement-skip-settled';
import { isBankStatementReconcileEnabled } from '@/lib/admin/bank-statement-feature';
import { requireVerifiedAdmin } from '@/lib/auth/admin-guard';
import { loadCheckoutSettings } from '@/lib/payments/checkout-settings';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 8_000_000;

export async function POST(request: Request) {
  const me = await requireVerifiedAdmin();
  if (!me) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  if (!(await isBankStatementReconcileEnabled())) {
    return NextResponse.json(
      {
        error:
          'Bank statement reconciliation is turned off (admin toggle or BANK_STATEMENT_RECONCILE_ENABLED env). Re-enable on Receivables when ready.',
      },
      { status: 403 }
    );
  }

  const form = await request.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: 'Expected multipart form' }, { status: 400 });
  }

  const file = form.get('file');
  const password = String(form.get('pdf_password') ?? '').trim();
  const eventId = String(form.get('event_id') ?? '').trim();

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Choose a PDF file' }, { status: 400 });
  }
  if (!password) {
    return NextResponse.json({ error: 'Enter the statement PDF password' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'PDF is too large (max 8 MB)' }, { status: 400 });
  }
  const mime = file.type || '';
  const name = file.name.toLowerCase();
  if (!name.endsWith('.pdf') && mime !== 'application/pdf') {
    return NextResponse.json({ error: 'Upload a PDF bank statement' }, { status: 400 });
  }

  const buffer = new Uint8Array(await file.arrayBuffer());
  const extracted = await extractStatementPdfText(buffer, password);
  if ('error' in extracted) {
    return NextResponse.json({ error: extracted.error }, { status: 400 });
  }

  const text = extracted.text;
  const account_number = parseStatementAccountNumber(text);
  const credits = parseSibStatementCredits(text);
  if (!credits.length) {
    return NextResponse.json(
      {
        error: 'No deposit rows found — this parser targets South Indian Bank PDF layout.',
        account_number,
        credit_count: 0,
      },
      { status: 400 }
    );
  }

  const { to_match, already_settled } = await partitionSettledCredits(credits);

  const checkout = await loadCheckoutSettings();
  const include_closed_lines = checkout.bank_statement_include_closed_lines;

  const { results, error } = await matchStatementCredits({
    credits: to_match,
    eventId: eventId || undefined,
    includeClosedLines: include_closed_lines,
  });
  if (error) {
    return NextResponse.json({ error }, { status: 500 });
  }

  const memberCredits = credits.filter((c) => c.kind === 'credit');
  const matched =
    results.filter((r) => r.best && r.credit.kind === 'credit').length;

  return NextResponse.json({
    account_number,
    credit_count: credits.length,
    member_credit_count: memberCredits.length,
    already_settled_count: already_settled.length,
    already_settled: already_settled.map((row) => ({
      credit: row.credit,
      fingerprint: bankStatementCreditFingerprint(row.credit),
      reason: row.reason,
    })),
    suggested_matches: matched,
    include_closed_lines,
    results,
  });
}