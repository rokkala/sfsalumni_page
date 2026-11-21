import { candidateForLine } from '@/lib/admin/bank-statement-review-state';
import type { BankStatementCreditResult } from '@/lib/admin/bank-statement-types';
import { formatCostForDisplay } from '@/lib/registration/registration';

function escCsv(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** Download CSV of lines in the clearing batch (audit before post). */
export function downloadClearingBatchCsv(
  rows: BankStatementCreditResult[],
  selected: Map<string, string>,
  clearingBatch: Set<string>,
  accountNumber: string | null
): void {
  const header = [
    'stmt_date',
    'bank_ref',
    'bank_amount_inr',
    'narration',
    'line_key',
    'registration_code',
    'payer_name',
    'receivable_due_inr',
    'receivable_ref',
  ];
  const body: string[] = [header.join(',')];

  for (const row of rows) {
    if (row.credit.kind !== 'credit') continue;
    const id = row.credit.credit_id;
    if (!clearingBatch.has(id)) continue;
    const lineKey = selected.get(id) || '';
    if (!lineKey) continue;
    const cand = candidateForLine(row, lineKey);
    const ref = row.credit.receipt_refs[0] || row.credit.rrn || '';
    body.push(
      [
        row.credit.stmt_date,
        ref,
        formatCostForDisplay(row.credit.amount_paise),
        row.credit.particulars.replace(/\s+/g, ' ').trim(),
        lineKey,
        cand?.registration_code ?? '',
        cand?.payer_name ?? '',
        cand ? formatCostForDisplay(cand.closed_line ? cand.amount_paise : cand.due_paise) : '',
        cand?.bank_reference ?? '',
      ]
        .map((c) => escCsv(String(c)))
        .join(',')
    );
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const acct = accountNumber ? `_acct_${accountNumber.replace(/\W/g, '')}` : '';
  const blob = new Blob([body.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bank_clearing_batch${acct}_${stamp}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}