// lib/registration/preview.ts
// Live preview of what the form would charge, shown only while the form has unsaved edits.
// It uses the same fee rule the server uses (getEventCostBreakdown), so the numbers match.
// The server recalculates on save and again on pay. The preview is never stored or charged.

import {
    donationDueWithPendingVerification,
    feePortionFromPendingProofAmount,
} from '@/lib/registration/pending-proof-due';
import {
    clampGuestCount,
    clampGuestsEating,
    getEventCostBreakdown,
    isEventAttending,
} from '@/lib/registration/registration';
import { donationIntentPaise, type FormData, type RegistrationMoney } from '@/lib/registration/types';

/** Proof total for preview; uses stored amount_paise or saved fee+donation when legacy proof has no amount. */
export function effectivePendingProofAmountPaise(
    saved: RegistrationMoney,
    pendingProofAmountPaise: number | undefined,
    hasPendingProof: boolean
): number {
    const stored = Math.max(0, Math.floor(Number(pendingProofAmountPaise) || 0));
    if (stored > 0) return stored;
    const inFlight = hasPendingProof || saved.passState === 'pending_verification' || savedFeeTreatedAsCovered(saved);
    if (!inFlight) return 0;
    const donationPending =
        saved.donationPaymentStatus !== 'paid' && saved.donationPaymentStatus !== 'failed';
    const donationPart = donationPending ? Math.max(0, saved.donationIntendedPaise) : 0;
    return Math.max(0, saved.feeTotalPaise) + donationPart;
}

export type PreviewMoneyOptions = {
    /**
     * Credit the saved registration fee in the preview (fee/donation already paid or awaiting
     * committee review). True when proof is pending, pass is in preview, partial fee paid, etc.
     */
    creditSavedRegistrationFee?: boolean;
    /** Pending offline proof amount (fee + donation at submit time). */
    pendingProofAmountPaise?: number;
};

/** Saved row shows fee covered (e.g. pending committee review) while fee total is still positive. */
export function savedFeeTreatedAsCovered(saved: RegistrationMoney): boolean {
    return (
        saved.feeTotalPaise > 0 &&
        saved.feeDuePaise === 0 &&
        saved.paymentStatus !== 'paid' &&
        (saved.passState === 'pending_verification' || saved.totalDuePaise === 0)
    );
}

/** True when the saved registration already has money in flight — preview should show increments only. */
export function shouldCreditSavedFeeInPreview(
    saved: RegistrationMoney,
    opts?: Pick<PreviewMoneyOptions, 'creditSavedRegistrationFee'>
): boolean {
    if (opts?.creditSavedRegistrationFee) return true;
    if (saved.passState === 'pending_verification') return true;
    if (saved.paymentStatus === 'partial') return true;
    if (saved.feePaidPaise > 0) return true;
    return savedFeeTreatedAsCovered(saved);
}

/**
 * Fee treated as already covered when previewing a higher guest count or other repricing.
 * Does not credit an unpaid saved total (no payment started yet).
 */
export function creditedFeePaidPaise(
    saved: RegistrationMoney,
    previewFeeTotal: number,
    opts?: PreviewMoneyOptions
): number {
    const paidRecorded = Math.max(0, saved.feePaidPaise);
    const savedTotal = Math.max(0, saved.feeTotalPaise);
    if (!shouldCreditSavedFeeInPreview(saved, opts)) return paidRecorded;

    const proofAmount = Math.max(0, Math.floor(Number(opts?.pendingProofAmountPaise) || 0));
    const proofFee = feePortionFromPendingProofAmount({
        proofAmountPaise: proofAmount,
        feeTotalPaise: savedTotal,
        donationIntendedPaise: saved.donationIntendedPaise,
        donationPaymentStatus: saved.donationPaymentStatus,
    });
    // Explicit proof amount → credit that fee slice only. Partial DB payment → paidRecorded. Else full saved fee in flight.
    let covered = paidRecorded;
    if (proofAmount > 0) {
        covered = Math.max(covered, proofFee);
    } else if (paidRecorded > 0) {
        covered = Math.max(covered, paidRecorded);
    } else {
        covered = Math.max(covered, savedTotal);
    }

    if (previewFeeTotal > covered) {
        return covered;
    }
    return covered;
}

/**
 * Builds the figures the form would show if saved now. The saved registration supplies the amount
 * already paid and the donation's payment state, because the browser never decides those.
 */
export function previewMoney(
    saved: RegistrationMoney,
    form: FormData,
    opts?: PreviewMoneyOptions
): RegistrationMoney {
    const creditSaved = shouldCreditSavedFeeInPreview(saved, opts);
    const guestCount = clampGuestCount(form.number_of_guests);
    const guestsEating = clampGuestsEating(form.guests_eating, guestCount);
    const attendanceValid = isEventAttending(form.attending, guestCount);

    const feeTotal = attendanceValid
        ? getEventCostBreakdown({
              attending: form.attending,
              alumnusEats: form.attending && form.lunch,
              batch: form.batch ?? null,
              guestCount,
              guestsEating,
          }).totalCost
        : 0;

    const feePaid = creditedFeePaidPaise(saved, feeTotal, opts);
    const feeDue = Math.max(0, feeTotal - feePaid);

    // A paid donation cannot be changed from the form, so the saved figure stays.
    const donationPaid = saved.donationPaymentStatus === 'paid';
    const donationIntended = donationPaid ? saved.donationIntendedPaise : donationIntentPaise(form);
    const donationDue = donationDueWithPendingVerification({
        intendedPaise: saved.donationIntendedPaise,
        paymentStatus: saved.donationPaymentStatus,
        pendingVerification: creditSaved,
        previewIntentPaise: donationIntended,
    });

    return {
        feeTotalPaise: feeTotal,
        feePaidPaise: feePaid,
        feeDuePaise: feeDue,
        donationIntendedPaise: donationIntended,
        donationDuePaise: donationDue,
        donationPaymentStatus: saved.donationPaymentStatus,
        totalDuePaise: feeDue + donationDue,
        paymentStatus: saved.paymentStatus,
        registrationCode: saved.registrationCode,
        registrationQr: saved.registrationQr,
        passState: saved.passState,
        previewRegistrationCode: saved.previewRegistrationCode,
        previewRegistrationQr: saved.previewRegistrationQr,
        eventFeePaymentLabel: saved.eventFeePaymentLabel,
    };
}