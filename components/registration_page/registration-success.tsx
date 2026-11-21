// components/registration_page/registration-success.tsx
// Confirmation screen. Shows the registration code when paid in full.
// Alumni can add guests here and pay only the extra amount due.

import { useState, type Dispatch, type SetStateAction } from 'react';
import BackHomeLink from '@/components/back-home-link';
import EventPushOptIn from '@/components/event-push-opt-in';
import OfflinePayModal from '@/components/offline-pay-modal';
import { ModalBlockingScrim } from '@/components/modal-shell';
import { RegistrationPassBlock, passBlockFromMoney } from '@/components/registration-pass-block';
import { PaymentSummary } from '@/components/registration_page/registration-payment-summary';
import {
    clampGuestCount,
    clampGuestsEating,
    EVENT_FEE_PER_PERSON_PAISE,
    formatCostForDisplay,
    MAX_GUESTS,
    MIN_GUESTS,
} from '@/lib/registration/registration';
import { eventFeeNotApplicable } from '@/lib/events/venue-attendance';
import type { EventCatalog } from '@/lib/events/types';
import type { BankAccountPublic } from '@/lib/payments/bank-details';
import { PASS_QR_UNCHANGED_HINT, pendingProofDisplay } from '@/lib/payments/offline-proof';
import type { FormData, RegistrationMoney } from '@/lib/registration/types';

const INPUT_CLASS =
    'w-full px-4 py-3.5 rounded-lg border border-outline-variant text-body-sm bg-surface focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all disabled:opacity-50';

export interface RegistrationSuccessProps {
    formData: FormData;
    setFormData: Dispatch<SetStateAction<FormData>>;
    event: EventCatalog | null;
    accountFullName: string;
    busy: boolean;
    formDirty: boolean;
    /** Saved amounts from the database. */
    money: RegistrationMoney;
    /** Preview while guest counts are edited. */
    displayMoney: RegistrationMoney;
    committeeConfirmed: boolean;
    error: string;
    saveMessage: string;
    signedIn: boolean;
    verificationPending: boolean;
    pendingProof: { utr: string | null; hasScreenshot: boolean } | null;
    savedBankReference: string;
    bankAccount: BankAccountPublic | null;
    onlineCheckoutEnabled: boolean;
    payingOnline: boolean;
    onPrepareOfflinePay: () => Promise<
        { registrationId: string; transactionRef: string } | { error: string }
    >;
    onPayOnline: () => void | Promise<void>;
    onOfflineSubmitted: (
        message: string,
        detail?: { registration?: Record<string, unknown> | null }
    ) => void;
    onSavePartySize: () => void;
    onEditDetails: () => void;
}

export function RegistrationSuccess(props: RegistrationSuccessProps) {
    const {
        formData,
        setFormData,
        event,
        accountFullName,
        busy,
        formDirty,
        money,
        displayMoney,
        committeeConfirmed,
        error,
        saveMessage,
        signedIn,
        verificationPending,
        pendingProof,
        savedBankReference,
        bankAccount,
        onlineCheckoutEnabled,
        payingOnline,
        onPrepareOfflinePay,
        onPayOnline,
        onOfflineSubmitted,
        onSavePartySize,
        onEditDetails,
    } = props;

    const [payOpen, setPayOpen] = useState(false);
    const [payInitialMethod, setPayInitialMethod] = useState<'neft_rtgs' | 'upi' | undefined>(
        undefined
    );
    const [payRegistrationId, setPayRegistrationId] = useState('');
    const [payRegistrationCode, setPayRegistrationCode] = useState('');
    const [payPreparing, setPayPreparing] = useState(false);
    const [payError, setPayError] = useState('');

    const isPaidInFull = money.paymentStatus === 'paid' && money.totalDuePaise === 0;
    const isConfirmed = committeeConfirmed || isPaidInFull;

    const guestCount = clampGuestCount(formData.number_of_guests);
    const guestsEating = clampGuestsEating(formData.guests_eating, guestCount);
    const feeLabel = formatCostForDisplay(EVENT_FEE_PER_PERSON_PAISE);
    const amountDuePaise = displayMoney.totalDuePaise;
    const choicesLocked = busy;
    const donationOnlyRegistration = eventFeeNotApplicable(formData.attending, guestCount);

    const canOpenPay =
        Boolean(bankAccount) &&
        !formDirty &&
        !busy &&
        !payPreparing &&
        (Boolean(pendingProof) || amountDuePaise > 0);

    const canPayUpi = canOpenPay && Boolean(bankAccount?.upi_id);

    const canPayOnline =
        onlineCheckoutEnabled &&
        !formDirty &&
        !busy &&
        !payingOnline &&
        !verificationPending &&
        amountDuePaise > 0;

    async function openPayModal(initialMethod?: 'neft_rtgs' | 'upi') {
        if (!canOpenPay) return;
        setPayPreparing(true);
        setPayError('');
        const result = await onPrepareOfflinePay();
        setPayPreparing(false);
        if ('error' in result) {
            setPayError(result.error);
            return;
        }
        if (!bankAccount) {
            setPayError('Bank details are not configured yet. Contact the committee.');
            return;
        }
        setPayRegistrationId(result.registrationId);
        setPayRegistrationCode(result.transactionRef);
        setPayInitialMethod(initialMethod);
        setPayOpen(true);
    }

    function changeGuestCount(raw: string) {
        const next = clampGuestCount(parseInt(raw, 10));
        setFormData({
            ...formData,
            number_of_guests: next,
            guests_eating: Math.min(formData.guests_eating, next),
        });
    }

    function changeGuestsEating(raw: string) {
        setFormData({
            ...formData,
            guests_eating: clampGuestsEating(parseInt(raw, 10), guestCount),
        });
    }

    const showPaySection =
        (verificationPending && formDirty && amountDuePaise > 0) ||
        (!verificationPending && (formDirty || amountDuePaise > 0 || pendingProof));

    const passBlock = passBlockFromMoney({
        passState: isConfirmed ? 'verified' : money.passState,
        registrationCode: money.registrationCode,
        registrationQr: money.registrationQr,
        previewRegistrationCode: money.previewRegistrationCode,
        previewRegistrationQr: money.previewRegistrationQr,
    });

    return (
        <>
            <ModalBlockingScrim active={payPreparing} />
            <div className="min-h-screen bg-surface flex items-center justify-center px-6 pt-20 pb-12">
                <div className="w-full max-w-lg">
                    <div className="bg-surface-paper rounded-2xl shadow-lg p-8 border border-surface-container-low text-left">
                        <div className="text-center mb-6">
                            <span className="material-symbols-outlined text-[64px] text-green-600 mx-auto block">
                                check_circle
                            </span>
                        </div>

                        <h1 className="text-headline-lg text-primary mb-3 text-center">
                            {isConfirmed ? 'Registration confirmed' : 'Registration saved'}
                        </h1>
                        {isConfirmed && passBlock?.state === 'verified' ? (
                            <p className="text-body-sm text-on-surface-variant mb-6 text-center">Payment verified</p>
                        ) : null}

                        {!isConfirmed && (
                            <p className="text-body-sm text-on-surface-variant mb-6 text-center">
                                {(formDirty ? displayMoney.totalDuePaise : money.totalDuePaise) > 0
                                    ? `Amount due ${formatCostForDisplay(formDirty ? displayMoney.totalDuePaise : money.totalDuePaise)}. Add guests below or edit details to pay.`
                                    : 'Your registration is saved. Your registration ID appears once payment is confirmed.'}
                            </p>
                        )}

                        {passBlock ? (
                            <div className="mb-6">
                                <RegistrationPassBlock {...passBlock} />
                            </div>
                        ) : null}

                        <section className="mb-6 space-y-4">
                            <h2 className="text-headline-sm text-primary uppercase tracking-wider">Add guests</h2>
                            <p className="text-body-sm text-on-surface-variant">
                                Bring more people? Update guest counts, save, then pay {feeLabel} per additional guest
                                (only the extra amount is charged).
                            </p>

                            {verificationPending ? (
                                <p className="rounded-lg bg-surface-container-low px-4 py-3 text-body-sm text-on-surface">
                                    {PASS_QR_UNCHANGED_HINT} You can add guests — the summary shows only the extra
                                    fee. Saving withdraws the pending proof; then submit proof or pay online for any
                                    additional amount still due.
                                </p>
                            ) : null}

                            <div className="flex flex-col">
                                <label htmlFor="success_guest_count" className="text-label-md text-primary mb-2 uppercase tracking-wider">
                                    Guests attending (not including you)
                                </label>
                                <input
                                    id="success_guest_count"
                                    type="number"
                                    min={MIN_GUESTS}
                                    max={MAX_GUESTS}
                                    step={1}
                                    value={formData.number_of_guests}
                                    onChange={(e) => changeGuestCount(e.target.value)}
                                    disabled={choicesLocked}
                                    className={INPUT_CLASS}
                                />
                            </div>

                            {guestCount > 0 ? (
                                <div className="flex flex-col">
                                    <label
                                        htmlFor="success_guests_eating"
                                        className="text-label-md text-primary mb-2 uppercase tracking-wider"
                                    >
                                        Guests having lunch
                                    </label>
                                    <input
                                        id="success_guests_eating"
                                        type="number"
                                        min={0}
                                        max={guestCount}
                                        step={1}
                                        value={guestsEating}
                                        onChange={(e) => changeGuestsEating(e.target.value)}
                                        disabled={choicesLocked}
                                        className={INPUT_CLASS}
                                    />
                                </div>
                            ) : null}
                        </section>

                        {showPaySection ? (
                            <div className="mb-6 space-y-4">
                                <PaymentSummary
                                    money={displayMoney}
                                    isPreview={formDirty}
                                    dueOnly
                                    refundEmail={event?.refund_email}
                                    eventTitle={event?.title || 'Event'}
                                    fullName={accountFullName}
                                />

                                {pendingProof ? (
                                    <p className="rounded-lg bg-surface-container-low px-4 py-3 text-body-sm text-on-surface">
                                        {pendingProofDisplay({
                                            utr: pendingProof.utr,
                                            screenshot_path: pendingProof.hasScreenshot ? 'on-file' : null,
                                        }).label}
                                    </p>
                                ) : null}

                                {payError ? (
                                    <p role="alert" className="text-body-sm text-error">
                                        {payError}
                                    </p>
                                ) : null}

                                <div className="flex flex-col gap-3">
                                    {formDirty ? (
                                        <button
                                            type="button"
                                            disabled={busy}
                                            onClick={onSavePartySize}
                                            className="w-full py-3 rounded-lg bg-primary text-on-primary text-label-md uppercase tracking-wider font-bold hover:bg-navy-subtle disabled:opacity-50 transition-all"
                                        >
                                            {busy ? 'Saving…' : 'Save guest changes'}
                                        </button>
                                    ) : null}
                                    {canPayOnline ? (
                                        <button
                                            type="button"
                                            onClick={() => void onPayOnline()}
                                            disabled={!canPayOnline}
                                            className="w-full py-3 rounded-lg bg-jubilee-gold-deep text-on-primary text-label-md uppercase tracking-wider font-bold hover:opacity-90 disabled:opacity-50 transition-all"
                                        >
                                            {payingOnline ? 'Opening checkout…' : 'Pay online'}
                                        </button>
                                    ) : null}
                                    {canPayUpi ? (
                                        <button
                                            type="button"
                                            onClick={() => void openPayModal('upi')}
                                            disabled={payPreparing}
                                            className="w-full py-3 rounded-lg bg-[#5f259f] text-white text-label-md uppercase tracking-wider font-bold hover:opacity-90 disabled:opacity-50 transition-all"
                                        >
                                            {payPreparing ? 'Preparing…' : 'UPI PhonePe'}
                                        </button>
                                    ) : null}
                                    {canOpenPay ? (
                                        <button
                                            type="button"
                                            onClick={() => void openPayModal()}
                                            className="w-full py-3 rounded-lg bg-dark-blue text-on-dark-blue text-label-md uppercase tracking-wider font-bold hover:opacity-90 disabled:opacity-50 transition-all"
                                        >
                                            {payPreparing
                                                ? 'Preparing…'
                                                : pendingProof
                                                  ? 'View payment proof'
                                                  : 'Pay via alternative method'}
                                        </button>
                                    ) : null}
                                </div>
                                {formDirty && amountDuePaise > 0 ? (
                                    <p className="text-body-sm text-on-surface-variant">
                                        Save guest changes before paying.
                                    </p>
                                ) : null}
                                {!bankAccount && amountDuePaise > 0 ? (
                                    <p className="text-body-sm text-on-surface-variant">
                                        Bank details are not available yet. Contact the committee.
                                    </p>
                                ) : null}
                            </div>
                        ) : null}

                        {saveMessage && !error ? (
                            <p role="status" className="p-3 rounded-lg border border-jubilee-gold-light bg-secondary-container/30 text-body-sm text-on-secondary-fixed-variant mb-4">
                                {saveMessage}
                            </p>
                        ) : null}

                        {error && (
                            <div role="alert" className="p-3 rounded-lg bg-error-container text-error text-body-sm mb-6">
                                {error}
                            </div>
                        )}

                        {!showPaySection && savedBankReference ? (
                            <p className="text-body-sm text-on-surface-variant mb-4">{savedBankReference}</p>
                        ) : null}

                        <div className="flex flex-col gap-3">
                            {!isConfirmed ? (
                                <button
                                    type="button"
                                    onClick={onEditDetails}
                                    className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-lg border border-outline-variant text-primary text-label-md uppercase tracking-wider transition-all cursor-pointer"
                                >
                                    Edit attendance, lunch or parking
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    onClick={onEditDetails}
                                    className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-lg border border-outline-variant text-primary text-label-md uppercase tracking-wider transition-all cursor-pointer"
                                >
                                    Full registration form
                                </button>
                            )}
                            <BackHomeLink
                                signedIn={signedIn}
                                showIcon={false}
                                guestHref={isConfirmed ? '/member' : '/'}
                                signedInLabel="Go to alumni portal"
                                guestLabel={isConfirmed ? 'Go to alumni portal' : 'Back to Home'}
                                className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-lg border border-outline-variant text-primary text-label-md uppercase tracking-wider transition-all"
                            />
                        </div>
                    </div>
                </div>
            </div>

            {bankAccount && payRegistrationId ? (
                <OfflinePayModal
                    open={payOpen}
                    onClose={() => {
                        setPayOpen(false);
                        setPayInitialMethod(undefined);
                    }}
                    initialRemittanceMethod={payInitialMethod}
                    account={bankAccount}
                    amountPaise={amountDuePaise}
                    note="Golden Jubilee registration"
                    transactionId={payRegistrationCode}
                    source={{
                        type: 'registration',
                        registrationId: payRegistrationId,
                        donationOnly: donationOnlyRegistration,
                    }}
                    existingProof={
                        pendingProof
                            ? {
                                  utr: pendingProof.utr,
                                  hasScreenshot: pendingProof.hasScreenshot,
                                  status: 'pending',
                              }
                            : null
                    }
                    onSubmitted={(message, detail) => {
                        onOfflineSubmitted(message, detail);
                        setPayOpen(false);
                    }}
                />
            ) : null}
        </>
    );
}