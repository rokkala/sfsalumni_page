'use client';

import { FormEvent, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import AmountWithFx from '@/components/amount-with-fx';
import {
  buildUpiPayUri,
  normalizeUpiRefNoInput,
  normalizeUpiTransactionId,
  shortUpiPaymentRef,
  UPI_REF_NO_LEN,
  UPI_REF_NO_PATTERN,
  type BankAccountPublic,
} from '@/lib/payments/bank-details';
import { normalizeRegistrationCode } from '@/lib/events/registration-code-format';
import {
  REMITTANCE_METHODS,
  remittanceMethodLabel,
  type RemittanceMethod,
} from '@/lib/payments/remittance-validate';
import {
  formatNextUpiWindowIst,
  type UpiQuotaSnapshot,
} from '@/lib/payments/upi-quota';

export type { BankAccountPublic };

function defaultPaymentDateIst(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export type ExistingOfflineProof = {
  utr: string | null;
  hasScreenshot: boolean;
  status: 'pending';
};

type Props = {
  open: boolean;
  onClose: () => void;
  account: BankAccountPublic;
  amountPaise: number;
  note?: string;
  /** Pre-filled UPI `tr` in the QR (e.g. registration id). */
  transactionId?: string;
  source:
    | { type: 'registration'; registrationId: string }
    | { type: 'donation'; causeId: string; message?: string };
  /** When set, proof was already submitted and cannot be replaced until reviewed. */
  existingProof?: ExistingOfflineProof | null;
  onSubmitted?: (message: string) => void;
  submitUrl?: string;
};

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export default function OfflinePayModal({
  open,
  onClose,
  account,
  amountPaise,
  note,
  transactionId,
  source,
  existingProof = null,
  onSubmitted,
  submitUrl = '/api/payments/offline-proof',
}: Props) {
  const titleId = useId();
  const photoInputId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [mounted, setMounted] = useState(false);
  const [qrSrc, setQrSrc] = useState('');
  const [utr, setUtr] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [phase, setPhase] = useState<'pay' | 'thanks'>('pay');
  const [thanksMessage, setThanksMessage] = useState('');
  const [method, setMethod] = useState<RemittanceMethod>('neft_rtgs');
  const [paymentDate, setPaymentDate] = useState(defaultPaymentDateIst);
  const [reference, setReference] = useState('');
  const [challanNumber, setChallanNumber] = useState('');
  const [repName, setRepName] = useState('');
  const [batchYear, setBatchYear] = useState('');
  const [section, setSection] = useState('');
  const [repPhone, setRepPhone] = useState('');
  const [foreignReference, setForeignReference] = useState('');
  const [amountForeign, setAmountForeign] = useState('');
  const [currency, setCurrency] = useState('');
  const [amountInrReported, setAmountInrReported] = useState('');
  const [upiQuota, setUpiQuota] = useState<UpiQuotaSnapshot | null>(null);
  const proofLocked = existingProof?.status === 'pending';
  const submitLabel =
    source.type === 'donation'
      ? { idle: 'Pay', busy: 'Paying…' }
      : { idle: 'Submit for verification', busy: 'Submitting…' };

  const upiTr =
    (transactionId && normalizeRegistrationCode(transactionId)) ||
    (transactionId ? normalizeUpiTransactionId(transactionId) : '');
  const upiTrShort = upiTr.includes('-') ? upiTr : upiTr ? shortUpiPaymentRef(upiTr) : '';

  const upiMethodAllowed =
    Boolean(account.upi_id) &&
    Boolean(upiQuota?.eligible) &&
    Boolean(upiQuota?.quota_available);

  const upiUri =
    method === 'upi' && account.upi_id && upiMethodAllowed
      ? buildUpiPayUri({
          upiId: account.upi_id,
          amountPaise,
          payeeName: account.account_name,
          note: note || account.label,
          transactionId,
        })
      : null;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    setUtr(normalizeUpiRefNoInput(existingProof?.utr ?? ''));
    setFile(null);
    setError('');
    setPhase('pay');
    setThanksMessage('');
    setMethod('neft_rtgs');
    setPaymentDate(defaultPaymentDateIst());
    setReference('');
    setChallanNumber('');
    setRepName('');
    setBatchYear('');
    setSection('');
    setRepPhone('');
    setForeignReference('');
    setAmountForeign('');
    setCurrency('');
    setAmountInrReported('');
  }, [open, existingProof?.utr]);

  useEffect(() => {
    if (!open || amountPaise < 100) {
      setUpiQuota(null);
      return;
    }
    let cancel = false;
    fetch(`/api/payments/bank-details?amountPaise=${encodeURIComponent(String(amountPaise))}`, {
      cache: 'no-store',
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((payload) => {
        if (!cancel && payload?.upi) setUpiQuota(payload.upi as UpiQuotaSnapshot);
      })
      .catch(() => {
        if (!cancel) setUpiQuota(null);
      });
    return () => {
      cancel = true;
    };
  }, [open, amountPaise]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open, phase]);

  useEffect(() => {
    if (!open || busy) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (phase === 'thanks') {
        const msg =
          thanksMessage ||
          'Thank you. Your payment is pending confirmation. Your QR will appear once the committee marks it paid.';
        onSubmitted?.(msg);
        setPhase('pay');
        setThanksMessage('');
        onClose();
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, phase, thanksMessage, onSubmitted, onClose]);

  useEffect(() => {
    if (!open || !upiUri || proofLocked) {
      setQrSrc('');
      return;
    }
    let cancel = false;
    import('qrcode')
      .then((mod) =>
        mod.default.toDataURL(upiUri, {
          margin: 1,
          width: 220,
          errorCorrectionLevel: 'M',
        })
      )
      .then((url) => {
        if (!cancel) setQrSrc(url);
      })
      .catch(() => {
        if (!cancel) setQrSrc('');
      });
    return () => {
      cancel = true;
    };
  }, [open, upiUri, proofLocked]);

  // Portal to document.body so this form is never nested inside the registration <form>
  // (nested forms make "Submit for verification" save the page form instead of posting proof).
  if (!open || !mounted) return null;

  function finishThanks() {
    const msg =
      thanksMessage ||
      'Thank you. Your payment is pending confirmation. Your QR will appear once the committee marks it paid.';
    onSubmitted?.(msg);
    setPhase('pay');
    setThanksMessage('');
    onClose();
  }

  async function onCopy(label: string, value: string) {
    const ok = await copyText(value);
    setCopied(ok ? label : '');
    if (ok) setTimeout(() => setCopied(''), 1500);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    setError('');
    if (proofLocked) {
      setError('A proof is already pending committee review.');
      return;
    }
    if (method === 'upi' && !upiMethodAllowed) {
      setError(
        upiQuota && !upiQuota.quota_available && upiQuota.next_opens_at
          ? `UPI limit reached for today. Try again from ${formatNextUpiWindowIst(upiQuota.next_opens_at)}.`
          : 'UPI is not available for this amount. Use NEFT/RTGS or another option.'
      );
      return;
    }
    if (method !== 'class_representative' && !file) {
      setError('Upload a photo of your payment confirmation.');
      return;
    }
    if (method === 'upi') {
      const utrNorm = normalizeUpiRefNoInput(utr);
      if (!UPI_REF_NO_PATTERN.test(utrNorm)) {
        setError(
          'Enter the 12-digit UPI Ref No. from your payment receipt (not the app Transaction ID)'
        );
        return;
      }
      if (!file) {
        setError('Upload a photo of your UPI payment.');
        return;
      }
    }
  if (!paymentDate.trim()) {
      setError('Enter the payment date.');
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set('sourceType', source.type);
      fd.set('paymentAccountId', account.id);
      fd.set('remittanceMethod', method);
      fd.set('paymentDate', paymentDate);
      fd.set('utr', method === 'upi' ? normalizeUpiRefNoInput(utr) : '');
      fd.set('reference', reference);
      fd.set('challanNumber', challanNumber);
      fd.set('repName', repName);
      fd.set('batchYear', batchYear);
      fd.set('section', section);
      fd.set('repPhone', repPhone);
      fd.set('foreignReference', foreignReference);
      fd.set('amountForeign', amountForeign);
      fd.set('currency', currency);
      fd.set('amountInrReported', amountInrReported);
      if (file) fd.set('screenshot', file);
      if (source.type === 'registration') {
        fd.set('registrationId', source.registrationId);
      } else {
        fd.set('causeId', source.causeId);
        fd.set('amountPaise', String(amountPaise));
        if (source.message) fd.set('message', source.message);
      }
      const res = await fetch(submitUrl, { method: 'POST', body: fd });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload.error || 'Could not submit');
        return;
      }
      setUtr('');
      setFile(null);
      setThanksMessage(
        source.type === 'donation'
          ? 'Thank you for your donation. The committee will confirm your payment.'
          : 'Thank you for your payment. Your entry pass unlocks once the committee confirms payment.'
      );
      setPhase('thanks');
    } catch {
      setError('Could not submit. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const rows: { label: string; value: string; key: string }[] = [
    { key: 'name', label: 'Account name', value: account.account_name },
    { key: 'number', label: 'Account number', value: account.account_number },
    { key: 'ifsc', label: 'IFSC', value: account.ifsc },
  ];
  if (account.bank_name) {
    rows.push({ key: 'bank', label: 'Bank', value: account.bank_name });
  }
  if (account.upi_id && method === 'upi' && upiMethodAllowed) {
    rows.push({ key: 'upi', label: 'UPI ID', value: account.upi_id });
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/45 p-0 sm:p-4"
      role="presentation"
      onClick={() => {
        if (busy) return;
        if (phase === 'thanks') finishThanks();
        else onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full sm:max-w-md max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-surface border border-outline-variant shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {phase === 'thanks' ? (
          <div className="px-5 py-8 space-y-5 text-center">
            <h2 id={titleId} className="text-lg font-semibold text-on-surface">
              Thank you
            </h2>
            <p className="text-sm text-on-surface-variant">
              Thank you for your payment. The committee will confirm the remittance.
            </p>
            <p className="text-sm text-on-surface font-medium">
              Your QR will appear once they mark it paid.
            </p>
            <button
              ref={closeRef}
              type="button"
              onClick={finishThanks}
              className="w-full rounded-lg bg-primary text-on-primary px-4 py-3 text-sm font-bold uppercase tracking-wider focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              OK
            </button>
          </div>
        ) : proofLocked ? (
          <div className="px-5 py-8 space-y-5">
            <div className="flex items-start justify-between gap-3">
              <h2 id={titleId} className="text-lg font-semibold text-on-surface">
                Payment already submitted
              </h2>
              <button
                ref={closeRef}
                type="button"
                onClick={onClose}
                className="rounded-lg p-2 text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <p className="text-sm text-on-surface" role="status">
              Your Bank / UPI payment proof is already on file and pending committee review. Do not
              pay again.
            </p>
            {existingProof?.utr?.trim() ? (
              <p className="text-sm text-on-surface-variant">
                UTR / reference: <span className="tabular-nums text-on-surface">{existingProof.utr.trim()}</span>
              </p>
            ) : null}
            {existingProof?.hasScreenshot ? (
              <p className="text-sm text-on-surface-variant">Screenshot is on file.</p>
            ) : null}
            <p className="text-sm text-on-surface-variant">
              Your QR will appear once the committee marks this payment paid. You can update
              details after they review it.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-lg bg-primary text-on-primary px-4 py-3 text-sm font-bold uppercase tracking-wider focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              OK
            </button>
          </div>
        ) : (
          <>
            <div className="sticky top-0 flex items-start justify-between gap-3 bg-surface border-b border-outline-variant px-5 py-4">
              <div>
                <h2 id={titleId} className="text-lg font-semibold text-on-surface">
                  Submit payment proof
                </h2>
                <p className="text-sm text-on-surface-variant mt-1">
                  Pay the amount below to <strong>{account.label}</strong> using your chosen method,
                  then submit proof for committee verification.
                </p>
                <div className="mt-2">
                  <AmountWithFx
                    paise={amountPaise}
                    primaryClassName="text-headline-sm text-jubilee-gold-deep tabular-nums"
                  />
                </div>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={onClose}
                disabled={busy}
                className="rounded-lg p-2 text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              {upiQuota && !upiQuota.eligible ? (
                <p className="rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2 text-sm text-on-surface-variant">
                  UPI is available only when your total due including donation is Rs. 5,000 or more.
                  Use NEFT/RTGS, cash/cheque deposit, your class representative, or foreign remittance
                  below.
                </p>
              ) : null}
              {upiQuota?.eligible && !upiQuota.quota_available && upiQuota.next_opens_at ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                  UPI limit reached for today. You can try UPI again from{' '}
                  <strong>{formatNextUpiWindowIst(upiQuota.next_opens_at)}</strong>. Other payment
                  methods remain available.
                </p>
              ) : null}

              <fieldset className="space-y-2">
                <legend className="text-xs uppercase tracking-wider text-on-surface-variant">
                  How did you pay?
                </legend>
                <div className="grid gap-2">
                  {REMITTANCE_METHODS.map((m) => {
                    const isUpi = m === 'upi';
                    const disabled =
                      isUpi &&
                      (!account.upi_id ||
                        !upiQuota?.eligible ||
                        !upiQuota?.quota_available);
                    return (
                      <label
                        key={m}
                        className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                          disabled
                            ? 'border-outline-variant/60 text-on-surface-variant opacity-60'
                            : 'border-outline-variant cursor-pointer'
                        }`}
                      >
                        <input
                          type="radio"
                          name={`${titleId}-method`}
                          value={m}
                          checked={method === m}
                          disabled={busy || disabled}
                          onChange={() => setMethod(m)}
                          className="accent-primary"
                        />
                        {remittanceMethodLabel(m)}
                        {isUpi && disabled && upiQuota && !upiQuota.eligible ? (
                          <span className="text-xs">(min Rs. 5,000)</span>
                        ) : null}
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <ul className="space-y-2">
                {rows.map((r) => (
                  <li
                    key={r.key}
                    className="flex items-center justify-between gap-3 rounded-lg border border-outline-variant px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-xs uppercase tracking-wider text-on-surface-variant">
                        {r.label}
                      </p>
                      <p className="text-sm break-all tabular-nums text-on-surface">{r.value}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void onCopy(r.key, r.value)}
                      className="shrink-0 rounded-lg px-2 py-1.5 text-xs font-bold uppercase text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                    >
                      {copied === r.key ? 'Copied' : 'Copy'}
                    </button>
                  </li>
                ))}
              </ul>

              {account.upi_id && method === 'upi' && upiMethodAllowed ? (
                <div className="rounded-xl border border-outline-variant bg-surface-container-low p-4 text-center">
                  <p className="text-xs uppercase tracking-wider mb-3 text-on-surface-variant">
                    Scan with any UPI app
                  </p>
                  {qrSrc ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={qrSrc}
                      alt={`UPI QR for ${account.upi_id}`}
                      width={220}
                      height={220}
                      className="mx-auto rounded-lg bg-white p-2"
                    />
                  ) : (
                    <p className="text-sm text-on-surface-variant">Preparing QR…</p>
                  )}
                  <p className="text-sm text-on-surface-variant mt-2 break-all">{account.upi_id}</p>
                  {upiTr ? (
                    <div className="mt-3 rounded-lg border border-outline-variant/80 bg-surface px-3 py-2 text-left">
                      <p className="text-xs uppercase tracking-wider text-on-surface-variant">
                        SFS id (in payment description)
                      </p>
                      <p className="text-sm break-all tabular-nums text-on-surface mt-1">{upiTrShort}</p>
                      <p className="text-xs text-on-surface-variant mt-1">
                        Put this in your bank narration for committee recon. Your pass works at the gate
                        after payment is confirmed.
                      </p>
                      <button
                        type="button"
                        onClick={() => void onCopy('reg-ref', upiTr)}
                        className="mt-2 rounded-lg px-2 py-1 text-xs font-bold uppercase text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                      >
                        {copied === 'reg-ref' ? 'Copied' : 'Copy ref'}
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <form onSubmit={onSubmit} className="space-y-3 border-t border-outline-variant pt-4">
                <label className="block">
                  <span className="text-xs uppercase tracking-wider text-on-surface-variant">
                    Payment date *
                  </span>
                  <input
                    type="date"
                    value={paymentDate}
                    onChange={(e) => setPaymentDate(e.target.value)}
                    disabled={busy}
                    required
                    className="mt-1 w-full px-4 py-3 rounded-lg border border-outline-variant text-sm bg-surface focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
                  />
                </label>

                {method === 'neft_rtgs' ? (
                  <>
                    <label className="block">
                      <span className="text-xs uppercase tracking-wider text-on-surface-variant">
                        Payment reference (NEFT/RTGS) *
                      </span>
                      <input
                        value={reference}
                        onChange={(e) => setReference(e.target.value)}
                        disabled={busy}
                        required
                        maxLength={64}
                        className="mt-1 w-full px-4 py-3 rounded-lg border border-outline-variant text-sm bg-surface"
                      />
                    </label>
                    <p className="text-sm text-on-surface-variant">
                      Upload a photo of your bank confirmation.
                    </p>
                  </>
                ) : null}

                {method === 'cash_cheque' ? (
                  <>
                    <label className="block">
                      <span className="text-xs uppercase tracking-wider text-on-surface-variant">
                        Challan number *
                      </span>
                      <input
                        value={challanNumber}
                        onChange={(e) => setChallanNumber(e.target.value)}
                        disabled={busy}
                        required
                        maxLength={64}
                        className="mt-1 w-full px-4 py-3 rounded-lg border border-outline-variant text-sm bg-surface"
                      />
                    </label>
                    <p className="text-sm text-on-surface-variant">Upload a photo of your deposit slip.</p>
                  </>
                ) : null}

                {method === 'class_representative' ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block sm:col-span-2">
                      <span className="text-xs uppercase tracking-wider text-on-surface-variant">
                        Representative name *
                      </span>
                      <input
                        value={repName}
                        onChange={(e) => setRepName(e.target.value)}
                        disabled={busy}
                        required
                        className="mt-1 w-full px-4 py-3 rounded-lg border border-outline-variant text-sm bg-surface"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs uppercase tracking-wider text-on-surface-variant">
                        Batch year *
                      </span>
                      <input
                        value={batchYear}
                        onChange={(e) => setBatchYear(e.target.value)}
                        disabled={busy}
                        required
                        className="mt-1 w-full px-4 py-3 rounded-lg border border-outline-variant text-sm bg-surface"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs uppercase tracking-wider text-on-surface-variant">
                        Section *
                      </span>
                      <input
                        value={section}
                        onChange={(e) => setSection(e.target.value)}
                        disabled={busy}
                        required
                        className="mt-1 w-full px-4 py-3 rounded-lg border border-outline-variant text-sm bg-surface"
                      />
                    </label>
                    <label className="block sm:col-span-2">
                      <span className="text-xs uppercase tracking-wider text-on-surface-variant">
                        Phone number *
                      </span>
                      <input
                        value={repPhone}
                        onChange={(e) => setRepPhone(e.target.value)}
                        disabled={busy}
                        required
                        inputMode="tel"
                        className="mt-1 w-full px-4 py-3 rounded-lg border border-outline-variant text-sm bg-surface"
                      />
                    </label>
                  </div>
                ) : null}

                {method === 'foreign' ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block sm:col-span-2">
                      <span className="text-xs uppercase tracking-wider text-on-surface-variant">
                        Payment reference *
                      </span>
                      <input
                        value={foreignReference}
                        onChange={(e) => setForeignReference(e.target.value)}
                        disabled={busy}
                        required
                        maxLength={64}
                        className="mt-1 w-full px-4 py-3 rounded-lg border border-outline-variant text-sm bg-surface"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs uppercase tracking-wider text-on-surface-variant">
                        Non-INR amount *
                      </span>
                      <input
                        value={amountForeign}
                        onChange={(e) => setAmountForeign(e.target.value)}
                        disabled={busy}
                        required
                        inputMode="decimal"
                        className="mt-1 w-full px-4 py-3 rounded-lg border border-outline-variant text-sm bg-surface tabular-nums"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs uppercase tracking-wider text-on-surface-variant">
                        Currency *
                      </span>
                      <input
                        value={currency}
                        onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                        disabled={busy}
                        required
                        maxLength={8}
                        placeholder="USD"
                        className="mt-1 w-full px-4 py-3 rounded-lg border border-outline-variant text-sm bg-surface"
                      />
                    </label>
                    <label className="block sm:col-span-2">
                      <span className="text-xs uppercase tracking-wider text-on-surface-variant">
                        INR amount received *
                      </span>
                      <input
                        value={amountInrReported}
                        onChange={(e) => setAmountInrReported(e.target.value)}
                        disabled={busy}
                        required
                        inputMode="decimal"
                        className="mt-1 w-full px-4 py-3 rounded-lg border border-outline-variant text-sm bg-surface tabular-nums"
                      />
                    </label>
                    <p className="text-sm text-on-surface-variant sm:col-span-2">
                      Upload a photo of your transaction.
                    </p>
                  </div>
                ) : null}

                {method === 'upi' ? (
                  <>
                    <label className="block">
                      <span className="text-xs uppercase tracking-wider text-on-surface-variant">
                        UPI Ref No. (12 digits) *
                      </span>
                      <input
                        value={utr}
                        onChange={(e) => setUtr(normalizeUpiRefNoInput(e.target.value))}
                        onPaste={(e) => {
                          e.preventDefault();
                          setUtr(normalizeUpiRefNoInput(e.clipboardData.getData('text')));
                        }}
                        disabled={busy}
                        required
                        inputMode="numeric"
                        autoComplete="off"
                        maxLength={UPI_REF_NO_LEN}
                        pattern="\d{12}"
                        className="mt-1 w-full px-4 py-3 rounded-lg border border-outline-variant text-sm bg-surface tabular-nums tracking-widest focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
                        placeholder="123456789012"
                      />
                    </label>
                    <p className="text-sm text-on-surface-variant">
                      Upload a photo of your UPI payment receipt.
                    </p>
                  </>
                ) : null}

                <div>
                  <span className="text-xs uppercase tracking-wider text-on-surface-variant">
                    {method === 'class_representative' ? 'Deposit slip photo (optional)' : 'Photo *'}
                  </span>
                  <input
                    id={photoInputId}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={busy}
                    required={method !== 'class_representative'}
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                    className="sr-only"
                  />
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <label
                      htmlFor={photoInputId}
                      className={`inline-flex min-h-11 items-center justify-center rounded-lg border border-primary/40 bg-surface-container-low px-4 py-2.5 text-sm font-bold uppercase tracking-wider text-primary cursor-pointer hover:bg-surface-container focus-within:outline-none focus-within:ring-2 focus-within:ring-primary/30 ${
                        busy ? 'pointer-events-none opacity-50' : ''
                      }`}
                    >
                      {file ? 'Replace photo' : 'Choose photo'}
                    </label>
                    <span className="text-sm text-on-surface-variant min-w-0 flex-1 truncate">
                      {file?.name || 'JPEG, PNG or WebP · max 4 MB'}
                    </span>
                  </div>
                </div>
                {error ? (
                  <p
                    className="rounded-lg bg-red-50 text-red-700 text-sm p-3"
                    role="alert"
                  >
                    {error}
                  </p>
                ) : null}
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full rounded-lg bg-primary text-on-primary px-4 py-3 text-sm font-bold uppercase tracking-wider disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  {busy ? submitLabel.busy : submitLabel.idle}
                </button>
              </form>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
