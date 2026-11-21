import type { BankStatementCandidate, BankStatementCreditResult } from '@/lib/admin/bank-statement-types';
import { formatCostForDisplay } from '@/lib/registration/registration';

/** Finance-controller open item status for imported bank credits. */
export type OpenItemStatus = 'SYSTEM' | 'EXCEPTION' | 'OPEN' | 'PROPOSED' | 'CLEARING';

export type ReviewFilter = 'all' | 'open' | 'clearing' | 'exception';

/** Status shown in the ledger (`inBatch` = clearing batch checkbox). */
export function ledgerStatus(row: BankStatementCreditResult, inBatch: boolean, lineKey: string): OpenItemStatus {
  if (row.credit.kind === 'gateway') return 'SYSTEM';
  if (!row.candidates.length) return 'EXCEPTION';
  if (!lineKey) return 'OPEN';
  return inBatch ? 'CLEARING' : 'PROPOSED';
}

const STATUS_META: Record<
  OpenItemStatus,
  { label: string; short: string; rowClass: string; badgeClass: string }
> = {
  SYSTEM: {
    label: 'System (gateway)',
    short: 'SYS',
    rowClass: 'bg-surface-container-low/60 text-on-surface-variant',
    badgeClass: 'bg-surface-container text-on-surface-variant',
  },
  EXCEPTION: {
    label: 'Exception — no receivable',
    short: 'EXC',
    rowClass: 'bg-error-container/10',
    badgeClass: 'bg-error-container text-error',
  },
  OPEN: {
    label: 'Open — assign receivable',
    short: 'OPEN',
    rowClass: 'bg-jubilee-gold-light/15',
    badgeClass: 'bg-jubilee-gold-light text-on-secondary-fixed-variant',
  },
  PROPOSED: {
    label: 'Proposed match — not in batch',
    short: 'PROP',
    rowClass: 'bg-surface-ivory',
    badgeClass: 'bg-surface-container text-on-surface',
  },
  CLEARING: {
    label: 'In clearing batch',
    short: 'CLR',
    rowClass: 'bg-secondary-container/12',
    badgeClass: 'bg-secondary-container text-on-secondary-fixed',
  },
};

export function statusMeta(status: OpenItemStatus) {
  return STATUS_META[status];
}

export function rowNeedsWork(
  row: BankStatementCreditResult,
  lineKey: string,
  inBatch: boolean
): boolean {
  if (row.credit.kind === 'gateway') return false;
  const status = ledgerStatus(row, inBatch, lineKey);
  return status === 'OPEN' || status === 'PROPOSED' || status === 'EXCEPTION';
}

export function rowPassesLedgerFilter(
  row: BankStatementCreditResult,
  lineKey: string,
  clearing: boolean,
  filter: ReviewFilter
): boolean {
  if (row.credit.kind === 'gateway') return filter === 'all';
  const status = ledgerStatus(row, clearing, lineKey);
  if (filter === 'exception') return status === 'EXCEPTION';
  if (filter === 'clearing') return status === 'CLEARING';
  if (filter === 'open') return status === 'OPEN' || status === 'PROPOSED' || status === 'EXCEPTION';
  return true;
}

export function candidateForLine(
  row: BankStatementCreditResult,
  lineKey: string
): BankStatementCandidate | null {
  if (!lineKey) return row.best;
  return row.candidates.find((c) => c.line_key === lineKey) ?? null;
}

export function openItemSummary(lineKey: string, candidate: BankStatementCandidate | null): string {
  if (!lineKey) return 'Unassigned';
  if (!candidate) return '—';
  const amt = candidate.closed_line
    ? formatCostForDisplay(candidate.amount_paise)
    : formatCostForDisplay(candidate.due_paise);
  const parts = [candidate.registration_code, candidate.payer_name, candidate.closed_line ? `Paid ${amt}` : `Due ${amt}`].filter(
    Boolean
  );
  return parts.join(' · ');
}