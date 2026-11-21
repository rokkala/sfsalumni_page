/**
 * Pending Bank / UPI proof helpers shared by submit + registration lock paths.
 * Pure display helpers live here so scripts/check-bank-details.mjs can assert them without DB.
 */

export type PendingOfflineProof = {
  id: string;
  utr: string | null;
  screenshot_path: string | null;
  status: 'pending';
};

/** Bank reference column value used for admin “awaiting verification” when only a screenshot exists. */
export const SCREENSHOT_BANK_REFERENCE = 'Screenshot on file';

/** Legacy copy; saving now withdraws pending proof instead of blocking edits. */
export const PENDING_PROOF_LOCK_MESSAGE =
  'Your Bank / UPI proof is pending committee review. Your registration ID and QR stay the same; status clears only after every payment line is verified. Save changes to withdraw the proof and update your registration.';

/** Shown on pass / banner — QR and Reg ID do not change while payments are in flight. */
export const PASS_QR_UNCHANGED_HINT =
  'Your registration ID and QR stay the same. Pending verification clears only after every payment line (fee and donation) is confirmed by finance.';

/** Offline / alternative-method thanks when registration has no attendance, only a gift. */
export const REGISTRATION_DONATION_ONLY_THANKS =
  'Thank you for the Donation. The committee will confirm your payment.';

/** Member-facing message when another proof submit is blocked. */
export const PENDING_PROOF_ALREADY_MESSAGE =
  'A Bank / UPI proof is already pending review. Wait for the committee, or contact them if you need to change the reference.';

/** Nav / chip / pass CTA when money is still due. */
export function pendingPaymentMemberLabel(proofPending: boolean): string {
  return proofPending ? 'Awaiting confirmation' : 'Complete payment';
}

/** Registration page H1 — never say “Complete payment” while proof awaits review. */
export function registrationFormHeading(input: {
  formMode: 'new' | 'pay' | 'update';
  verificationPending: boolean;
}): string {
  if (input.verificationPending) return 'Awaiting confirmation';
  if (input.formMode === 'update') return 'Update registration';
  if (input.formMode === 'pay') return 'Complete payment';
  return 'Event Registration';
}

/**
 * My home venue-pass payment strip. Proof submitted (pending row or bank ref) is
 * “awaiting confirmation”, not “Complete payment”.
 */
export function venuePassPaymentCue(input: {
  confirmed: boolean;
  dueLabel: string;
  pendingOfflineProof: boolean;
  bankReference?: string | null;
  /** Not attending and no guests — only a jubilee gift, no entry pass. */
  donationOnly?: boolean;
}): {
  awaiting: boolean;
  badge: string;
  message: string;
  ctaLabel: string;
} | null {
  if (input.confirmed) return null;
  const awaiting =
    input.pendingOfflineProof || Boolean(String(input.bankReference ?? '').trim());
  if (awaiting) {
    return {
      awaiting: true,
      badge: 'Awaiting confirmation',
      message: input.donationOnly
        ? 'Your gift is with the committee. They will confirm when it is matched to your payment.'
        : `Your payment is with the committee. ${PASS_QR_UNCHANGED_HINT} The QR below is not valid for entry until then.`,
      ctaLabel: input.donationOnly ? 'View gift details' : 'View registration',
    };
  }
  return {
    awaiting: false,
    badge: input.dueLabel,
    message: input.donationOnly
      ? 'Complete payment for your jubilee gift.'
      : 'Complete payment to unlock your entry pass QR.',
    ctaLabel: pendingPaymentMemberLabel(false),
  };
}

export function bankReferenceFromProof(input: {
  utr: string | null;
  hasScreenshot: boolean;
  /** Normalized registration ref embedded in the UPI payment note (no UTR from member). */
  registrationUpiRef?: string | null;
}): string {
  const utr = String(input.utr ?? '').trim();
  if (utr) return utr;
  if (input.hasScreenshot) return SCREENSHOT_BANK_REFERENCE;
  const regRef = String(input.registrationUpiRef ?? '').trim();
  if (regRef) return regRef;
  throw new Error('Add a UTR reference or a payment screenshot');
}

export type VenuePassState = 'none' | 'payment_required' | 'pending_verification' | 'verified';

/** Member-facing entry pass state (venue pass only). Preview QR while a Reg ID is reserved and not fully verified. */
export function passStateFromRegistration(input: {
  venuePass: boolean;
  paymentStatus: string | null | undefined;
  totalDuePaise: number | null | undefined;
  /** True when `pending_offline_proof` is present — not bank_reference alone. */
  pendingOfflineProof: boolean;
  /** SFS code already on file — keep the same preview QR until all lines are verified. */
  hasRegistrationCode?: boolean;
}): VenuePassState {
  if (!input.venuePass) return 'none';
  const totalDue = Math.max(0, Math.floor(Number(input.totalDuePaise) || 0));
  const fullyVerified =
    input.paymentStatus === 'paid' && totalDue === 0 && !input.pendingOfflineProof;
  if (fullyVerified) return 'verified';
  if (input.pendingOfflineProof || input.hasRegistrationCode) return 'pending_verification';
  return 'payment_required';
}

export const PASS_PENDING_VERIFICATION_MESSAGE = `${PASS_QR_UNCHANGED_HINT} This pass is not valid for venue entry until then.`;

export const PASS_PAYMENT_VERIFIED_MESSAGE = 'Payment verified. Show this QR code at the venue.';

export function passStatusBadge(state: VenuePassState): string | null {
  if (state === 'pending_verification') return 'Pending verification';
  if (state === 'verified') return 'Payment verified';
  return null;
}

export function verificationStatusLabel(input: {
  paymentStatus: string | null | undefined;
  pendingProof: boolean;
  bankReference: string | null | undefined;
  /** Fee + donation still owed; fee alone may show as paid when total cost is ₹0. */
  totalDuePaise?: number | null;
}): string {
  const totalDue = Math.max(0, Math.floor(Number(input.totalDuePaise) || 0));
  const status = input.paymentStatus ?? 'pending';
  const fullyVerified = status === 'paid' && totalDue === 0;
  if (fullyVerified && !input.pendingProof) return 'Payment verified';
  if (input.pendingProof || Boolean(String(input.bankReference ?? '').trim())) {
    return 'pending verification';
  }
  if (totalDue > 0 && (status === 'partial' || (status === 'paid' && totalDue > 0))) {
    return 'pending verification';
  }
  return 'not submitted';
}

export function pendingProofDisplay(proof: {
  utr: string | null;
  screenshot_path: string | null;
}): { utr: string; hasScreenshot: boolean; label: string } {
  const utr = String(proof.utr ?? '').trim();
  const hasScreenshot = Boolean(proof.screenshot_path);
  const label = utr
    ? hasScreenshot
      ? `UTR ${utr} · screenshot on file · pending verification`
      : `UTR ${utr} · pending verification`
    : hasScreenshot
      ? 'Screenshot on file · pending verification'
      : 'Pending verification';
  return { utr, hasScreenshot, label };
}
