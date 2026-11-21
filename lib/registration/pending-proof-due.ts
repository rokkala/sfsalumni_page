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