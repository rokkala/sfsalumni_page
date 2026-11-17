// app/events/page.tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import MemberGate from '@/components/member-gate';
import PortalShell from '@/components/portal-shell';
import {
  eventActionFromRegistration,
  type EventRegistrationHint,
} from '@/lib/events/event-cta';
import { eventFeeSummary } from '@/lib/events/pricing';
import type { EventCatalog } from '@/lib/events/types';

type RegMap = Record<string, EventRegistrationHint | null>;

export default function EventsPage() {
  const [events, setEvents] = useState<EventCatalog[]>([]);
  const [regs, setRegs] = useState<RegMap>({});
  const [message, setMessage] = useState('Loading events…');

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/events', { cache: 'no-store' });
        const payload = await res.json().catch(() => ({}));
        if (!active) return;
        if (!res.ok) {
          setMessage(payload.error || 'Events are not connected yet.');
          setEvents([]);
          return;
        }
        const rows = payload as EventCatalog[];
        setMessage(rows.length ? '' : 'No upcoming events have been published yet.');

        const next: RegMap = {};
        const meRes = await fetch('/api/auth/me', { cache: 'no-store' });
        if (active && meRes.ok) {
          await Promise.all(
            rows.map(async (event) => {
              const regRes = await fetch(
                `/api/registration/event?eventId=${encodeURIComponent(event.id)}`,
                { cache: 'no-store' }
              );
              if (!active || !regRes.ok) {
                next[event.id] = null;
                return;
              }
              const body = (await regRes.json().catch(() => ({}))) as {
                registration?: EventRegistrationHint | null;
              };
              next[event.id] = body.registration ?? null;
            })
          );
        }
        if (!active) return;
        setRegs(next);
        setEvents(rows);
      } catch {
        if (active) setMessage('Events are not configured yet.');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <PortalShell title="Make the next memory" eyebrow="REUNIONS · MEETUPS · SCHOOL EVENTS">
      <MemberGate>
        {message && (
          <p className="rounded-xl bg-secondary-container/30 border border-jubilee-gold-light p-5 text-body-sm text-on-secondary-fixed-variant mb-4">
            {message}
          </p>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          {events.map((e) => {
            const action = eventActionFromRegistration(e.id, regs[e.id]);
            return (
              <article
                key={e.id}
                className="rounded-2xl bg-surface-paper border border-primary/10 p-6 shadow-sm hover:border-jubilee-gold-light transition-colors"
              >
                <div className="text-label-sm uppercase tracking-widest text-jubilee-gold-deep font-bold">
                  {new Date(e.starts_at).toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </div>
                <h2 className="text-headline-sm text-primary mt-3">{e.title}</h2>
                <p className="text-body-sm text-navy-subtle mt-2">{e.summary}</p>
                {e.venue && (
                  <p className="text-label-sm text-on-surface-variant mt-3">Venue: {e.venue}</p>
                )}
                {e.description && e.description.trim() !== e.summary.trim() ? (
                  <p className="text-body-sm text-on-surface-variant mt-3 whitespace-pre-line">
                    {e.description}
                  </p>
                ) : null}
                {action.kind === 'register' ? (
                  <p className="text-label-sm text-navy-subtle mt-3">{eventFeeSummary()}</p>
                ) : (
                  <p className="text-label-sm text-jubilee-gold-deep mt-3 font-bold">
                    {action.kind === 'view' ? "You're registered" : 'Registration in progress'}
                  </p>
                )}
                <Link
                  href={action.href}
                  className="inline-flex mt-5 rounded-lg bg-secondary-container text-on-secondary-container hover:bg-secondary-fixed px-4 py-2.5 text-label-sm font-bold"
                >
                  {action.label} ↗
                </Link>
              </article>
            );
          })}
        </div>
      </MemberGate>
    </PortalShell>
  );
}
