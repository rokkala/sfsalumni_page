'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import AdminShell from '@/components/admin-shell';
import { openCashfreeCheckout } from '@/lib/payments/checkout-client';

export default function AdminCashfreeSmokePage() {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const start = useCallback(async () => {
    setBusy(true);
    setStatus('Creating ₹1 order…');
    try {
      const res = await fetch('/api/admin/cashfree-smoke', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(String(data.error || res.statusText || 'Could not create order'));
        return;
      }
      setStatus(`Order ${data.orderId}. Opening Cashfree…`);
      const result = await openCashfreeCheckout({
        orderId: String(data.orderId),
        paymentSessionId: String(data.paymentSessionId),
        mode: data.mode === 'production' ? 'production' : 'sandbox',
        description: 'Smoke test ₹1',
      });
      if (result && 'failed' in result && result.failed) {
        setStatus(result.message);
      } else if (result && 'order_id' in result) {
        setStatus(
          'Checkout closed. If you paid, confirm in Cashfree dashboard or wait for the webhook.'
        );
      } else {
        setStatus('Checkout closed.');
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <AdminShell title="Cashfree smoke test">
      <p className="text-body-sm text-on-surface-variant max-w-xl mb-4">
        Opens live Cashfree checkout for <strong className="text-on-surface">₹1</strong> on this
        site&apos;s domain (required — Cashfree blocks <code className="text-xs">localhost</code>{' '}
        unless whitelisted). Choose <strong className="text-on-surface">UPI</strong> in the
        modal. This is a real charge.{' '}
        <strong className="font-semibold text-on-surface">This test does not create a row</strong> in
        Admin → Donations or Bank / UPI — check the Cashfree merchant dashboard instead. Member gifts
        at <code className="text-xs">/member/donate</code> do appear under Admin → Donations.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => void start()}
        className="rounded-xl bg-primary px-5 py-2.5 text-label-lg text-on-primary font-semibold disabled:opacity-50"
      >
        {busy ? 'Please wait…' : 'Start ₹1 UPI test'}
      </button>
      {status ? (
        <p className="text-body-sm text-on-surface-variant mt-4 max-w-xl" role="status">
          {status}
        </p>
      ) : null}
      <p className="text-body-sm mt-6">
        <Link href="/admin/payment-accounts" className="text-primary underline">
          Back to payment accounts
        </Link>
      </p>
    </AdminShell>
  );
}