'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatCostForDisplay } from '@/lib/registration/registration';
import { creditEvidenceItems } from '@/lib/admin/bank-statement-credit-evidence';
import type { SibStatementCredit } from '@/lib/admin/sib-statement-parse';
import type {
  BankStatementCandidate,
  BankStatementCreditResult,
  BankStatementMatchTier,
  BankStatementProofSummary,
} from '@/lib/admin/bank-statement-types';
import {
  candidateForLine,
  ledgerStatus,
  openItemSummary,
  rowNeedsWork,
  rowPassesLedgerFilter,
  statusMeta,
  type ReviewFilter,
} from '@/lib/admin/bank-statement-review-state';
import { remittanceMethodLabel } from '@/lib/payments/remittance-validate';

const inr = (paise: number) => formatCostForDisplay(paise);

type CandidateSort = 'score' | 'amount_delta';

function receivablesSearchUrl(ref: string): string {
  return `/admin/receivables?${new URLSearchParams({ q: ref }).toString()}`;
}

function sortCandidates(
  list: BankStatementCandidate[],
  credit: SibStatementCredit,
  mode: CandidateSort
): BankStatementCandidate[] {
  const copy = [...list];
  if (mode === 'score') {
    return copy.sort((a, b) => b.match_score - a.match_score);
  }
  return copy.sort((a, b) => {
    const da = Math.abs((a.closed_line ? a.amount_paise : a.due_paise) - credit.amount_paise);
    const db = Math.abs((b.closed_line ? b.amount_paise : b.due_paise) - credit.amount_paise);
    return da - db;
  });
}

function RefCompareStrip({
  bankRef,
  regRef,
}: {
  bankRef: string | null;
  regRef: string | null;
}) {
  const match =
    bankRef &&
    regRef &&
    normalizeRefToken(bankRef) === normalizeRefToken(regRef);
  return (
    <div className="grid gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-label-sm sm:grid-cols-2">
      <div>
        <p className="text-[0.65rem] font-bold uppercase text-on-surface-variant">Bank ref</p>
        <p className="font-mono font-semibold tabular-nums text-primary break-all">{bankRef || '—'}</p>
      </div>
      <div>
        <p className="text-[0.65rem] font-bold uppercase text-on-surface-variant">Receivable ref</p>
        <p
          className={`font-mono font-semibold tabular-nums break-all ${
            match ? 'text-on-secondary-fixed' : 'text-on-surface'
          }`}
        >
          {regRef || '—'}
        </p>
      </div>
      {bankRef && regRef ? (
        <p className="sm:col-span-2 text-[0.7rem] text-on-surface-variant">
          {match ? 'Refs align — good sign for clearing.' : 'Compare refs with proofs on the left.'}
        </p>
      ) : null}
    </div>
  );
}

function normalizeRefToken(raw: string): string {
  const d = raw.replace(/\D/g, '');
  return d.length > 12 ? d.slice(-12) : d;
}

function bankRefTokens(credit: SibStatementCredit): string[] {
  const out = new Set<string>();
  for (const r of credit.receipt_refs) out.add(normalizeRefToken(r));
  if (credit.rrn) out.add(normalizeRefToken(credit.rrn));
  return [...out].filter(Boolean);
}

function utrMatchesBank(utr: string | null, tokens: string[]): boolean {
  if (!utr || !tokens.length) return false;
  const u = normalizeRefToken(utr);
  return tokens.some((t) => t === u || u.endsWith(t) || t.endsWith(u));
}

function tierClass(tier: BankStatementMatchTier): string {
  if (tier === 'high') return 'bg-secondary-container text-on-secondary-fixed';
  if (tier === 'medium') return 'bg-jubilee-gold-light text-on-secondary-fixed-variant';
  return 'bg-surface-container text-on-surface-variant';
}

function proofStripe(status: string): string {
  if (status === 'pending') return 'border-l-jubilee-gold-deep bg-jubilee-gold-light/30';
  if (status === 'approved') return 'border-l-secondary-fixed bg-secondary-container/35';
  return 'border-l-outline-variant bg-surface-container-low';
}

function ProofCards({ proofs, bankRefTokens: refTokens }: { proofs: BankStatementProofSummary[]; bankRefTokens: string[] }) {
  if (!proofs.length) {
    return (
      <p className="rounded-lg border border-dashed border-outline-variant px-3 py-2 text-label-sm text-on-surface-variant">
        No uploaded proof for this receivable.
      </p>
    );
  }
  return (
    <ul className="space-y-2" role="list" aria-label="Uploaded remittance proofs">
      {proofs.map((p) => {
        const refHit = utrMatchesBank(p.utr, refTokens);
        return (
          <li
            key={p.id}
            className={`rounded-lg border-l-4 px-3 py-2 text-label-sm ${proofStripe(p.status)} ${
              refHit ? 'ring-1 ring-secondary-fixed/50' : ''
            }`}
          >
            {refHit ? (
              <p className="mb-1 text-[0.65rem] font-bold uppercase text-on-secondary-fixed">UTR matches bank ref</p>
            ) : null}
            <p className="font-semibold capitalize">
              {p.status} · {inr(p.amount_paise)}
            </p>
            <p className="tabular-nums">
              UTR <span className="font-medium text-on-surface">{p.utr || '—'}</span>
            </p>
            {p.payment_date ? <p className="text-on-surface-variant">Payment date {p.payment_date}</p> : null}
            {p.remittance_method ? (
              <p className="text-on-surface-variant">{remittanceMethodLabel(p.remittance_method as never)}</p>
            ) : null}
            {p.admin_note ? <p className="text-on-surface-variant italic">Note: {p.admin_note}</p> : null}
          </li>
        );
      })}
    </ul>
  );
}

function BankProofPanel({
  credit,
  chosen,
  chosenCandidate,
}: {
  credit: SibStatementCredit;
  chosen: string;
  chosenCandidate: BankStatementCandidate | null;
}) {
  const ref = credit.receipt_refs[0] || credit.rrn;
  const amountOk =
    chosenCandidate && !chosenCandidate.closed_line && chosenCandidate.due_paise === credit.amount_paise;
  const amountWarn =
    chosenCandidate && !chosenCandidate.closed_line && chosenCandidate.due_paise !== credit.amount_paise;

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-ivory/80">
      <div className="border-b border-outline-variant/60 bg-white px-4 py-3">
        <p className="text-[0.65rem] font-bold uppercase tracking-wide text-on-surface-variant">Bank proof</p>
        <p className="mt-1 text-headline-sm font-bold tabular-nums text-on-surface">{inr(credit.amount_paise)}</p>
        <p className="text-label-sm text-on-surface-variant">
          {credit.stmt_date}
          {ref ? (
            <>
              {' '}
              · Ref <span className="font-mono font-semibold text-primary">{ref}</span>
            </>
          ) : null}
        </p>
        {chosen && chosenCandidate ? (
          <p
            className={`mt-2 rounded-md px-2 py-1 text-label-sm ${
              amountOk
                ? 'bg-secondary-container/40 text-on-secondary-fixed'
                : amountWarn
                  ? 'bg-error-container/25 text-error'
                  : 'bg-surface-container text-on-surface-variant'
            }`}
          >
            {chosenCandidate.closed_line
              ? 'Assigned to a paid line (preview only)'
              : amountOk
                ? 'Amount matches receivable due'
                : `Receivable due is ${inr(chosenCandidate.due_paise)} — check before posting`}
          </p>
        ) : (
          <p className="mt-2 text-label-sm text-on-surface-variant">Pick a receivable open item on the left.</p>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-3">
        <p className="break-all font-mono text-[0.72rem] leading-relaxed text-on-surface">{credit.particulars}</p>
        <dl className="grid gap-2 text-label-sm">
          {creditEvidenceItems(credit).map((item) => (
            <div key={item.id} className="rounded-md border border-outline-variant/60 bg-white px-3 py-2">
              <dt className="text-[0.65rem] uppercase text-on-surface-variant">{item.label}</dt>
              <dd className="break-all font-medium">{item.value}</dd>
              {item.hint ? <dd className="text-on-surface-variant text-[0.7rem]">{item.hint}</dd> : null}
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

function OpenItemsColumn({
  row,
  chosen,
  includeClosedLines,
  bankRefTokens: refTokens,
  candidateSort,
  onPick,
}: {
  row: BankStatementCreditResult;
  chosen: string;
  includeClosedLines: boolean;
  bankRefTokens: string[];
  candidateSort: CandidateSort;
  onPick: (creditId: string, lineKey: string) => void;
}) {
  const { credit, candidates, best } = row;
  const creditId = credit.credit_id;
  const bankRef = credit.receipt_refs[0] || credit.rrn || '';
  const open = sortCandidates(
    candidates.filter((c) => !c.closed_line),
    credit,
    candidateSort
  );
  const closed = sortCandidates(
    candidates.filter((c) => c.closed_line),
    credit,
    candidateSort
  );

  if (!candidates.length) {
    return (
      <div className="rounded-lg border border-dashed border-outline-variant bg-white p-4 text-body-sm text-on-surface-variant">
        No receivable open item for this bank credit.{' '}
        {bankRef ? (
          <Link href={receivablesSearchUrl(bankRef)} className="font-semibold text-primary underline">
            Search receivables for ref {bankRef}
          </Link>
        ) : (
          <Link href="/admin/receivables" className="font-semibold text-primary underline">
            Open receivables
          </Link>
        )}
        .
        {!includeClosedLines ? ' Or enable paid / manually closed lines above.' : null}
      </div>
    );
  }

  const renderCard = (c: BankStatementCandidate) => {
    const selected = chosen === c.line_key;
    const suggested = best?.line_key === c.line_key && !c.closed_line;
    return (
      <button
        key={c.line_key}
        type="button"
        onClick={() => onPick(creditId, c.line_key)}
        className={`w-full cursor-pointer rounded-xl border p-3 text-left transition-shadow ${
          selected
            ? 'border-secondary-fixed bg-secondary-container/25 ring-2 ring-secondary-fixed/45 shadow-md'
            : suggested
              ? 'border-primary/25 bg-primary/5 hover:border-primary/40'
              : 'border-outline-variant bg-white hover:border-primary/30 hover:shadow-sm'
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
          {suggested ? (
            <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[0.65rem] font-bold uppercase text-primary">
              Suggested
            </span>
          ) : null}
          <span className={`rounded px-1.5 py-0.5 text-[0.65rem] font-bold uppercase ${tierClass(c.tier)}`}>
            {c.tier} {c.match_score}
          </span>
          {c.closed_line ? (
            <span className="rounded bg-surface-container px-1.5 py-0.5 text-label-sm font-semibold">Paid line</span>
          ) : null}
          <span className="font-semibold text-on-surface">{c.payer_name}</span>
        </div>
        <p className="mt-1 text-label-sm text-on-surface-variant">
          {c.registration_code ? `${c.registration_code} · ` : ''}
          {c.closed_line ? `Settled ${inr(c.amount_paise)}` : `Due ${inr(c.due_paise)}`}
          {c.bank_reference ? (
            <>
              {' '}
              · Reg ref <span className="tabular-nums text-on-surface">{c.bank_reference}</span>
            </>
          ) : null}
        </p>
        {c.reasons.length ? (
          <p className="mt-1 text-label-sm text-on-surface-variant">{c.reasons.join(' · ')}</p>
        ) : null}
        <div className="mt-3">
          <p className="mb-1 text-[0.65rem] font-bold uppercase tracking-wide text-on-surface-variant">Proofs</p>
          <ProofCards proofs={c.proofs} bankRefTokens={refTokens} />
        </div>
      </button>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="border-b border-outline-variant/60 px-4 py-3">
        <p className="text-[0.65rem] font-bold uppercase tracking-wide text-on-surface-variant">
          Receivable open items
        </p>
        <p className="text-label-sm text-on-surface-variant">
          Sorted by {candidateSort === 'score' ? 'match score' : 'amount closest to bank'}. Tap to assign.
        </p>
        {chosen ? (
          <button
            type="button"
            className="mt-1 cursor-pointer text-label-sm font-semibold text-primary underline"
            onClick={() => onPick(creditId, '')}
          >
            Unassign
          </button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {open.map(renderCard)}
        {closed.length > 0 ? (
          <div className="pt-2">
            <p className="mb-2 text-label-sm font-semibold text-on-secondary-fixed-variant">
              Paid / manually closed {includeClosedLines ? '(preview)' : ''}
            </p>
            {closed.map(renderCard)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

type SettledPreview = {
  credit: SibStatementCredit;
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

export function BankStatementReviewPanel({
  rows,
  selected,
  clearingBatch,
  reviewFilter,
  onFilterChange,
  activeCreditId,
  onActiveChange,
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
  const [candidateSort, setCandidateSort] = useState<CandidateSort>('score');

  const memberRows = useMemo(() => rows.filter((r) => r.credit.kind === 'credit'), [rows]);
  const gatewayRows = useMemo(() => rows.filter((r) => r.credit.kind === 'gateway'), [rows]);

  const ledgerRows = useMemo(() => {
    return memberRows.filter((row) => {
      const id = row.credit.credit_id;
      const lineKey = selected.get(id) || '';
      return rowPassesLedgerFilter(row, lineKey, clearingBatch.has(id), reviewFilter);
    });
  }, [memberRows, reviewFilter, selected, clearingBatch]);

  const activeRow = useMemo(() => {
    if (activeCreditId) {
      const hit = rows.find((r) => r.credit.credit_id === activeCreditId);
      if (hit) return hit;
    }
    return ledgerRows[0] ?? null;
  }, [rows, ledgerRows, activeCreditId]);

  const depositRail = useMemo(
    () => (showGateway ? [...ledgerRows, ...gatewayRows] : ledgerRows),
    [ledgerRows, gatewayRows, showGateway]
  );

  const focusIndex = useMemo(() => {
    if (!activeRow) return 0;
    const i = depositRail.findIndex((r) => r.credit.credit_id === activeRow.credit.credit_id);
    return i >= 0 ? i : 0;
  }, [depositRail, activeRow]);

  const totals = useMemo(() => {
    let statementCredits = 0;
    let clearingPaise = 0;
    let openCount = 0;
    let excCount = 0;
    for (const row of memberRows) {
      statementCredits += row.credit.amount_paise;
      const id = row.credit.credit_id;
      const lineKey = selected.get(id) || '';
      const st = ledgerStatus(row, clearingBatch.has(id), lineKey);
      if (st === 'CLEARING') clearingPaise += row.credit.amount_paise;
      if (st === 'OPEN' || st === 'PROPOSED') openCount += 1;
      if (st === 'EXCEPTION') excCount += 1;
    }
    return { statementCredits, clearingPaise, openCount, excCount };
  }, [memberRows, selected, clearingBatch]);

  const filters: { id: ReviewFilter; label: string; count: number }[] = [
    { id: 'open', label: 'Needs work', count: actionCount },
    { id: 'clearing', label: 'Clearing batch', count: readyCount },
    { id: 'exception', label: 'Exceptions', count: totals.excCount },
    { id: 'all', label: 'All', count: memberRows.length },
  ];

  const go = useCallback(
    (delta: number) => {
      if (!depositRail.length) return;
      const idx = depositRail.findIndex((r) => r.credit.credit_id === activeCreditId);
      const base = idx >= 0 ? idx : 0;
      const next = (base + delta + depositRail.length) % depositRail.length;
      onActiveChange(depositRail[next].credit.credit_id);
    },
    [depositRail, activeCreditId, onActiveChange]
  );

  const activeId = activeRow?.credit.credit_id;
  const activeLineKey = activeId ? selected.get(activeId) || '' : '';
  const activeInBatch = activeId ? clearingBatch.has(activeId) : false;
  const activeStatus = activeRow ? ledgerStatus(activeRow, activeInBatch, activeLineKey) : null;
  const activeMeta = activeStatus ? statusMeta(activeStatus) : null;
  const activeCand = activeRow ? candidateForLine(activeRow, activeLineKey) : null;
  const activeBankRefs = activeRow ? bankRefTokens(activeRow.credit) : [];

  const advanceNeedsWork = useCallback(() => {
    const queue = memberRows.filter((r) => {
      const id = r.credit.credit_id;
      return rowNeedsWork(r, selected.get(id) || '', clearingBatch.has(id));
    });
    if (!queue.length) return;
    const idx = activeId ? queue.findIndex((r) => r.credit.credit_id === activeId) : -1;
    const next = queue[(idx + 1) % queue.length];
    onActiveChange(next.credit.credit_id);
  }, [memberRows, selected, clearingBatch, activeId, onActiveChange]);

  const handleBatchToggle = useCallback(() => {
    if (!activeId || !activeLineKey) return;
    const adding = !activeInBatch;
    onToggleBatch(activeId, adding);
    if (adding) advanceNeedsWork();
  }, [activeId, activeLineKey, activeInBatch, onToggleBatch, advanceNeedsWork]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const t = e.target;
      if (
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        t instanceof HTMLSelectElement ||
        (t instanceof HTMLElement && t.isContentEditable)
      ) {
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        go(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        go(1);
      } else if ((e.key === 'b' || e.key === 'B') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (activeLineKey && activeId && !activeInBatch) {
          e.preventDefault();
          handleBatchToggle();
        }
      } else if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (activeLineKey && activeId && !activeInBatch) {
          e.preventDefault();
          handleBatchToggle();
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [go, handleBatchToggle, activeLineKey, activeId, activeInBatch]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="rounded-lg border border-outline-variant bg-white px-4 py-3">
        <p className="text-label-sm font-semibold text-on-surface">Statement clearing</p>
        <p className="text-label-sm text-on-surface-variant">
          {accountNumber ? <>A/c <span className="tabular-nums font-medium">{accountNumber}</span> · </> : null}
          Credits {inr(totals.statementCredits)} · Batch {approveCount} ({inr(totals.clearingPaise)})
        </p>
        <p className="mt-1 text-label-sm text-on-surface-variant">
          Choose a <strong className="font-semibold text-on-surface">bank deposit</strong> below, match an{' '}
          <strong className="font-semibold text-on-surface">open item</strong> on the left to the{' '}
          <strong className="font-semibold text-on-surface">bank proof</strong> on the right. Shortcuts:{' '}
          <kbd className="rounded border border-outline-variant px-1 font-mono text-[0.7rem]">←</kbd>{' '}
          <kbd className="rounded border border-outline-variant px-1 font-mono text-[0.7rem]">→</kbd> deposits,{' '}
          <kbd className="rounded border border-outline-variant px-1 font-mono text-[0.7rem]">B</kbd> or{' '}
          <kbd className="rounded border border-outline-variant px-1 font-mono text-[0.7rem]">Enter</kbd> add to batch.
        </p>
        <div className="mt-2 flex flex-wrap gap-3 text-label-sm">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={showGateway}
              onChange={(e) => setShowGateway(e.target.checked)}
            />
            Show gateway lines ({gatewayRows.length})
          </label>
          {alreadySettled.length > 0 ? (
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={showDbSettled}
                onChange={(e) => setShowDbSettled(e.target.checked)}
              />
              Show already-settled in DB ({alreadySettled.length})
            </label>
          ) : null}
          <button
            type="button"
            disabled={approveCount < 1}
            onClick={onExportBatch}
            className="cursor-pointer rounded-md border border-outline-variant bg-surface-ivory px-2 py-1 font-semibold disabled:opacity-50"
          >
            Export batch CSV
          </button>
        </div>
        <label className="mt-2 flex cursor-pointer items-center gap-2 text-label-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={includeClosedEnabled}
            disabled={rematchBusy}
            onChange={(e) => onIncludeClosedChange(e.target.checked)}
          />
          Include paid / manually closed receivable lines
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          role="tablist"
          aria-label="Filter"
          className="flex flex-wrap gap-1 rounded-lg border border-outline-variant bg-surface-ivory p-1"
        >
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
        {depositRail.length > 0 ? (
          <div className="flex items-center gap-2 text-label-sm">
            <button
              type="button"
              className="cursor-pointer rounded-lg border border-outline-variant bg-white px-3 py-1.5 font-semibold hover:bg-surface-container"
              onClick={() => go(-1)}
            >
              Prev deposit
            </button>
            <span className="tabular-nums text-on-surface-variant">
              {focusIndex + 1} / {depositRail.length}
            </span>
            <button
              type="button"
              className="cursor-pointer rounded-lg border border-outline-variant bg-white px-3 py-1.5 font-semibold hover:bg-surface-container"
              onClick={() => go(1)}
            >
              Next deposit
            </button>
          </div>
        ) : null}
      </div>

      {showDbSettled && alreadySettled.length > 0 ? (
        <ul className="max-h-24 overflow-y-auto rounded-lg border border-outline-variant/60 bg-surface-container-low p-2 text-label-sm text-on-surface-variant">
          {alreadySettled.map((item) => (
            <li key={item.fingerprint} className="tabular-nums">
              {item.credit.stmt_date} · {inr(item.credit.amount_paise)} — {item.reason}
            </li>
          ))}
        </ul>
      ) : null}

      {depositRail.length > 0 ? (
        <div aria-label="Bank deposits on this statement" className="flex gap-2 overflow-x-auto pb-1">
          {depositRail.map((row) => {
            const id = row.credit.credit_id;
            const lineKey = selected.get(id) || '';
            const st = ledgerStatus(row, clearingBatch.has(id), lineKey);
            const meta = statusMeta(st);
            const isActive = id === activeCreditId;
            const ref = row.credit.receipt_refs[0] || row.credit.rrn;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onActiveChange(id)}
                className={`min-w-[9.5rem] shrink-0 cursor-pointer rounded-xl border px-3 py-2 text-left ${
                  row.credit.kind === 'gateway' ? 'opacity-75' : ''
                } ${
                  isActive ? 'border-primary bg-primary/10 ring-2 ring-primary/25' : 'border-outline-variant bg-white'
                }`}
              >
                <span className={`text-[0.6rem] font-bold ${meta.badgeClass} rounded px-1`}>{meta.short}</span>
                <p className="mt-1 font-bold tabular-nums">{inr(row.credit.amount_paise)}</p>
                <p className="text-[0.65rem] text-on-surface-variant">{row.credit.stmt_date}</p>
                {ref ? <p className="truncate font-mono text-[0.6rem]">{ref}</p> : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {activeRow && activeMeta ? (
        <div className="flex min-h-[min(48vh,460px)] flex-1 flex-col gap-2 overflow-hidden">
          {activeStatus === 'EXCEPTION' ? (
            <div className="rounded-lg border border-error/30 bg-error-container/15 px-3 py-2 text-label-sm text-error">
              Exception — no auto match.{' '}
              {(activeRow.credit.receipt_refs[0] || activeRow.credit.rrn) && (
                <Link
                  href={receivablesSearchUrl(activeRow.credit.receipt_refs[0] || activeRow.credit.rrn || '')}
                  className="font-semibold underline"
                >
                  Search receivables by bank ref
                </Link>
              )}
            </div>
          ) : null}
          {activeRow.credit.kind === 'gateway' ? (
            <p className="rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2 text-label-sm text-on-surface-variant">
              Gateway bulk settlement — not assigned to a member line.
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-outline-variant bg-white px-3 py-2">
            <div className="text-label-sm">
              <span className={`rounded px-1.5 py-0.5 text-[0.65rem] font-bold ${activeMeta.badgeClass}`}>
                {activeMeta.short}
              </span>
              <span className="ml-2 font-medium">{openItemSummary(activeLineKey, activeCand)}</span>
            </div>
            {activeLineKey ? (
              <button
                type="button"
                onClick={() => (activeInBatch && activeId ? onToggleBatch(activeId, false) : handleBatchToggle())}
                className={`cursor-pointer rounded-lg px-3 py-1.5 text-label-sm font-bold ${
                  activeInBatch
                    ? 'bg-secondary-container text-on-secondary-fixed'
                    : 'border border-outline-variant bg-surface-ivory'
                }`}
              >
                {activeInBatch ? 'In batch ✓ — remove' : 'Add to clearing batch'}
              </button>
            ) : (
              <span className="text-label-sm text-on-surface-variant">Select open item on the left</span>
            )}
          </div>

          <RefCompareStrip
            bankRef={activeRow.credit.receipt_refs[0] || activeRow.credit.rrn}
            regRef={activeCand?.bank_reference ?? null}
          />
          <div className="flex flex-wrap items-center gap-2 text-label-sm">
            <span className="text-on-surface-variant">Sort open items:</span>
            <button
              type="button"
              onClick={() => setCandidateSort('score')}
              className={`cursor-pointer rounded-md px-2 py-1 font-semibold ${
                candidateSort === 'score' ? 'bg-primary text-on-primary' : 'border border-outline-variant'
              }`}
            >
              Match score
            </button>
            <button
              type="button"
              onClick={() => setCandidateSort('amount_delta')}
              className={`cursor-pointer rounded-md px-2 py-1 font-semibold ${
                candidateSort === 'amount_delta' ? 'bg-primary text-on-primary' : 'border border-outline-variant'
              }`}
            >
              Closest amount
            </button>
          </div>
          {activeRow.credit.kind === 'credit' ? (
            <div className="grid min-h-0 flex-1 gap-3 overflow-hidden md:grid-cols-2">
              <div className="min-h-0 overflow-hidden rounded-lg border border-outline-variant">
                <OpenItemsColumn
                  row={activeRow}
                  chosen={activeLineKey}
                  includeClosedLines={includeClosedLines}
                  bankRefTokens={activeBankRefs}
                  candidateSort={candidateSort}
                  onPick={onPick}
                />
              </div>
              <div className="min-h-0 overflow-hidden rounded-lg border border-outline-variant">
                <BankProofPanel
                  credit={activeRow.credit}
                  chosen={activeLineKey}
                  chosenCandidate={activeCand}
                />
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center rounded-lg border border-outline-variant bg-white p-8 text-body-sm text-on-surface-variant">
          No bank deposits in this filter.
        </div>
      )}

      {gatewayRows.length > 0 && !showGateway ? (
        <p className="text-label-sm text-on-surface-variant">
          {gatewayRows.length} gateway line(s) hidden — enable “Show gateway lines” to view.
        </p>
      ) : null}
    </div>
  );
}