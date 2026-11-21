'use client';

import { useEffect, useState } from 'react';
import { formatCostForDisplay } from '@/lib/registration/registration';
import { remittanceMethodLabel, type RemittanceMethod } from '@/lib/payments/remittance-validate';

type RegDetail = {
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
  meals: string;
};

export function InlineRegistrationDetail({ registrationId }: { registrationId: string }) {
  const [detail, setDetail] = useState<RegDetail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void fetch(`/api/admin/registrations/${encodeURIComponent(registrationId)}`, { cache: 'no-store' })
      .then(async (res) => {
        const payload = await res.json().catch(() => ({}));
        if (!active) return;
        if (!res.ok) {
          setError(payload.error || 'Could not load');
          return;
        }
        setDetail(payload as RegDetail);
      })
      .catch(() => active && setError('Could not load'));
    return () => {
      active = false;
    };
  }, [registrationId]);

  if (error) return <p className="text-label-sm text-error">{error}</p>;
  if (!detail) return <p className="text-label-sm text-on-surface-variant">Loading registration…</p>;

  return (
    <dl className="grid gap-2 text-label-sm sm:grid-cols-2">
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
        <dd>{detail.phone_number || '—'}</dd>
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
        <dt className="text-[0.65rem] font-bold uppercase text-on-surface-variant">Due</dt>
        <dd className="font-semibold tabular-nums">{formatCostForDisplay(detail.due_paise)}</dd>
      </div>
      <div className="sm:col-span-2">
        <dt className="text-[0.65rem] font-bold uppercase text-on-surface-variant">Their reference</dt>
        <dd className="font-mono break-all">{detail.bank_reference || '—'}</dd>
      </div>
      <div className="sm:col-span-2">
        <dt className="text-[0.65rem] font-bold uppercase text-on-surface-variant">Meals</dt>
        <dd>{detail.meals}</dd>
      </div>
    </dl>
  );
}

type ProofDetail = {
  utr: string | null;
  status: string;
  amount_paise: number;
  payment_date: string | null;
  remittance_method: string | null;
  screenshot_url: string | null;
};

export function InlineProofDetail({ proofId }: { proofId: string }) {
  const [proof, setProof] = useState<ProofDetail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void fetch(`/api/admin/offline-proofs/${encodeURIComponent(proofId)}`, { cache: 'no-store' })
      .then(async (res) => {
        const payload = await res.json().catch(() => ({}));
        if (!active) return;
        if (!res.ok) {
          setError(payload.error || 'Could not load');
          return;
        }
        setProof(payload as ProofDetail);
      })
      .catch(() => active && setError('Could not load'));
    return () => {
      active = false;
    };
  }, [proofId]);

  if (error) return <p className="text-label-sm text-error">{error}</p>;
  if (!proof) return <p className="text-label-sm text-on-surface-variant">Loading proof…</p>;

  return (
    <div className="space-y-2 text-label-sm">
      <p>
        <span className="capitalize">{proof.status}</span> · {formatCostForDisplay(proof.amount_paise)}
        {proof.payment_date ? ` · ${proof.payment_date}` : ''}
      </p>
      <p className="font-mono break-all">
        UTR <span className="font-semibold">{proof.utr || '—'}</span>
      </p>
      {proof.remittance_method ? (
        <p className="text-on-surface-variant">
          {remittanceMethodLabel(proof.remittance_method as RemittanceMethod)}
        </p>
      ) : null}
      {proof.screenshot_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={proof.screenshot_url}
          alt="Member uploaded payment proof"
          className="max-h-64 w-full rounded-lg border border-outline-variant bg-surface-ivory object-contain"
        />
      ) : (
        <p className="text-on-surface-variant">No screenshot — UTR only.</p>
      )}
    </div>
  );
}