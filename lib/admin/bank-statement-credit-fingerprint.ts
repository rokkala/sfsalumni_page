import type { SibStatementCredit } from '@/lib/admin/sib-statement-parse';

/** Stable key for the same bank row across daily full-month PDF re-uploads. */
export function bankStatementCreditFingerprint(credit: SibStatementCredit): string {
  const rrn = credit.rrn || credit.receipt_refs[0] || '';
  const sfs = credit.sfs_tokens[0] || '';
  const narration = credit.particulars
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 160);
  return [credit.stmt_date, String(credit.amount_paise), rrn, sfs, narration].join('|');
}