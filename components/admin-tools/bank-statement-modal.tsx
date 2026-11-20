'use client';

import { useCallback, useId, useRef, useState } from 'react';
import { ModalCloseButton, ModalOverlay } from '@/components/modal-shell';
import { formatCostForDisplay } from '@/lib/registration/registration';
import type { BankStatementCreditResult } from '@/lib/admin/bank-statement-match';
import type { EventCatalog } from '@/lib/events/types';

function formatInrPaise(paise: number): string {
  return formatCostForDisplay(paise);
}

type Props = {
  open: boolean;
  onClose: () => void;
  onApplied: () => void;
  events: EventCatalog[];
  defaultEventId: string;
};

type ApiResult = {
  account_number?: string | null;
  suggested_matches?: number;
  member_credit_count?: number;
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
  const [password, setPassword] = useState('');
  const [eventId, setEventId] = useState(defaultEventId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState('');
  const [rows, setRows] = useState<BankStatementCreditResult[]>([]);
  const [selected, setSelected] = useState<Map<string, string>>(new Map());

  const reset = useCallback(() => {
    setPassword('');
    setError('');
    setSummary('');
    setRows([]);
    setSelected(new Map());
    if (fileRef.current) fileRef.current.value = '';
  }, []);

  const close = useCallback(() => {
    if (busy) return;
    reset();
    onClose();
  }, [busy, onClose, reset]);

  async function onUpload(e: React.FormEvent) {
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
    setSummary('');
    setRows([]);
    setSelected(new Map());
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
      const next = new Map<string, string>();
      for (const r of list) {
        if (r.best && r.credit.kind === 'credit' && r.best.tier === 'high') {
          next.set(r.credit.credit_id, r.best.line_key);
        }
      }
      setSelected(next);
      const acct = payload.account_number ? ` · A/C ${payload.account_number}` : '';
      setSummary(
        `${payload.member_credit_count ?? 0} member credit(s), ${payload.suggested_matches ?? 0} high-confidence match(es)${acct}`
      );
    } finally {
      setBusy(false);
    }
  }

  async function applySelected() {
    const applyRows = [...selected.entries()].map(([credit_id, line_key]) => ({
      credit_id,
      line_key,
      action: 'auto',
    }));
    if (!applyRows.length) {
      setError('Select at least one line to apply.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/admin/bank-statements/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rows: applyRows.map((r) => ({ line_key: r.line_key })) }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload.error || 'Apply failed');
        return;
      }
      const n = Number(payload.applied_count) || 0;
      const skip = (payload.skipped || []) as { line_key: string; error: string }[];
      setSummary(`Applied ${n} line(s).${skip.length ? ` ${skip.length} skipped.` : ''}`);
      onApplied();
      if (skip.length) {
        setError(skip.map((s) => `${s.line_key}: ${s.error}`).join(' · '));
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

  if (!open) return null;

  return (
    <ModalOverlay
      titleId={titleId}
      backdropLabel="Close bank statement upload"
      onBackdropClose={close}
      disableBackdropClose={busy}
      panelClassName="space-y-4 overflow-y-auto p-5 sm:max-w-4xl max-h-[90vh]"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id={titleId} className="text-headline-sm text-primary">
            Bank statement reconciliation
          </h3>
          <p className="mt-1 text-body-sm text-on-surface-variant">
            Upload a South Indian Bank PDF. We match deposits to open receivable lines by UTR, SFS ref,
            name, and amount.
          </p>
        </div>
        <ModalCloseButton disabled={busy} onClick={close} />
      </div>

      <form onSubmit={(e) => void onUpload(e)} className="space-y-3 rounded-xl border border-outline-variant p-4">
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
              <option value="">All open lines</option>
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
          {busy && !rows.length ? 'Parsing…' : 'Upload & match'}
        </button>
      </form>

      {error ? (
        <p className="rounded-lg bg-error-container text-error text-body-sm p-3">{error}</p>
      ) : null}
      {summary ? (
        <p className="rounded-xl border border-jubilee-gold-light bg-secondary-container/30 p-3 text-body-sm">
          {summary}
        </p>
      ) : null}

      {rows.length > 0 ? (
        <div className="space-y-4">
          <table className="w-full text-left text-body-sm border border-outline-variant rounded-xl overflow-hidden">
            <thead className="bg-surface-container text-label-sm text-on-surface-variant">
              <tr>
                <th className="px-2 py-2">Apply</th>
                <th className="px-2 py-2">Statement</th>
                <th className="px-2 py-2">Match</th>
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
                        <span className="text-label-sm text-on-surface-variant">PG</span>
                      ) : (
                        <input
                          type="checkbox"
                          checked={Boolean(chosen)}
                          onChange={(ev) =>
                            pickMatch(
                              credit.credit_id,
                              ev.target.checked ? best?.line_key || '' : ''
                            )
                          }
                          disabled={!best}
                          className="size-4"
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
                        <p className="text-label-sm mt-1">RRN {credit.rrn}</p>
                      ) : null}
                      {credit.payer_name ? (
                        <p className="text-label-sm">{credit.payer_name}</p>
                      ) : null}
                    </td>
                    <td className="px-2 py-2">
                      {isGateway ? (
                        <p className="text-label-sm text-on-surface-variant">Gateway / bulk — skip</p>
                      ) : !candidates.length ? (
                        <p className="text-label-sm text-on-surface-variant">No open line at this amount</p>
                      ) : (
                        <select
                          className="w-full max-w-md rounded-lg border border-primary/15 px-2 py-1.5 text-body-sm bg-surface-ivory"
                          value={chosen}
                          onChange={(ev) => pickMatch(credit.credit_id, ev.target.value)}
                        >
                          <option value="">— Pick registration —</option>
                          {candidates.map((c) => (
                            <option key={c.line_key} value={c.line_key}>
                              [{c.tier}] {c.payer_name} · {formatInrPaise(c.due_paise)}
                              {c.phone ? ` · ${c.phone}` : ''} — {c.reasons.join(', ')}
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
          <button
            type="button"
            disabled={busy || selected.size < 1}
            onClick={() => void applySelected()}
            className="rounded-lg bg-secondary-container text-on-secondary-container px-4 py-2.5 text-label-sm font-bold uppercase tracking-wider disabled:opacity-50 cursor-pointer"
          >
            Apply selected ({selected.size})
          </button>
        </div>
      ) : null}
    </ModalOverlay>
  );
}