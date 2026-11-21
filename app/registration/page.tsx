// app/registration/page.tsx
// Registration route. The database is the source of truth for every amount shown on load.
// Name, email and phone come from the signed-in alumni account (alumni_accounts), not from this form.
// When the registration is paid in full, the server reports committee_confirmed with the
// registration code, and no payment is asked for.
// Bank / UPI proof is submitted via OfflinePayModal (UTR and/or screenshot).
// Parking: a yes/no plus 2-wheeler and 4-wheeler counts. Total vehicles may not exceed guests + 1.

'use client';

import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { COMMITTEE_AUTH_PATH } from '@/lib/jubilee-cta';
import { createClient } from '@/lib/supabase';
import { normalizePhoneNumber, phoneValidationError, splitE164 } from '@/lib/phone';
import {
    clampVehicleCount,
    formatCostForDisplay,
    registrationSaveAllowed,
    MAX_GUESTS,
    vehicleCountsProblem,
} from '@/lib/registration/registration';
import { formatLocation, isValidBatch, isValidSection, parseLocation } from '@/lib/registration/registration-fields';
import { chooseRegistrationEvent } from '@/lib/events/choose-event';
import type { EventRegistrationHint } from '@/lib/events/event-cta';
import { eventIsOpen } from '@/lib/events/open';
import { eventFeeNotApplicable } from '@/lib/events/venue-attendance';
import type { EventCatalog } from '@/lib/events/types';
import {
    mergeRegistrationPrefill,
    type ExistingRegistrationRow,
    type RegistrationPrefill,
    type RegistrationProfileSnapshot,
} from '@/lib/events/existing-registration';
import {
    ChooseEventScreen,
    ConfirmPrefillScreen,
    EventUnavailableScreen,
    LegacySignInScreen,
    SignInScreen,
} from '@/components/registration_page/registration-screens';
import {
    RegistrationForm,
    type AccountContact,
    type RegistrationFormMode,
} from '@/components/registration_page/registration-form';
import { RegistrationSuccess } from '@/components/registration_page/registration-success';
import { previewMoney } from '@/lib/registration/preview';
import type { BankAccountPublic } from '@/lib/payments/bank-details';
import {
    CASHFREE_CHECKOUT_CANCELLED,
    confirmRegistrationCashfreePayment,
} from '@/lib/payments/cashfree-confirm-client';
import { openCashfreeCheckout } from '@/lib/payments/checkout-client';
import { pendingProofDisplay, REGISTRATION_DONATION_ONLY_THANKS } from '@/lib/payments/offline-proof';
import {
    toCheckoutOrder,
    type OrderApiResponse,
} from '@/lib/registration/payment-types';
import { useWaitCursor } from '@/lib/use-wait-cursor';
import {
    choicesFingerprint,
    donationFormFromPaise,
    donationIntentPaise,
    donationValidationError,
    EMPTY_FORM,
    EMPTY_MONEY,
    moneyFromRegistration,
    parsePreRegistrationRow,
    type AuthProfile,
    type FormData,
    type PreRegistrationData,
    type RegistrationMoney,
    type RegistrationStep,
    type RegistrationUser,
} from '@/lib/registration/types';

type PendingProofState = { utr: string | null; hasScreenshot: boolean };

/** A saved registration as the server reports it right now. */
interface LoadedRegistration {
    id: string;
    money: RegistrationMoney;
    committeeConfirmed: boolean;
    bankReference: string;
    pendingProof: PendingProofState | null;
    registrationCode: string | null;
    upiPaymentRef: string | null;
}

function formFromPrefill(prefill: RegistrationPrefill): FormData {
    return {
        phone_number: prefill.phone_number,
        full_name: prefill.full_name,
        last_name: prefill.last_name,
        batch: prefill.batch,
        section: prefill.section,
        city: prefill.city,
        country: prefill.country,
        email: prefill.email,
        attending: prefill.attending,
        lunch: prefill.lunch,
        food_preference: prefill.food_preference,
        number_of_guests: prefill.number_of_guests,
        guests_eating: prefill.guests_eating,
        has_parking: prefill.has_parking,
        two_wheeler_count: prefill.two_wheeler_count,
        four_wheeler_count: prefill.four_wheeler_count,
        ...donationFormFromPaise(prefill.intended_donation_paise),
    };
}

/**
 * Reads the signed-in alumni's name, email and phone from alumni_accounts.
 * Falls back to the auth profile if the row cannot be read, so registration still works.
 */
async function loadAccountContact(
    supabase: ReturnType<typeof createClient>,
    userId: string,
    profile: AuthProfile
): Promise<AccountContact> {
    const fallback: AccountContact = {
        full_name: profile.full_name || '',
        last_name: profile.last_name || '',
        email: profile.email || '',
        phone_number: profile.phone_number || '',
    };
    try {
        const { data, error } = await supabase
            .from('alumni_accounts')
            .select('full_name, last_name, email, phone_number')
            .eq('id', userId)
            .maybeSingle();
        if (error || !data) return fallback;
        return {
            full_name: data.full_name ?? fallback.full_name,
            last_name: data.last_name ?? fallback.last_name,
            email: data.email ?? fallback.email,
            phone_number: data.phone_number ?? fallback.phone_number,
        };
    } catch {
        return fallback;
    }
}

/** Returns a message telling the user what to fix in their account, or null when the contact is usable. */
function accountContactProblem(contact: AccountContact | null): string | null {
    if (!contact) return 'Your account details are still loading. Try again in a moment.';
    if (!contact.full_name.trim()) return 'Your account has no name. Add it in your profile, then register.';
    if (!contact.email.trim()) return 'Your account has no email. Add it in your profile, then register.';
    if (!contact.phone_number.trim()) {
        return 'Your account has no phone number. Add it in your profile, then register.';
    }
    const split = splitE164(contact.phone_number);
    if (phoneValidationError(split.isd, split.national)) {
        return 'Your account phone number is not valid. Update it in your profile, then register.';
    }
    return null;
}

function RegistrationPageSuspenseFallback() {
    useWaitCursor(true);
    return (
        <div className="min-h-screen bg-surface flex items-center justify-center pt-20">
            <RegistrationLoadingPanel />
        </div>
    );
}

function RegistrationLoadingPanel() {
    return (
        <div className="text-center">
            <div className="w-12 h-12 rounded-full border-4 border-primary border-t-secondary-container animate-spin mx-auto mb-4" />
            <p className="text-body-md text-on-surface-variant">Loading...</p>
        </div>
    );
}

export default function RegistrationPage() {
    return (
        <Suspense fallback={<RegistrationPageSuspenseFallback />}>
            <RegistrationPageInner />
        </Suspense>
    );
}

function RegistrationPageInner() {
    const router = useRouter();
    const [user, setUser] = useState<RegistrationUser | null>(null);
    const [gate, setGate] = useState<'ok' | 'admin' | null>(null);
    const [loading, setLoading] = useState(true);
    const [currentStep, setCurrentStep] = useState<RegistrationStep>('phone');
    const [error, setError] = useState('');
    const [preRegData, setPreRegData] = useState<PreRegistrationData | null>(null);
    const [preRegCandidates, setPreRegCandidates] = useState<PreRegistrationData[]>([]);
    /** Name, email and phone from the alumni account. Never typed on this form. */
    const [accountContact, setAccountContact] = useState<AccountContact | null>(null);
    const [formData, setFormData] = useState<FormData>(EMPTY_FORM);
    /** Amounts as the database last returned them. Never edited in the browser. */
    const [money, setMoney] = useState<RegistrationMoney>(EMPTY_MONEY);
    const [committeeConfirmed, setCommitteeConfirmed] = useState(false);
    const [registrationId, setRegistrationId] = useState<string | null>(null);
    const [registrationCode, setRegistrationCode] = useState<string | null>(null);
    /** SFS-XXXXX reserved for UPI before payment (may differ from hidden pass code until paid). */
    const [upiPaymentRef, setUpiPaymentRef] = useState<string | null>(null);
    /** Bank / UPI reference as last submitted for verification. */
    const [savedBankReference, setSavedBankReference] = useState('');
    const [pendingProof, setPendingProof] = useState<PendingProofState | null>(null);
    const [bankAccount, setBankAccount] = useState<BankAccountPublic | null>(null);
    /** Fingerprint of the choices as last saved. Differs from the form when edits are unsaved. */
    const [savedFingerprint, setSavedFingerprint] = useState('');
    const [saving, setSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState('');
    const [event, setEvent] = useState<EventCatalog | null>(null);
    const [choices, setChoices] = useState<EventCatalog[]>([]);
    const [choiceRegs, setChoiceRegs] = useState<
        Record<string, EventRegistrationHint | null>
    >({});
    const [eventLoaded, setEventLoaded] = useState(false);
    const [eventError, setEventError] = useState('');
    const [hasSavedReg, setHasSavedReg] = useState(false);
    /** False until the saved registration for this event has been fetched (avoids form flash). */
    const [regHydrated, setRegHydrated] = useState(false);

    const searchParams = useSearchParams();
    const pathname = usePathname() || '';
    const newRegistrationGate =
        pathname === '/new_registration' || pathname.startsWith('/new_registration/');
    const supabase = createClient();

    useEffect(() => {
        async function loadEvent() {
            const fromQuery = searchParams.get('event');
            setEventLoaded(false);
            try {
                if (fromQuery) {
                    const res = await fetch(`/api/events/${fromQuery}`, { cache: 'no-store' });
                    const row = res.ok ? ((await res.json()) as EventCatalog) : null;
                    if (!row || !eventIsOpen(row, new Date())) {
                        setEvent(null);
                        setEventError('This event is not available for registration.');
                        return;
                    }
                    setEvent(row);
                    setEventError('');
                    return;
                }
                const listRes = await fetch('/api/events', { cache: 'no-store' });
                if (!listRes.ok) {
                    setEventError('Events are not available yet.');
                    return;
                }
                const list = (await listRes.json()) as EventCatalog[];
                setChoices(list);
                const chosen = chooseRegistrationEvent(list);
                if (!list.length) {
                    setEvent(null);
                    setEventError('No published events are open for registration.');
                    return;
                }
                if (!chosen) {
                    // Several events: load which ones this alumni already registered for.
                    const regs: Record<string, EventRegistrationHint | null> = {};
                    for (const row of list) {
                        try {
                            const regRes = await fetch(
                                `/api/registration/event?eventId=${encodeURIComponent(row.id)}`,
                                { cache: 'no-store' }
                            );
                            if (regRes.ok) {
                                const body = (await regRes.json()) as {
                                    registration?: EventRegistrationHint | null;
                                };
                                regs[row.id] = body.registration ?? null;
                            } else {
                                regs[row.id] = null;
                            }
                        } catch {
                            regs[row.id] = null;
                        }
                    }
                    setChoiceRegs(regs);
                    setEvent(null);
                    setEventError('');
                    return;
                }
                setEvent(chosen);
                setEventError('');
            } catch {
                setEventError('Could not load event details.');
            } finally {
                setEventLoaded(true);
            }
        }
        void loadEvent();
    }, [searchParams]);

    function applyRosterPrefill(match: PreRegistrationData) {
        const loc = parseLocation(match.current_location || '');
        const hasParking = match.has_parking === true;
        setFormData((prev) => ({
            ...prev,
            batch: match.batch ?? prev.batch,
            section: match.section || prev.section,
            city: loc.city || prev.city,
            country: loc.country || prev.country,
            food_preference: match.food_preference ?? prev.food_preference,
            number_of_guests:
                typeof match.number_of_guests === 'number' ? match.number_of_guests : prev.number_of_guests,
            guests_eating:
                typeof match.guests_eating === 'number' ? match.guests_eating : prev.guests_eating,
            attending: typeof match.attending === 'boolean' ? match.attending : prev.attending,
            has_parking: typeof match.has_parking === 'boolean' ? hasParking : prev.has_parking,
            two_wheeler_count: hasParking
                ? typeof match.two_wheeler_count === 'number'
                    ? match.two_wheeler_count
                    : prev.two_wheeler_count
                : 0,
            four_wheeler_count: hasParking
                ? typeof match.four_wheeler_count === 'number'
                    ? match.four_wheeler_count
                    : prev.four_wheeler_count
                : 0,
        }));
        setPreRegData(match);
        setPreRegCandidates([]);
        setCurrentStep('details');
    }

    async function prefillFromMemberRoster(
        phoneNumber: string,
        email: string,
        fullName?: string
    ): Promise<RegistrationStep> {
        try {
            const params = new URLSearchParams();
            if (phoneNumber) params.set('phone', phoneNumber);
            if (email) params.set('email', email);
            if (fullName) params.set('name', fullName);
            if (![...params.keys()].length) return 'details';

            const res = await fetch(`/api/registration/roster-lookup?${params.toString()}`, {
                cache: 'no-store',
            });
            if (!res.ok) return 'details';

            const payload = (await res.json().catch(() => ({}))) as {
                kind?: string;
                auto?: boolean;
                matches?: unknown[];
            };
            const matches = (payload.matches || [])
                .map((row) => parsePreRegistrationRow(row))
                .filter((row): row is PreRegistrationData => row != null);
            if (!matches.length) return 'details';

            if (payload.auto || (payload.kind === 'exact' && matches.length === 1)) {
                applyRosterPrefill(matches[0]);
                return 'details';
            }

            setPreRegData(matches[0]);
            setPreRegCandidates(matches);
            return 'confirm_prefill';
        } catch (err) {
            console.error('Prefill error:', err);
            return 'details';
        }
    }

    useEffect(() => {
        async function checkAuth() {
            try {
                const res = await fetch('/api/auth/me');
                if (!res.ok) {
                    setLoading(false);
                    setCurrentStep('phone');
                    return;
                }

                const profile = (await res.json()) as AuthProfile;
                setUser({
                    id: profile.id,
                    email: profile.email,
                    role: profile.role,
                    jubilee_reg_status: profile.jubilee_reg_status || 'none',
                });

                if (profile.role === 'admin') {
                    setGate('admin');
                    return;
                }
                setGate('ok');

                const contact = await loadAccountContact(supabase, profile.id, profile);
                setAccountContact(contact);

                const loc = parseLocation(profile.current_location || '');
                setFormData((prev) => ({
                    ...prev,
                    batch: profile.batch ?? undefined,
                    section: profile.section || '',
                    city: loc.city,
                    country: loc.country,
                }));

                const rosterStep = await prefillFromMemberRoster(
                    contact.phone_number,
                    contact.email,
                    contact.full_name
                );
                setCurrentStep(rosterStep);
            } catch {
                setCurrentStep('phone');
            } finally {
                setLoading(false);
            }
        }

        void checkAuth();
        // Runs once on mount; the prefill helper is recreated each render but only used here.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (gate === 'admin') router.replace(COMMITTEE_AUTH_PATH);
    }, [gate, router]);

    /**
     * Reads the saved registration and its server-calculated amounts. Used on load, after a save,
     * and after a payment. Returns null when there is no open registration for this event.
     */
    async function loadSavedRegistration(
        eventId: string,
        applyToForm: boolean
    ): Promise<LoadedRegistration | null> {
        const res = await fetch(`/api/registration/event?eventId=${encodeURIComponent(eventId)}`, {
            cache: 'no-store',
        });
        if (!res.ok) return null;

        const payload = (await res.json().catch(() => ({}))) as {
            registration?: Record<string, unknown> | null;
            profile?: RegistrationProfileSnapshot | null;
        };
        const reg = payload.registration;
        if (!reg) {
            setHasSavedReg(false);
            setRegistrationId(null);
            setRegistrationCode(null);
            setUpiPaymentRef(null);
            setMoney(EMPTY_MONEY);
            setCommitteeConfirmed(false);
            setSavedBankReference('');
            setPendingProof(null);
            return null;
        }

        const id = String(reg.id ?? '');
        const next = moneyFromRegistration(reg);
        const confirmed = reg.committee_confirmed === true;
        const bankReference = typeof reg.bank_reference === 'string' ? reg.bank_reference : '';
        const rawProof = reg.pending_offline_proof;
        const nextPending: PendingProofState | null =
            rawProof && typeof rawProof === 'object'
                ? {
                      utr:
                          typeof (rawProof as { utr?: unknown }).utr === 'string'
                              ? ((rawProof as { utr: string }).utr)
                              : null,
                      hasScreenshot: Boolean((rawProof as { has_screenshot?: unknown }).has_screenshot),
                  }
                : null;
        setRegistrationId(id || null);
        const code =
            typeof reg.registration_code === 'string' && reg.registration_code.trim()
                ? reg.registration_code.trim()
                : null;
        setRegistrationCode(code);
        const payRef =
            typeof reg.upi_payment_ref === 'string' && reg.upi_payment_ref.trim()
                ? reg.upi_payment_ref.trim()
                : code || id || null;
        setUpiPaymentRef(payRef);
        setMoney(next);
        setCommitteeConfirmed(confirmed);
        setSavedBankReference(
            nextPending
                ? pendingProofDisplay({
                      utr: nextPending.utr,
                      screenshot_path: nextPending.hasScreenshot ? 'on-file' : null,
                  }).label
                : bankReference
        );
        setPendingProof(nextPending);
        setHasSavedReg(true);

        if (applyToForm) {
            const prefill = mergeRegistrationPrefill(
                payload.profile ?? null,
                reg as unknown as ExistingRegistrationRow
            );
            const nextForm = formFromPrefill(prefill);
            setFormData((prev) => ({
              ...nextForm,
              city: nextForm.city || prev.city,
              country: nextForm.country || prev.country,
            }));
            setSavedFingerprint(choicesFingerprint(nextForm));
        }

        // Confirmed by the committee, or fully paid: the success screen with the code.
        const settled =
            confirmed || (next.paymentStatus === 'paid' && next.totalDuePaise === 0);
        if (settled) {
            setPendingProof(null);
            setCurrentStep('success');
        }
        return {
            id,
            money: next,
            committeeConfirmed: confirmed,
            bankReference,
            pendingProof: settled ? null : nextPending,
            registrationCode: code,
            upiPaymentRef: payRef,
        };
    }

    useEffect(() => {
        if (!user?.id || !event?.id || gate !== 'ok') {
            if (gate === 'admin' || gate === null || !user) setRegHydrated(true);
            return;
        }
        let active = true;
        setRegHydrated(false);
        void loadSavedRegistration(event.id, true).finally(() => {
            if (active) setRegHydrated(true);
        });
        return () => {
            active = false;
        };
        // Runs once per user and event. loadSavedRegistration reads no changing state.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id, event?.id, gate]);

    useEffect(() => {
        if (!user?.id || gate !== 'ok') {
            setBankAccount(null);
            setOnlineCheckoutEnabled(false);
            return;
        }
        let cancel = false;
        void (async () => {
            try {
                const res = await fetch('/api/payments/bank-details', { cache: 'no-store' });
                const payload = (await res.json().catch(() => ({}))) as {
                    account?: BankAccountPublic;
                    online_checkout_available?: boolean;
                };
                if (cancel) return;
                setBankAccount(res.ok && payload.account ? payload.account : null);
                setOnlineCheckoutEnabled(Boolean(payload.online_checkout_available));
            } catch {
                if (!cancel) setBankAccount(null);
            }
        })();
        return () => {
            cancel = true;
        };
    }, [user?.id, gate]);

    /**
     * Checks the form fields and the account contact. Returns the account's phone in E.164 for saving.
     * Name, email and phone are not typed on this form, so their errors point to the profile instead.
     */
    function validateRegistrationForm(): { ok: true; e164: string } | { ok: false } {
        const contactProblem = accountContactProblem(accountContact);
        if (contactProblem || !accountContact) {
            setError(contactProblem || 'Your account details are missing.');
            return { ok: false };
        }
        const e164 = normalizePhoneNumber(accountContact.phone_number) || accountContact.phone_number;

        if (!isValidBatch(formData.batch)) {
            setError('Select your batch year');
            return { ok: false };
        }
        if (!isValidSection(formData.section)) {
            setError('Select your section (A–D)');
            return { ok: false };
        }
        if (!formData.city.trim() || !formData.country.trim()) {
            setError('City and country are required');
            return { ok: false };
        }
        if (!formatLocation(formData.city, formData.country)) {
            setError('City and country are required');
            return { ok: false };
        }
        if (
            !Number.isInteger(formData.number_of_guests) ||
            formData.number_of_guests < 0 ||
            formData.number_of_guests > MAX_GUESTS
        ) {
            setError(`You can register up to ${MAX_GUESTS} guests`);
            return { ok: false };
        }
        if (formData.guests_eating < 0 || formData.guests_eating > formData.number_of_guests) {
            setError('Guests eating cannot be more than the number of guests');
            return { ok: false };
        }
        const intendedDonation = donationIntentPaise(formData);
        if (!registrationSaveAllowed(formData.attending, formData.number_of_guests, intendedDonation)) {
            setError(
                'Enter a donation (at least ₹1), or choose at least one person to attend: you or a guest'
            );
            return { ok: false };
        }
        if (formData.has_parking) {
            const parkingError = vehicleCountsProblem(
                formData.two_wheeler_count,
                formData.four_wheeler_count,
                formData.number_of_guests
            );
            if (parkingError) {
                setError(parkingError);
                return { ok: false };
            }
        }
        const donationError = donationValidationError(formData);
        if (donationError) {
            setError(donationError);
            return { ok: false };
        }
        if (!event?.id) {
            setError('No event selected for registration');
            return { ok: false };
        }
        return { ok: true, e164 };
    }

    /**
     * Writes the form to the database, then reloads the saved amounts. Never opens checkout.
     */
    async function saveRegistration(e?: FormEvent): Promise<LoadedRegistration | null> {
        e?.preventDefault();
        if (!user || saving || !event) return null;

        setSaving(true);
        setError('');
        setSaveMessage('');

        const valid = validateRegistrationForm();
        if (!valid.ok || !accountContact) {
            setSaving(false);
            return null;
        }

        // Vehicle counts only count when parking is needed; otherwise they are sent as zero.
        const twoWheelers = formData.has_parking ? clampVehicleCount(formData.two_wheeler_count) : 0;
        const fourWheelers = formData.has_parking ? clampVehicleCount(formData.four_wheeler_count) : 0;

        try {
            const res = await fetch('/api/registration/event', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    eventId: event.id,
                    phone_number: valid.e164,
                    full_name: accountContact.full_name.trim(),
                    last_name: accountContact.last_name.trim(),
                    batch: formData.batch,
                    section: formData.section,
                    city: formData.city.trim(),
                    country: formData.country.trim(),
                    attending: formData.attending,
                    lunch: formData.lunch,
                    food_preference: formData.food_preference,
                    number_of_guests: formData.number_of_guests,
                    guests_eating: formData.guests_eating,
                    has_parking: formData.has_parking,
                    two_wheeler_count: twoWheelers,
                    four_wheeler_count: fourWheelers,
                    intended_donation_paise: donationIntentPaise(formData),
                }),
            });
            const payload = (await res.json().catch(() => ({}))) as {
                error?: string;
                withdrawn_pending_proof?: boolean;
            };
            if (!res.ok) {
                setError(payload.error || 'Could not save registration');
                setSaving(false);
                return null;
            }

            const loaded = await loadSavedRegistration(event.id, false);
            if (!loaded) {
                setError('Saved, but the amounts could not be reloaded. Refresh the page.');
                setSaving(false);
                return null;
            }

            setSavedFingerprint(choicesFingerprint(formData));
            let saveText =
                loaded.money.totalDuePaise > 0
                    ? `Saved. Amount due ${formatCostForDisplay(loaded.money.totalDuePaise)}.`
                    : 'Saved. Nothing is due.';
            if (payload.withdrawn_pending_proof) {
                saveText += ' Your pending payment proof was withdrawn — submit proof again if money is still due.';
            }
            setSaveMessage(saveText);
            setSaving(false);
            return loaded;
        } catch {
            setError('Could not save registration. Please try again.');
            setSaving(false);
            return null;
        }
    }

    /** Saves party-size edits from the success screen (no online checkout). */
    async function savePartySize() {
        await saveRegistration();
    }

    /** Saves if needed, then returns registration id + UPI/bank reference for the offline modal. */
    async function prepareOfflinePay(): Promise<
        { registrationId: string; transactionRef: string } | { error: string }
    > {
        let regId = registrationId;
        if (pendingProof) {
            if (!regId) return { error: 'Could not find your registration. Please try again.' };
            const ref = upiPaymentRef?.trim() || registrationCode?.trim() || regId;
            return { registrationId: regId, transactionRef: ref };
        }
        if (formDirty || !regId) {
            const loaded = await saveRegistration();
            if (!loaded) return { error: 'Fix the errors on the form, then try again.' };
            regId = loaded.id;
        }
        if (!regId) return { error: 'Could not find your registration. Please try again.' };
        let ref = upiPaymentRef?.trim() || registrationCode?.trim() || '';
        if (!ref) {
            const reloaded = await loadSavedRegistration(event!.id, false);
            ref = reloaded?.upiPaymentRef?.trim() || reloaded?.registrationCode?.trim() || '';
        }
        return { registrationId: regId, transactionRef: ref || regId };
    }

    async function payRegistrationOnline() {
        const prep = await prepareOfflinePay();
        if ('error' in prep) {
            setError(prep.error);
            return;
        }
        setPayingOnline(true);
        setError('');
        setSaveMessage('');
        try {
            const res = await fetch('/api/payments/create-order', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ registrationId: prep.registrationId }),
            });
            const payload = (await res.json().catch(() => ({}))) as OrderApiResponse;
            if (!res.ok) {
                setError(payload.error || 'Could not start payment');
                return;
            }
            if (payload.skipCheckout) {
                setSaveMessage(
                    payload.registration_code
                        ? `Settled. Your registration code is ${payload.registration_code}.`
                        : 'Saved. Nothing is due.'
                );
                if (event?.id) await loadSavedRegistration(event.id, false);
                return;
            }
            const order = toCheckoutOrder(payload, {
                name: accountContact?.full_name || '',
                email: accountContact?.email || '',
                contact: accountContact?.phone_number || '',
            });
            if (!order) {
                setError('Incomplete payment response from server');
                return;
            }
            const checkout = await openCashfreeCheckout({
                orderId: order.orderId,
                paymentSessionId: order.paymentSessionId,
                mode: order.mode,
                description: order.description,
            });
            if (!checkout) {
                setError(CASHFREE_CHECKOUT_CANCELLED);
                return;
            }
            if ('failed' in checkout) {
                setError(checkout.message);
                return;
            }
            const confirmed = await confirmRegistrationCashfreePayment({
                registrationId: prep.registrationId,
                orderId: checkout.order_id,
            });
            if (!confirmed.ok) {
                setError(confirmed.message);
                return;
            }
            const verified = confirmed.verified;
            const giftOnly = eventFeeNotApplicable(formData.attending, formData.number_of_guests);
            setSaveMessage(
                giftOnly
                    ? REGISTRATION_DONATION_ONLY_THANKS
                    : verified.registration_code
                      ? `Payment received. Your registration code is ${verified.registration_code}.`
                      : 'Payment received.'
            );
            if (event?.id) await loadSavedRegistration(event.id, false);
        } catch {
            setError('Online payment failed. Please try again.');
        } finally {
            setPayingOnline(false);
        }
    }

    async function handleOfflineSubmitted(message: string) {
        setSaveMessage(message);
        setError('');
        if (event?.id) {
            await loadSavedRegistration(event.id, false);
            return;
        }
        setSavedBankReference('Pending committee review');
    }

    function acceptPreRegistration(match: PreRegistrationData) {
        applyRosterPrefill(match);
    }

    function dismissPreRegistration() {
        setPreRegData(null);
        setPreRegCandidates([]);
        setCurrentStep('details');
    }

    const formDirty = !savedFingerprint || choicesFingerprint(formData) !== savedFingerprint;
    // Shown amounts: the database figures until the form is edited, then a live preview.
    const displayMoney = formDirty ? previewMoney(money, formData) : money;
    const donationLocked = money.donationPaymentStatus === 'paid';
    const isSettled =
        committeeConfirmed || (money.paymentStatus === 'paid' && money.totalDuePaise === 0);
    // Do not show “awaiting verification” once the registration is confirmed / paid.
    const verificationPending = Boolean(pendingProof) && !isSettled;
    const [payingOnline, setPayingOnline] = useState(false);
    const [onlineCheckoutEnabled, setOnlineCheckoutEnabled] = useState(false);
    const busy = saving || payingOnline;

    /** Cashfree redirect returnUrl (?cf_order_id=) — same verify path as modal checkout. */
    useEffect(() => {
        const orderId = searchParams.get('cf_order_id')?.trim();
        if (!orderId || !event?.id || gate !== 'ok' || !regHydrated) return;

        let active = true;
        setPayingOnline(true);
        setError('');
        void (async () => {
            let regId = registrationId;
            if (!regId) {
                const loaded = await loadSavedRegistration(event.id, false);
                regId = loaded?.id || null;
            }
            if (!regId) {
                if (active) {
                    setError('Sign in and save your registration, then refresh to confirm payment.');
                    setPayingOnline(false);
                }
                return;
            }

            const confirmed = await confirmRegistrationCashfreePayment({
                registrationId: regId,
                orderId,
            });
            if (!active) return;
            setPayingOnline(false);

            if (confirmed.ok) {
                const verified = confirmed.verified;
                setSaveMessage(
                    verified.registration_code
                        ? `Payment received. Your registration code is ${verified.registration_code}.`
                        : 'Payment received.'
                );
                await loadSavedRegistration(event.id, false);
                if (typeof window !== 'undefined') {
                    const url = new URL(window.location.href);
                    url.searchParams.delete('cf_order_id');
                    window.history.replaceState({}, '', url.pathname + url.search);
                }
                return;
            }
            setError(confirmed.message);
        })();

        return () => {
            active = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams, event?.id, gate, regHydrated, registrationId]);
    const formMode: RegistrationFormMode = hasSavedReg
        ? money.totalDuePaise > 0
            ? 'pay'
            : 'update'
        : 'new';

    const waitingOnSavedReg = Boolean(user && gate === 'ok' && event && !regHydrated);
    const pageLoading = loading || !eventLoaded || waitingOnSavedReg;
    useWaitCursor(pageLoading || payingOnline);

    if (pageLoading) {
        return (
            <div className="min-h-screen bg-surface flex items-center justify-center pt-20">
                <RegistrationLoadingPanel />
            </div>
        );
    }

    if (gate === 'admin') {
        return (
            <div className="min-h-screen bg-surface flex items-center justify-center pt-20">
                <RegistrationLoadingPanel />
            </div>
        );
    }

    if (!event && choices.length > 1) {
        return <ChooseEventScreen choices={choices} registrationsByEventId={choiceRegs} />;
    }

    if (eventError && !event) return <EventUnavailableScreen message={eventError} />;

    if (!user) {
        return newRegistrationGate ? (
            <SignInScreen event={event} />
        ) : (
            <LegacySignInScreen event={event} />
        );
    }

    const incompleteBanner = !isSettled ? (
        <div
            className="sticky top-20 z-40 bg-yellow-400 w-full text-yellow-950 text-center font-semibold p-3 text-sm sm:text-base border-b border-yellow-500 shadow-sm"
            role="status"
        >
            {verificationPending
                ? 'Payment submitted — pass QR below is not valid for entry until finance confirms. Saving changes withdraws the pending proof.'
                : 'Registration is not complete until payment is made and verified'}
        </div>
    ) : null;

    if (currentStep === 'confirm_prefill' && preRegData) {
        return (
            <div className="flex flex-col">
                {incompleteBanner}
                <ConfirmPrefillScreen
                    preRegData={preRegData}
                    candidates={preRegCandidates}
                    onAccept={acceptPreRegistration}
                    onReject={dismissPreRegistration}
                />
            </div>
        );
    }

    if (currentStep === 'details') {
        return (
            <div className="flex flex-col">
                {incompleteBanner}
                <RegistrationForm
                    formData={formData}
                    setFormData={setFormData}
                    accountContact={accountContact}
                    event={event}
                    formMode={formMode}
                    hasSavedReg={hasSavedReg}
                    busy={busy}
                    saving={saving}
                    money={money}
                    displayMoney={displayMoney}
                    formDirty={formDirty}
                    donationLocked={donationLocked}
                    verificationPending={verificationPending}
                    bankAccount={bankAccount}
                    onPrepareOfflinePay={prepareOfflinePay}
                    savedBankReference={savedBankReference}
                    pendingProof={verificationPending ? pendingProof : null}
                    onOfflineSubmitted={(message) => {
                        void handleOfflineSubmitted(message);
                    }}
                    onlineCheckoutEnabled={onlineCheckoutEnabled}
                    onPayOnline={() => void payRegistrationOnline()}
                    payingOnline={payingOnline}
                    saveMessage={saveMessage}
                    error={error}
                    onSubmit={(e) => {
                        void saveRegistration(e);
                    }}
                />
            </div>
        );
    }

    if (currentStep === 'success') {
        return (
            <RegistrationSuccess
                formData={formData}
                setFormData={setFormData}
                event={event}
                accountFullName={accountContact?.full_name || ''}
                busy={busy}
                formDirty={formDirty}
                money={money}
                displayMoney={displayMoney}
                committeeConfirmed={committeeConfirmed}
                error={error}
                saveMessage={saveMessage}
                signedIn={Boolean(user)}
                verificationPending={verificationPending}
                pendingProof={verificationPending ? pendingProof : null}
                savedBankReference={savedBankReference}
                bankAccount={bankAccount}
                onlineCheckoutEnabled={onlineCheckoutEnabled}
                payingOnline={payingOnline}
                onPrepareOfflinePay={prepareOfflinePay}
                onPayOnline={() => void payRegistrationOnline()}
                onOfflineSubmitted={(message) => {
                    void handleOfflineSubmitted(message);
                }}
                onSavePartySize={() => void savePartySize()}
                onEditDetails={() => {
                    setError('');
                    setSaveMessage('');
                    setCurrentStep('details');
                }}
            />
        );
    }

    return null;
}