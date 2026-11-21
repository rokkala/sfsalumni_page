'use client';

import { useEffect, useId, useState } from 'react';
import { ModalCloseButton, ModalOverlay } from '@/components/modal-shell';
import { formatCostForDisplay } from '@/lib/registration/registration';
import { remittanceMethodLabel, type RemittanceMethod } from '@/lib/payments/remittance-validate';

function remittanceMetaSummary(
  method: string | null | undefined,
  meta: unknown
): string | null {
  if (!meta || typeof meta !== 'object') return null;
  const m = meta as Record<string, unknown>;
  if (method === 'cash_cheque' && m.challan_number) return `Challan ${String(m.challan_number)}`;
  if (method === 'class_representative' && m.rep_name) {
    return `${String(m.rep_name)} · ${String(m.batch_year)}/${String(m.section)} · ${String(m.phone)}`;
  }
  if (method === 'foreign' && m.currency) {
    return `${String(m.reference)} · ${String(m.currency)} ${String(m.amount_foreign)}`;
  }
  if (method === 'neft_rtgs' && m.reference) return `Ref ${String(m.reference)}`;
  return null;
}

type ProofDetail = {
  id: string;
  donor_name: string;
  donor_email: string;
  amount_paise: number;
  utr: string | null;
  status: string;
  payment_date: string | null;
  remittance_method: string | null;
  remittance_meta: unknown;
  screenshot_url: string | null;
  payment_account_label: string | null;
  source_type: string;
  admin_note: string | null;
};

export function RemittanceProofQuickViewModal({
  proofId,
  open,
  onClose,
}: {
  proofId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const titleId = useId();
  const [proof, setProof] = useState<ProofDetail | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !proofId) {
      setProof(null);
      setError('');
      return;
    }
    let active = true;
    setLoading(true);
    setError('');
    void fetch(`/api/admin/offline-proofs/${encodeURIComponent(proofId)}`, { cache: 'no-store' })
      .then(async (res) => {
        const payload = await res.json().catch(() => ({}));
        if (!active) return;
        if (!res.ok) {
          setError(payload.error || 'Could not load proof');
          setProof(null);
          return;
        }
        setProof(payload as ProofDetail);
      })
      .catch(() => {
        if (active) {
          setError('Could not load proof');
          setProof(null);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, proofId]);

  if (!open || !proofId) return null;

  return (
    <ModalOverlay
      titleId={titleId}
      backdropLabel="Close payment proof"
      onBackdropClose={onClose}
      panelClassName="flex max-h-[90vh] w-full flex-col sm:max-w-lg"
    >
      <div className="flex items-start justify-between gap-3 border-b border-outline-variant px-5 py-4">
        <div>
          <p className="text-[0.65rem] font-bold uppercase tracking-wide text-on-surface-variant">
            Uploaded proof
          </p>
          <h2 id={titleId} className="text-headline-sm text-primary">
            {loading ? 'Loading…' : proof?.donor_name || 'Remittance proof'}
          </h2>
          {proof ? (
            <p className="tabular-nums text-label-sm text-on-surface-variant">
              {formatCostForDisplay(proof.amount_paise)} · <span className="capitalize">{proof.status}</span>
            </p>
          ) : null}
        </div>
        <ModalCloseButton onClick={onClose} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-label-sm">
        {error ? (
          <p className="rounded-lg bg-error-container p-3 text-error" role="alert">
            {error}
          </p>
        ) : null}
        {loading && !proof ? <p className="text-on-surface-variant">Loading proof…</p> : null}
        {proof ? (
          <>
            <dl className="mb-4 grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-[0.65rem] font-bold uppercase text-on-surface-variant">UTR / reference</dt>
                <dd className="font-mono break-all">{proof.utr || '—'}</dd>
              </div>
              <div>
                <dt className="text-[0.65rem] font-bold uppercase text-on-surface-variant">Payment date</dt>
                <dd className="tabular-nums">{proof.payment_date || '—'}</dd>
              </div>
              <div>
                <dt className="text-[0.65rem] font-bold uppercase text-on-surface-variant">Method</dt>
                <dd>
                  {proof.remittance_method
                    ? remittanceMethodLabel(proof.remittance_method as RemittanceMethod)
                    : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-[0.65rem] font-bold uppercase text-on-surface-variant">Bank account</dt>
                <dd>{proof.payment_account_label || '—'}</dd>
              </div>
              {remittanceMetaSummary(proof.remittance_method, proof.remittance_meta) ? (
                <div className="sm:col-span-2">
                  <dt className="text-[0.65rem] font-bold uppercase text-on-surface-variant">Details</dt>
                  <dd>{remittanceMetaSummary(proof.remittance_method, proof.remittance_meta)}</dd>
                </div>
              ) : null}
              {proof.admin_note ? (
                <div className="sm:col-span-2">
                  <dt className="text-[0.65rem] font-bold uppercase text-on-surface-variant">Admin note</dt>
                  <dd className="italic">{proof.admin_note}</dd>
                </div>
              ) : null}
            </dl>
            {proof.screenshot_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={proof.screenshot_url}
                alt="Payment screenshot uploaded by member"
                className="w-full max-h-[55vh] rounded-xl border border-outline-variant bg-surface-ivory object-contain"
              />
            ) : (
              <p className="rounded-lg border border-dashed border-outline-variant p-4 text-on-surface-variant">
                No screenshot — only UTR / reference on file.
              </p>
            )}
          </>
        ) : null}
      </div>

      <footer className="flex justify-end border-t border-outline-variant px-5 py-4">
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer rounded-lg bg-primary px-5 py-2 font-bold text-on-primary"
        >
          Close
        </button>
      </footer>
    </ModalOverlay>
  );
}