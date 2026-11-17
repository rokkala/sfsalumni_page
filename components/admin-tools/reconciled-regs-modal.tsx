'use client';

import { createPortal } from 'react-dom';
import { useEffect, useId, useRef, useState } from 'react';
import { formatCostForDisplay } from '@/lib/registration/registration';

type Row = {
  id: string;
  full_name: string;
  email: string;
  event_title: string;
  registration_code: string | null;
  settled_paise: number;
  committee_verified: boolean;
  state: string;
  state_label: string;
};

export default function ReconciledRegsModal({
  open,
  onClose,
  eventId = '',
}: {
  open: boolean;
  onClose: () => void;
  eventId?: string;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [mounted, setMounted] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setRows(null);
    setError('');
    (async () => {
      try {
        const params = new URLSearchParams();
        if (eventId) params.set('event_id', eventId);
        const res = await fetch(`/api/admin/registrations?${params}`, { cache: 'no-store' });
        const payload = await res.json().catch(() => ({}));
        if (!active) return;
        if (!res.ok) {
          setError(payload.error || 'Could not load registrations');
          setRows([]);
          return;
        }
        const list = (Array.isArray(payload) ? payload : []) as Row[];
        setRows(list.filter((r) => r.settled_paise > 0));
      } catch {
        if (active) {
          setError('Could not load registrations');
          setRows([]);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [open, eventId]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;

  const total = (rows || []).reduce((sum, r) => sum + r.settled_paise, 0);

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-6">
      <button
        type="button"
        className="absolute inset-0 bg-primary/50 backdrop-blur-[2px] cursor-pointer"
        aria-label="Close payments reconciled"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-[81] flex w-full sm:max-w-3xl max-h-[92vh] flex-col overflow-hidden rounded-t-2xl sm:rounded-2xl border border-outline-variant bg-surface-paper shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-outline-variant px-6 pb-4 pt-6">
          <div>
            <p className="text-label-sm font-bold uppercase tracking-widest text-jubilee-gold-deep">
              Committee tools
            </p>
            <h2 id={titleId} className="mt-1 text-headline-sm text-primary">
              Payments reconciled
            </h2>
            <p className="mt-1 text-body-sm text-on-surface-variant">
              {rows
                ? `${rows.length} registrations · ${formatCostForDisplay(total)} received`
                : 'Loading reconciled registrations…'}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-2 text-primary hover:bg-surface-container focus:outline-none focus:ring-2 focus:ring-primary/30"
            aria-label="Close"
          >
            <span className="material-symbols-outlined text-[22px]">close</span>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {error && (
            <p className="m-4 rounded-xl border border-error-container bg-error-container/40 p-3 text-body-sm text-on-error-container">
              {error}
            </p>
          )}
          {!error && rows && rows.length === 0 && (
            <p className="px-6 py-10 text-body-sm text-on-surface-variant">No reconciled payments yet.</p>
          )}
          {rows && rows.length > 0 && (
            <table className="min-w-full text-left text-body-sm">
              <thead className="sticky top-0 bg-primary text-label-sm text-secondary-container">
                <tr>
                  <th className="px-4 py-3">Alumnus</th>
                  <th className="px-4 py-3">Event</th>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">State</th>
                  <th className="px-4 py-3 text-right">Received</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-jubilee-gold-light/60 odd:bg-surface-ivory/70">
                    <td className="px-4 py-3">
                      <div className="font-medium text-primary">{r.full_name}</div>
                      <div className="text-label-sm text-on-surface-variant">{r.email}</div>
                    </td>
                    <td className="px-4 py-3 text-navy-subtle">{r.event_title}</td>
                    <td className="px-4 py-3 tracking-wide">{r.registration_code || '—'}</td>
                    <td className="px-4 py-3 text-navy-subtle">
                      {r.state_label}
                      {r.committee_verified && (
                        <div className="text-label-sm text-on-surface-variant">Committee verified</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-primary">
                      {formatCostForDisplay(r.settled_paise)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
