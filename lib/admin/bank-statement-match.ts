import type { ReceivableLine } from '@/lib/admin/receivable-lines';
import { loadReceivableLines } from '@/lib/admin/receivable-lines';
import { shortUpiPaymentRef } from '@/lib/payments/bank-details';
import { normalizeUpiRefNoInput } from '@/lib/payments/bank-details';
import {
  type SibStatementCredit,
  nameMatchScore,
} from '@/lib/admin/sib-statement-parse';
import { createAdminClient } from '@/lib/supabase-admin';

export type BankStatementMatchTier = 'high' | 'medium' | 'low' | 'none';

export type BankStatementCandidate = {
  line_key: string;
  kind: ReceivableLine['kind'];
  payer_name: string;
  payer_email: string;
  phone: string | null;
  due_paise: number;
  bank_reference: string | null;
  proof_id: string | null;
  registration_id: string | null;
  tier: BankStatementMatchTier;
  reasons: string[];
};

export type BankStatementCreditResult = {
  credit: SibStatementCredit;
  candidates: BankStatementCandidate[];
  best: BankStatementCandidate | null;
};

function sfsKeysForRegistration(registrationId: string): string[] {
  const ref = shortUpiPaymentRef(registrationId);
  if (!ref) return [];
  const body = ref.replace(/^SFS/i, '').toLowerCase();
  return body ? [body] : [];
}

function refMatchesLine(
  line: ReceivableLine,
  rrn: string | null,
  sfsTokens: string[]
): { hit: boolean; reason: string | null } {
  const utr = line.bank_reference ? normalizeUpiRefNoInput(line.bank_reference) : '';
  if (rrn && utr.length === 12 && rrn === utr) {
    return { hit: true, reason: `RRN matches ref ${utr}` };
  }
  if (rrn && line.bank_reference && line.bank_reference.includes(rrn)) {
    return { hit: true, reason: `RRN matches bank reference` };
  }
  const regId = line.registration_id;
  if (regId && sfsTokens.length) {
    const keys = sfsKeysForRegistration(regId);
    for (const token of sfsTokens) {
      const t = token.toLowerCase();
      for (const key of keys) {
        if (key.startsWith(t) || t.startsWith(key.slice(0, t.length))) {
          return { hit: true, reason: `SFS code matches registration ref` };
        }
      }
    }
  }
  return { hit: false, reason: null };
}

function scoreLine(
  credit: SibStatementCredit,
  line: ReceivableLine,
  phone: string | null
): BankStatementCandidate | null {
  if (line.due_paise < 1) return null;
  if (credit.amount_paise !== line.due_paise) return null;

  const reasons: string[] = [];
  let tier: BankStatementMatchTier = 'low';

  const ref = refMatchesLine(line, credit.rrn, credit.sfs_tokens);
  if (ref.hit && ref.reason) {
    reasons.push(ref.reason);
    tier = 'high';
  }

  if (credit.payer_name && line.payer_name) {
    const score = nameMatchScore(credit.payer_name, line.payer_name);
    if (score >= 2) {
      reasons.push(`Name match (${score} tokens)`);
      if (tier !== 'high') tier = 'medium';
    } else if (score === 1 && tier === 'low') {
      reasons.push('Weak name overlap');
    }
  }

  if (reasons.length === 0) {
    reasons.push('Amount matches due only');
  }

  return {
    line_key: line.line_key,
    kind: line.kind,
    payer_name: line.payer_name,
    payer_email: line.payer_email,
    phone,
    due_paise: line.due_paise,
    bank_reference: line.bank_reference,
    proof_id: line.proof_id,
    registration_id: line.registration_id,
    tier,
    reasons,
  };
}

async function phonesByRegistration(
  registrationIds: string[]
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  if (!registrationIds.length) return map;
  const admin = createAdminClient();
  const { data } = await admin
    .from('event_registrations')
    .select('id,phone_number')
    .in('id', registrationIds);
  for (const row of data || []) {
    map.set(String(row.id), row.phone_number ? String(row.phone_number) : null);
  }
  return map;
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

  const regIds = [
    ...new Set(lines.map((l) => l.registration_id).filter(Boolean) as string[]),
  ];
  const phones = await phonesByRegistration(regIds);

  const results: BankStatementCreditResult[] = [];

  for (const credit of input.credits) {
    if (credit.kind === 'gateway') {
      results.push({ credit, candidates: [], best: null });
      continue;
    }

    const candidates: BankStatementCandidate[] = [];
    for (const line of lines) {
      const phone = line.registration_id ? phones.get(line.registration_id) ?? null : null;
      const scored = scoreLine(credit, line, phone);
      if (scored) candidates.push(scored);
    }

    candidates.sort((a, b) => {
      const tierOrder = { high: 0, medium: 1, low: 2, none: 3 };
      const d = tierOrder[a.tier] - tierOrder[b.tier];
      if (d !== 0) return d;
      return a.payer_name.localeCompare(b.payer_name);
    });

    const highs = candidates.filter((c) => c.tier === 'high');
    const best =
      highs.length === 1
        ? highs[0]
        : candidates.length === 1 && candidates[0].tier !== 'low'
          ? candidates[0]
          : highs[0] ?? null;

    results.push({ credit, candidates: candidates.slice(0, 8), best });
  }

  return { results, error: null };
}