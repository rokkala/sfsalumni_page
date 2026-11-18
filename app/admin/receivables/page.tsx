'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import AdminShell from '@/components/admin-shell';
import { formatCostForDisplay } from '@/lib/registration/registration';
import type { ReceivableLine } from '@/lib/admin/receivable-lines';
import type { EventCatalog } from '@/lib/events/types';

const KIND_LABEL: Record<ReceivableLine['kind'], string> = {
  registration_fee: 'Fee',
  registration_gift: 'Gift',
  cause_donation: 'Cause',
};

const BUTTON_PRIMARY =
  'rounded-lg bg-secondary-container text-on-secondary-container px-3 py-1.5 text-label-sm disabled:opacity-50 cursor-pointer hover:bg-secondary-fixed';
const BUTTON_OUTLINE =
  'rounded-lg border border-primary/20 bg-surface-ivory px-3 py-1.5 text-label-sm text-primary disabled:opacity-50 cursor-pointer';

export default function AdminReceivablesPage() {
  const [events, setEvents] = useState<EventCatalog[]>([]);
  const [lines, setLines] = useState<ReceivableLine[]>([]);
  const [summary, setSummary] = useState({ line_count: 0, due_paise: 0, settled_paise: 0 });
  const [eventId, setEventId] = useState('');
  const [status, setStatus] = useState<'all' | 'open' | 'paid' | 'pending'>('open');
  const [q, setQ] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (eventId) params.set('event_id', eventId);
    if (status !== 'all') params.set('status', status);
    if (q.trim()) params.set('q', q.trim());
    const res = await fetch(`/api/admin/receivables?${params}`, { cache: 'no-store' });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.error || 'Could not load receivables');
    setLines(payload.lines || []);
    setSummary(payload.summary || { line_count: 0, due_paise: 0, settled_paise: 0 });
  }, [eventId, status, q]);

  useEffect(() => {
    void fetch('/api/admin/events')
      .then((r) => r.json())
      .then((p) => setEvents(p.events || []))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    setError('');
    const t = setTimeout(() => {
      void load().catch((e) => setError(e instanceof Error ? e.message : 'Could not load'));
    }, 200);
    return () => clearTimeout(t);
  }, [load]);

  async function patchLine(line: ReceivableLine, payment_status: 'paid' | 'pending') {
    setBusy(line.line_key);
    setMessage('');
    try {
      const res = await fetch(`/api/admin/receivables/${encodeURIComponent(line.line_key)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ payment_status }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(payload.error || 'Update failed');
        return;
      }
      setMessage(payment_status === 'paid' ? 'Line marked paid.' : 'Line marked unpaid.');
      await load();
    } finally {
      setBusy('');
    }
  }

  return (
    <AdminShell title="Receivables">
      <p className="text-body-sm text-on-surface-variant mb-4 max-w-3xl">
        Every rupee as its own line — registration fees, gifts at checkout, and standalone cause
        donations. Reconcile each line on its own with <strong className="font-semibold text-on-surface">Mark paid</strong>{' '}
        / <strong className="font-semibold text-on-surface">Mark unpaid</strong>. Offline proofs stay on{' '}
        <Link href="/admin/remittance-proofs" className="text-primary underline font-medium">
          Remittance proofs
        </Link>
        .
      </p>

      {error ? (
        <p className="rounded-lg bg-error-container text-error text-body-sm p-3 mb-4">{error}</p>
      ) : null}
      {message ? (
        <p className="rounded-xl border border-jubilee-gold-light bg-secondary-container/30 p-4 text-body-sm text-on-secondary-fixed-variant mb-4">
          {message}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3 mb-4 text-body-sm">
        <span>
          Lines: <strong>{summary.line_count}</strong>
        </span>
        <span>
          Due: <strong>{formatCostForDisplay(summary.due_paise)}</strong>
        </span>
        <span>
          Received: <strong>{formatCostForDisplay(summary.settled_paise)}</strong>
        </span>
      </div>

      <div className="flex flex-col md:flex-row gap-3 mb-5">
        <select
          className="px-4 py-3 rounded-lg border border-primary/15 text-body-sm bg-surface-ivory"
          value={eventId}
          onChange={(e) => setEventId(e.target.value)}
        >
          <option value="">All events (fees & gifts)</option>
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.title}
            </option>
          ))}
        </select>
        <select
          className="px-4 py-3 rounded-lg border border-primary/15 text-body-sm bg-surface-ivory"
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
        >
          <option value="open">Open (amount due)</option>
          <option value="all">All lines</option>
          <option value="pending">Not fully paid</option>
          <option value="paid">Paid</option>
        </select>
        <input
          type="search"
          placeholder="Search reason, name, email, UTR…"
          className="flex-1 px-4 py-3 rounded-lg border border-primary/15 text-body-sm bg-surface-ivory"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-outline-variant">
        <table className="w-full text-left text-body-sm">
          <thead className="bg-surface-container text-label-sm text-on-surface-variant">
            <tr>
              <th className="px-3 py-2">Reason</th>
              <th className="px-3 py-2">Payer</th>
              <th className="px-3 py-2">Amount</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Reconciliation</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {!lines.length ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-on-surface-variant">
                  No receivable lines match this filter.
                </td>
              </tr>
            ) : (
              lines.map((line) => {
                const isBusy = busy === line.line_key;
                const canMarkPaid = line.due_paise > 0;
                const canMarkUnpaid = line.payment_status === 'paid' || line.settled_paise > 0;
                return (
                  <tr key={line.line_key} className="border-t border-outline-variant/60">
                    <td className="px-3 py-3 align-top">
                      <p className="font-medium text-on-surface">{line.reason}</p>
                      <p className="text-label-sm text-on-surface-variant mt-0.5">
                        {KIND_LABEL[line.kind]} · {line.channel_label}
                      </p>
                      {line.registration_id ? (
                        <Link
                          href={
                            line.event_id
                              ? `/admin/registrations?event=${encodeURIComponent(line.event_id)}`
                              : '/admin/registrations'
                          }
                          className="text-label-sm text-primary underline"
                        >
                          View registration
                        </Link>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 align-top">
                      <p>{line.payer_name}</p>
                      <p className="text-label-sm text-on-surface-variant">{line.payer_email}</p>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <p>{formatCostForDisplay(line.amount_paise)}</p>
                      <p className="text-label-sm text-on-surface-variant">
                        Due {formatCostForDisplay(line.due_paise)}
                      </p>
                    </td>
                    <td className="px-3 py-3 align-top capitalize">{line.payment_status}</td>
                    <td className="px-3 py-3 align-top max-w-xs">
                      <p className="text-label-sm">{line.recon_hint}</p>
                      {line.bank_reference ? (
                        <p className="text-label-sm text-on-surface-variant mt-1">
                          Ref: {line.bank_reference}
                        </p>
                      ) : null}
                      {line.proof_id ? (
                        <Link
                          href="/admin/remittance-proofs"
                          className="text-label-sm text-primary underline mt-1 inline-block"
                        >
                          Open proof queue
                        </Link>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 align-top">
                      <div className="flex flex-wrap gap-2">
                        {canMarkPaid ? (
                          <button
                            type="button"
                            disabled={isBusy}
                            className={BUTTON_PRIMARY}
                            onClick={() => void patchLine(line, 'paid')}
                          >
                            Mark paid
                          </button>
                        ) : null}
                        {canMarkUnpaid ? (
                          <button
                            type="button"
                            disabled={isBusy}
                            className={BUTTON_OUTLINE}
                            onClick={() => void patchLine(line, 'pending')}
                          >
                            Mark unpaid
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}