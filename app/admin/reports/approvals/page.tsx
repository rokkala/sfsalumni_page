'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import AdminShell from '@/components/admin-shell';
import type { ApprovalAuditKind, ApprovalAuditRow } from '@/lib/admin/approval-audit';

type ReviewerOption = { id: string; name: string };

type Payload = {
  count: number;
  rows: ApprovalAuditRow[];
  reviewers: ReviewerOption[];
  filters: { kind: string; reviewer: string | null };
};

const KIND_OPTIONS: { value: ApprovalAuditKind | 'all'; label: string }[] = [
  { value: 'all', label: 'All types' },
  { value: 'membership', label: 'Membership' },
  { value: 'admin_account', label: 'Admin account' },
  { value: 'memory', label: 'Memory' },
  { value: 'story', label: 'Story' },
  { value: 'remittance_proof', label: 'Remittance proof' },
  { value: 'registration_payment', label: 'Registration payment' },
  { value: 'donation_payment', label: 'Donation payment' },
];

const KIND_LABEL: Record<ApprovalAuditKind, string> = {
  membership: 'Membership',
  admin_account: 'Admin account',
  memory: 'Memory',
  story: 'Story',
  remittance_proof: 'Remittance proof',
  registration_payment: 'Registration payment',
  donation_payment: 'Donation payment',
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-IN');
}

function decisionClass(decision: string): string {
  const d = decision.toLowerCase();
  if (['verified', 'published', 'approved', 'paid'].includes(d)) {
    return 'bg-primary-container text-on-primary-container';
  }
  if (['rejected', 'failed', 'suspended'].includes(d)) {
    return 'bg-error-container text-error';
  }
  return 'bg-surface-container-high text-on-surface';
}

function actorBadge(actor: ApprovalAuditRow['actor']): string {
  if (actor === 'auto') return 'bg-jubilee-amber/15 text-jubilee-amber';
  if (actor === 'manual') return 'bg-surface-container-highest text-on-surface-variant';
  return 'bg-primary/10 text-primary';
}

export default function AdminApprovalAuditPage() {
  const [kind, setKind] = useState<ApprovalAuditKind | 'all'>('all');
  const [reviewer, setReviewer] = useState('');
  const [rows, setRows] = useState<ApprovalAuditRow[]>([]);
  const [reviewers, setReviewers] = useState<ReviewerOption[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ limit: '10000' });
    if (kind !== 'all') params.set('kind', kind);
    if (reviewer) params.set('reviewer', reviewer);
    const res = await fetch(`/api/admin/reports/approvals?${params}`, { cache: 'no-store' });
    const payload = (await res.json().catch(() => ({}))) as Payload & { error?: string };
    if (!res.ok) {
      setError(payload.error || 'Could not load report');
      setRows([]);
      setLoading(false);
      return;
    }
    setRows(payload.rows || []);
    setReviewers(payload.reviewers || []);
    setLoading(false);
  }, [kind, reviewer]);

  useEffect(() => {
    void load();
  }, [load]);

  const groupedCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      m.set(r.kind, (m.get(r.kind) || 0) + 1);
    }
    return m;
  }, [rows]);

  const autoCount = useMemo(() => rows.filter((r) => r.actor === 'auto').length, [rows]);

  return (
    <AdminShell title="Approval audit">
      <p className="text-body-sm text-on-surface-variant mb-4 max-w-3xl">
        Full audit trail: admin decisions (membership, content, remittance proofs) plus payment
        settlements. <strong className="font-semibold text-on-surface">Cashfree (auto)</strong> rows
        come from webhook, member verify, or receivables Cashfree sync when a gateway payment id is
        stored. <strong className="font-semibold text-on-surface">Committee (manual)</strong> is mark
        paid without a gateway id. UTR approvals appear once under remittance proof (not duplicated as
        payment rows).{' '}
        <Link href="/admin/reports" className="text-primary underline font-medium">
          All reports
        </Link>
        .
      </p>

      {error ? (
        <p className="rounded-lg bg-error-container text-error text-body-sm p-3 mb-4">{error}</p>
      ) : null}

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <label className="flex flex-col gap-1 text-label-sm text-on-surface-variant">
          Type
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as ApprovalAuditKind | 'all')}
            className="rounded-lg border border-outline-variant bg-surface px-3 py-2 text-body-sm min-w-[11rem]"
          >
            {KIND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-label-sm text-on-surface-variant">
          Actor
          <select
            value={reviewer}
            onChange={(e) => setReviewer(e.target.value)}
            className="rounded-lg border border-outline-variant bg-surface px-3 py-2 text-body-sm min-w-[14rem]"
          >
            <option value="">Everyone</option>
            {reviewers.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-lg bg-primary text-on-primary px-4 py-2 text-label-sm font-medium"
        >
          Refresh
        </button>
      </div>

      {!loading && rows.length ? (
        <p className="text-label-sm text-on-surface-variant mb-2">
          Showing {rows.length} row(s)
          {autoCount ? <span> · {autoCount} automatic (Cashfree)</span> : null}
          {[...groupedCount.entries()].map(([k, n]) => (
            <span key={k} className="ml-2">
              · {KIND_LABEL[k as ApprovalAuditKind] || k}: {n}
            </span>
          ))}
        </p>
      ) : null}

      {loading ? (
        <p className="text-body-sm text-on-surface-variant">Loading…</p>
      ) : !rows.length ? (
        <p className="text-body-sm text-on-surface-variant">No rows match these filters.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-outline-variant/40">
          <table className="w-full min-w-[56rem] text-left text-body-sm">
            <thead className="bg-surface-container text-label-sm text-on-surface-variant">
              <tr>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Subject</th>
                <th className="px-3 py-2 font-medium">Decision</th>
                <th className="px-3 py-2 font-medium">Actor</th>
                <th className="px-3 py-2 font-medium">Note</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={`${row.kind}-${row.entity_id}-${row.reviewed_at}-${row.actor}`}
                  className="border-t border-outline-variant/30"
                >
                  <td className="px-3 py-2 whitespace-nowrap text-on-surface-variant">
                    {formatWhen(row.reviewed_at)}
                  </td>
                  <td className="px-3 py-2">{KIND_LABEL[row.kind]}</td>
                  <td className="px-3 py-2">
                    {row.link_href ? (
                      <Link href={row.link_href} className="text-primary underline font-medium">
                        {row.subject}
                      </Link>
                    ) : (
                      row.subject
                    )}
                    {row.subject_detail ? (
                      <span className="block text-label-sm text-on-surface-variant truncate max-w-[18rem]">
                        {row.subject_detail}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-label-sm capitalize ${decisionClass(row.decision)}`}
                    >
                      {row.decision}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-label-sm ${actorBadge(row.actor)}`}
                    >
                      {row.reviewed_by_name || (row.actor === 'admin' ? 'Admin' : row.actor)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-on-surface-variant max-w-[14rem] truncate" title={row.note || ''}>
                    {row.note || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminShell>
  );
}