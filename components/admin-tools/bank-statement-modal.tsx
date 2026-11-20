'use client';

import { useCallback, useId, useRef, useState } from 'react';
import { ModalCloseButton, ModalOverlay } from '@/components/modal-shell';
import { formatCostForDisplay } from '@/lib/registration/registration';
import { bankStatementCreditFingerprint } from '@/lib/admin/bank-statement-credit-fingerprint';
import {
  autoSelectLineKeys,
  type BankStatementCreditResult,
} from '@/lib/admin/bank-statement-types';
import type { SibStatementCredit } from '@/lib/admin/sib-statement-parse';
import type { EventCatalog } from '@/lib/events/types';

function formatInrPaise(paise: number): string {
  return formatCostForDisplay(paise);
}

type Step = 'upload' | 'review';

type Props = {
  open: boolean;
  onClose: () => void;
  onApplied: () => void;
  events: EventCatalog[];
  defaultEventId: string;
};

type SettledRow = {
  credit: SibStatementCredit;
  fingerprint: string;
  reason: string;
};

type ApiResult = {
  account_number?: string | null;
  suggested_matches?: number;
  member_credit_count?: number;
  already_settled_count?: number;
  already_settled?: SettledRow[];
  results?: BankStatementCreditResult[];
  error?: string;
};

export default function BankStatementModal({
  open,
  onClose,
  onApplied,
  events,
  defaultEventId,
}: Props) {
  const titleId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>('upload');
  const [password, setPassword] = useState('');
  const [eventId, setEventId] = useState(defaultEventId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [accountNumber, setAccountNumber] = useState<string | null>(null);
  const [rows, setRows] = useState<BankStatementCreditResult[]>([]);
  const [alreadySettled, setAlreadySettled] = useState<SettledRow[]>([]);
  const [showSettled, setShowSettled] = useState(false);
  const [selected, setSelected] = useState<Map<string, string>>(new Map());

  const reset = useCallback(() => {
    setStep('upload');
    setPassword('');
    setError('');
    setAccountNumber(null);
    setRows([]);
    setAlreadySettled([]);
    setShowSettled(false);
    setSelected(new Map());
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
    setShowSettled(false);
    setSelected(new Map());
    setAccountNumber(null);
  }, [busy]);

  async function runAutoRecon(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError('Choose a PDF statement.');
      return;
    }
    if (!password.trim()) {
      setError('Enter the PDF password.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const fd = new FormData();
      fd.set('file', file);
      fd.set('pdf_password', password.trim());
      if (eventId) fd.set('event_id', eventId);
      const res = await fetch('/api/admin/bank-statements', { method: 'POST', body: fd });
      const payload = (await res.json().catch(() => ({}))) as ApiResult;
      if (!res.ok) {
        setError(payload.error || 'Could not parse statement');
        return;
      }
      const list = payload.results || [];
      setRows(list);
      setAlreadySettled(payload.already_settled || []);
      setAccountNumber(payload.account_number ?? null);
      setSelected(autoSelectLineKeys(list));
      setStep('review');
    } finally {
      setBusy(false);
    }
  }

  async function approveReconciliation() {
    const applyRows = [...selected.entries()].filter(([, lineKey]) => lineKey);
    if (!applyRows.length) {
      setError('No matches selected. Adjust the list or cancel.');
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
        setError(
          `Approved ${n}; ${skip.length} skipped: ${skip.map((s) => s.error).join(' · ')}`
        );
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

  const approvedCount = [...selected.values()].filter(Boolean).length;
  const autoCount = rows.filter((r) => selected.has(r.credit.credit_id)).length;
  const unmatchedMember = rows.filter(
    (r) => r.credit.kind === 'credit' && !r.candidates.length
  ).length;

  if (!open) return null;

  return (
    <ModalOverlay
      titleId={titleId}
      backdropLabel={step === 'review' ? 'Cancel reconciliation' : 'Close bank statement upload'}
      onBackdropClose={step === 'review' ? backToUpload : cancelWithoutApply}
      disableBackdropClose={busy}
      panelClassName="space-y-4 overflow-y-auto p-5 sm:max-w-4xl max-h-[90vh] flex flex-col"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id={titleId} className="text-headline-sm text-primary">
            {step === 'upload' ? 'Bank statement upload' : 'Auto-reconciliation preview'}
          </h3>
          <p className="mt-1 text-body-sm text-on-surface-variant">
            {step === 'upload' ? (
              <>
                Upload a South Indian Bank PDF. We parse deposits and suggest registration matches — nothing
                is marked paid until you approve.
              </>
            ) : (
              <>
                Review auto-matched lines. <strong className="font-semibold text-on-surface">Approve</strong>{' '}
                to settle receivables; <strong className="font-semibold text-on-surface">Cancel</strong> leaves
                everything unchanged.
              </>
            )}
          </p>
        </div>
        <ModalCloseButton disabled={busy} onClick={cancelWithoutApply} />
      </div>

      {step === 'upload' ? (
        <form onSubmit={(e) => void runAutoRecon(e)} className="space-y-3 rounded-xl border border-outline-variant p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <label className="flex flex-1 min-w-[12rem] flex-col gap-1 text-label-sm">
              Statement PDF
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,application/pdf"
                className="text-body-sm file:mr-2 file:rounded-lg file:border-0 file:bg-secondary-container file:px-3 file:py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-label-sm sm:w-48">
              PDF password
              <input
                type="password"
                autoComplete="off"
                value={password}
                onChange={(ev) => setPassword(ev.target.value)}
                className="rounded-lg border border-primary/15 px-3 py-2 text-body-sm bg-surface-ivory"
                placeholder="Customer ID or your PDF lock"
              />
            </label>
            <label className="flex flex-col gap-1 text-label-sm sm:min-w-[14rem]">
              Limit to event
              <select
                value={eventId}
                onChange={(ev) => setEventId(ev.target.value)}
                className="rounded-lg border border-primary/15 px-3 py-2 text-body-sm bg-surface-ivory"
              >
                <option value="">All open lines (recommended)</option>
                {events.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-primary text-on-primary px-4 py-2.5 text-label-sm font-bold uppercase tracking-wider disabled:opacity-50 cursor-pointer"
          >
            {busy ? 'Running auto-recon…' : 'Run auto-reconciliation'}
          </button>
        </form>
      ) : null}

      {error ? (
        <p className="rounded-lg bg-error-container text-error text-body-sm p-3" role="alert">
          {error}
        </p>
      ) : null}

      {step === 'review' ? (
        <>
          <div className="rounded-xl border border-jubilee-gold-light bg-secondary-container/30 p-4 text-body-sm space-y-2">
            <p>
              <strong>{rows.filter((r) => r.credit.kind === 'credit').length}</strong> new deposit(s) to
              review (already settled rows hidden).
              {alreadySettled.length > 0 ? (
                <>
                  {' '}
                  <strong>{alreadySettled.length}</strong> skipped as previously matched / paid.
                </>
              ) : null}
              {accountNumber ? (
                <>
                  {' '}
                  Account <span className="tabular-nums">{accountNumber}</span>.
                </>
              ) : null}{' '}
              Auto-selected <strong>{autoCount}</strong>; for approval <strong>{approvedCount}</strong>.
              {unmatchedMember > 0 ? (
                <>
                  {' '}
                  <strong>{unmatchedMember}</strong> need manual match.
                </>
              ) : null}
            </p>
            {alreadySettled.length > 0 ? (
              <label className="flex items-center gap-2 text-label-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={showSettled}
                  onChange={(e) => setShowSettled(e.target.checked)}
                  className="size-4"
                />
                Show {alreadySettled.length} already-settled bank line(s)
              </label>
            ) : null}
          </div>

          {showSettled && alreadySettled.length > 0 ? (
            <details className="rounded-lg border border-outline-variant p-3 text-body-sm" open>
              <summary className="cursor-pointer font-medium text-on-surface-variant">
                Already settled (not applied again)
              </summary>
              <ul className="mt-2 space-y-2 max-h-40 overflow-y-auto">
                {alreadySettled.map((item) => (
                  <li key={item.fingerprint} className="text-label-sm text-on-surface-variant">
                    <span className="tabular-nums">
                      {item.credit.stmt_date} · {formatInrPaise(item.credit.amount_paise)}
                    </span>
                    {item.credit.rrn ? ` · RRN ${item.credit.rrn}` : null} — {item.reason}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full text-left text-body-sm border border-outline-variant rounded-xl overflow-hidden">
              <thead className="bg-surface-container text-label-sm text-on-surface-variant sticky top-0">
                <tr>
                  <th className="px-2 py-2">Include</th>
                  <th className="px-2 py-2">Bank credit</th>
                  <th className="px-2 py-2">Registration match</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const { credit, candidates, best } = row;
                  const isGateway = credit.kind === 'gateway';
                  const chosen = selected.get(credit.credit_id) || '';
                  return (
                    <tr key={credit.credit_id} className="border-t border-outline-variant/60 align-top">
                      <td className="px-2 py-2">
                        {isGateway ? (
                          <span className="text-label-sm text-on-surface-variant">Skip</span>
                        ) : (
                          <input
                            type="checkbox"
                            aria-label="Include in approval"
                            checked={Boolean(chosen)}
                            onChange={(ev) =>
                              pickMatch(
                                credit.credit_id,
                                ev.target.checked ? best?.line_key || chosen || '' : ''
                              )
                            }
                            disabled={!candidates.length}
                            className="size-4 cursor-pointer"
                          />
                        )}
                      </td>
                      <td className="px-2 py-2 max-w-xs">
                        <p className="tabular-nums">
                          {credit.stmt_date} · {formatInrPaise(credit.amount_paise)}
                        </p>
                        <p className="text-label-sm text-on-surface-variant break-all mt-1">
                          {credit.particulars.length > 120
                            ? `${credit.particulars.slice(0, 120)}…`
                            : credit.particulars}
                        </p>
                        {credit.rrn ? (
                          <p className="text-label-sm mt-1 tabular-nums">RRN {credit.rrn}</p>
                        ) : null}
                        {credit.payer_name ? (
                          <p className="text-label-sm">{credit.payer_name}</p>
                        ) : null}
                      </td>
                      <td className="px-2 py-2">
                        {isGateway ? (
                          <p className="text-label-sm text-on-surface-variant">Gateway / bulk</p>
                        ) : !candidates.length ? (
                          <p className="text-label-sm text-on-surface-variant">No open line at this amount</p>
                        ) : (
                          <select
                            className="w-full max-w-md rounded-lg border border-primary/15 px-2 py-1.5 text-body-sm bg-surface-ivory"
                            value={chosen}
                            onChange={(ev) => pickMatch(credit.credit_id, ev.target.value)}
                          >
                            <option value="">— None —</option>
                          {candidates.map((c) => (
                            <option key={c.line_key} value={c.line_key}>
                              [{c.tier}·{c.match_score}] {c.payer_name} · due{' '}
                              {formatInrPaise(c.due_paise)}
                              {c.registration_code ? ` · ${c.registration_code}` : ''}
                              {c.phone ? ` · ${c.phone}` : ''}
                              {c.bank_reference ? ` · ref ${c.bank_reference}` : ''} — {c.reasons[0]}
                            </option>
                          ))}
                          </select>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-outline-variant pt-4 sticky bottom-0 bg-surface-paper">
            <button
              type="button"
              disabled={busy}
              onClick={backToUpload}
              className="rounded-lg border border-outline-variant px-4 py-2.5 text-label-sm font-bold uppercase tracking-wider disabled:opacity-50 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || approvedCount < 1}
              onClick={() => void approveReconciliation()}
              className="rounded-lg bg-primary text-on-primary px-4 py-2.5 text-label-sm font-bold uppercase tracking-wider disabled:opacity-50 cursor-pointer"
            >
              {busy ? 'Approving…' : `Approve reconciliation (${approvedCount})`}
            </button>
          </div>
        </>
      ) : null}
    </ModalOverlay>
  );
}