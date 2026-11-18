'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import Link from 'next/link';
import AdminBulkBar from '@/components/admin-tools/admin-bulk-bar';
import { ModalCloseButton, ModalOverlay } from '@/components/modal-shell';
import {
  remittanceMethodLabel,
  type RemittanceMethod,
} from '@/lib/payments/remittance-validate';

type PendingGiftWithoutProof = {
  id: string;
  amount_paise: number;
  created_at: string;
  donor_name: string;
  donor_email: string;
  label: string;
  kind: 'cause' | 'event';
};

function proofSourceLabel(sourceType: string): string {
  if (sourceType === 'donation') return 'Cause donation';
  if (sourceType === 'registration') return 'Registration (fee ± donation)';
  return sourceType;
}

type Proof = {
  id: string;
  source_type: string;
  registration_id: string | null;
  donation_id: string | null;
  amount_paise: number;
  utr: string | null;
  remittance_method?: RemittanceMethod | string | null;
  payment_date?: string | null;
  remittance_meta?: Record<string, unknown> | null;
  status: string;
  admin_note: string | null;
  created_at: string;
  screenshot_url: string | null;
  donor_name: string;
  donor_email: string;
  payment_account_label: string | null;
};

function formatInr(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN')}`;
}

function remittanceMetaSummary(
  method: string | null | undefined,
  meta: Record<string, unknown> | null | undefined
): string | null {
  if (!meta || typeof meta !== 'object') return null;
  if (method === 'cash_cheque' && meta.challan_number) {
    return `Challan ${String(meta.challan_number)}`;
  }
  if (method === 'class_representative' && meta.rep_name) {
    return `${String(meta.rep_name)} · ${String(meta.batch_year)}/${String(meta.section)} · ${String(meta.phone)}`;
  }
  if (method === 'foreign' && meta.currency) {
    return `${String(meta.reference)} · ${String(meta.currency)} ${String(meta.amount_foreign)} → INR ${String(meta.amount_inr_reported)}`;
  }
  if (method === 'neft_rtgs' && meta.reference) {
    return `Ref ${String(meta.reference)}`;
  }
  return null;
}

export default function RemittanceProofsPanel() {
  const [proofs, setProofs] = useState<Proof[]>([]);
  const [pendingGiftsWithoutProof, setPendingGiftsWithoutProof] = useState<PendingGiftWithoutProof[]>(
    []
  );
  const [onlineCheckoutEnabled, setOnlineCheckoutEnabled] = useState(false);
  const [cashfreeConfigured, setCashfreeConfigured] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [checkoutOk, setCheckoutOk] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reviewId, setReviewId] = useState<string | null>(null);
  const reviewTitleId = useId();

  const loadCheckoutSettings = useCallback(async () => {
    const res = await fetch('/api/admin/payment-checkout-settings', { cache: 'no-store' });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.error || 'Could not load checkout settings');
    setOnlineCheckoutEnabled(Boolean(payload.online_checkout_enabled));
    setCashfreeConfigured(Boolean(payload.cashfree_configured));
  }, []);

  const loadProofs = useCallback(async () => {
    const res = await fetch('/api/admin/offline-proofs?status=pending', { cache: 'no-store' });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.error || 'Could not load proofs');
    setProofs(payload.proofs || []);
    setPendingGiftsWithoutProof(payload.pending_gifts_without_proof || []);
  }, []);

  const load = useCallback(async () => {
    setError('');
    try {
      await Promise.all([loadProofs(), loadCheckoutSettings()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load');
    }
  }, [loadProofs, loadCheckoutSettings]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllProofs() {
    setSelected((prev) => {
      if (proofs.length > 0 && prev.size === proofs.length) return new Set();
      return new Set(proofs.map((p) => p.id));
    });
  }

  async function decideProof(id: string, status: 'approved' | 'rejected') {
    setBusy(true);
    setError('');
    setOk('');
    try {
      const res = await fetch(`/api/admin/offline-proofs/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload.error || 'Could not update proof');
        return;
      }
      setOk(status === 'approved' ? 'Proof approved — payment marked paid.' : 'Proof rejected.');
      setReviewId(null);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      await loadProofs();
    } catch {
      setError('Could not update proof');
    } finally {
      setBusy(false);
    }
  }

  async function decideProofsBulk(status: 'approved' | 'rejected') {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBusy(true);
    setError('');
    setOk('');
    try {
      const res = await fetch('/api/admin/offline-proofs/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids, status }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload.error || 'Bulk update failed');
        return;
      }
      const done = Number(payload.approved || 0) + Number(payload.rejected || 0);
      const failed = Number(payload.failed || 0);
      setOk(
        failed > 0
          ? `${done} updated, ${failed} failed.`
          : status === 'approved'
            ? `${done} proofs approved — payments marked paid.`
            : `${done} proofs rejected.`
      );
      setSelected(new Set());
      setReviewId(null);
      await loadProofs();
    } catch {
      setError('Bulk update failed');
    } finally {
      setBusy(false);
    }
  }

  async function saveOnlineCheckout(next: boolean) {
    setBusy(true);
    setCheckoutError('');
    setCheckoutOk('');
    try {
      const res = await fetch('/api/admin/payment-checkout-settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ online_checkout_enabled: next }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || 'Could not save');
      setOnlineCheckoutEnabled(Boolean(payload.online_checkout_enabled));
      setCashfreeConfigured(Boolean(payload.cashfree_configured));
      setCheckoutOk(
        next ? 'Online checkout is on for members.' : 'Online checkout is off. Bank / UPI only.'
      );
    } catch (e) {
      setCheckoutError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  const reviewProof = proofs.find((p) => p.id === reviewId) || null;

  return (
    <>
      <p className="text-body-sm text-on-surface-variant mb-6 max-w-3xl">
        Approve or reject offline remittance proofs and control whether members see Pay online.
        Bank account details are under{' '}
        <Link href="/admin/payment-accounts" className="text-primary underline font-medium">
          Bank / UPI
        </Link>
        .
      </p>

      <section className="rounded-2xl border border-outline-variant bg-white p-5 space-y-3 mb-8 max-w-3xl">
        <h3 className="text-headline-sm text-primary">Pay online (Cashfree)</h3>
        <p className="text-body-sm text-on-surface-variant">
          When enabled, members see a <strong className="font-semibold text-on-surface">Pay online</strong>{' '}
          button on registration and donations. Cashfree API keys must be set in Vercel; this toggle
          only controls whether members see the option.
        </p>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 accent-primary"
            checked={onlineCheckoutEnabled}
            disabled={busy || (!cashfreeConfigured && !onlineCheckoutEnabled)}
            onChange={(e) => void saveOnlineCheckout(e.target.checked)}
          />
          <span className="text-body-sm text-on-surface">
            Offer online checkout
            {!cashfreeConfigured ? (
              <span className="block text-on-surface-variant mt-1">
                Cashfree keys are missing on this deployment — add CASHFREE_CLIENT_ID and
                CASHFREE_CLIENT_SECRET before turning this on.
              </span>
            ) : null}
          </span>
        </label>
        {cashfreeConfigured ? (
          <p className="text-body-sm text-on-surface-variant">
            <Link href="/admin/cashfree-smoke" className="text-primary underline font-medium">
              Test ₹1 Cashfree UPI
            </Link>{' '}
            (on this domain — not localhost).
          </p>
        ) : null}
        {checkoutError ? (
          <p className="rounded-lg bg-error-container text-error text-body-sm p-3">{checkoutError}</p>
        ) : null}
        {checkoutOk ? (
          <p className="rounded-lg bg-secondary-container text-on-secondary-fixed text-body-sm p-3">
            {checkoutOk}
          </p>
        ) : null}
      </section>

      <section className="rounded-2xl border border-outline-variant bg-white p-5 space-y-4 mb-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-headline-sm text-primary">Pending proofs</h3>
            <p className="text-body-sm text-on-surface-variant mt-1">
              Open a proof to check UTR and screenshot. Approve marks paid; reject leaves unpaid.
              Select several for bulk approve or reject.{' '}
              <strong className="font-semibold text-on-surface">Cause donations</strong> from{' '}
              <code className="text-label-sm">/member/donate</code> appear as{' '}
              <strong className="font-semibold text-on-surface">Cause donation</strong>; jubilee
              add-on donations ride on <strong className="font-semibold text-on-surface">
              Registration</strong> proofs.
            </p>
          </div>
          {proofs.length > 0 ? (
            <label className="inline-flex items-center gap-2 text-body-sm text-primary cursor-pointer">
              <input
                type="checkbox"
                checked={selected.size === proofs.length}
                onChange={toggleSelectAllProofs}
                disabled={busy}
              />
              Select all ({proofs.length})
            </label>
          ) : null}
        </div>

        {error ? (
          <p className="rounded-lg bg-error-container text-error text-body-sm p-3">{error}</p>
        ) : null}
        {ok ? (
          <p className="rounded-lg bg-secondary-container text-on-secondary-fixed text-body-sm p-3">
            {ok}
          </p>
        ) : null}

        {pendingGiftsWithoutProof.length > 0 ? (
          <section className="rounded-xl border border-jubilee-gold-deep/40 bg-jubilee-gold-light/30 p-4 space-y-3">
            <p className="text-body-sm text-on-surface">
              <strong className="font-semibold text-primary">
                {pendingGiftsWithoutProof.length} pending donation
                {pendingGiftsWithoutProof.length === 1 ? '' : 's'}
              </strong>{' '}
              in the ledger with no UTR proof in this queue yet. The member still needs to pay and
              submit proof (or finish Pay online). Track amounts on{' '}
              <Link href="/admin/donations" className="text-primary underline font-medium">
                Admin → Donations
              </Link>
              .
            </p>
            <ul className="space-y-2 text-body-sm">
              {pendingGiftsWithoutProof.slice(0, 8).map((g) => (
                <li key={g.id} className="flex flex-wrap justify-between gap-2 text-on-surface">
                  <span>
                    {g.donor_name} · {g.label}
                    {g.kind === 'event' ? (
                      <span className="text-on-surface-variant">
                        {' '}
                        (reconcile via Registration proof when they pay the fee)
                      </span>
                    ) : null}
                  </span>
                  <span className="tabular-nums font-medium">{formatInr(g.amount_paise)}</span>
                </li>
              ))}
            </ul>
            {pendingGiftsWithoutProof.length > 8 ? (
              <p className="text-label-sm text-on-surface-variant">
                …and {pendingGiftsWithoutProof.length - 8} more — see Donation report.
              </p>
            ) : null}
          </section>
        ) : null}

        {proofs.length === 0 ? (
          <p className="text-body-sm text-on-surface-variant py-4">No pending submissions.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {proofs.map((p) => {
              const checked = selected.has(p.id);
              return (
                <li
                  key={p.id}
                  className={`rounded-xl border p-4 space-y-3 ${
                    checked ? 'border-primary bg-secondary-container/20' : 'border-outline-variant'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSelected(p.id)}
                      disabled={busy}
                      aria-label={`Select proof from ${p.donor_name}`}
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-body-sm font-medium text-primary truncate">
                        {p.donor_name}
                      </p>
                      <p className="text-headline-sm text-primary tabular-nums mt-0.5">
                        {formatInr(p.amount_paise)}
                      </p>
                      <p className="text-label-sm text-on-surface-variant mt-1 truncate">
                        {p.donor_email}
                      </p>
                      <p className="text-label-sm text-on-surface-variant">
                        {proofSourceLabel(p.source_type)}
                        {p.payment_account_label ? ` · ${p.payment_account_label}` : ''}
                      </p>
                      {p.remittance_method ? (
                        <p className="text-label-sm text-on-surface-variant mt-1">
                          {remittanceMethodLabel(p.remittance_method as RemittanceMethod)}
                          {p.payment_date ? ` · paid ${p.payment_date}` : ''}
                        </p>
                      ) : null}
                      {remittanceMetaSummary(p.remittance_method, p.remittance_meta) ? (
                        <p className="text-body-sm text-on-surface mt-1">
                          {remittanceMetaSummary(p.remittance_method, p.remittance_meta)}
                        </p>
                      ) : null}
                      {p.utr ? (
                        <p className="text-body-sm text-on-surface mt-2">
                          UTR <span className="tabular-nums font-medium">{p.utr}</span>
                        </p>
                      ) : (
                        <p className="text-body-sm text-on-surface-variant mt-2">No UTR · screenshot only</p>
                      )}
                    </div>
                  </div>
                  {p.screenshot_url ? (
                    <button
                      type="button"
                      onClick={() => setReviewId(p.id)}
                      className="block w-full overflow-hidden rounded-lg border border-outline-variant bg-surface-ivory focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={p.screenshot_url}
                        alt=""
                        className="h-28 w-full object-cover object-top"
                      />
                    </button>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setReviewId(p.id)}
                      className="rounded-lg border border-outline-variant px-3 py-1.5 text-label-sm font-bold uppercase tracking-wider disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary cursor-pointer"
                    >
                      Review
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void decideProof(p.id, 'approved')}
                      className="rounded-lg bg-primary text-on-primary px-3 py-1.5 text-label-sm font-bold uppercase tracking-wider disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary cursor-pointer"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void decideProof(p.id, 'rejected')}
                      className="rounded-lg border border-outline-variant px-3 py-1.5 text-label-sm font-bold uppercase tracking-wider disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary cursor-pointer"
                    >
                      Reject
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <AdminBulkBar count={selected.size} busy={busy} onClear={() => setSelected(new Set())}>
          <button
            type="button"
            disabled={busy}
            onClick={() => void decideProofsBulk('approved')}
            className="rounded-lg bg-primary text-on-primary px-3 py-1.5 text-label-sm font-bold uppercase tracking-wider disabled:opacity-50 cursor-pointer"
          >
            Approve selected
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void decideProofsBulk('rejected')}
            className="rounded-lg border border-outline-variant px-3 py-1.5 text-label-sm font-bold uppercase tracking-wider disabled:opacity-50 cursor-pointer"
          >
            Reject selected
          </button>
        </AdminBulkBar>
      </section>

      {reviewProof ? (
        <ModalOverlay
          titleId={reviewTitleId}
          backdropLabel="Close review remittance"
          onBackdropClose={() => setReviewId(null)}
          disableBackdropClose={busy}
          panelClassName="space-y-4 overflow-y-auto p-5 sm:max-w-2xl"
        >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 id={reviewTitleId} className="text-headline-sm text-primary">
                  Review remittance
                </h3>
                <p className="mt-1 text-body-sm text-on-surface-variant">
                  {reviewProof.donor_name} · {formatInr(reviewProof.amount_paise)}
                </p>
              </div>
              <ModalCloseButton disabled={busy} onClick={() => setReviewId(null)} />
            </div>
            <dl className="grid gap-2 text-body-sm sm:grid-cols-2">
              <div>
                <dt className="text-label-sm uppercase tracking-wider text-on-surface-variant">Email</dt>
                <dd className="text-primary">{reviewProof.donor_email}</dd>
              </div>
              <div>
                <dt className="text-label-sm uppercase tracking-wider text-on-surface-variant">Source</dt>
                <dd className="text-primary">{proofSourceLabel(reviewProof.source_type)}</dd>
              </div>
              <div>
                <dt className="text-label-sm uppercase tracking-wider text-on-surface-variant">Method</dt>
                <dd className="text-primary">
                  {reviewProof.remittance_method
                    ? remittanceMethodLabel(reviewProof.remittance_method as RemittanceMethod)
                    : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-label-sm uppercase tracking-wider text-on-surface-variant">
                  Payment date
                </dt>
                <dd className="text-primary tabular-nums">{reviewProof.payment_date || '—'}</dd>
              </div>
              <div>
                <dt className="text-label-sm uppercase tracking-wider text-on-surface-variant">Reference</dt>
                <dd className="text-primary tabular-nums break-all">{reviewProof.utr || '—'}</dd>
              </div>
              {remittanceMetaSummary(reviewProof.remittance_method, reviewProof.remittance_meta) ? (
                <div className="sm:col-span-2">
                  <dt className="text-label-sm uppercase tracking-wider text-on-surface-variant">
                    Details
                  </dt>
                  <dd className="text-primary">
                    {remittanceMetaSummary(reviewProof.remittance_method, reviewProof.remittance_meta)}
                  </dd>
                </div>
              ) : null}
              <div>
                <dt className="text-label-sm uppercase tracking-wider text-on-surface-variant">Account</dt>
                <dd className="text-primary">{reviewProof.payment_account_label || '—'}</dd>
              </div>
            </dl>
            {reviewProof.screenshot_url ? (
              <a
                href={reviewProof.screenshot_url}
                target="_blank"
                rel="noreferrer"
                className="block overflow-hidden rounded-xl border border-outline-variant focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={reviewProof.screenshot_url}
                  alt="Payment screenshot"
                  className="w-full max-h-[50vh] object-contain bg-surface-ivory"
                />
              </a>
            ) : (
              <p className="rounded-lg bg-surface-ivory p-4 text-body-sm text-on-surface-variant">
                No screenshot on file — rely on UTR / bank statement.
              </p>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                disabled={busy}
                onClick={() => void decideProof(reviewProof.id, 'approved')}
                className="rounded-lg bg-primary text-on-primary px-4 py-2.5 text-label-sm font-bold uppercase tracking-wider disabled:opacity-50 cursor-pointer"
              >
                Approve & mark paid
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void decideProof(reviewProof.id, 'rejected')}
                className="rounded-lg border border-outline-variant px-4 py-2.5 text-label-sm font-bold uppercase tracking-wider disabled:opacity-50 cursor-pointer"
              >
                Reject
              </button>
            </div>
        </ModalOverlay>
      ) : null}
    </>
  );
}
