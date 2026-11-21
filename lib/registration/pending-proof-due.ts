// Shared due math while offline proof is pending or after a withdrawn proof is credited.

import {
    amountDuePaise,
    statusFromAmounts,
    type RegistrationPaymentStatus,
} from '@/lib/events/balance';

/** Fee treated as covered while committee reviews Bank/UPI proof for the saved registration. */
export function feeDueWithPendingVerification(
    feeTotalPaise: number,
    feePaidPaise: number,
    pendingVerification: boolean
): number {
    const total = Math.max(0, Math.floor(Number(feeTotalPaise) || 0));
    const paid = Math.max(0, Math.floor(Number(feePaidPaise) || 0));
    if (!pendingVerification) return amountDuePaise(total, paid);
    return amountDuePaise(total, Math.max(paid, total));
}

/** Fee portion of a pending offline proof (proof total may include donation). */
export function feePortionFromPendingProofAmount(input: {
    proofAmountPaise: number;
    feeTotalPaise: number;
    donationIntendedPaise: number;
    donationPaymentStatus: string | null | undefined;
}): number {
    const proof = Math.max(0, Math.floor(Number(input.proofAmountPaise) || 0));
    if (proof < 1) return 0;
    const donationPending =
        input.donationPaymentStatus !== 'paid' &&
        input.donationPaymentStatus !== 'failed' &&
        input.donationIntendedPaise > 0;
    const feePart = donationPending
        ? Math.max(0, proof - input.donationIntendedPaise)
        : proof;
    return Math.max(0, feePart);
}

/** Donation still owed; while proof is pending, saved intent is treated as already submitted. */
export function donationDueWithPendingVerification(input: {
    intendedPaise: number;
    paymentStatus: string | null | undefined;
    pendingVerification: boolean;
    /** New intent while editing — only then is incremental due shown. */
    previewIntentPaise?: number;
}): number {
    const status = input.paymentStatus ?? null;
    if (status === 'paid' || status === 'failed') return 0;
    const savedIntent = Math.max(0, Math.floor(Number(input.intendedPaise) || 0));
    const previewIntent =
        input.previewIntentPaise == null
            ? savedIntent
            : Math.max(0, Math.floor(Number(input.previewIntentPaise) || 0));
    if (!input.pendingVerification) return previewIntent;
    return Math.max(0, previewIntent - savedIntent);
}

/** Pricing fields that affect fee, donation intent, or proof amount — must match client choicesFingerprint. */
export function registrationPricingFingerprint(parts: {
    attending: boolean;
    lunch: boolean;
    food_preference: string | null;
    number_of_guests: number;
    guests_eating: number;
    has_parking: boolean;
    two_wheeler_count: number;
    four_wheeler_count: number;
    intended_donation_paise: number;
    batch: number | null;
}): string {
    return [
        parts.attending,
        parts.lunch,
        parts.food_preference ?? '',
        parts.number_of_guests,
        parts.guests_eating,
        parts.has_parking,
        parts.has_parking ? parts.two_wheeler_count : 0,
        parts.has_parking ? parts.four_wheeler_count : 0,
        Math.max(0, Math.floor(Number(parts.intended_donation_paise) || 0)),
        parts.batch ?? '',
    ].join('|');
}

/** Use stored proof amount when present; otherwise at least what was due when the proof was pending. */
export function inferredWithdrawnProofAmountPaise(input: {
    proofAmountPaise: number;
    feeTotalPaise: number;
    feePaidPaise: number;
    donationDuePaise: number;
}): number {
    const proof = Math.max(0, Math.floor(Number(input.proofAmountPaise) || 0));
    const feeDue = amountDuePaise(
        Math.max(0, Math.floor(Number(input.feeTotalPaise) || 0)),
        Math.max(0, Math.floor(Number(input.feePaidPaise) || 0))
    );
    const donationDue = Math.max(0, Math.floor(Number(input.donationDuePaise) || 0));
    return Math.max(proof, feeDue + donationDue);
}

/** Apply a withdrawn proof amount to fee first, then donation (same order as mark-paid settle). */
export function applyWithdrawnRegistrationProofCredit(input: {
    proofAmountPaise: number;
    feeTotal: number;
    feePaidBefore: number;
    donationAmountDue: number;
}): {
    amount_paid_paise: number;
    payment_status: Exclude<RegistrationPaymentStatus, 'cancelled'>;
    donationDuePaise: number;
    donationSettledByCredit: boolean;
} {
    const proof = Math.max(0, Math.floor(Number(input.proofAmountPaise) || 0));
    const feeTotal = Math.max(0, Math.floor(Number(input.feeTotal) || 0));
    const feePaidBefore = Math.max(0, Math.floor(Number(input.feePaidBefore) || 0));
    const donationAmountDue = Math.max(0, Math.floor(Number(input.donationAmountDue) || 0));

    const feeDue = amountDuePaise(feeTotal, feePaidBefore);
    const feePortion = Math.min(proof, feeDue);
    const amount_paid_paise = Math.min(feeTotal, feePaidBefore + feePortion);
    const remainder = proof - feePortion;
    const donationPortion = Math.min(remainder, donationAmountDue);
    const donationDuePaise = Math.max(0, donationAmountDue - donationPortion);
    const donationSettledByCredit =
        donationAmountDue > 0 && donationPortion >= donationAmountDue;

    return {
        amount_paid_paise,
        payment_status: statusFromAmounts(feeTotal, amount_paid_paise),
        donationDuePaise,
        donationSettledByCredit,
    };
}