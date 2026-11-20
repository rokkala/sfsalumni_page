import type { ReceivableLine } from '@/lib/admin/receivable-lines';
import { loadReceivableLines } from '@/lib/admin/receivable-lines';
import { shortUpiPaymentRef, normalizeUpiRefNoInput } from '@/lib/payments/bank-details';
import { nameMatchScore, type SibStatementCredit } from '@/lib/admin/sib-statement-parse';
import { createAdminClient } from '@/lib/supabase-admin';

export type BankStatementMatchTier = 'high' | 'medium' | 'low' | 'none';

export type BankStatementCandidate = {
  line_key: string;
  kind: ReceivableLine['kind'];
  payer_name: string;
  payer_email: string;
  phone: string | null;
  due_paise: number;
  amount_paise: number;
  bank_reference: string | null;
  proof_id: string | null;
  registration_id: string | null;
  registration_code: string | null;
  tier: BankStatementMatchTier;
  match_score: number;
  reasons: string[];
};

export type BankStatementCreditResult = {
  credit: SibStatementCredit;
  candidates: BankStatementCandidate[];
  best: BankStatementCandidate | null;
};

type LineContext = {
  line: ReceivableLine;
  phone: string | null;
  registration_code: string | null;
  proof_utr: string | null;
};

function digitsOnly(s: string): string {
  return String(s || '').replace(/\D/g, '');
}

function phoneTail10(phone: string | null): string | null {
  const d = digitsOnly(phone || '');
  if (d.length >= 10) return d.slice(-10);
  return d.length ? d : null;
}

function sfsKeysForRegistration(registrationId: string): string[] {
  const ref = shortUpiPaymentRef(registrationId);
  if (!ref) return [];
  const body = ref.replace(/^SFS/i, '').toLowerCase();
  return body ? [body] : [];
}

function sfsTokenMatchesRegistration(sfsTokens: string[], registrationId: string | null): string | null {
  if (!registrationId || !sfsTokens.length) return null;
  const keys = sfsKeysForRegistration(registrationId);
  for (const token of sfsTokens) {
    const t = token.toLowerCase();
    for (const key of keys) {
      if (key.startsWith(t) || t.startsWith(key.slice(0, Math.max(3, t.length)))) {
        return `SFS ${token} ↔ ${shortUpiPaymentRef(registrationId)}`;
      }
    }
  }
  return null;
}

function receiptMatchesLine(
  credit: SibStatementCredit,
  line: ReceivableLine,
  proofUtr: string | null
): string | null {
  const refs = credit.receipt_refs || [];
  const bankRef = normalizeUpiRefNoInput(line.bank_reference || '');
  const proof = normalizeUpiRefNoInput(proofUtr || '');

  for (const raw of refs) {
    const r = normalizeUpiRefNoInput(raw);
    if (r.length >= 10 && bankRef && (r === bankRef || bankRef.includes(r) || r.includes(bankRef))) {
      return `Receipt ref ${r} matches bank reference`;
    }
    if (r.length >= 10 && proof && (r === proof || proof.includes(r))) {
      return `Receipt ref ${r} matches pending proof UTR`;
    }
    if (line.bank_reference && line.bank_reference.includes(raw)) {
      return `Receipt ref matches narration on file`;
    }
  }
  if (credit.rrn && proof && credit.rrn === proof) {
    return `RRN matches proof UTR`;
  }
  return null;
}

function scoreLine(credit: SibStatementCredit, ctx: LineContext): BankStatementCandidate | null {
  const line = ctx.line;
  if (line.due_paise < 1) return null;

  let score = 0;
  const reasons: string[] = [];

  const receiptHit = receiptMatchesLine(credit, line, ctx.proof_utr);
  if (receiptHit) {
    score += 120;
    reasons.push(receiptHit);
  }

  const sfsHit = sfsTokenMatchesRegistration(credit.sfs_tokens, line.registration_id);
  if (sfsHit) {
    score += 90;
    reasons.push(sfsHit);
  }

  const code = ctx.registration_code?.trim().toUpperCase();
  if (code) {
    const blob = credit.particulars.toUpperCase();
    if (blob.includes(code) || blob.includes(code.replace('-', ''))) {
      score += 95;
      reasons.push(`Registration code ${code} in narration`);
    }
  }

  if (credit.payer_name && line.payer_name) {
    const ns = nameMatchScore(credit.payer_name, line.payer_name);
    if (ns >= 2) {
      score += 35 + ns * 10;
      reasons.push(`Name match (${ns} tokens)`);
    } else if (ns === 1) {
      score += 12;
      reasons.push('Partial name match');
    }
  }

  const phoneTail = phoneTail10(ctx.phone);
  if (phoneTail && credit.particulars.replace(/\D/g, '').includes(phoneTail)) {
    score += 80;
    reasons.push('Phone digits in narration');
  }

  if (credit.amount_paise === line.due_paise) {
    score += 55;
    reasons.push('Amount matches amount due');
  } else if (credit.amount_paise === line.amount_paise) {
    score += 35;
    reasons.push('Amount matches line total (check fee vs gift)');
  } else {
    const diff = Math.abs(credit.amount_paise - line.due_paise);
    if (diff <= 100) {
      score += 15;
      reasons.push('Amount within ₹1 of due');
    } else {
      score -= 15;
      reasons.push(`Amount ₹${(credit.amount_paise / 100).toFixed(2)} vs due ₹${(line.due_paise / 100).toFixed(2)}`);
    }
  }

  if (score < 20) return null;

  let tier: BankStatementMatchTier = 'low';
  if (score >= 100) tier = 'high';
  else if (score >= 55) tier = 'medium';

  return {
    line_key: line.line_key,
    kind: line.kind,
    payer_name: line.payer_name,
    payer_email: line.payer_email,
    phone: ctx.phone,
    due_paise: line.due_paise,
    amount_paise: line.amount_paise,
    bank_reference: line.bank_reference,
    proof_id: line.proof_id,
    registration_id: line.registration_id,
    registration_code: ctx.registration_code,
    tier,
    match_score: score,
    reasons,
  };
}

async function buildLineContexts(lines: ReceivableLine[]): Promise<LineContext[]> {
  const regIds = [...new Set(lines.map((l) => l.registration_id).filter(Boolean) as string[])];
  const proofIds = [...new Set(lines.map((l) => l.proof_id).filter(Boolean) as string[])];

  const admin = createAdminClient();
  const phoneMap = new Map<string, string | null>();
  const codeMap = new Map<string, string | null>();
  const proofUtrMap = new Map<string, string | null>();

  if (regIds.length) {
    const { data } = await admin
      .from('event_registrations')
      .select('id,phone_number,registration_code')
      .in('id', regIds);
    for (const row of data || []) {
      phoneMap.set(String(row.id), row.phone_number ? String(row.phone_number) : null);
      codeMap.set(
        String(row.id),
        row.registration_code ? String(row.registration_code) : null
      );
    }
  }

  if (proofIds.length) {
    const { data } = await admin
      .from('offline_payment_proofs')
      .select('id,utr')
      .in('id', proofIds);
    for (const row of data || []) {
      proofUtrMap.set(String(row.id), row.utr ? String(row.utr) : null);
    }
  }

  return lines.map((line) => ({
    line,
    phone: line.registration_id ? phoneMap.get(line.registration_id) ?? null : null,
    registration_code: line.registration_id ? codeMap.get(line.registration_id) ?? null : null,
    proof_utr: line.proof_id ? proofUtrMap.get(line.proof_id) ?? null : null,
  }));
}

function pickBest(candidates: BankStatementCandidate[]): BankStatementCandidate | null {
  if (!candidates.length) return null;
  const sorted = [...candidates].sort((a, b) => b.match_score - a.match_score);
  const top = sorted[0];
  const second = sorted[1];
  if (top.tier === 'high' && (!second || top.match_score - second.match_score >= 25)) {
    return top;
  }
  if (top.match_score >= 100 && (!second || top.match_score > second.match_score)) {
    return top;
  }
  if (candidates.length === 1 && top.tier !== 'low') return top;
  if (top.tier === 'medium' && top.match_score >= 70 && (!second || top.match_score - second.match_score >= 20)) {
    return top;
  }
  return top.tier === 'high' ? top : null;
}

export async function matchStatementCredits(input: {
  credits: SibStatementCredit[];
  eventId?: string;
}): Promise<{ results: BankStatementCreditResult[]; error: string | null }> {
  const { lines, error } = await loadReceivableLines({
    eventId: input.eventId,
    status: 'open',
  });
  if (error) return { results: [], error };

  const contexts = await buildLineContexts(lines);
  const results: BankStatementCreditResult[] = [];

  for (const credit of input.credits) {
    if (credit.kind === 'gateway') {
      results.push({ credit, candidates: [], best: null });
      continue;
    }

    const candidates: BankStatementCandidate[] = [];
    for (const ctx of contexts) {
      const scored = scoreLine(credit, ctx);
      if (scored) candidates.push(scored);
    }

    candidates.sort((a, b) => b.match_score - a.match_score || a.payer_name.localeCompare(b.payer_name));

    const best = pickBest(candidates);
    results.push({ credit, candidates: candidates.slice(0, 15), best });
  }

  return { results, error: null };
}

/** For modal: auto-select rows safe to pre-check. */
export function autoSelectLineKeys(results: BankStatementCreditResult[]): Map<string, string> {
  const next = new Map<string, string>();
  for (const r of results) {
    if (r.credit.kind !== 'credit' || !r.best) continue;
    if (r.best.tier === 'high' || (r.best.tier === 'medium' && r.best.match_score >= 65)) {
      next.set(r.credit.credit_id, r.best.line_key);
    }
  }
  return next;
}