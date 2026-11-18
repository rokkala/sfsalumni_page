'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import AdminShell from '@/components/admin-shell';

type Tab = 'transactions' | 'settlements';

type PortalLink = {
  kind: 'donation' | 'registration';
  id: string;
  label: string;
  member_name: string;
  member_email: string;
};

type TxRow = {
  event_type: string;
  event_status: string;
  event_time: string;
  order_id: string;
  order_amount_inr: number | null;
  payment_amount_inr: number | null;
  payment_utr: string | null;
  payment_group: string | null;
  payment_time: string | null;
  customer_name: string | null;
  customer_email: string | null;
  portal_links: PortalLink[];
  in_portal: boolean;
};

type TxPayload = {
  mode: string;
  from: string;
  to: string;
  count: number;
  rows: TxRow[];
};

type SettlementRow = {
  cf_settlement_id: string | null;
  status: string;
  status_description: string | null;
  settlement_utr: string | null;
  payment_from: string | null;
  payment_till: string | null;
  settlement_initiated_on: string | null;
  settlement_processed_on: string | null;
  payment_amount_inr: number | null;
  fees_inr: number | null;
  adjustment_inr: number | null;
  amount_settled_inr: number | null;
  settlement_type: string | null;
  order_id: string | null;
  payment_utr: string | null;
};

type SettlementPayload = {
  mode: string;
  from: string;
  to: string;
  count: number;
  total_settled_inr: number;
  rows: SettlementRow[];
};

function formatInr(rupees: number | null): string {
  if (rupees == null || !Number.isFinite(rupees)) return '—';
  return `₹${rupees.toLocaleString('en-IN')}`;
}

function formatWhen(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-IN');
}

function defaultFromTo() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(start), to: iso(end) };
}

function portalHref(link: PortalLink): string {
  if (link.kind === 'donation') return `/admin/donations`;
  return `/admin/registrations`;
}

function csvEscape(v: string) {
  if (v.includes(',') || v.includes('"') || v.includes('\n')) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

export default function AdminCashfreeTransactionsPage() {
  const def = useMemo(() => defaultFromTo(), []);
  const [tab, setTab] = useState<Tab>('transactions');
  const [from, setFrom] = useState(def.from);
  const [to, setTo] = useState(def.to);
  const [onlyPortal, setOnlyPortal] = useState(false);
  const [txData, setTxData] = useState<TxPayload | null>(null);
  const [settlementData, setSettlementData] = useState<SettlementPayload | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ from, to });
    try {
      if (tab === 'transactions') {
        if (onlyPortal) params.set('portal', '1');
        const res = await fetch(`/api/admin/cashfree-transactions?${params}`, { cache: 'no-store' });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(payload.error || 'Could not load transactions');
          setTxData(null);
          return;
        }
        setTxData(payload as TxPayload);
      } else {
        const res = await fetch(`/api/admin/cashfree-settlements?${params}`, { cache: 'no-store' });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(payload.error || 'Could not load settlements');
          setSettlementData(null);
          return;
        }
        setSettlementData(payload as SettlementPayload);
      }
    } catch {
      setError(tab === 'transactions' ? 'Could not load transactions' : 'Could not load settlements');
      setTxData(null);
      setSettlementData(null);
    } finally {
      setLoading(false);
    }
  }, [from, to, onlyPortal, tab]);

  useEffect(() => {
    void load();
  }, [load]);

  function downloadCsv() {
    const escape = csvEscape;
    if (tab === 'transactions' && txData?.rows.length) {
      const headers = [
        'event_time',
        'event_type',
        'event_status',
        'order_id',
        'payment_amount_inr',
        'payment_utr',
        'payment_group',
        'customer_name',
        'customer_email',
        'in_portal',
      ];
      const lines = [
        headers.join(','),
        ...txData.rows.map((r) =>
          [
            r.event_time,
            r.event_type,
            r.event_status,
            r.order_id,
            r.payment_amount_inr ?? '',
            r.payment_utr ?? '',
            r.payment_group ?? '',
            r.customer_name ?? '',
            r.customer_email ?? '',
            r.in_portal ? 'yes' : 'no',
          ]
            .map((c) => escape(String(c)))
            .join(',')
        ),
      ];
      triggerCsvDownload(lines.join('\n'), `cashfree-transactions-${txData.from}-${txData.to}.csv`);
      return;
    }
    if (tab === 'settlements' && settlementData?.rows.length) {
      const headers = [
        'cf_settlement_id',
        'status',
        'settlement_utr',
        'payment_from',
        'payment_till',
        'settlement_initiated_on',
        'settlement_processed_on',
        'payment_amount_inr',
        'fees_inr',
        'adjustment_inr',
        'amount_settled_inr',
        'settlement_type',
      ];
      const lines = [
        headers.join(','),
        ...settlementData.rows.map((r) =>
          [
            r.cf_settlement_id ?? '',
            r.status,
            r.settlement_utr ?? '',
            r.payment_from ?? '',
            r.payment_till ?? '',
            r.settlement_initiated_on ?? '',
            r.settlement_processed_on ?? '',
            r.payment_amount_inr ?? '',
            r.fees_inr ?? '',
            r.adjustment_inr ?? '',
            r.amount_settled_inr ?? '',
            r.settlement_type ?? '',
          ]
            .map((c) => escape(String(c)))
            .join(',')
        ),
      ];
      triggerCsvDownload(lines.join('\n'), `cashfree-settlements-${settlementData.from}-${settlementData.to}.csv`);
    }
  }

  function triggerCsvDownload(body: string, filename: string) {
    const blob = new Blob([body], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  const hasCsv =
    tab === 'transactions'
      ? Boolean(txData?.rows.length)
      : Boolean(settlementData?.rows.length);

  return (
    <AdminShell title="Cashfree reports">
      <p className="text-body-sm text-on-surface-variant mb-4 max-w-3xl">
        <strong className="font-semibold text-on-surface">Transactions</strong> — customer payments
        and refunds (reconciliation API), matched to portal registrations and donations.{' '}
        <strong className="font-semibold text-on-surface">Settlements</strong> — batches Cashfree
        sends to your bank (gross, fees, net, settlement UTR). Offline member UTR is on{' '}
        <Link href="/admin/remittance-proofs" className="text-primary underline font-medium">
          Remittance proofs
        </Link>
        .
      </p>

      <div
        role="tablist"
        aria-label="Cashfree report type"
        className="flex flex-wrap gap-2 mb-6 border-b border-outline-variant pb-3"
      >
        {(
          [
            ['transactions', 'Transactions'],
            ['settlements', 'Settlements'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`rounded-xl px-4 py-2.5 text-label-sm cursor-pointer ${
              tab === key
                ? 'bg-primary text-on-primary shadow-sm'
                : 'bg-surface-container text-primary hover:bg-secondary-container/50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-col lg:flex-row flex-wrap gap-3 mb-6 items-end">
        <label className="block">
          <span className="text-label-sm uppercase tracking-wider text-primary">From</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="mt-1 block px-4 py-3 rounded-lg border border-outline-variant text-body-sm"
          />
        </label>
        <label className="block">
          <span className="text-label-sm uppercase tracking-wider text-primary">To</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="mt-1 block px-4 py-3 rounded-lg border border-outline-variant text-body-sm"
          />
        </label>
        {tab === 'transactions' ? (
          <label className="flex items-center gap-2 text-body-sm cursor-pointer pb-3">
            <input
              type="checkbox"
              checked={onlyPortal}
              onChange={(e) => setOnlyPortal(e.target.checked)}
            />
            Only orders linked in the portal
          </label>
        ) : null}
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-lg bg-primary text-on-primary px-4 py-2.5 text-label-sm disabled:opacity-50 cursor-pointer"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        <button
          type="button"
          onClick={downloadCsv}
          disabled={!hasCsv}
          className="rounded-lg border border-primary/20 px-4 py-2.5 text-label-sm text-primary disabled:opacity-40 cursor-pointer"
        >
          Download CSV
        </button>
      </div>

      {error ? (
        <p className="rounded-lg bg-error-container text-error text-body-sm p-3 mb-4">{error}</p>
      ) : null}

      {tab === 'transactions' && txData ? (
        <p className="text-label-sm text-on-surface-variant mb-3 tabular-nums">
          Mode: <span className="text-primary font-medium">{txData.mode}</span> · {txData.count}{' '}
          payment events · {txData.from} → {txData.to}
        </p>
      ) : null}
      {tab === 'settlements' && settlementData ? (
        <p className="text-label-sm text-on-surface-variant mb-3 tabular-nums">
          Mode: <span className="text-primary font-medium">{settlementData.mode}</span> ·{' '}
          {settlementData.count} settlements · net to bank{' '}
          <span className="text-primary font-semibold">
            {formatInr(settlementData.total_settled_inr)}
          </span>{' '}
          · {settlementData.from} → {settlementData.to}
        </p>
      ) : null}

      {tab === 'transactions' ? (
        <div className="overflow-x-auto rounded-2xl border border-primary/10 bg-surface-paper shadow-sm">
          <table className="min-w-full text-left text-body-sm">
            <thead className="bg-primary text-label-sm text-secondary-container">
              <tr>
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Order id</th>
                <th className="px-4 py-3">UTR</th>
                <th className="px-4 py-3">Method</th>
                <th className="px-4 py-3">Portal</th>
              </tr>
            </thead>
            <tbody>
              {!loading && (!txData || txData.rows.length === 0) ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-on-surface-variant">
                    No Cashfree payment events in this range.
                  </td>
                </tr>
              ) : (
                (txData?.rows || []).map((r, i) => (
                  <tr
                    key={`${r.order_id}-${r.event_time}-${i}`}
                    className="border-t border-jubilee-gold-light/60 odd:bg-surface-ivory/70 align-top"
                  >
                    <td className="px-4 py-3 whitespace-nowrap text-on-surface-variant">
                      {formatWhen(r.event_time)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="block text-primary font-medium">{r.event_status || '—'}</span>
                      <span className="text-label-sm text-on-surface-variant">{r.event_type}</span>
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {formatInr(r.payment_amount_inr ?? r.order_amount_inr)}
                    </td>
                    <td className="px-4 py-3 font-mono text-label-sm break-all max-w-[12rem]">
                      {r.order_id || '—'}
                    </td>
                    <td className="px-4 py-3 text-label-sm break-all max-w-[10rem]">
                      {r.payment_utr || '—'}
                    </td>
                    <td className="px-4 py-3 text-on-surface-variant">{r.payment_group || '—'}</td>
                    <td className="px-4 py-3">
                      {r.portal_links.length === 0 ? (
                        <span className="text-on-surface-variant">—</span>
                      ) : (
                        <ul className="space-y-1">
                          {r.portal_links.map((link) => (
                            <li key={`${link.kind}-${link.id}`}>
                              <Link href={portalHref(link)} className="text-primary underline">
                                {link.kind === 'donation' ? 'Donation' : 'Registration'}
                              </Link>
                              <span className="text-label-sm text-on-surface-variant block">
                                {link.member_name} · {link.label}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-primary/10 bg-surface-paper shadow-sm">
          <table className="min-w-full text-left text-body-sm">
            <thead className="bg-primary text-label-sm text-secondary-container">
              <tr>
                <th className="px-4 py-3">Initiated</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Settlement UTR</th>
                <th className="px-4 py-3">Period</th>
                <th className="px-4 py-3 text-right">Gross</th>
                <th className="px-4 py-3 text-right">Fees</th>
                <th className="px-4 py-3 text-right">Adj.</th>
                <th className="px-4 py-3 text-right">Net settled</th>
              </tr>
            </thead>
            <tbody>
              {!loading && (!settlementData || settlementData.rows.length === 0) ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-on-surface-variant">
                    No settlements in this range.
                  </td>
                </tr>
              ) : (
                (settlementData?.rows || []).map((r, i) => (
                  <tr
                    key={`${r.cf_settlement_id}-${i}`}
                    className="border-t border-jubilee-gold-light/60 odd:bg-surface-ivory/70 align-top"
                  >
                    <td className="px-4 py-3 whitespace-nowrap text-on-surface-variant">
                      {formatWhen(r.settlement_initiated_on || r.settlement_processed_on)}
                      {r.cf_settlement_id ? (
                        <span className="block text-label-sm font-mono mt-0.5">{r.cf_settlement_id}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <span className="block text-primary font-medium">{r.status || '—'}</span>
                      {r.status_description ? (
                        <span className="text-label-sm text-on-surface-variant">{r.status_description}</span>
                      ) : null}
                      {r.settlement_type ? (
                        <span className="text-label-sm text-on-surface-variant block">{r.settlement_type}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-label-sm break-all max-w-[10rem] font-mono">
                      {r.settlement_utr || '—'}
                    </td>
                    <td className="px-4 py-3 text-label-sm text-on-surface-variant">
                      {r.payment_from || r.payment_till ? (
                        <>
                          {formatWhen(r.payment_from)}
                          <span className="block">→ {formatWhen(r.payment_till)}</span>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatInr(r.payment_amount_inr)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatInr(r.fees_inr)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatInr(r.adjustment_inr)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium text-primary">
                      {formatInr(r.amount_settled_inr)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </AdminShell>
  );
}