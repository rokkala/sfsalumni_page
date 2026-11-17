'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import AdminShell from '@/components/admin-shell';
import ReconciledRegsModal from '@/components/admin-tools/reconciled-regs-modal';

type GiftBucket = { count: number; paid_paise: number; pending_paise: number };

type ReconciliationSnapshot = {
  pending_utr_proofs: number;
  pending_gifts_without_proof: number;
  pending_cause_gifts_queued: number;
  unpaid_registrations: number;
  action_total: number;
};

type Overview = {
  pendingMembers: number;
  publishedEvents: number;
  unpaidRegistrations: number;
  pendingMemories?: number;
  pendingStories?: number;
  pendingApprovals?: number;
  amountPaidPaise?: number;
  amountDuePaise?: number;
  registrationCount?: number;
  gifts?: { cause_gifts: GiftBucket; event_gifts: GiftBucket };
  giftsPaidPaise?: number;
  giftsPendingPaise?: number;
  totalReceivedPaise?: number;
  reconciliation?: ReconciliationSnapshot;
  catalogReady?: boolean;
};

export default function AdminOverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [reconciledOpen, setReconciledOpen] = useState(false);
  const closeReconciled = useCallback(() => setReconciledOpen(false), []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/overview');
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(payload.error || 'Could not load overview');
          return;
        }
        setData(payload as Overview);
      } catch {
        setError('Could not load overview');
      }
    })();
  }, []);

  const moneyPaid =
    data?.amountPaidPaise != null
      ? `₹${(data.amountPaidPaise / 100).toLocaleString('en-IN')}`
      : '—';
  const moneyDue =
    data?.amountDuePaise != null
      ? `₹${(data.amountDuePaise / 100).toLocaleString('en-IN')}`
      : '—';
  const giftsPaid =
    data?.giftsPaidPaise != null
      ? `₹${(data.giftsPaidPaise / 100).toLocaleString('en-IN')}`
      : '—';
  const totalReceived =
    data?.totalReceivedPaise != null
      ? `₹${(data.totalReceivedPaise / 100).toLocaleString('en-IN')}`
      : moneyPaid;

  const cards = [
    {
      href: '/admin/approvals',
      label: 'Pending approvals',
      value: data?.pendingApprovals ?? '—',
      hint: 'Memberships, memories, and stories',
      icon: 'fact_check',
      tone: 'gold' as const,
    },
    {
      href: '/admin/event-ops',
      label: 'Registrations',
      value: data?.registrationCount ?? '—',
      hint: 'Money, exceptions, check-ins',
      icon: 'analytics',
      tone: 'navy' as const,
    },
    {
      label: 'Total received',
      value: totalReceived,
      hint: `Regs ${moneyPaid} · donations ${giftsPaid} · due ${moneyDue}`,
      icon: 'payments',
      tone: 'amber' as const,
      onClick: () => setReconciledOpen(true),
    },
    {
      href: '/admin/donations',
      label: 'Donations received',
      value: giftsPaid,
      hint:
        data?.gifts != null
          ? `Cause ${data.gifts.cause_gifts.count} · registration ${data.gifts.event_gifts.count} paid`
          : 'All paid donation rows',
      icon: 'volunteer_activism',
      tone: 'gold' as const,
    },
    {
      href: '/admin/registrations',
      label: 'Unpaid / partial',
      value: data?.unpaidRegistrations ?? '—',
      hint: 'Review and mark paid',
      icon: 'confirmation_number',
      tone: 'amber' as const,
    },
    {
      href: '/admin/events',
      label: 'Published events',
      value: data?.publishedEvents ?? '—',
      hint: data?.catalogReady === false ? 'Apply event_catalog migration' : 'Create and price events',
      icon: 'event',
      tone: 'navy' as const,
    },
    {
      href: '/admin/membership',
      label: 'Pending memberships',
      value: data?.pendingMembers ?? '—',
      hint: 'Approve or reject applicants',
      icon: 'group',
      tone: 'gold' as const,
    },
  ];

  const toneClass = {
    gold: {
      card: 'border-jubilee-gold-light bg-gradient-to-br from-secondary-container/35 to-surface-paper',
      iconWrap: 'bg-secondary-container text-on-secondary-container',
    },
    navy: {
      card: 'border-primary/15 bg-gradient-to-br from-primary-fixed/50 to-surface-paper',
      iconWrap: 'bg-primary text-secondary-container',
    },
    amber: {
      card: 'border-jubilee-amber/25 bg-gradient-to-br from-jubilee-gold-light/50 to-surface-paper',
      iconWrap: 'bg-jubilee-gold-deep text-on-primary',
    },
  };

  return (
    <AdminShell title="Overview">
      {error && (
        <p className="rounded-xl border border-error-container bg-error-container/40 p-4 text-body-sm text-on-error-container mb-4">
          {error}
        </p>
      )}

      {data?.reconciliation && data.reconciliation.action_total > 0 ? (
        <section className="rounded-2xl border border-primary/15 bg-surface-paper p-5 mb-6 shadow-sm">
          <h2 className="text-headline-sm text-primary">Reconciliation queue</h2>
          <p className="text-body-sm text-on-surface-variant mt-1 mb-4">
            Work through these in order: bank proofs → donations without proof → unpaid registrations.
          </p>
          <ul className="grid gap-3 sm:grid-cols-3">
            <li>
              <Link
                href="/admin/payment-accounts"
                className="block rounded-xl border border-outline-variant bg-white p-4 hover:border-primary/30"
              >
                <p className="text-display-sm text-primary tabular-nums">
                  {data.reconciliation.pending_utr_proofs}
                </p>
                <p className="text-label-md text-primary font-bold mt-1">UTR proofs to review</p>
                <p className="text-body-sm text-on-surface-variant mt-1">
                  Registration + cause donations ({data.reconciliation.pending_cause_gifts_queued}{' '}
                  cause-only)
                </p>
              </Link>
            </li>
            <li>
              <Link
                href="/admin/donations?status=pending"
                className="block rounded-xl border border-outline-variant bg-white p-4 hover:border-primary/30"
              >
                <p className="text-display-sm text-primary tabular-nums">
                  {data.reconciliation.pending_gifts_without_proof}
                </p>
                <p className="text-label-md text-primary font-bold mt-1">Donations awaiting payment</p>
                <p className="text-body-sm text-on-surface-variant mt-1">No proof in queue yet</p>
              </Link>
            </li>
            <li>
              <Link
                href="/admin/registrations"
                className="block rounded-xl border border-outline-variant bg-white p-4 hover:border-primary/30"
              >
                <p className="text-display-sm text-primary tabular-nums">
                  {data.reconciliation.unpaid_registrations}
                </p>
                <p className="text-label-md text-primary font-bold mt-1">Unpaid / partial regs</p>
                <p className="text-body-sm text-on-surface-variant mt-1">Fees or bundled donations</p>
              </Link>
            </li>
          </ul>
        </section>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => {
          const t = toneClass[c.tone];
          const inner = (
            <>
              <span
                className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${t.iconWrap}`}
              >
                <span className="material-symbols-outlined text-[22px]">{c.icon}</span>
              </span>
              <div className="text-display-sm text-primary mt-4 tabular-nums">{c.value}</div>
              <div className="text-label-md text-primary font-bold mt-1">{c.label}</div>
              <p className="text-body-sm text-on-surface-variant mt-1">{c.hint}</p>
            </>
          );
          const className = `rounded-2xl border p-5 text-left shadow-sm transition-transform hover:-translate-y-0.5 ${t.card}`;
          if (c.onClick) {
            return (
              <button
                key={c.label}
                type="button"
                onClick={c.onClick}
                aria-haspopup="dialog"
                className={`${className} cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/30`}
              >
                {inner}
              </button>
            );
          }
          return (
            <Link key={c.label} href={c.href!} className={className}>
              {inner}
            </Link>
          );
        })}
      </div>
      <ReconciledRegsModal open={reconciledOpen} onClose={closeReconciled} />
    </AdminShell>
  );
}
