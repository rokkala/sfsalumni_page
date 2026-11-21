'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ModalCloseButton, ModalOverlay } from '@/components/modal-shell';
import { formatCostForDisplay } from '@/lib/registration/registration';
import { bankStatementCreditFingerprint } from '@/lib/admin/bank-statement-credit-fingerprint';
import { autoSelectLineKeys, type BankStatementCreditResult } from '@/lib/admin/bank-statement-types';
import type { SibStatementCredit } from '@/lib/admin/sib-statement-parse';
import type { EventCatalog } from '@/lib/events/types';
import { ledgerStatus, type ReviewFilter } from '@/lib/admin/bank-statement-review-state';
import { BankStatementReviewPanel } from '@/components/admin-tools/bank-statement-review-panel';
import { downloadClearingBatchCsv } from '@/lib/admin/bank-statement-batch-csv';

type Step = 'upload' | 'review';

type SettledRow = {
  credit: SibStatementCredit;
  fingerprint: string;
  reason: string;
};

type ApiResult = {
  account_number?: string | null;
  results?: BankStatementCreditResult[];
  already_settled?: SettledRow[];
  include_closed_lines?: boolean;
  error?: string;
};

function isClosedCandidate(
  results: BankStatementCreditResult[],
  creditId: string,
  lineKey: string
): boolean {
  const row = results.find((r) => r.credit.credit_id === creditId);
  return Boolean(row?.candidates.find((c) => c.line_key === lineKey)?.closed_line);
}

type Props = {
  open: boolean;
  onClose: () => void;
  onApplied: () => void;
  events: EventCatalog[];
  defaultEventId: string;
  includeClosedLines?: boolean;
};

const STEP_LABELS: Record<Step, string> = {
  upload: 'Upload PDF',
  review: 'Review matches',
};

export default function BankStatementModal({
  open,
  onClose,
  onApplied,
  events,
  defaultEventId,
  includeClosedLines = false,
}: Props) {
  const titleId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const lastFileRef = useRef<File | null>(null);
  const [step, setStep] = useState<Step>('upload');
  const [password, setPassword] = useState('');
  const [eventId, setEventId] = useState(defaultEventId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [accountNumber, setAccountNumber] = useState<string | null>(null);
  const [rows, setRows] = useState<BankStatementCreditResult[]>([]);
  const [alreadySettled, setAlreadySettled] = useState<SettledRow[]>([]);
  const [selected, setSelected] = useState<Map<string, string>>(new Map());
  const [clearingBatch, setClearingBatch] = useState<Set<string>>(new Set());
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('open');
  const [activeCreditId, setActiveCreditId] = useState<string | null>(null);
  const [includeClosedMatch, setIncludeClosedMatch] = useState(includeClosedLines);
  const [rematchBusy, setRematchBusy] = useState(false);

  useEffect(() => {
    setIncludeClosedMatch(includeClosedLines);
  }, [includeClosedLines]);

  const reset = useCallback(() => {
    setStep('upload');
    setPassword('');
    setError('');
    setAccountNumber(null);
    setRows([]);
    setAlreadySettled([]);
    setSelected(new Map());
    setClearingBatch(new Set());
    setActiveCreditId(null);
    setReviewFilter('open');
    if (fileRef.current) fileRef.current.value = '';
  }, []);

  const cancelWithoutApply = useCallback(() => {
    if (busy) return;
    reset();
    onClose();
  }, [busy, onClose, reset]);

  const backToUpload = useCallback(() => {
    if (busy) return;
    setStep('upload');
    setError('');
    setRows([]);
    setAlreadySettled([]);
    setSelected(new Map());
    setClearingBatch(new Set());
    setAccountNumber(null);
    setActiveCreditId(null);
  }, [busy]);

  async function parseStatementFile(file: File, closedLines?: boolean) {
    if (!password.trim()) {
      setError('Enter the PDF password.');
      return false;
    }
    setError('');
    const useClosed = closedLines ?? includeClosedMatch;
    const fd = new FormData();
    fd.set('file', file);
    fd.set('pdf_password', password.trim());
    if (eventId) fd.set('event_id', eventId);
    if (useClosed) fd.set('include_closed_lines', '1');
    const res = await fetch('/api/admin/bank-statements', { method: 'POST', body: fd });
    const payload = (await res.json().catch(() => ({}))) as ApiResult;
    if (!res.ok) {
      setError(payload.error || 'Could not parse statement');
      return false;
    }
    const list = payload.results || [];
    setRows(list);
    setAlreadySettled(payload.already_settled || []);
    setAccountNumber(payload.account_number ?? null);
    if (typeof payload.include_closed_lines === 'boolean') {
      setIncludeClosedMatch(payload.include_closed_lines);
    }
    const picks = autoSelectLineKeys(list);
    setSelected(picks);
    setClearingBatch(new Set());
    const firstMember = list.find((r) => r.credit.kind === 'credit');
    setActiveCreditId(firstMember?.credit.credit_id ?? null);
    return true;
  }

  async function runAutoRecon(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError('Choose a PDF statement.');
      return;
    }
    setBusy(true);
    try {
      lastFileRef.current = file;
      const ok = await parseStatementFile(file);
      if (ok) {
        setReviewFilter('all');
        setStep('review');
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleIncludeClosedChange(on: boolean) {
    setIncludeClosedMatch(on);
    const file = lastFileRef.current;
    if (!file || step !== 'review') return;
    setRematchBusy(true);
    setError('');
    try {
      await parseStatementFile(file, on);
    } finally {
      setRematchBusy(false);
    }
  }

  async function approveReconciliation() {
    const picked = [...selected.entries()].filter(([creditId, lineKey]) => lineKey && clearingBatch.has(creditId));
    const applyRows = picked.filter(
      ([creditId, lineKey]) => !isClosedCandidate(rows, creditId, lineKey)
    );
    if (picked.length > applyRows.length) {
      setError(
        'Paid-line matches are preview only — deselect them or turn off “includes paid lines” before approving.'
      );
      return;
    }
    if (!applyRows.length) {
      setError('Clearing batch is empty. Assign open items and tick Batch, or cancel.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/admin/bank-statements/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          rows: applyRows.map(([credit_id, line_key]) => {
            const match = rows.find((r) => r.credit.credit_id === credit_id);
            const credit = match?.credit;
            return {
              line_key,
              fingerprint: credit ? bankStatementCreditFingerprint(credit) : undefined,
              stmt_date: credit?.stmt_date,
              amount_paise: credit?.amount_paise,
              rrn: credit?.rrn,
            };
          }),
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload.error || 'Could not approve reconciliation');
        return;
      }
      const n = Number(payload.applied_count) || 0;
      const skip = (payload.skipped || []) as { line_key: string; error: string }[];
      onApplied();
      if (skip.length) {
        setError(`Approved ${n}; ${skip.length} skipped: ${skip.map((s) => s.error).join(' · ')}`);
      } else {
        reset();
        onClose();
      }
    } finally {
      setBusy(false);
    }
  }

  function pickMatch(creditId: string, lineKey: string) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (lineKey) next.set(creditId, lineKey);
      else next.delete(creditId);
      return next;
    });
  }

  function toggleBatch(creditId: string, on: boolean) {
    setClearingBatch((prev) => {
      const next = new Set(prev);
      if (on) next.add(creditId);
      else next.delete(creditId);
      return next;
    });
  }

  const memberRows = rows.filter((r) => r.credit.kind === 'credit');
  const approveCount = [...clearingBatch].filter((id) => selected.get(id)).length;
  const readyCount = memberRows.filter((r) => {
    const id = r.credit.credit_id;
    const lineKey = selected.get(id) || '';
    return ledgerStatus(r, clearingBatch.has(id), lineKey) === 'CLEARING';
  }).length;
  const actionCount = memberRows.filter((r) => {
    const id = r.credit.credit_id;
    const lineKey = selected.get(id) || '';
    const st = ledgerStatus(r, clearingBatch.has(id), lineKey);
    return st === 'OPEN' || st === 'PROPOSED' || st === 'EXCEPTION';
  }).length;

  if (!open) return null;

  return (
    <ModalOverlay
      titleId={titleId}
      backdropLabel={step === 'review' ? 'Cancel reconciliation' : 'Close bank statement upload'}
      onBackdropClose={step === 'review' ? backToUpload : cancelWithoutApply}
      disableBackdropClose={busy}
      panelClassName="flex max-h-[92vh] flex-col gap-4 overflow-hidden p-5 sm:max-w-[min(72rem,96vw)] bg-surface-paper"
    >
      <header className="flex shrink-0 items-start justify-between gap-3">
        <div className="space-y-2">
          <p className="text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">
            Bank reconciliation · {STEP_LABELS[step]}
          </p>
          <h3 id={titleId} className="text-headline-sm text-primary">
            {step === 'upload' ? 'Import bank statement' : 'Match deposits to registrations'}
          </h3>
          <p className="max-w-2xl text-body-sm text-on-surface-variant">
            {step === 'upload'
              ? 'Upload the South Indian Bank PDF. We list each deposit and suggest a registration match.'
              : 'Work through each deposit card. Link the right alumni, tick Mark paid, then approve at the bottom.'}
          </p>
        </div>
        <ModalCloseButton disabled={busy} onClick={cancelWithoutApply} />
      </header>

      {error ? (
        <p className="shrink-0 rounded-lg bg-error-container p-3 text-body-sm text-error" role="alert">
          {error}
        </p>
      ) : null}

      {step === 'upload' ? (
        <form
          onSubmit={(e) => void runAutoRecon(e)}
          className="shrink-0 space-y-4 rounded-2xl border border-outline-variant bg-white p-5 shadow-sm"
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className="flex flex-col gap-1 text-label-sm sm:col-span-2 lg:col-span-1">
              Statement PDF
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,application/pdf"
                className="text-body-sm file:mr-2 file:cursor-pointer file:rounded-lg file:border-0 file:bg-secondary-container file:px-3 file:py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-label-sm">
              PDF password
              <input
                type="password"
                autoComplete="off"
                value={password}
                onChange={(ev) => setPassword(ev.target.value)}
                className="rounded-lg border border-primary/15 bg-surface-ivory px-3 py-2 text-body-sm"
                placeholder="Customer ID"
              />
            </label>
            <label className="flex flex-col gap-1 text-label-sm">
              Event (optional)
              <select
                value={eventId}
                onChange={(ev) => setEventId(ev.target.value)}
                className="rounded-lg border border-primary/15 bg-surface-ivory px-3 py-2 text-body-sm"
              >
                <option value="">All open lines</option>
                {events.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex cursor-pointer items-start gap-2 text-label-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-primary"
              checked={includeClosedMatch}
              onChange={(e) => setIncludeClosedMatch(e.target.checked)}
            />
            <span>
              Include paid / manually closed receivable lines (show against bank credits for checking — cannot
              post)
            </span>
          </label>
          <button
            type="submit"
            disabled={busy}
            className="cursor-pointer rounded-lg bg-primary px-5 py-2.5 text-label-sm font-bold text-on-primary disabled:opacity-50"
          >
            {busy ? 'Parsing…' : 'Parse statement'}
          </button>
        </form>
      ) : null}

      {step === 'review' ? (
        <>
          <BankStatementReviewPanel
            rows={rows}
            selected={selected}
            clearingBatch={clearingBatch}
            reviewFilter={reviewFilter}
            onFilterChange={setReviewFilter}
            activeCreditId={activeCreditId}
            onActiveChange={setActiveCreditId}
            onPick={pickMatch}
            onToggleBatch={toggleBatch}
            includeClosedLines={includeClosedMatch}
            includeClosedEnabled={includeClosedMatch}
            onIncludeClosedChange={(on) => void handleIncludeClosedChange(on)}
            rematchBusy={rematchBusy}
            accountNumber={accountNumber}
            readyCount={readyCount}
            actionCount={actionCount}
            approveCount={approveCount}
            alreadySettled={alreadySettled}
            onExportBatch={() => downloadClearingBatchCsv(rows, selected, clearingBatch, accountNumber)}
          />

          <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-outline-variant pt-4">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={backToUpload}
                className="cursor-pointer rounded-lg border border-outline-variant px-4 py-2 text-label-sm font-semibold disabled:opacity-50 hover:bg-surface-container"
              >
                Different file
              </button>
              <button
                type="button"
                disabled={busy || approveCount < 1}
                onClick={() => downloadClearingBatchCsv(rows, selected, clearingBatch, accountNumber)}
                className="cursor-pointer rounded-lg border border-outline-variant bg-surface-ivory px-4 py-2 text-label-sm font-semibold disabled:opacity-50 hover:bg-surface-container"
              >
                Export batch CSV
              </button>
            </div>
            <button
              type="button"
              disabled={busy || approveCount < 1}
              onClick={() => void approveReconciliation()}
              className="cursor-pointer rounded-lg bg-primary px-6 py-2.5 text-label-sm font-bold text-on-primary shadow-sm disabled:opacity-50"
            >
              {busy ? 'Posting…' : `Mark selected as paid (${approveCount})`}
            </button>
          </footer>
        </>
      ) : null}
    </ModalOverlay>
  );
}