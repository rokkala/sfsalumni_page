// lib/events/event-cta.ts
// CTA for an event card or hero slide when the signed-in alumni may already be registered.
// Guests and alumni with no row still see Register. Settled registrations point at details.
// Register kind uses newRegistrationPath; continue/view use registrationPath — lib/events/choose-event.ts.
import { newRegistrationPath, registrationPath } from './choose-event.ts';

export type EventRegistrationHint = {
  payment_status?: string | null;
  total_due_paise?: number | null;
  committee_confirmed?: boolean | null;
  pending_offline_proof?: unknown;
  bank_reference?: string | null;
};

export type EventAction = {
  /** register = first-time; continue = unpaid/pending proof; view = settled */
  kind: 'register' | 'continue' | 'view';
  label: string;
  href: string;
};

function duePaise(reg: EventRegistrationHint): number {
  return Math.max(0, Number(reg.total_due_paise) || 0);
}

function isSettled(reg: EventRegistrationHint): boolean {
  if (reg.committee_confirmed === true) return true;
  return reg.payment_status === 'paid' && duePaise(reg) === 0;
}

function proofPending(reg: EventRegistrationHint): boolean {
  if (reg.pending_offline_proof) return true;
  return Boolean(String(reg.bank_reference ?? '').trim());
}

/** Keep in sync with pendingPaymentMemberLabel in lib/payments/offline-proof.ts */
function continueLabel(awaiting: boolean): string {
  return awaiting ? 'Awaiting confirmation' : 'Complete payment';
}

/**
 * Action for one event given an optional saved registration.
 * Pass null/undefined when not signed in or no registration exists.
 */
export function eventActionFromRegistration(
  eventId: string,
  registration: EventRegistrationHint | null | undefined
): EventAction {
  const hrefContinue = registrationPath(eventId);
  if (!registration) {
    return {
      kind: 'register',
      label: 'New Registration',
      href: newRegistrationPath(eventId),
    };
  }
  if (isSettled(registration)) {
    return { kind: 'view', label: 'View event details', href: hrefContinue };
  }
  return {
    kind: 'continue',
    label: continueLabel(proofPending(registration)),
    href: hrefContinue,
  };
}
