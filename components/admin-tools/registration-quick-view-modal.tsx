'use client';

import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { ModalCloseButton, ModalOverlay } from '@/components/modal-shell';
import { formatCostForDisplay } from '@/lib/registration/registration';

type RegistrationDetail = {
  id: string;
  event_id: string;
  full_name: string;
  email: string;
  phone_number: string | null;
  event_title: string;
  registration_code: string | null;
  batch: number | null;
  billed_paise: number;
  settled_paise: number;
  due_paise: number;
  state_label: string;
  bank_reference: string | null;
  proof_screenshot_url: string | null;
  meals: string;
};

export function RegistrationQuickViewModal({
  registrationId,
  open,
  onClose,
}: {
  registrationId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const titleId = useId();
  const [detail, setDetail] = useState<RegistrationDetail | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !registrationId) {
      setDetail(null);
      setError('');
      return;
    }
    let active = true;
    setLoading(true);
    setError('');
    void fetch(`/api/admin/registrations/${encodeURIComponent(registrationId)}`, { cache: 'no-store' })
      .then(async (res) => {
        const payload = await res.json().catch(() => ({}));
        if (!active) return;
        if (!res.ok) {
          setError(payload.error || 'Could not load registration');
          setDetail(null);
          return;
        }
        setDetail(payload as RegistrationDetail);
      })
      .catch(() => {
        if (active) {
          setError('Could not load registration');
          setDetail(null);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, registrationId]);

  if (!open || !registrationId) return null;

  return (
    <ModalOverlay
      titleId={titleId}
      backdropLabel="Close registration details"
      onBackdropClose={onClose}
      panelClassName="flex max-h-[90vh] w-full flex-col sm:max-w-md"
    >
      <div className="flex items-start justify-between gap-3 border-b border-outline-variant px-5 py-4">
        <div>
          <p className="text-[0.65rem] font-bold uppercase tracking-wide text-on-surface-variant">Registration</p>
          <h2 id={titleId} className="text-headline-sm text-primary">
            {loading ? 'Loading…' : detail?.full_name || 'Registration'}
          </h2>
          {detail?.registration_code ? (
            <p className="font-mono text-label-sm font-semibold">{detail.registration_code}</p>
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
        {loading && !detail ? <p className="text-on-surface-variant">Loading registration…</p> : null}
        {detail ? (
          <dl className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <dt className="text-[0.65rem] font-bold uppercase text-on-surface-variant">Event</dt>
              <dd>{detail.event_title}</dd>
            </div>
            <div>
              <dt className="text-[0.65rem] font-bold uppercase text-on-surface-variant">Email</dt>
              <dd className="break-all">{detail.email}</dd>
            </div>
            <div>
              <dt className="text-[0.65rem] font-bold uppercase text-on-surface-variant">Phone</dt>
              <dd className="tabular-nums">{detail.phone_number || '—'}</dd>
            </div>
            <div>
              <dt className="text-[0.65rem] font-bold uppercase text-on-surface-variant">Batch</dt>
              <dd>{detail.batch ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-[0.65rem] font-bold uppercase text-on-surface-variant">Status</dt>
              <dd>{detail.state_label}</dd>
            </div>
            <div>
              <dt className="text-[0.65rem] font-bold uppercase text-on-surface-variant">Billed</dt>
              <dd className="tabular-nums font-semibold">{formatCostForDisplay(detail.billed_paise)}</dd>
            </div>
            <div>
              <dt className="text-[0.65rem] font-bold uppercase text-on-surface-variant">Paid</dt>
              <dd className="tabular-nums">{formatCostForDisplay(detail.settled_paise)}</dd>
            </div>
            <div>
              <dt className="text-[0.65rem] font-bold uppercase text-on-surface-variant">Due</dt>
              <dd className="tabular-nums font-semibold text-primary">
                {formatCostForDisplay(detail.due_paise)}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-[0.65rem] font-bold uppercase text-on-surface-variant">Reference</dt>
              <dd className="font-mono break-all">{detail.bank_reference || '—'}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-[0.65rem] font-bold uppercase text-on-surface-variant">Meals</dt>
              <dd>{detail.meals}</dd>
            </div>
            {detail.proof_screenshot_url ? (
              <div className="sm:col-span-2">
                <dt className="text-[0.65rem] font-bold uppercase text-on-surface-variant">Payment proof</dt>
                <dd className="mt-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={detail.proof_screenshot_url}
                    alt="Uploaded payment proof"
                    className="max-h-48 w-auto rounded-lg border border-outline-variant"
                  />
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </div>

      <footer className="flex flex-wrap justify-between gap-2 border-t border-outline-variant px-5 py-4">
        {detail ? (
          <Link
            href={`/admin/registrations?event=${encodeURIComponent(detail.event_id)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-label-sm font-semibold text-primary underline"
          >
            Full roster (new tab)
          </Link>
        ) : (
          <span />
        )}
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