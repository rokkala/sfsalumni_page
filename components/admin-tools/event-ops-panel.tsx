// components/admin-tools/event-ops-panel.tsx
'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import OpsWorkQueue from '@/components/admin-tools/ops-work-queue';
import ReconciledRegsModal from '@/components/admin-tools/reconciled-regs-modal';
import { formatCostForDisplay } from '@/lib/registration/registration';
import type { EventCatalog } from '@/lib/events/types';

type StateKey = 'cancelled' | 'confirmed' | 'awaiting_verification' | 'partial' | 'unpaid';

type Totals = {
    registration_count: number;
    people: number;
    checked_in_count: number;
    billed_paise: number;
    settled_paise: number;
    due_paise: number;
    fees_settled_paise: number;
    fees_due_paise: number;
    reg_gifts_settled_paise: number;
    reg_gifts_due_paise: number;
};

type GiftBucket = {
    count: number;
    paid_paise: number;
    pending_paise: number;
};

type ExceptionRow = {
    id: string;
    event_id: string;
    event_title: string;
    full_name: string;
    email: string;
    registration_code: string | null;
    state: StateKey;
    state_label: string;
    billed_paise: number;
    settled_paise: number;
    due_paise: number;
    kinds: string[];
    kind_labels: string[];
};

type Payload = {
    totals: Totals;
    gifts?: {
        cause_gifts: GiftBucket;
        event_gifts: GiftBucket;
    };
    gifts_paid_paise?: number;
    gifts_pending_paise?: number;
    total_received_paise?: number;
    state_counts: Record<StateKey, number>;
    state_labels: Record<StateKey, string>;
    kind_counts: Record<string, number>;
    exception_labels: Record<string, string>;
    exceptions: ExceptionRow[];
};

const STATE_BADGE: Record<StateKey, string> = {
    cancelled: 'bg-surface-container text-on-surface-variant',
    confirmed: 'bg-primary text-secondary-container',
    awaiting_verification: 'bg-secondary-container text-on-secondary-container',
    partial: 'bg-jubilee-gold-light text-on-secondary-fixed-variant',
    unpaid: 'bg-error-container text-error',
};

export default function EventOpsPanel() {
    const [events, setEvents] = useState<EventCatalog[]>([]);
    const [eventId, setEventId] = useState('');
    const [kind, setKind] = useState('');
    const [stateFilter, setStateFilter] = useState<StateKey | ''>('');
    const [data, setData] = useState<Payload | null>(null);
    const [error, setError] = useState('');
    const [reconciledOpen, setReconciledOpen] = useState(false);
    const closeReconciled = useCallback(() => setReconciledOpen(false), []);

    const load = useCallback(async () => {
        setError('');
        const params = new URLSearchParams();
        if (eventId) params.set('event_id', eventId);
        const res = await fetch(`/api/admin/event-ops?${params}`, { cache: 'no-store' });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
            setError(payload.error || 'Could not load event ops');
            setData(null);
            return;
        }
        setData(payload as Payload);
    }, [eventId]);

    useEffect(() => {
        fetch('/api/admin/events')
            .then((r) => r.json())
            .then((list) => {
                if (Array.isArray(list)) setEvents(list);
            })
            .catch(() => {});
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const filtered = useMemo(() => {
        if (!data) return [];
        return data.exceptions.filter((e) => {
            if (kind && !e.kinds.includes(kind as (typeof e.kinds)[number])) return false;
            if (stateFilter && e.state !== stateFilter) return false;
            return true;
        });
    }, [data, kind, stateFilter]);

    function registrationHref(row: ExceptionRow) {
        const p = new URLSearchParams();
        if (row.event_id) p.set('event', row.event_id);
        if (row.email) p.set('q', row.email);
        return `/admin/registrations?${p}`;
    }

    function regStateHref(state: StateKey) {
        const p = new URLSearchParams();
        if (eventId) p.set('event', eventId);
        p.set('state', state);
        return `/admin/registrations?${p}`;
    }

    const t = data?.totals;
    const counts = data?.state_counts;

    const needsAttention =
        counts && t
            ? counts.awaiting_verification + counts.partial + counts.unpaid
            : 0;

    return (
        <>
            {error && (
                <p className="rounded-xl border border-error/30 bg-error-container p-4 text-body-sm text-error mb-4">
                    {error}
                </p>
            )}

            <OpsWorkQueue eventId={eventId} className="mb-6" />

            <div className="flex flex-col sm:flex-row gap-3 mb-6">
                <select
                    className="px-4 py-3.5 rounded-lg border border-primary/15 text-body-sm bg-surface-ivory"
                    value={eventId}
                    onChange={(e) => setEventId(e.target.value)}
                >
                    <option value="">All events</option>
                    {events.map((e) => (
                        <option key={e.id} value={e.id}>
                            {e.title}
                        </option>
                    ))}
                </select>
                <Link
                    href={`/admin/registrations${eventId ? `?event=${eventId}` : ''}`}
                    className="inline-flex items-center justify-center rounded-lg border border-primary/20 px-4 py-2.5 text-label-sm text-primary hover:bg-secondary-container/40"
                >
                    Confirm & pay
                </Link>
                <Link
                    href="/admin/payment-accounts"
                    className="inline-flex items-center justify-center rounded-lg border border-primary/20 px-4 py-2.5 text-label-sm text-primary hover:bg-secondary-container/40"
                >
                    Bank proofs
                </Link>
            </div>

            {t && data?.gifts ? (
                <section className="rounded-2xl border border-jubilee-gold-deep/25 bg-jubilee-gold-light/20 p-5 mb-6 space-y-4">
                    <div className="flex flex-wrap items-end justify-between gap-3">
                        <div>
                            <h2 className="text-headline-sm text-primary">Money together</h2>
                            <p className="text-body-sm text-on-surface-variant mt-1 max-w-2xl">
                                Registration fees, jubilee add-on donations on the form, and separate
                                cause donations at <code className="text-label-sm">/member/donate</code>.
                            </p>
                        </div>
                        <p className="text-headline-sm text-jubilee-gold-deep tabular-nums font-semibold">
                            Total received{' '}
                            {formatCostForDisplay(
                                data.total_received_paise ??
                                    t.settled_paise + data.gifts.cause_gifts.paid_paise
                            )}
                        </p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <div className="rounded-xl border border-outline-variant bg-white p-4">
                            <p className="text-label-sm uppercase tracking-wider text-on-surface-variant">
                                Registration fees received
                            </p>
                            <p className="mt-2 text-headline-sm text-primary tabular-nums">
                                {formatCostForDisplay(t.fees_settled_paise ?? 0)}
                            </p>
                            <p className="text-label-sm text-on-surface-variant mt-1">
                                Due {formatCostForDisplay(t.fees_due_paise ?? 0)}
                            </p>
                        </div>
                        <div className="rounded-xl border border-outline-variant bg-white p-4">
                            <p className="text-label-sm uppercase tracking-wider text-on-surface-variant">
                                Registration donations
                            </p>
                            <p className="mt-2 text-headline-sm text-primary tabular-nums">
                                {formatCostForDisplay(data.gifts.event_gifts.paid_paise)}
                            </p>
                            <p className="text-label-sm text-on-surface-variant mt-1">
                                {data.gifts.event_gifts.count} pledged · pending{' '}
                                {formatCostForDisplay(data.gifts.event_gifts.pending_paise)}
                            </p>
                        </div>
                        <div className="rounded-xl border border-outline-variant bg-white p-4">
                            <p className="text-label-sm uppercase tracking-wider text-on-surface-variant">
                                Standalone donations
                            </p>
                            <p className="mt-2 text-headline-sm text-primary tabular-nums">
                                {formatCostForDisplay(data.gifts.cause_gifts.paid_paise)}
                            </p>
                            <p className="text-label-sm text-on-surface-variant mt-1">
                                {data.gifts.cause_gifts.count} pledged · pending{' '}
                                {formatCostForDisplay(data.gifts.cause_gifts.pending_paise)}
                                {!eventId ? '' : ' · all causes (not filtered by event)'}
                            </p>
                        </div>
                        <div className="rounded-xl border border-outline-variant bg-white p-4">
                            <p className="text-label-sm uppercase tracking-wider text-on-surface-variant">
                                All donations received
                            </p>
                            <p className="mt-2 text-headline-sm text-primary tabular-nums">
                                {formatCostForDisplay(data.gifts_paid_paise ?? 0)}
                            </p>
                            <p className="text-label-sm text-on-surface-variant mt-1">
                                Pending {formatCostForDisplay(data.gifts_pending_paise ?? 0)} ·{' '}
                                <Link href="/admin/donations" className="text-primary underline">
                                    Donation report
                                </Link>
                            </p>
                        </div>
                    </div>
                </section>
            ) : null}

            {t && counts ? (
                <section className="grid gap-4 lg:grid-cols-3 mb-8">
                    <div className="rounded-2xl border border-primary/10 bg-surface-paper p-5 shadow-sm">
                        <h3 className="text-label-sm font-bold uppercase tracking-wider text-on-surface-variant">
                            Attendance
                        </h3>
                        <dl className="mt-3 space-y-2 text-body-sm">
                            <div className="flex justify-between gap-2">
                                <dt className="text-on-surface-variant">Registrations</dt>
                                <dd className="tabular-nums text-primary font-medium">{t.registration_count}</dd>
                            </div>
                            <div className="flex justify-between gap-2">
                                <dt className="text-on-surface-variant">People (alumni + guests)</dt>
                                <dd className="tabular-nums text-primary font-medium">{t.people}</dd>
                            </div>
                            <div className="flex justify-between gap-2">
                                <dt className="text-on-surface-variant">Checked in</dt>
                                <dd className="tabular-nums text-primary font-medium">{t.checked_in_count}</dd>
                            </div>
                        </dl>
                        <Link
                            href="/admin/check-in"
                            className="inline-block mt-4 text-label-sm text-primary underline"
                        >
                            Open check-in
                        </Link>
                    </div>
                    <div className="rounded-2xl border border-primary/10 bg-surface-paper p-5 shadow-sm">
                        <h3 className="text-label-sm font-bold uppercase tracking-wider text-on-surface-variant">
                            Payment status
                        </h3>
                        <p className="text-body-sm text-on-surface-variant mt-1">
                            {needsAttention} need confirmation or payment
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                            {(
                                [
                                    'awaiting_verification',
                                    'partial',
                                    'unpaid',
                                    'confirmed',
                                    'cancelled',
                                ] as StateKey[]
                            ).map((key) => (
                                <Link
                                    key={key}
                                    href={regStateHref(key)}
                                    className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-label-sm ${STATE_BADGE[key]} hover:opacity-90`}
                                >
                                    {data?.state_labels[key]}
                                    <span className="tabular-nums font-bold">{counts[key]}</span>
                                </Link>
                            ))}
                        </div>
                    </div>
                    <div className="rounded-2xl border border-primary/10 bg-surface-paper p-5 shadow-sm">
                        <h3 className="text-label-sm font-bold uppercase tracking-wider text-on-surface-variant">
                            Registration money
                        </h3>
                        <dl className="mt-3 space-y-2 text-body-sm">
                            <div className="flex justify-between gap-2">
                                <dt className="text-on-surface-variant">Billed</dt>
                                <dd className="tabular-nums text-primary font-medium">
                                    {formatCostForDisplay(t.billed_paise)}
                                </dd>
                            </div>
                            <div className="flex justify-between gap-2">
                                <dt className="text-on-surface-variant">Received</dt>
                                <dd className="tabular-nums text-primary font-medium">
                                    {formatCostForDisplay(t.settled_paise)}
                                </dd>
                            </div>
                            <div className="flex justify-between gap-2">
                                <dt className="text-on-surface-variant">Still due</dt>
                                <dd className="tabular-nums text-error font-medium">
                                    {formatCostForDisplay(t.due_paise)}
                                </dd>
                            </div>
                        </dl>
                        <button
                            type="button"
                            onClick={() => setReconciledOpen(true)}
                            className="mt-4 text-label-sm text-primary underline cursor-pointer"
                        >
                            View reconciled list ({formatCostForDisplay(t.settled_paise)})
                        </button>
                    </div>
                </section>
            ) : null}
            <ReconciledRegsModal open={reconciledOpen} onClose={closeReconciled} eventId={eventId} />

            <div className="mb-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h2 className="text-headline-sm text-primary">Fix list</h2>
                        <p className="text-body-sm text-on-surface-variant mt-1">
                            Registrations with mismatched money or missing IDs — open each row to confirm payment.
                        </p>
                    </div>
                    <p className="text-label-sm text-on-surface-variant tabular-nums">
                        Showing {filtered.length} of {data?.exceptions.length ?? 0}
                    </p>
                </div>
                <div className="flex flex-wrap gap-2 items-center">
                    <span className="text-label-sm text-on-surface-variant">State:</span>
                    <button
                        type="button"
                        onClick={() => setStateFilter('')}
                        className={`rounded-lg px-2.5 py-1 text-label-sm cursor-pointer ${
                            stateFilter === '' ? 'bg-primary text-on-primary' : 'bg-surface-container text-primary'
                        }`}
                    >
                        All
                    </button>
                    {data &&
                        (['awaiting_verification', 'partial', 'unpaid'] as StateKey[]).map((key) => (
                            <button
                                key={key}
                                type="button"
                                onClick={() => setStateFilter(stateFilter === key ? '' : key)}
                                className={`rounded-lg px-2.5 py-1 text-label-sm cursor-pointer ${STATE_BADGE[key]} ${
                                    stateFilter === key ? 'ring-2 ring-primary/40' : ''
                                }`}
                            >
                                {data.state_labels[key]} (
                                {data.exceptions.filter((e) => e.state === key).length})
                            </button>
                        ))}
                </div>
                <div className="flex flex-wrap gap-2 items-center">
                    <span className="text-label-sm text-on-surface-variant">Issue type:</span>
                    <button
                        type="button"
                        onClick={() => setKind('')}
                        className={`rounded-lg px-2.5 py-1 text-label-sm cursor-pointer ${
                            kind === '' ? 'bg-primary text-on-primary' : 'bg-surface-container text-primary'
                        }`}
                    >
                        All kinds
                    </button>
                    {data &&
                        Object.entries(data.exception_labels).map(([key, label]) => (
                            <button
                                key={key}
                                type="button"
                                onClick={() => setKind(kind === key ? '' : key)}
                                className={`rounded-lg px-2.5 py-1 text-label-sm cursor-pointer bg-jubilee-gold-light/70 text-on-secondary-fixed-variant ${
                                    kind === key ? 'ring-2 ring-primary/40' : ''
                                }`}
                            >
                                {label} ({data.kind_counts[key] || 0})
                            </button>
                        ))}
                </div>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-primary/10 bg-surface-paper shadow-sm">
                <table className="min-w-full text-left text-body-sm">
                    <thead className="bg-primary text-label-sm text-secondary-container">
                        <tr>
                            <th className="px-4 py-3">Alumnus</th>
                            <th className="px-4 py-3">Event</th>
                            <th className="px-4 py-3">Code</th>
                            <th className="px-4 py-3">State</th>
                            <th className="px-4 py-3">Received / Due</th>
                            <th className="px-4 py-3">Issues</th>
                            <th className="px-4 py-3">Next step</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.length === 0 ? (
                            <tr>
                                <td colSpan={7} className="px-4 py-8 text-on-surface-variant">
                                    No exceptions in this view.
                                </td>
                            </tr>
                        ) : (
                            filtered.map((row) => (
                                <tr key={row.id} className="border-t border-jubilee-gold-light/60 odd:bg-surface-ivory/70">
                                    <td className="px-4 py-3">
                                        <div className="font-medium text-primary">{row.full_name}</div>
                                        <div className="text-label-sm text-on-surface-variant">{row.email}</div>
                                    </td>
                                    <td className="px-4 py-3 text-navy-subtle">{row.event_title}</td>
                                    <td className="px-4 py-3 tracking-wide">{row.registration_code || '—'}</td>
                                    <td className="px-4 py-3">
                                        <span className={`inline-flex rounded-md px-2 py-0.5 text-label-sm ${STATE_BADGE[row.state]}`}>
                                            {row.state_label}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 tabular-nums">
                                        {formatCostForDisplay(row.settled_paise)} / {formatCostForDisplay(row.due_paise)}
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex flex-wrap gap-1.5">
                                            {row.kind_labels.map((label) => (
                                                <span
                                                    key={label}
                                                    className="inline-flex rounded-md bg-jubilee-gold-light/70 px-2 py-0.5 text-label-sm text-on-secondary-fixed-variant"
                                                >
                                                    {label}
                                                </span>
                                            ))}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <Link
                                            href={registrationHref(row)}
                                            className="inline-flex rounded-lg bg-secondary-container text-on-secondary-container px-3 py-1.5 text-label-sm hover:bg-secondary-fixed"
                                        >
                                            Open registration
                                        </Link>
                                        {row.state === 'awaiting_verification' ? (
                                            <Link
                                                href="/admin/payment-accounts"
                                                className="block mt-2 text-label-sm text-primary underline"
                                            >
                                                Match bank proof
                                            </Link>
                                        ) : null}
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </>
    );
}