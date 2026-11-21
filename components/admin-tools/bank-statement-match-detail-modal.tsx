'use client';

import Link from 'next/link';
import { useEffect, useId, useMemo, useState } from 'react';
import { ModalCloseButton, ModalOverlay } from '@/components/modal-shell';
import { formatCostForDisplay } from '@/lib/registration/registration';
import type { BankStatementCandidate, BankStatementMatchTier } from '@/lib/admin/bank-statement-types';
import type { SibStatementCredit } from '@/lib/admin/sib-statement-parse';
import { remittanceMethodLabel } from '@/lib/payments/remittance-validate';

const inr = (paise: number) => formatCostForDisplay(paise);

const KIND_LABEL: Record<BankStatementCandidate['kind'], string> = {
  registration_fee: 'Registration fee',
  registration_gift: 'Registration gift',
  cause_donation: 'Cause donation',
};

function parseLineKey(lineKey: string): 'fee' | 'donation' | null {
  const sep = lineKey.indexOf(':');
  if (sep < 1) return null;
  const head = lineKey.slice(0, sep);
  if (head === 'fee') return 'fee';
  if (head === 'donation') return 'donation';
  return null;
}

function tierClass(tier: BankStatementMatchTier): string {
  if (tier === 'high') return 'bg-secondary-container text-on-secondary-fixed';
  if (tier === 'medium') return 'bg-jubilee-gold-light text-on-secondary-fixed-variant';
  return 'bg-surface-container text-on-surface-variant';
}

export type MatchPickerPayload = {
  creditId: string;
  credit: SibStatementCredit;
  /** Suggested matches for this bank line only — not the full registration roster. */
  candidates: BankStatementCandidate[];
  selectedLineKey: string;
};

export function BankStatementMatchDetailModal({
  open,
  payload,
  onConfirm,
  onClose,
}: {
  open: boolean;
  payload: MatchPickerPayload | null;
  onConfirm: (creditId: string, lineKey: string) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const [previewKey, setPreviewKey] = useState('');

  useEffect(() => {
    if (open && payload) {
      setPreviewKey(payload.selectedLineKey || payload.candidates[0]?.line_key || '');
    }
    if (!open) setPreviewKey('');
  }, [open, payload]);

  const list = payload?.candidates ?? [];
  const effectiveKey = previewKey || payload?.selectedLineKey || list[0]?.line_key || '';
  const preview = useMemo(
    () => list.find((c) => c.line_key === effectiveKey) ?? null,
    [list, effectiveKey]
  );

  if (!open || !payload) return null;

  const { credit, creditId, selectedLineKey } = payload;
  const bankRef = credit.receipt_refs[0] || credit.rrn || '—';

  function confirm() {
    if (!effectiveKey) return;
    onConfirm(creditId, effectiveKey);
    setPreviewKey('');
    onClose();
  }

  function close() {
    setPreviewKey('');
    onClose();
  }

  const c = preview;
  const regRef = c ? c.bank_reference || c.proofs.find((p) => p.utr)?.utr || '—' : '—';
  const parsedKind = c ? parseLineKey(c.line_key) : null;

  return (
    <ModalOverlay
      titleId={titleId}
      backdropLabel="Close registration match"
      onBackdropClose={close}
      panelClassName="flex max-h-[90vh] w-full flex-col sm:max-w-lg"
    >
      <div className="flex items-start justify-between gap-3 border-b border-outline-variant px-5 py-4">
        <div>
          <p className="text-[0.65rem] font-bold uppercase tracking-wide text-on-surface-variant">
            Match this deposit
          </p>
          <h2 id={titleId} className="text-headline-sm text-primary tabular-nums">
            {inr(credit.amount_paise)} · {credit.stmt_date}
          </h2>
          <p className="font-mono text-label-sm text-on-surface-variant">Bank ref {bankRef}</p>
        </div>
        <ModalCloseButton onClick={close} />
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 text-label-sm">
        {list.length > 1 ? (
          <section>
            <p className="text-[0.65rem] font-bold uppercase text-on-surface-variant">
              Pick one registration for this bank line ({list.length} suggestion{list.length === 1 ? '' : 's'})
            </p>
            <ul className="mt-2 max-h-36 space-y-1 overflow-y-auto" role="listbox" aria-label="Suggested matches">
              {list.map((item) => {
                const active = item.line_key === effectiveKey;
                return (
                  <li key={item.line_key}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => setPreviewKey(item.line_key)}
                      className={`w-full cursor-pointer rounded-lg border px-3 py-2 text-left ${
                        active
                          ? 'border-primary bg-primary/10 ring-1 ring-primary/30'
                          : 'border-outline-variant bg-white hover:border-primary/30'
                      }`}
                    >
                      <span className="font-medium">{item.payer_name}</span>
                      {item.registration_code ? (
                        <span className="ml-1 font-mono text-[0.7rem]">{item.registration_code}</span>
                      ) : null}
                      <span className={`ml-2 rounded px-1 py-0.5 text-[0.6rem] font-bold uppercase ${tierClass(item.tier)}`}>
                        {item.tier} {item.match_score}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : list.length === 0 ? (
          <p className="rounded-lg border border-dashed border-outline-variant p-4 text-on-surface-variant">
            No registration matches this deposit. Search receivables manually.
          </p>
        ) : null}

        {c ? (
          <>
            <p className="text-[0.65rem] font-bold uppercase text-on-surface-variant">Registration details</p>
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-[0.65rem] font-bold uppercase text-on-surface-variant">Name</dt>
                <dd className="font-medium">{c.payer_name}</dd>
              </div>
              <div>
                <dt className="text-[0.65rem] font-bold uppercase text-on-surface-variant">Email</dt>
                <dd className="break-all">{c.payer_email || '—'}</dd>
              </div>
              <div>
                <dt className="text-[0.65rem] font-bold uppercase text-on-surface-variant">Phone</dt>
                <dd className="tabular-nums">{c.phone || '—'}</dd>
              </div>
              <div>
                <dt className="text-[0.65rem] font-bold uppercase text-on-surface-variant">Reg ID</dt>
                <dd className="font-mono text-[0.72rem] break-all">{c.registration_id || '—'}</dd>
              </div>
              <div>
                <dt className="text-[0.65rem] font-bold uppercase text-on-surface-variant">Line type</dt>
                <dd>
                  {KIND_LABEL[c.kind]}
                  {parsedKind === 'donation' ? ' (donation line)' : ''}
                </dd>
              </div>
              <div>
                <dt className="text-[0.65rem] font-bold uppercase text-on-surface-variant">Amount</dt>
                <dd className="tabular-nums font-semibold">
                  {c.closed_line ? (
                    <>Settled {inr(c.amount_paise)}</>
                  ) : (
                    <>Due {inr(c.due_paise)}</>
                  )}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-[0.65rem] font-bold uppercase text-on-surface-variant">Reference number</dt>
                <dd className="font-mono break-all">{regRef}</dd>
              </div>
            </dl>

            {c.reasons.length ? (
              <p className="text-on-surface-variant">{c.reasons.join(' · ')}</p>
            ) : null}

            {c.proofs.length ? (
              <section>
                <p className="text-[0.65rem] font-bold uppercase text-on-surface-variant">Uploaded document</p>
                <ul className="mt-1 space-y-2">
                  {c.proofs.map((p) => (
                    <li key={p.id} className="rounded-lg border border-outline-variant bg-white px-3 py-2">
                      <p className="font-semibold capitalize">
                        {p.status} · {inr(p.amount_paise)}
                      </p>
                      <p className="tabular-nums">
                        UTR <span className="font-medium">{p.utr || '—'}</span>
                      </p>
                      {p.remittance_method ? (
                        <p className="text-on-surface-variant">
                          {remittanceMethodLabel(p.remittance_method as never)}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
                <Link href="/admin/remittance-proofs" className="mt-2 inline-block font-semibold text-primary underline">
                  Open remittance proofs
                </Link>
              </section>
            ) : (
              <p className="text-on-surface-variant">No uploaded document on this line.</p>
            )}
          </>
        ) : null}
      </div>

      <footer className="flex flex-wrap justify-between gap-2 border-t border-outline-variant px-5 py-4">
        {selectedLineKey ? (
          <button
            type="button"
            onClick={() => {
              onConfirm(creditId, '');
              setPreviewKey('');
              onClose();
            }}
            className="cursor-pointer text-label-sm font-semibold text-on-surface-variant underline"
          >
            Clear match
          </button>
        ) : (
          <span />
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={close}
            className="cursor-pointer rounded-lg border border-outline-variant px-4 py-2 font-semibold"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!effectiveKey}
            onClick={confirm}
            className="cursor-pointer rounded-lg bg-primary px-5 py-2 font-bold text-on-primary disabled:opacity-50"
          >
            Use this match
          </button>
        </div>
      </footer>
    </ModalOverlay>
  );
}