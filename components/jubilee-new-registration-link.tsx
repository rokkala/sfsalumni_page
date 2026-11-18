'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { newRegistrationPath } from '@/lib/events/choose-event';
import { jubileeCta, jubileeNavCta, type JubileeAccountHint } from '@/lib/jubilee-cta';

type Variant = 'nav' | 'hero' | 'inline';

const styles: Record<Variant, string> = {
  nav: 'inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary hover:bg-navy-subtle text-on-primary text-label-md uppercase tracking-wider shadow-sm transition-all',
  hero: 'inline-flex items-center gap-2.5 px-6 py-3.5 rounded-lg bg-primary hover:bg-navy-subtle text-on-primary text-label-md uppercase tracking-wider shadow-lg hover:shadow-xl transition-all transform hover:-translate-y-0.5',
  inline:
    'inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-primary hover:bg-navy-subtle text-on-primary text-label-md uppercase tracking-wider shadow-sm transition-all border border-primary/20',
};

/** Parallel CTA for the username-first registration gate at /new_registration. */
export default function JubileeNewRegistrationLink({
  variant = 'nav',
  className = '',
  eventId,
}: {
  variant?: Variant;
  className?: string;
  /** When set, links straight to that event’s gate. */
  eventId?: string;
}) {
  const [account, setAccount] = useState<JubileeAccountHint | null | undefined>(undefined);
  const [eventIds, setEventIds] = useState<string[]>([]);
  const pathname = usePathname();

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/auth/me', { cache: 'no-store' });
        if (!active) return;
        if (!res.ok) {
          setAccount(null);
          return;
        }
        const me = await res.json();
        setAccount({
          role: me.role,
          jubilee_reg_status: me.jubilee_reg_status || 'none',
          payment_proof_pending: Boolean(me.payment_proof_pending),
        });
      } catch {
        if (active) setAccount(null);
      }
    })();
    return () => {
      active = false;
    };
  }, [pathname]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/events', { cache: 'no-store' });
        if (!active || !res.ok) return;
        const rows = (await res.json()) as { id?: string }[];
        if (!active || !Array.isArray(rows)) return;
        setEventIds(rows.map((row) => String(row.id || '')).filter(Boolean));
      } catch {
        if (active) setEventIds([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [pathname]);

  if (account === undefined) return null;
  const cta = variant === 'nav' ? jubileeNavCta(account) : jubileeCta(account);
  if (!cta.show) return null;

  let href = cta.href.replace(/^\/registration/, '/new_registration');
  if (eventId) href = newRegistrationPath(eventId);
  else if (href === '/new_registration' && eventIds.length === 1) href = newRegistrationPath(eventIds[0]);

  return (
    <Link
      href={href}
      id="new_registration"
      data-cta="new_registration"
      className={`${styles[variant]} ${className}`.trim()}
    >
      <span className="material-symbols-outlined text-[18px]">how_to_reg</span>
      New registration
    </Link>
  );
}