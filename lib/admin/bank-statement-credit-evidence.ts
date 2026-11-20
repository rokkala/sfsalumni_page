import type { SibStatementCredit } from '@/lib/admin/sib-statement-parse';

export type CreditEvidenceItem = {
  id: string;
  label: string;
  value: string;
  hint?: string;
};

/** Bank / gateway fragments mistaken for payer names in narration. */
export function isBankRailPayerLabel(name: string | null | undefined): boolean {
  const n = String(name || '').trim();
  if (!n) return false;
  return (
    /^SBM\s+P2A/i.test(n) ||
    /^API\s+BANKING/i.test(n) ||
    /^CASHFREE/i.test(n) ||
    /\/PAYOUT$/i.test(n)
  );
}

/** Structured fields parsed from a statement credit for admin review. */
export function creditEvidenceItems(credit: SibStatementCredit): CreditEvidenceItem[] {
  const items: CreditEvidenceItem[] = [];
  const head = credit.particulars.split('/')[0]?.trim();
  const channel = head?.toUpperCase() || '';
  if (head) {
    items.push({ id: 'channel', label: 'Channel', value: head });
  }
  const refLabel =
    channel === 'UPI'
      ? 'UPI RRN / receipt ref (match vs receivable Ref)'
      : channel === 'IMPS'
        ? 'IMPS transaction ref (match vs receivable Ref)'
        : 'Receipt ref (match vs receivable Ref)';
  if (credit.receipt_refs.length) {
    items.push({
      id: 'refs',
      label: refLabel,
      value: credit.receipt_refs.join(', '),
    });
  }
  if (credit.rrn && !credit.receipt_refs.includes(credit.rrn)) {
    items.push({
      id: 'rrn',
      label: 'UPI RRN (match vs receivable Ref)',
      value: credit.rrn,
    });
  }
  if (credit.sfs_tokens.length) {
    items.push({
      id: 'sfs',
      label: 'SFS code in narration',
      value: credit.sfs_tokens.map((t) => `SFS${t}`).join(', '),
    });
  }
  if (credit.payer_name) {
    const rail = isBankRailPayerLabel(credit.payer_name);
    items.push({
      id: 'payer',
      label: rail ? 'Narration text (not a member name)' : 'Member name in narration',
      value: credit.payer_name,
      hint: rail
        ? 'This line has no person name — match using ref, SFS code, amount, or receivable UTR.'
        : undefined,
    });
  }
  return items;
}