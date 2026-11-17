'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import MemberGate from '@/components/member-gate';
import AmountWithFx from '@/components/amount-with-fx';
import OfflinePayModal from '@/components/offline-pay-modal';
import { openCashfreeCheckout } from '@/lib/payments/checkout-client';
import PortalShell from '@/components/portal-shell';
import {
  DONATION_AMOUNT_CHIPS_PAISE,
  DONATION_MAX_MESSAGE,
} from '@/lib/donations/validate';
import type { BankAccountPublic } from '@/lib/payments/bank-details';

type Cause = {
  id: string;
  title: string;
  description: string | null;
};

function formatInrFromPaise(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN')}`;
}

export default function MemberDonatePage() {
  const searchParams = useSearchParams();
  const [causes, setCauses] = useState<Cause[] | null>(null);
  const [causeId, setCauseId] = useState('');
  const [chipPaise, setChipPaise] = useState<number | null>(DONATION_AMOUNT_CHIPS_PAISE[1]);
  const [customRupees, setCustomRupees] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [bankAccount, setBankAccount] = useState<BankAccountPublic | null>(null);
  const [offlineOpen, setOfflineOpen] = useState(false);
  const [payingOnline, setPayingOnline] = useState(false);
  const [onlineCheckoutEnabled, setOnlineCheckoutEnabled] = useState(false);
  const [offlineNote, setOfflineNote] = useState('');
  const [success, setSuccess] = useState<{
    amount_paise: number;
    causeTitle: string;
  } | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [causesRes, bankRes] = await Promise.all([
          fetch('/api/donations/causes', { cache: 'no-store' }),
          fetch('/api/payments/bank-details', { cache: 'no-store' }),
        ]);
        const payload = await causesRes.json().catch(() => ({}));
        const bankPayload = await bankRes.json().catch(() => ({}));
        if (!active) return;
        if (!causesRes.ok) {
          setCauses([]);
          setError(payload.error || 'Could not load causes');
        } else {
          const list = (payload.causes || []) as Cause[];
          setCauses(list);
          if (list[0]) setCauseId(list[0].id);
        }
        if (bankRes.ok && bankPayload.account) {
          setBankAccount(bankPayload.account as BankAccountPublic);
        } else {
          setBankAccount(null);
        }
        if (bankRes.ok) {
          setOnlineCheckoutEnabled(Boolean(bankPayload.online_checkout_available));
        } else {
          setOnlineCheckoutEnabled(false);
        }
      } catch {
        if (active) {
          setCauses([]);
          setError('Could not load causes');
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const selectedCause = causes?.find((c) => c.id === causeId) || null;

  const completeDonationVerify = useCallback(
    async (
      orderId: string,
      opts?: { donationId?: string; amountPaise?: number; causeTitle?: string }
    ) => {
      const verifyRes = await fetch('/api/donations/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(opts?.donationId ? { donationId: opts.donationId } : {}),
          order_id: orderId,
        }),
      });
      const verified = await verifyRes.json().catch(() => ({}));
      if (!verifyRes.ok) {
        setError(
          verified.error ||
            'Payment could not be confirmed yet. If money was debited, contact the committee.'
        );
        return false;
      }
      setSuccess({
        amount_paise: Number(verified.amount_paise) || opts?.amountPaise || 100,
        causeTitle: opts?.causeTitle || selectedCause?.title || 'Donation',
      });
      setError('');
      return true;
    },
    [selectedCause?.title]
  );

  useEffect(() => {
    const orderId = searchParams.get('cf_order_id')?.trim();
    if (!orderId) return;
    let active = true;
    setPayingOnline(true);
    setError('');
    void (async () => {
      const ok = await completeDonationVerify(orderId);
      if (!active) return;
      setPayingOnline(false);
      if (ok && typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        url.searchParams.delete('cf_order_id');
        window.history.replaceState({}, '', url.pathname + url.search);
      }
    })();
    return () => {
      active = false;
    };
  }, [searchParams, completeDonationVerify]);

  function amountPaise(): number | null {
    if (useCustom) {
      const n = Math.round(Number(customRupees) * 100);
      if (!Number.isFinite(n) || n < 100) return null;
      return n;
    }
    return chipPaise;
  }

  async function payOnline(e?: FormEvent) {
    e?.preventDefault();
    setError('');
    setSuccess(null);
    setOfflineNote('');
    if (!causeId) {
      setError('Choose a cause');
      return;
    }
    const paise = amountPaise();
    if (paise == null) {
      setError('Enter at least ₹1');
      return;
    }
    setPayingOnline(true);
    try {
      const res = await fetch('/api/donations/create-order', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          causeId,
          amountPaise: paise,
          message: message.trim() || undefined,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload.error || 'Could not start payment');
        return;
      }
      const checkout = await openCashfreeCheckout({
        orderId: String(payload.orderId),
        paymentSessionId: String(payload.paymentSessionId),
        mode: payload.checkoutMode === 'production' ? 'production' : 'sandbox',
        description: payload.description,
      });
      if (!checkout) return;
      if ('failed' in checkout) {
        setError(checkout.message);
        return;
      }
      const ok = await completeDonationVerify(checkout.order_id, {
        donationId: payload.donationId,
        amountPaise: paise,
        causeTitle: selectedCause?.title,
      });
      if (!ok) return;
    } catch {
      setError('Online payment failed. Please try again.');
    } finally {
      setPayingOnline(false);
    }
  }

  function openBankPay(e?: FormEvent) {
    e?.preventDefault();
    setError('');
    setSuccess(null);
    setOfflineNote('');
    if (!causeId) {
      setError('Choose a cause');
      return;
    }
    if (amountPaise() == null) {
      setError('Enter at least ₹1');
      return;
    }
    if (!bankAccount) {
      setError('Bank details are not configured yet. Contact the committee.');
      return;
    }
    setOfflineOpen(true);
  }

  return (
    <PortalShell title="Donate" intro="Support a cause that matters to SFS.">
      <MemberGate>
        {success ? (
          <section className="rounded-2xl border border-outline-variant bg-white p-6 sm:p-8 max-w-xl">
            <p className="text-label-sm uppercase tracking-widest text-jubilee-gold-deep font-bold">
              Thank you
            </p>
            <h2 className="text-headline-md text-primary mt-2">Donation received</h2>
            <p className="text-body-md text-on-surface-variant mt-3">
              {formatInrFromPaise(success.amount_paise)} toward{' '}
              <span className="text-primary font-semibold">{success.causeTitle}</span>.
            </p>
            <p className="text-body-sm text-on-surface-variant mt-2">
              Thank you for your support.
            </p>
            <div className="flex flex-wrap gap-3 mt-6">
              <button
                type="button"
                onClick={() => setSuccess(null)}
                className="rounded-lg bg-primary text-on-primary px-4 py-2.5 text-label-sm font-bold uppercase tracking-wider"
              >
                Donate again
              </button>
              <Link
                href="/member"
                className="rounded-lg border border-outline-variant px-4 py-2.5 text-label-sm uppercase tracking-wider text-primary"
              >
                Back home
              </Link>
            </div>
          </section>
        ) : (
          <form
            onSubmit={openBankPay}
            className="rounded-2xl border border-outline-variant bg-white p-5 sm:p-7 max-w-xl space-y-5"
          >
            <div>
              <p className="text-label-sm uppercase tracking-wider text-primary mb-2">Cause</p>
              {causes === null ? (
                <p className="text-body-sm text-on-surface-variant">Loading…</p>
              ) : !causes.length ? (
                <p className="text-body-sm text-on-surface-variant">
                  No active causes yet. Check back soon.
                </p>
              ) : (
                <ul className="space-y-2">
                  {causes.map((c) => (
                    <li key={c.id}>
                      <label
                        className={`flex gap-3 rounded-xl border px-3 py-3 cursor-pointer ${
                          causeId === c.id
                            ? 'border-jubilee-gold-deep bg-jubilee-gold-light/40'
                            : 'border-outline-variant'
                        }`}
                      >
                        <input
                          type="radio"
                          name="cause"
                          className="mt-1 accent-primary"
                          checked={causeId === c.id}
                          onChange={() => setCauseId(c.id)}
                        />
                        <span className="min-w-0">
                          <span className="block text-body-md text-primary font-semibold">
                            {c.title}
                          </span>
                          {c.description ? (
                            <span className="block text-body-sm text-on-surface-variant mt-0.5">
                              {c.description}
                            </span>
                          ) : null}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <p className="text-label-sm uppercase tracking-wider text-primary mb-2">Amount</p>
              <div className="flex flex-wrap gap-2">
                {DONATION_AMOUNT_CHIPS_PAISE.map((paise) => (
                  <button
                    key={paise}
                    type="button"
                    onClick={() => {
                      setUseCustom(false);
                      setChipPaise(paise);
                    }}
                    className={`rounded-full px-4 py-2 text-label-sm font-bold ${
                      !useCustom && chipPaise === paise
                        ? 'bg-primary text-on-primary'
                        : 'bg-surface-container text-primary'
                    }`}
                  >
                    {formatInrFromPaise(paise)}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setUseCustom(true)}
                  className={`rounded-full px-4 py-2 text-label-sm font-bold ${
                    useCustom ? 'bg-primary text-on-primary' : 'bg-surface-container text-primary'
                  }`}
                >
                  Custom
                </button>
              </div>
              {useCustom ? (
                <label className="block mt-3">
                  <span className="sr-only">Custom amount in rupees</span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    inputMode="numeric"
                    value={customRupees}
                    onChange={(e) => setCustomRupees(e.target.value)}
                    placeholder="Amount in ₹"
                    className="w-full px-4 py-3.5 rounded-lg border border-outline-variant text-body-sm bg-surface focus:outline-none focus:border-primary"
                  />
                </label>
              ) : null}
            </div>

            <label className="block">
              <span className="text-label-sm uppercase tracking-wider text-primary">
                Message (optional)
              </span>
              <textarea
                rows={3}
                maxLength={DONATION_MAX_MESSAGE}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="mt-1 w-full px-4 py-3.5 rounded-lg border border-outline-variant text-body-sm bg-surface resize-y focus:outline-none focus:border-primary"
                placeholder="A short note with your gift"
              />
              <span className="text-body-sm text-on-surface-variant">
                {message.length}/{DONATION_MAX_MESSAGE}
              </span>
            </label>

            {error ? (
              <p className="rounded-lg bg-error-container text-error text-body-sm p-3">{error}</p>
            ) : null}

            {amountPaise() != null ? (
              <div className="rounded-xl border border-outline-variant bg-surface-container-low px-4 py-3">
                <p className="text-label-sm uppercase tracking-wider text-primary mb-2">You pay</p>
                <AmountWithFx
                  paise={amountPaise()!}
                  primaryClassName="text-headline-sm text-jubilee-gold-deep tabular-nums"
                />
              </div>
            ) : null}

            <div className="flex flex-col gap-2">
              {onlineCheckoutEnabled ? (
                <button
                  type="button"
                  onClick={() => void payOnline()}
                  disabled={!causes?.length || amountPaise() == null || payingOnline}
                  className="w-full rounded-lg bg-jubilee-gold-deep text-on-primary px-4 py-3 text-label-sm font-bold uppercase tracking-wider disabled:opacity-50"
                >
                  {payingOnline ? 'Opening checkout…' : 'Pay online'}
                </button>
              ) : null}
              <button
                type="submit"
                disabled={!causes?.length || amountPaise() == null || !bankAccount}
                className="w-full rounded-lg bg-primary text-on-primary px-4 py-3 text-label-sm font-bold uppercase tracking-wider disabled:opacity-50"
              >
                Submit payment proof
              </button>
            </div>
            <p className="text-body-sm text-on-surface-variant text-center">
              {onlineCheckoutEnabled
                ? 'Pay online with UPI or card, or transfer via NEFT/UPI and upload proof.'
                : bankAccount
                  ? 'Transfer via NEFT or UPI, then upload your proof. The committee verifies payment.'
                  : 'Bank details are not available yet. Contact the committee.'}
            </p>
            {offlineNote ? (
              <p className="rounded-lg bg-secondary-container text-on-secondary-fixed text-body-sm p-3">
                {offlineNote}
              </p>
            ) : null}
          </form>
        )}
        {bankAccount && amountPaise() != null && causeId ? (
          <OfflinePayModal
            open={offlineOpen}
            onClose={() => setOfflineOpen(false)}
            account={bankAccount}
            amountPaise={amountPaise()!}
            note={selectedCause?.title || 'Donation'}
            transactionId={causeId ? `DON-${causeId.replace(/-/g, '').slice(0, 24)}` : undefined}
            source={{ type: 'donation', causeId, message }}
            onSubmitted={(msg) => {
              setOfflineNote(msg);
              setSuccess({
                amount_paise: amountPaise()!,
                causeTitle: selectedCause?.title || 'Donation',
              });
              setOfflineOpen(false);
            }}
          />
        ) : null}
      </MemberGate>
    </PortalShell>
  );
}
