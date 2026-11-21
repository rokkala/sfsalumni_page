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
    /** Bank/UPI proof awaiting committee review — credit saved fee (and donation intent) in the preview. */
    pendingVerification?: boolean;
};

/** Fee already covered by verified payment or by pending offline proof on the saved registration. */
export function creditedFeePaidPaise(saved: RegistrationMoney, pendingVerification: boolean): number {
    if (!pendingVerification) return saved.feePaidPaise;
    return Math.max(saved.feePaidPaise, saved.feeTotalPaise);
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
    const pendingVerification = Boolean(opts?.pendingVerification);
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

    const feePaid = creditedFeePaidPaise(saved, pendingVerification);
    const feeDue = Math.max(0, feeTotal - feePaid);

    // A paid donation cannot be changed from the form, so the saved figure stays.
    const donationPaid = saved.donationPaymentStatus === 'paid';
    const donationIntended = donationPaid ? saved.donationIntendedPaise : donationIntentPaise(form);
    const donationDue = donationDueWithPendingVerification({
        intendedPaise: saved.donationIntendedPaise,
        paymentStatus: saved.donationPaymentStatus,
        pendingVerification,
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