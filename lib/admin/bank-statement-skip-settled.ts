import type { SibStatementCredit } from '@/lib/admin/sib-statement-parse';
import { normalizeUpiRefNoInput } from '@/lib/payments/bank-details';
import { bankStatementCreditFingerprint } from '@/lib/admin/bank-statement-credit-fingerprint';
import { createAdminClient } from '@/lib/supabase-admin';

export type SettledCreditMeta = {
  credit: SibStatementCredit;
  reason: string;
};

export type PartitionSettledCredits = {
  to_match: SibStatementCredit[];
  already_settled: SettledCreditMeta[];
};

type SettledIndex = {
  fingerprints: Set<string>;
  utrAmount: Set<string>;
  refAmount: Set<string>;
};

function utrAmountKey(utr: string, amountPaise: number): string {
  const u = normalizeUpiRefNoInput(utr);
  return u ? `${u}|${amountPaise}` : '';
}

function creditLookupKeys(credit: SibStatementCredit): string[] {
  const keys: string[] = [];
  for (const ref of credit.receipt_refs) {
    const k = utrAmountKey(ref, credit.amount_paise);
    if (k) keys.push(k);
  }
  if (credit.rrn) {
    const k = utrAmountKey(credit.rrn, credit.amount_paise);
    if (k) keys.push(k);
  }
  return [...new Set(keys)];
}

async function loadSettledIndex(fingerprints: string[]): Promise<SettledIndex> {
  const admin = createAdminClient();
  const index: SettledIndex = {
    fingerprints: new Set(),
    utrAmount: new Set(),
    refAmount: new Set(),
  };

  if (fingerprints.length) {
    const { data: seen, error } = await admin
      .from('bank_statement_settled_credits')
      .select('fingerprint')
      .in('fingerprint', fingerprints);
    if (!error) {
      for (const row of seen || []) {
        if (row.fingerprint) index.fingerprints.add(String(row.fingerprint));
      }
    }
  }

  const { data: proofs } = await admin
    .from('offline_payment_proofs')
    .select('utr,amount_paise,status')
    .eq('status', 'approved')
    .not('utr', 'is', null);

  for (const p of proofs || []) {
    const k = utrAmountKey(String(p.utr || ''), Number(p.amount_paise) || 0);
    if (k) index.utrAmount.add(k);
  }

  const { data: regs } = await admin
    .from('event_registrations')
    .select('bank_reference,amount_paid_paise,payment_status')
    .eq('payment_status', 'paid');

  for (const r of regs || []) {
    const ref = String(r.bank_reference || '').trim();
    const paid = Math.max(0, Number(r.amount_paid_paise) || 0);
    if (!ref || paid < 1) continue;
    const u = normalizeUpiRefNoInput(ref);
    if (u.length >= 10) {
      const k = utrAmountKey(u, paid);
      if (k) index.refAmount.add(k);
    }
    index.refAmount.add(`${ref.toLowerCase()}|${paid}`);
  }

  const { data: donations } = await admin
    .from('donations')
    .select('id,amount_paise,payment_status')
    .eq('payment_status', 'paid');

  const donationIds = (donations || []).map((d) => d.id).filter(Boolean);
  if (donationIds.length) {
    const { data: donProofs } = await admin
      .from('offline_payment_proofs')
      .select('donation_id,utr,amount_paise')
      .in('donation_id', donationIds)
      .eq('status', 'approved');
    for (const p of donProofs || []) {
      const k = utrAmountKey(String(p.utr || ''), Number(p.amount_paise) || 0);
      if (k) index.utrAmount.add(k);
    }
  }

  return index;
}

function reasonForCredit(
  credit: SibStatementCredit,
  fp: string,
  index: SettledIndex
): string | null {
  if (index.fingerprints.has(fp)) {
    return 'Marked settled from a prior statement upload';
  }
  for (const k of creditLookupKeys(credit)) {
    if (index.utrAmount.has(k)) return 'UTR / receipt already on an approved proof';
    if (index.refAmount.has(k)) return 'Reference and amount already on a paid registration';
  }
  return null;
}

export async function partitionSettledCredits(
  credits: SibStatementCredit[]
): Promise<PartitionSettledCredits> {
  const fps = credits.map(bankStatementCreditFingerprint);
  const index = await loadSettledIndex(fps);

  const to_match: SibStatementCredit[] = [];
  const already_settled: SettledCreditMeta[] = [];

  for (const credit of credits) {
    if (credit.kind === 'gateway') {
      to_match.push(credit);
      continue;
    }
    const fp = bankStatementCreditFingerprint(credit);
    const reason = reasonForCredit(credit, fp, index);
    if (reason) {
      already_settled.push({ credit, reason });
    } else {
      to_match.push(credit);
    }
  }

  return { to_match, already_settled };
}

export async function recordSettledCreditFingerprints(
  items: { fingerprint: string; stmt_date: string; amount_paise: number; rrn: string | null; line_key: string | null }[]
): Promise<void> {
  if (!items.length) return;
  const admin = createAdminClient();
  const rows = items.map((item) => ({
    fingerprint: item.fingerprint,
    stmt_date: item.stmt_date,
    amount_paise: item.amount_paise,
    rrn: item.rrn,
    line_key: item.line_key,
    settled_at: new Date().toISOString(),
  }));
  const { error } = await admin.from('bank_statement_settled_credits').upsert(rows, {
    onConflict: 'fingerprint',
    ignoreDuplicates: true,
  });
  if (error) {
    console.error('recordSettledCreditFingerprints', error);
  }
}