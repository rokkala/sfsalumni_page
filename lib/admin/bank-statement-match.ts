import type { ReceivableLine } from '@/lib/admin/receivable-lines';
import { loadReceivableLines } from '@/lib/admin/receivable-lines';
import type {
  BankStatementCandidate,
  BankStatementCreditResult,
  BankStatementMatchTier,
  BankStatementProofSummary,
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
  proofs: BankStatementProofSummary[];
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
  if (credit.rrn) {
    const r = normalizeUpiRefNoInput(credit.rrn);
    if (r.length >= 10 && bankRef && r === bankRef) {
      return `RRN ${r} matches bank reference`;
    }
    if (credit.rrn && proof && credit.rrn === proof) {
      return `RRN matches proof UTR`;
    }
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
    proofs: ctx.proofs,
  };
}

async function registrationIdsForPaymentRefs(refs: string[]): Promise<string[]> {
  const digits = [...new Set(refs.map(normalizeUpiRefNoInput).filter((r) => r.length >= 10))];
  if (!digits.length) return [];
  const admin = createAdminClient();
  const ids = new Set<string>();
  const { data: proofs } = await admin
    .from('offline_payment_proofs')
    .select('registration_id,utr')
    .in('utr', digits)
    .not('registration_id', 'is', null);
  for (const p of proofs || []) {
    const u = normalizeUpiRefNoInput(p.utr);
    if (digits.includes(u) && p.registration_id) ids.add(String(p.registration_id));
  }
  const { data: regs } = await admin
    .from('event_registrations')
    .select('id,bank_reference')
    .not('bank_reference', 'is', null);
  for (const r of regs || []) {
    const u = normalizeUpiRefNoInput(r.bank_reference);
    if (digits.includes(u)) ids.add(String(r.id));
  }
  return [...ids];
}

async function buildLineContexts(lines: ReceivableLine[]): Promise<LineContext[]> {
  const regIds = [...new Set(lines.map((l) => l.registration_id).filter(Boolean) as string[])];
  const donationIds = [...new Set(lines.map((l) => l.donation_id).filter(Boolean) as string[])];
  const proofIds = [...new Set(lines.map((l) => l.proof_id).filter(Boolean) as string[])];

  const admin = createAdminClient();
  const phoneMap = new Map<string, string | null>();
  const codeMap = new Map<string, string | null>();
  const proofUtrMap = new Map<string, string | null>();
  const proofUtrByReg = new Map<string, string | null>();
  const proofsByReg = new Map<string, BankStatementProofSummary[]>();
  const proofsByDon = new Map<string, BankStatementProofSummary[]>();

  function pushProof(
    map: Map<string, BankStatementProofSummary[]>,
    key: string,
    row: BankStatementProofSummary
  ): void {
    const list = map.get(key) || [];
    if (list.some((p) => p.id === row.id)) return;
    list.push(row);
    map.set(key, list);
  }

  const proofSelect =
    'id,registration_id,donation_id,utr,status,amount_paise,created_at,remittance_method,payment_date,admin_note';

  if (regIds.length) {
    const { data: regProofRows } = await admin
      .from('offline_payment_proofs')
      .select(proofSelect)
      .in('registration_id', regIds)
      .order('created_at', { ascending: false });
    for (const row of regProofRows || []) {
      const rid = String(row.registration_id || '');
      if (!rid) continue;
      pushProof(proofsByReg, rid, {
        id: String(row.id),
        utr: row.utr ? String(row.utr) : null,
        status: String(row.status || ''),
        amount_paise: Math.max(0, Number(row.amount_paise) || 0),
        created_at: String(row.created_at || ''),
        remittance_method: row.remittance_method ? String(row.remittance_method) : null,
        payment_date: row.payment_date ? String(row.payment_date) : null,
        admin_note: row.admin_note ? String(row.admin_note) : null,
      });
    }
  }

  if (donationIds.length) {
    const { data: donProofRows } = await admin
      .from('offline_payment_proofs')
      .select(proofSelect)
      .in('donation_id', donationIds)
      .order('created_at', { ascending: false });
    for (const row of donProofRows || []) {
      const did = String(row.donation_id || '');
      if (!did) continue;
      pushProof(proofsByDon, did, {
        id: String(row.id),
        utr: row.utr ? String(row.utr) : null,
        status: String(row.status || ''),
        amount_paise: Math.max(0, Number(row.amount_paise) || 0),
        created_at: String(row.created_at || ''),
        remittance_method: row.remittance_method ? String(row.remittance_method) : null,
        payment_date: row.payment_date ? String(row.payment_date) : null,
        admin_note: row.admin_note ? String(row.admin_note) : null,
      });
    }
  }

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

  if (regIds.length) {
    const { data: regProofs } = await admin
      .from('offline_payment_proofs')
      .select('registration_id,utr,status,created_at')
      .in('registration_id', regIds)
      .not('utr', 'is', null)
      .order('created_at', { ascending: false });
    for (const p of regProofs || []) {
      const rid = String(p.registration_id || '');
      if (!rid || proofUtrByReg.has(rid)) continue;
      if (p.status === 'pending' || p.status === 'approved') {
        proofUtrByReg.set(rid, p.utr ? String(p.utr) : null);
      }
    }
  }

  return lines.map((line) => {
    const proofs: BankStatementProofSummary[] = [];
    if (line.registration_id) {
      for (const p of proofsByReg.get(line.registration_id) || []) proofs.push(p);
    }
    if (line.donation_id) {
      for (const p of proofsByDon.get(line.donation_id) || []) {
        if (!proofs.some((x) => x.id === p.id)) proofs.push(p);
      }
    }
    return {
      line,
      phone: line.registration_id ? phoneMap.get(line.registration_id) ?? null : null,
      registration_code: line.registration_id ? codeMap.get(line.registration_id) ?? null : null,
      proof_utr: line.proof_id
        ? proofUtrMap.get(line.proof_id) ?? null
        : line.registration_id
          ? proofUtrByReg.get(line.registration_id) ?? null
          : null,
      proofs,
    };
  });
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
  const { lines: baseLines, error } = await loadReceivableLines({
    eventId: input.eventId,
    status: includeClosed ? 'all' : 'open',
  });
  if (error) return { results: [], error };

  const stmtRefs = [
    ...new Set(
      input.credits.flatMap((c) =>
        [...(c.receipt_refs || []), ...(c.rrn ? [c.rrn] : [])].filter(Boolean)
      )
    ),
  ];
  const refRegIds = await registrationIdsForPaymentRefs(stmtRefs);
  let lines = baseLines;
  const covered = new Set(baseLines.map((l) => l.registration_id).filter(Boolean));
  const missingRefRegs = refRegIds.filter((id) => !covered.has(id));
  if (missingRefRegs.length) {
    const { lines: allLines, error: allErr } = await loadReceivableLines({
      status: 'all',
    });
    if (!allErr) {
      const extra = allLines.filter(
        (l) => l.registration_id && missingRefRegs.includes(l.registration_id)
      );
      const seen = new Set(lines.map((l) => l.line_key));
      for (const row of extra) {
        if (!seen.has(row.line_key)) lines.push(row);
      }
    }
  }

  const contexts = await buildLineContexts(lines);
  const utrPinnedRegIds = new Set(refRegIds);
  const results: BankStatementCreditResult[] = [];

  for (const credit of input.credits) {
    if (credit.kind === 'gateway') {
      results.push({ credit, candidates: [], best: null });
      continue;
    }

    const candidates: BankStatementCandidate[] = [];
    for (const ctx of contexts) {
      const allowClosed =
        includeClosed ||
        Boolean(ctx.line.registration_id && utrPinnedRegIds.has(ctx.line.registration_id));
      const scored = scoreLine(credit, ctx, allowClosed);
      if (scored) candidates.push(scored);
    }

    candidates.sort((a, b) => b.match_score - a.match_score || a.payer_name.localeCompare(b.payer_name));

    const best = pickBest(candidates);
    results.push({ credit, candidates: candidates.slice(0, 15), best });
  }

  return { results, error: null };
}
