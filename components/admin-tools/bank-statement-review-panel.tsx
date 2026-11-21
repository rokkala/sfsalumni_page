'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { formatCostForDisplay } from '@/lib/registration/registration';
import type {
  BankStatementCandidate,
  BankStatementCreditResult,
  BankStatementMatchTier,
} from '@/lib/admin/bank-statement-types';
import {
  candidateForLine,
  ledgerStatus,
  rowPassesLedgerFilter,
  type ReviewFilter,
} from '@/lib/admin/bank-statement-review-state';
import { RegistrationQuickViewModal } from '@/components/admin-tools/registration-quick-view-modal';

const inr = (paise: number) => formatCostForDisplay(paise);

function tierLabel(tier: BankStatementMatchTier): string {
  if (tier === 'high') return 'Strong match';
  if (tier === 'medium') return 'Likely match';
  if (tier === 'low') return 'Weak match';
  return 'No match';
}

function tierClass(tier: BankStatementMatchTier): string {
  if (tier === 'high') return 'bg-secondary-container text-on-secondary-fixed';
  if (tier === 'medium') return 'bg-jubilee-gold-light text-on-secondary-fixed-variant';
  return 'bg-surface-container text-on-surface-variant';
}

function regRef(candidate: BankStatementCandidate): string {
  if (candidate.bank_reference) return candidate.bank_reference;
  return candidate.proofs.find((p) => p.utr)?.utr || '—';
}

function candidateOptions(row: BankStatementCreditResult, includeClosedLines: boolean): BankStatementCandidate[] {
  const list = includeClosedLines ? row.candidates : row.candidates.filter((c) => !c.closed_line);
  return [...list].sort((a, b) => b.match_score - a.match_score);
}

function shortlistForPicker(
  row: BankStatementCreditResult,
  includeClosedLines: boolean,
  selectedLineKey: string
): BankStatementCandidate[] {
  const list = candidateOptions(row, includeClosedLines);
  const strong = list.filter((c) => c.match_score >= 50 || c.tier === 'high' || c.tier === 'medium');
  let base = (strong.length ? strong : list.slice(0, 5)).slice(0, 8);
  if (selectedLineKey && !base.some((c) => c.line_key === selectedLineKey)) {
    const hit = list.find((c) => c.line_key === selectedLineKey);
    if (hit) base = [hit, ...base].slice(0, 8);
  }
  return base;
}

type SettledPreview = {
  credit: import('@/lib/admin/sib-statement-parse').SibStatementCredit;
  fingerprint: string;
  reason: string;
};

type ReviewPanelProps = {
  rows: BankStatementCreditResult[];
  selected: Map<string, string>;
  clearingBatch: Set<string>;
  reviewFilter: ReviewFilter;
  onFilterChange: (f: ReviewFilter) => void;
  activeCreditId: string | null;
  onActiveChange: (id: string) => void;
  onPick: (creditId: string, lineKey: string) => void;
  onToggleBatch: (creditId: string, on: boolean) => void;
  includeClosedLines: boolean;
  accountNumber: string | null;
  readyCount: number;
  actionCount: number;
  approveCount: number;
  includeClosedEnabled: boolean;
  onIncludeClosedChange: (on: boolean) => void;
  rematchBusy: boolean;
  alreadySettled: SettledPreview[];
  onExportBatch: () => void;
};

function plainStatus(
  row: BankStatementCreditResult,
  lineKey: string,
  inBatch: boolean
): { label: string; tone: 'ok' | 'warn' | 'bad' | 'neutral' } {
  const st = ledgerStatus(row, inBatch, lineKey);
  if (st === 'EXCEPTION') return { label: 'No registration found — link manually', tone: 'bad' };
  if (st === 'CLEARING') return { label: 'Will mark as paid when you approve below', tone: 'ok' };
  if (!lineKey && row.best && !row.best.closed_line) {
    return { label: `Suggested: ${row.best.payer_name}`, tone: 'warn' };
  }
  if (lineKey && !inBatch) return { label: 'Linked — tick Mark paid if correct', tone: 'warn' };
  if (st === 'OPEN') return { label: 'Pick who paid this deposit', tone: 'neutral' };
  return { label: 'Review this line', tone: 'neutral' };
}

export function BankStatementReviewPanel({
  rows,
  selected,
  clearingBatch,
  reviewFilter,
  onFilterChange,
  onPick,
  onToggleBatch,
  includeClosedLines,
  accountNumber,
  readyCount,
  actionCount,
  approveCount,
  includeClosedEnabled,
  onIncludeClosedChange,
  rematchBusy,
  alreadySettled,
  onExportBatch,
}: ReviewPanelProps) {
  const [showGateway, setShowGateway] = useState(false);
  const [showDbSettled, setShowDbSettled] = useState(false);
  const [expandPickId, setExpandPickId] = useState<string | null>(null);
  const [regViewId, setRegViewId] = useState<string | null>(null);

  const memberRows = useMemo(() => rows.filter((r) => r.credit.kind === 'credit'), [rows]);
  const gatewayRows = useMemo(() => rows.filter((r) => r.credit.kind === 'gateway'), [rows]);

  const visibleRows = useMemo(() => {
    const base = showGateway ? [...memberRows, ...gatewayRows] : memberRows;
    return base.filter((row) => {
      const id = row.credit.credit_id;
      const lineKey = selected.get(id) || '';
      return rowPassesLedgerFilter(row, lineKey, clearingBatch.has(id), reviewFilter);
    });
  }, [memberRows, gatewayRows, showGateway, reviewFilter, selected, clearingBatch]);

  const totals = useMemo(() => {
    let credits = 0;
    let batchPaise = 0;
    let exc = 0;
    for (const row of memberRows) {
      credits += row.credit.amount_paise;
      const id = row.credit.credit_id;
      const lineKey = selected.get(id) || '';
      const st = ledgerStatus(row, clearingBatch.has(id), lineKey);
      if (st === 'CLEARING') batchPaise += row.credit.amount_paise;
      if (st === 'EXCEPTION') exc += 1;
    }
    return { credits, batchPaise, exc };
  }, [memberRows, selected, clearingBatch]);

  const filters: { id: ReviewFilter; label: string; count: number }[] = [
    { id: 'all', label: 'All deposits', count: memberRows.length },
    { id: 'open', label: 'Needs your review', count: actionCount },
    { id: 'clearing', label: 'Marked to pay', count: readyCount },
    { id: 'exception', label: 'Unmatched', count: totals.exc },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <ol className="list-decimal space-y-1 rounded-xl border border-primary/15 bg-primary/5 px-4 py-3 pl-8 text-body-sm text-on-surface">
        <li>Each card is one <strong>bank deposit</strong> — confirm it belongs to the right alumni.</li>
        <li>
          Tap <strong>Use this match</strong> or pick someone else, then tick <strong>Mark paid</strong>.
        </li>
        <li>
          When done, click <strong>Mark selected as paid</strong> at the bottom ({approveCount} selected,{' '}
          {inr(totals.batchPaise)}).
        </li>
      </ol>

      <div className="rounded-lg border border-outline-variant bg-white px-4 py-3 text-label-sm">
        <p className="font-semibold text-on-surface">
          {memberRows.length} deposit{memberRows.length === 1 ? '' : 's'} on statement
          {accountNumber ? (
            <>
              {' '}
              · account <span className="font-mono">{accountNumber}</span>
            </>
          ) : null}
        </p>
        <p className="text-on-surface-variant">Total credits {inr(totals.credits)}</p>
        <details className="mt-2">
          <summary className="cursor-pointer font-semibold text-primary">More options</summary>
          <div className="mt-2 flex flex-wrap gap-3 pt-1">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={includeClosedEnabled}
                disabled={rematchBusy}
                onChange={(e) => onIncludeClosedChange(e.target.checked)}
              />
              Show already-paid receivable lines
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={showGateway}
                onChange={(e) => setShowGateway(e.target.checked)}
              />
              Show gateway batches
            </label>
            {alreadySettled.length > 0 ? (
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={showDbSettled}
                  onChange={(e) => setShowDbSettled(e.target.checked)}
                />
                Show skipped (already in system)
              </label>
            ) : null}
            <button
              type="button"
              disabled={approveCount < 1}
              onClick={onExportBatch}
              className="cursor-pointer rounded-md border border-outline-variant px-2 py-1 font-semibold disabled:opacity-50"
            >
              Export CSV
            </button>
          </div>
        </details>
      </div>

      <div className="flex flex-wrap gap-1 rounded-lg border border-outline-variant bg-surface-ivory p-1" role="tablist">
        {filters.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={reviewFilter === f.id}
            onClick={() => onFilterChange(f.id)}
            className={`cursor-pointer rounded-md px-3 py-1.5 text-label-sm font-semibold ${
              reviewFilter === f.id ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:bg-white'
            }`}
          >
            {f.label} ({f.count})
          </button>
        ))}
      </div>

      {showDbSettled && alreadySettled.length > 0 ? (
        <ul className="max-h-20 overflow-y-auto rounded-lg border border-outline-variant bg-surface-container-low p-2 text-label-sm text-on-surface-variant">
          {alreadySettled.map((item) => (
            <li key={item.fingerprint}>
              Skipped {item.credit.stmt_date} {inr(item.credit.amount_paise)} — {item.reason}
            </li>
          ))}
        </ul>
      ) : null}

      <ul className="min-h-0 flex-1 space-y-3 overflow-y-auto pb-2">
        {visibleRows.map((row) => {
          const credit = row.credit;
          const id = credit.credit_id;
          const lineKey = selected.get(id) || '';
          const inBatch = clearingBatch.has(id);
          const picked = lineKey ? candidateForLine(row, lineKey) : null;
          const suggestion = !lineKey && row.best && !row.best.closed_line ? row.best : null;
          const active = picked ?? suggestion;
          const bankRef = credit.receipt_refs[0] || credit.rrn || '—';
          const status = plainStatus(row, lineKey, inBatch);
          const canPost = Boolean(picked && !picked.closed_line);
          const expanded = expandPickId === id;
          const alternatives = shortlistForPicker(row, includeClosedLines, lineKey);

          if (credit.kind === 'gateway') {
            return (
              <li
                key={id}
                className="rounded-xl border border-outline-variant bg-surface-container-low px-4 py-3 text-label-sm text-on-surface-variant"
              >
                Gateway settlement {inr(credit.amount_paise)} · {credit.stmt_date} — not linked to a member
              </li>
            );
          }

          const toneBorder =
            status.tone === 'ok'
              ? 'border-secondary-fixed/50'
              : status.tone === 'bad'
                ? 'border-error/40'
                : status.tone === 'warn'
                  ? 'border-jubilee-gold-deep/40'
                  : 'border-outline-variant';

          return (
            <li
              key={id}
              className={`rounded-xl border-2 bg-white shadow-sm ${toneBorder}`}
            >
              <div className="flex flex-wrap items-start gap-3 border-b border-outline-variant/60 px-4 py-3">
                <label className="flex cursor-pointer items-center gap-2 pt-0.5">
                  <input
                    type="checkbox"
                    className="size-5 accent-primary"
                    checked={inBatch}
                    disabled={!canPost}
                    onChange={(e) => onToggleBatch(id, e.target.checked)}
                  />
                  <span className="text-label-sm font-bold text-on-surface">Mark paid</span>
                </label>
                <p className="flex-1 text-label-sm text-on-surface-variant">{status.label}</p>
                {active ? (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[0.65rem] font-bold uppercase ${tierClass(active.tier)}`}
                  >
                    {tierLabel(active.tier)}
                  </span>
                ) : null}
              </div>

              <div className="grid gap-4 px-4 py-4 md:grid-cols-[1fr_auto_1fr] md:items-center">
                <div className="space-y-1">
                  <p className="text-[0.65rem] font-bold uppercase text-on-surface-variant">Money in (bank)</p>
                  <p className="text-headline-sm font-bold tabular-nums text-on-surface">{inr(credit.amount_paise)}</p>
                  <p className="tabular-nums text-label-sm text-on-surface-variant">{credit.stmt_date}</p>
                  <p className="font-mono text-[0.72rem] break-all text-primary">Ref {bankRef}</p>
                </div>

                <p className="hidden text-2xl text-on-surface-variant md:block" aria-hidden>
                  →
                </p>

                <div className="space-y-1 md:border-l md:border-outline-variant/60 md:pl-4">
                  <p className="text-[0.65rem] font-bold uppercase text-on-surface-variant">
                    {picked ? 'Linked registration' : suggestion ? 'We suggest' : 'Registration'}
                  </p>
                  {active ? (
                    <>
                      <p className="text-body-md font-semibold text-on-surface">{active.payer_name}</p>
                      <p className="text-label-sm">
                        {active.registration_code ? (
                          <span className="font-mono font-bold">{active.registration_code}</span>
                        ) : null}
                        {active.registration_code ? ' · ' : ''}
                        Due {inr(active.closed_line ? active.amount_paise : active.due_paise)}
                      </p>
                      <p className="font-mono text-[0.72rem] break-all text-on-surface-variant">
                        Their ref {regRef(active)}
                      </p>
                      {active.proofs[0] ? (
                        <Link href="/admin/remittance-proofs" className="text-label-sm font-semibold text-primary underline">
                          View uploaded proof ({active.proofs[0].status})
                        </Link>
                      ) : (
                        <p className="text-label-sm text-on-surface-variant">No proof uploaded</p>
                      )}
                    </>
                  ) : (
                    <p className="text-body-sm text-on-surface-variant">
                      No automatic match.{' '}
                      <Link href="/admin/receivables" className="font-semibold text-primary underline">
                        Search receivables
                      </Link>
                    </p>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-2 border-t border-outline-variant/60 bg-surface-ivory/50 px-4 py-3">
                {suggestion && !lineKey ? (
                  <button
                    type="button"
                    className="cursor-pointer rounded-lg bg-primary px-4 py-2 text-label-sm font-bold text-on-primary"
                    onClick={() => {
                      onPick(id, suggestion.line_key);
                      setExpandPickId(null);
                    }}
                  >
                    Use this match
                  </button>
                ) : null}
                {alternatives.length > 0 ? (
                  <button
                    type="button"
                    className="cursor-pointer rounded-lg border border-outline-variant bg-white px-4 py-2 text-label-sm font-semibold"
                    onClick={() => setExpandPickId(expanded ? null : id)}
                  >
                    {expanded ? 'Hide choices' : picked ? 'Change match' : 'Choose who paid'}
                  </button>
                ) : null}
                {picked?.registration_id ? (
                  <button
                    type="button"
                    onClick={() => setRegViewId(picked.registration_id)}
                    className="cursor-pointer rounded-lg border border-outline-variant bg-white px-4 py-2 text-label-sm font-semibold text-primary"
                  >
                    Open registration
                  </button>
                ) : null}
              </div>

              {expanded && alternatives.length > 0 ? (
                <div className="border-t border-outline-variant/60 px-4 py-3">
                  <p className="mb-2 text-label-sm font-semibold text-on-surface">Who paid this deposit?</p>
                  <ul className="space-y-2" role="radiogroup">
                    {alternatives.map((c) => {
                      const chosen = lineKey === c.line_key;
                      return (
                        <li key={c.line_key}>
                          <button
                            type="button"
                            role="radio"
                            aria-checked={chosen}
                            onClick={() => {
                              onPick(id, c.line_key);
                              setExpandPickId(null);
                            }}
                            className={`w-full cursor-pointer rounded-lg border px-3 py-2 text-left text-label-sm ${
                              chosen
                                ? 'border-primary bg-primary/10 ring-1 ring-primary/25'
                                : 'border-outline-variant bg-white hover:border-primary/30'
                            }`}
                          >
                            <span className="font-semibold">{c.payer_name}</span>
                            {c.registration_code ? (
                              <span className="ml-2 font-mono text-[0.7rem]">{c.registration_code}</span>
                            ) : null}
                            <span className="ml-2 tabular-nums text-on-surface-variant">
                              {inr(c.closed_line ? c.amount_paise : c.due_paise)}
                            </span>
                            <span className="ml-2 text-[0.65rem] text-on-surface-variant">
                              {tierLabel(c.tier)} · ref {regRef(c)}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {visibleRows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-outline-variant p-8 text-center text-body-sm text-on-surface-variant">
          Nothing in this filter — try <strong>All deposits</strong>.
        </p>
      ) : null}

      <RegistrationQuickViewModal
        registrationId={regViewId}
        open={regViewId !== null}
        onClose={() => setRegViewId(null)}
      />
    </div>
  );
}