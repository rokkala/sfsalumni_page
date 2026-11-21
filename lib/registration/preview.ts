// lib/registration/preview.ts
// Live preview of what the form would charge, shown only while the form has unsaved edits.
// It uses the same fee rule the server uses (getEventCostBreakdown), so the numbers match.
// The server recalculates on save and again on pay. The preview is never stored or charged.

import { donationDueWithPendingVerification } from '@/lib/registration/pending-proof-due';
import {
    clampGuestCount,
    clampGuestsEating,
    getEventCostBreakdown,
    isEventAttending,
} from '@/lib/registration/registration';
import { donationIntentPaise, type FormData, type RegistrationMoney } from '@/lib/registration/types';

export type PreviewMoneyOptions = {
    /**
     * Credit the saved registration fee in the preview (fee/donation already paid or awaiting
     * committee review). True when proof is pending, pass is in preview, partial fee paid, etc.
     */
    creditSavedRegistrationFee?: boolean;
};

/** True when the saved registration already has money in flight — preview should show increments only. */
export function shouldCreditSavedFeeInPreview(
    saved: RegistrationMoney,
    opts?: Pick<PreviewMoneyOptions, 'creditSavedRegistrationFee'>
): boolean {
    if (opts?.creditSavedRegistrationFee) return true;
    if (saved.passState === 'pending_verification') return true;
    if (saved.paymentStatus === 'partial') return true;
    return saved.feePaidPaise > 0;
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
    if (previewFeeTotal > savedTotal) {
        return Math.max(paidRecorded, savedTotal);
    }
    return Math.max(paidRecorded, savedTotal);
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