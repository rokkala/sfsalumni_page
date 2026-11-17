'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import AdminShell from '@/components/admin-shell';

type DonationRow = {
  id: string;
  amount_paise: number;
  message: string | null;
  payment_status: string;
  razorpay_payment_id: string | null;
  razorpay_order_id?: string | null;
  created_at: string;
  kind?: 'cause' | 'event';
  cause_title: string;
  donor_name: string;
  donor_email: string;
  channel_label?: string;
  recon_hint?: string;
  proof_id?: string | null;
};

function formatInr(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN')}`;
}

export default function AdminDonationsPage() {
  const searchParams = useSearchParams();
  const [donations, setDonations] = useState<DonationRow[]>([]);
  const initialStatus = searchParams.get('status');
  const [statusFilter, setStatusFilter] = useState<'all' | 'paid' | 'pending' | 'failed'>(
    initialStatus === 'pending' || initialStatus === 'paid' || initialStatus === 'failed'
      ? initialStatus
      : 'all'
  );
  const [error, setError] = useState('');

  const loadDonations = useCallback(async () => {
    const q = statusFilter === 'all' ? '' : `?status=${statusFilter}`;
    const res = await fetch(`/api/admin/donations${q}`, { cache: 'no-store' });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.error || 'Could not load donations');
    setDonations(payload.donations || []);
  }, [statusFilter]);

  useEffect(() => {
    setError('');
    void loadDonations().catch((e) =>
      setError(e instanceof Error ? e.message : 'Could not load')
    );
  }, [loadDonations]);

  return (
    <AdminShell title="Donation report">
      <p className="text-body-sm text-on-surface-variant mb-6 max-w-3xl">
        Ledger of all donations (standalone at{' '}
        <code className="text-label-sm">/member/donate</code> and add-ons on registration). Each row
        shows <strong className="font-semibold text-on-surface">channel</strong> and the next
        reconciliation step. UTR review is on{' '}
        <Link href="/admin/remittance-proofs" className="text-primary underline font-medium">
          Remittance proofs
        </Link>
        . To add funds members can choose, use{' '}
        <Link href="/admin/donation-causes" className="text-primary underline font-medium">
          Donation types
        </Link>
        .
      </p>

      {error ? (
        <p className="rounded-lg bg-error-container text-error text-body-sm p-3 mb-4">{error}</p>
      ) : null}

      <p className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <span className="text-headline-sm text-primary">
          Donations received ({donations.length})
        </span>
        <span className="flex gap-1">
          {(['all', 'paid', 'pending', 'failed'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={`rounded-full px-3 py-1.5 text-label-sm capitalize ${
                statusFilter === s
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface-container text-primary'
              }`}
            >
              {s}
            </button>
          ))}
        </span>
      </p>

      {!donations.length ? (
        <p className="text-body-sm text-on-surface-variant">No donations yet.</p>
      ) : (
        <ul className="space-y-3 max-w-3xl">
          {donations.map((d) => (
            <li
              key={d.id}
              className="rounded-xl border border-outline-variant bg-white p-4 text-body-sm"
            >
              <div className="flex flex-wrap justify-between gap-2">
                <p className="font-semibold text-primary">
                  {formatInr(d.amount_paise)} · {d.cause_title}
                </p>
                <div className="flex flex-wrap gap-2 items-center">
                  {d.channel_label ? (
                    <span className="text-label-sm rounded-md bg-surface-container px-2 py-0.5 text-primary">
                      {d.channel_label}
                    </span>
                  ) : null}
                  <span className="text-label-sm uppercase tracking-wider text-jubilee-gold-deep">
                    {d.payment_status}
                  </span>
                </div>
              </div>
              <p className="text-on-surface-variant mt-1">
                {d.donor_name} · {d.donor_email}
                {d.kind === 'event' ? (
                  <span className="ml-1 text-label-sm">· registration add-on</span>
                ) : (
                  <span className="ml-1 text-label-sm">· standalone cause</span>
                )}
              </p>
              {d.message ? <p className="mt-1 text-on-surface">{d.message}</p> : null}
              {d.recon_hint ? (
                <p className="mt-2 text-body-sm text-on-surface-variant">{d.recon_hint}</p>
              ) : null}
              {d.proof_id ? (
                <p className="mt-2">
                  <Link
                    href="/admin/remittance-proofs"
                    className="text-primary text-label-sm font-bold uppercase tracking-wider underline"
                  >
                    Review UTR proof
                  </Link>
                </p>
              ) : d.payment_status === 'pending' && d.kind === 'event' ? (
                <p className="mt-2">
                  <Link
                    href="/admin/remittance-proofs"
                    className="text-primary text-label-sm font-bold uppercase tracking-wider underline"
                  >
                    Review registration proof
                  </Link>
                </p>
              ) : null}
              <p className="text-on-surface-variant mt-2 text-label-sm">
                {new Date(d.created_at).toLocaleString('en-IN')}
                {d.razorpay_payment_id ? ` · ref ${d.razorpay_payment_id}` : ''}
                {d.razorpay_order_id ? ` · order ${d.razorpay_order_id}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </AdminShell>
  );
}