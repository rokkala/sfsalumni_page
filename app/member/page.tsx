// app/member/page.tsx
// Member home. The next-step button is decided from the server's amounts: a registration needs
// action only when money is still due and the committee has not confirmed it. A confirmed
// registration never shows a pay or continue prompt.

'use client';

import HomeDestinationLanes from '@/components/home-destination-lanes';
import MemberGate from '@/components/member-gate';
import {
  MemberHomeBootstrapProvider,
  useMemberHomeBootstrap,
  MEMBER_HOME_OUTSIDE,
} from '@/components/member-home-bootstrap';
import MemberPaymentHistory from '@/components/member-payment-history';
import MemberVenuePass from '@/components/member-venue-pass';
import PortalShell from '@/components/portal-shell';
import { firstNameFromFullName } from '@/lib/portal/welcome';

function MemberPageInner() {
  const homeBundle = useMemberHomeBootstrap();
  const member = homeBundle !== MEMBER_HOME_OUTSIDE && homeBundle ? homeBundle.member : null;
  const welcomeReady =
    member &&
    member.member_status !== 'rejected' &&
    member.member_status !== 'suspended';
  const firstName = member ? firstNameFromFullName(String(member.full_name || '')) : 'friend';
  const batch =
    member && typeof member.batch === 'number'
      ? member.batch
      : member?.batch != null
        ? Number(member.batch) || null
        : null;

  return (
    <PortalShell title="My home" intro="Your venue pass and next step live here.">
      {welcomeReady && (
        <section className="mb-6 rounded-2xl border border-outline-variant border-l-[3px] border-l-jubilee-gold-deep bg-surface-paper px-5 py-6 sm:px-7 sm:py-7">
          <p className="text-label-sm uppercase tracking-[0.16em] text-jubilee-gold-deep font-bold">
            Welcome
          </p>
          <h2 className="text-headline-lg text-primary mt-2">Welcome, {firstName}</h2>
          {batch != null && (
            <p className="text-label-sm text-jubilee-gold-deep mt-3 tracking-wide">Class of {batch}</p>
          )}
        </section>
      )}

      <MemberGate mode="signed-in">
        <MemberVenuePass />
        <MemberPaymentHistory />

        <HomeDestinationLanes />
      </MemberGate>
    </PortalShell>
  );
}

export default function MemberPage() {
  return (
    <MemberHomeBootstrapProvider>
      <MemberPageInner />
    </MemberHomeBootstrapProvider>
  );
}