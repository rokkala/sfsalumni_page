import type { SibStatementCredit } from '@/lib/admin/sib-statement-parse';
import type { ReceivableLine } from '@/lib/admin/receivable-lines';

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
  /** Paid / no amount due — preview only when include-closed toggle is on. */
  closed_line: boolean;
};

export type BankStatementCreditResult = {
  credit: SibStatementCredit;
  candidates: BankStatementCandidate[];
  best: BankStatementCandidate | null;
};

export function autoSelectLineKeys(results: BankStatementCreditResult[]): Map<string, string> {
  const next = new Map<string, string>();
  for (const r of results) {
    if (r.credit.kind !== 'credit' || !r.best || r.best.closed_line) continue;
    if (r.best.tier === 'high' || (r.best.tier === 'medium' && r.best.match_score >= 65)) {
      next.set(r.credit.credit_id, r.best.line_key);
    }
  }
  return next;
}