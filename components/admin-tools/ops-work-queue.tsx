'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type ReconciliationSnapshot = {
  pending_utr_proofs: number;
  pending_gifts_without_proof: number;
  pending_cause_gifts_queued: number;
  unpaid_registrations: number;
  action_total: number;
};

/**
 * Shared “what to do next” strip for overview, event ops, and registrations.
 */
export default function OpsWorkQueue({
  eventId = '',
  className = '',
}: {
  eventId?: string;
  className?: string;
}) {
  const [recon, setRecon] = useState<ReconciliationSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch('/api/admin/overview', { cache: 'no-store' });
        const payload = await res.json().catch(() => ({}));
        if (!active) return;
        if (res.ok && payload.reconciliation) {
          setRecon(payload.reconciliation as ReconciliationSnapshot);
        } else {
          setRecon(null);
        }
      } catch {
        if (active) setRecon(null);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  function regStateHref(state: string) {
    const p = new URLSearchParams();
    if (eventId) p.set('event', eventId);
    p.set('state', state);
    return `/admin/registrations?${p}`;
  }

  if (loading) {
    return (
      <div
        className={`rounded-2xl border border-primary/10 bg-surface-paper p-5 animate-pulse ${className}`}
        aria-hidden
      >
        <div className="h-5 w-48 bg-surface-container rounded mb-3" />
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="h-20 bg-surface-container rounded-xl" />
          <div className="h-20 bg-surface-container rounded-xl" />
          <div className="h-20 bg-surface-container rounded-xl" />
        </div>
      </div>
    );
  }

  if (!recon || recon.action_total === 0) {
    return (
      <section
        className={`rounded-2xl border border-jubilee-gold-light/60 bg-secondary-container/15 p-5 ${className}`}
      >
        <p className="text-body-sm text-on-surface-variant">
          <span className="material-symbols-outlined text-[18px] align-middle mr-1 text-primary">
            check_circle
          </span>
          Nothing waiting in the money queue. Use{' '}
          <Link href="/admin/event-ops" className="text-primary underline">
            Event ops
          </Link>{' '}
          for attendance reports.
        </p>
      </section>
    );
  }

  return (
    <section className={`rounded-2xl border border-primary/15 bg-surface-paper p-5 shadow-sm ${className}`}>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h2 className="text-headline-sm text-primary">Work queue</h2>
          <p className="text-body-sm text-on-surface-variant mt-1">
            Do these in order: verify bank proofs → chase pending donations → confirm registrations.
          </p>
        </div>
        <p className="text-label-sm text-on-surface-variant tabular-nums">
          <span className="text-primary font-bold">{recon.action_total}</span> items need attention
        </p>
      </div>
      <ol className="grid gap-3 sm:grid-cols-3 list-none">
        <li>
          <Link
            href="/admin/payment-accounts"
            className="block h-full rounded-xl border border-outline-variant bg-white p-4 hover:border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/25"
          >
            <p className="text-label-sm font-bold uppercase tracking-wider text-jubilee-gold-deep">Step 1</p>
            <p className="text-display-sm text-primary tabular-nums mt-1">{recon.pending_utr_proofs}</p>
            <p className="text-label-md text-primary font-bold mt-1">Review payment proofs</p>
            <p className="text-body-sm text-on-surface-variant mt-1">
              UTR screenshots in Bank / UPI ({recon.pending_cause_gifts_queued} cause-only)
            </p>
          </Link>
        </li>
        <li>
          <Link
            href="/admin/donations?status=pending"
            className="block h-full rounded-xl border border-outline-variant bg-white p-4 hover:border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/25"
          >
            <p className="text-label-sm font-bold uppercase tracking-wider text-jubilee-gold-deep">Step 2</p>
            <p className="text-display-sm text-primary tabular-nums mt-1">{recon.pending_gifts_without_proof}</p>
            <p className="text-label-md text-primary font-bold mt-1">Pending donations</p>
            <p className="text-body-sm text-on-surface-variant mt-1">Not yet matched to a proof</p>
          </Link>
        </li>
        <li>
          <div className="h-full rounded-xl border border-outline-variant bg-white p-4">
            <p className="text-label-sm font-bold uppercase tracking-wider text-jubilee-gold-deep">Step 3</p>
            <p className="text-display-sm text-primary tabular-nums mt-1">{recon.unpaid_registrations}</p>
            <p className="text-label-md text-primary font-bold mt-1">Registration money</p>
            <p className="text-body-sm text-on-surface-variant mt-2 flex flex-wrap gap-2">
              <Link href={regStateHref('awaiting_verification')} className="text-primary underline">
                Awaiting proof
              </Link>
              <Link href={regStateHref('partial')} className="text-primary underline">
                Partly paid
              </Link>
              <Link href={regStateHref('unpaid')} className="text-primary underline">
                Unpaid
              </Link>
            </p>
          </div>
        </li>
      </ol>
    </section>
  );
}