import type { ReceivableLine } from '@/lib/admin/receivable-lines';
import { loadReceivableLines } from '@/lib/admin/receivable-lines';
import type {
  BankStatementCandidate,
  BankStatementCreditResult,
  BankStatementMatchTier,
} from '@/lib/admin/bank-statement-types';
import { shortUpiPaymentRef, normalizeUpiRefNoInput } from '@/lib/payments/bank-details';
import { nameMatchScore, type SibStatementCredit } from '@/lib/admin/sib-statement-parse';
import { createAdminClient } from '@/lib/supabase-admin';

export type {
  BankStatementCandidate,
  BankStatementCreditResult,
  BankStatementMatchTier,
} from '@/lib/admin/bank-statement-types';

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

function scoreAmount(
  credit: SibStatementCredit,
  line: ReceivableLine,
  closed: boolean,
  reasons: string[]
): number {
  let score = 0;
  if (closed) {
    const target = line.settled_paise > 0 ? line.settled_paise : line.amount_paise;
    if (credit.amount_paise === target) {
      score += 55;
      reasons.push('Amount matches settled total (paid line)');
    } else if (credit.amount_paise === line.amount_paise) {
      score += 45;
      reasons.push('Amount matches line total (paid line)');
    } else {
      const diff = Math.abs(credit.amount_paise - target);
      if (diff <= 100) {
        score += 15;
        reasons.push('Amount within ₹1 of settled');
      } else {
        score -= 15;
        reasons.push(
          `Amount ₹${(credit.amount_paise / 100).toFixed(2)} vs settled ₹${(target / 100).toFixed(2)}`
        );
      }
    }
    return score;
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
  return score;
}

function scoreLine(
  credit: SibStatementCredit,
  ctx: LineContext,
  includeClosedLines: boolean
): BankStatementCandidate | null {
  const line = ctx.line;
  const closed = line.due_paise < 1;
  if (closed) {
    if (!includeClosedLines) return null;
    if (line.payment_status !== 'paid' && line.settled_paise < 1) return null;
  }

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

  score += scoreAmount(credit, line, closed, reasons);
  if (closed) {
    reasons.unshift('Paid receivable line (preview only)');
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
    closed_line: closed,
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
  includeClosedLines?: boolean;
}): Promise<{ results: BankStatementCreditResult[]; error: string | null }> {
  const includeClosed = Boolean(input.includeClosedLines);
  const { lines, error } = await loadReceivableLines({
    eventId: input.eventId,
    status: includeClosed ? 'all' : 'open',
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
      const scored = scoreLine(credit, ctx, includeClosed);
      if (scored) candidates.push(scored);
    }

    candidates.sort((a, b) => b.match_score - a.match_score || a.payer_name.localeCompare(b.payer_name));

    const best = pickBest(candidates);
    results.push({ credit, candidates: candidates.slice(0, 15), best });
  }

  return { results, error: null };
}
