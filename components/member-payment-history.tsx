'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MEMBER_HOME_OUTSIDE, useMemberHomeBootstrap } from '@/components/member-home-bootstrap';

type Reg = { id: string; registration_code: string | null; payment_status: string; event_title: string };
type Don = { id: string; amount_paise: number; payment_status: string; cause_title: string };

export default function MemberPaymentHistory() {
  const homeBundle = useMemberHomeBootstrap();
  const [regs, setRegs] = useState<Reg[]>([]);
  const [dons, setDons] = useState<Don[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (homeBundle !== MEMBER_HOME_OUTSIDE) {
      if (homeBundle === undefined) {
        setLoading(true);
        return;
      }
      if (!homeBundle) {
        setLoading(false);
        return;
      }
      setRegs(homeBundle.transactions.registrations || []);
      setDons(homeBundle.transactions.donations || []);
      setLoading(false);
      return;
    }

    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/member/transactions', { cache: 'no-store' });
        if (!res.ok || !active) return;
        const data = (await res.json()) as { registrations?: Reg[]; donations?: Don[] };
        setRegs(data.registrations || []);
        setDons(data.donations || []);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [homeBundle]);

  if (loading) return null;
  if (regs.length === 0 && dons.length === 0) return null;

  return (
    <section className="mb-6 rounded-2xl border border-outline-variant bg-white p-6 shadow-sm">
      <h2 className="text-headline-sm text-primary">Your payments</h2>
      <p className="text-body-sm text-on-surface-variant mt-1">Download a receipt for settled transactions.</p>
      <ul className="mt-4 space-y-2 text-body-sm">
        {regs.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-outline-variant/50 pt-2">
            <span>
              {r.event_title}
              {r.registration_code ? ` · ${r.registration_code}` : ''}
            </span>
            <Link
              href={`/api/member/receipt?registrationId=${encodeURIComponent(r.id)}`}
              className="text-primary underline text-label-sm"
              target="_blank"
              rel="noreferrer"
            >
              Receipt
            </Link>
          </li>
        ))}
        {dons.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-outline-variant/50 pt-2">
            <span>Donation · {d.cause_title}</span>
            <Link
              href={`/api/member/receipt?donationId=${encodeURIComponent(d.id)}`}
              className="text-primary underline text-label-sm"
              target="_blank"
              rel="noreferrer"
            >
              Receipt
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}