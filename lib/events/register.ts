// lib/events/register.ts
// Reads and saves one account's registration for one event. The fee comes only from
// getEventCostBreakdown. The donation intent is stored as a pending donation row linked
// from the registration. Payment and code issuance happen in mark-paid.ts.
// Parking: has_parking plus 2-wheeler and 4-wheeler counts. Counts are stored as zero when parking is off,
// and total vehicles may not exceed guests + 1 (the alumnus plus each guest).

import type { AlumniAccount } from '@/lib/auth/request';
import {
  OPEN_PAYMENT_STATUSES,
  amountDuePaise,
  jubileeStatusFromPayment,
  statusFromAmounts,
} from '@/lib/events/balance';
import { selectCatalog } from '@/lib/events/catalog-select';
import { isEventSoftDeleted } from '@/lib/events/soft-delete';
import type { EventCatalog } from '@/lib/events/types';
import { repriceEventRegistrations } from '@/lib/events/reprice';
import {
  donationDuePaise,
  issueRegistrationCodeIfEligible,
  loadDonation,
  passEligibilityFromRegistration,
  visibleRegistrationCode,
  type DonationSnapshot,
} from '@/lib/events/mark-paid';
import {
  clearRegistrationCode,
  isEligibleForRegistrationCode,
  readRegistrationCode,
  reserveUpiPaymentCode,
  type RegistrationCodeAdmin,
} from '@/lib/events/registration-code';
import { registrationQrPayload } from '@/lib/events/registration-qr-payload';
import { formatEventFeePaymentLabel } from '@/lib/events/payment-display';
import { passStateFromRegistration } from '@/lib/payments/offline-proof';
import { eventFeeNotApplicable, needsVenuePass } from '@/lib/events/venue-attendance';
import { assertDonationAmountPaise } from '@/lib/donations/validate';
import {
  MAX_GUESTS,
  anyoneEating,
  clampGuestCount,
  clampGuestsEating,
  clampVehicleCount,
  getEventCostBreakdown,
  normalizeFoodPreference,
  registrationSaveAllowed,
  vehicleCountsProblem,
} from '@/lib/registration/registration';
import {
  formatLocation,
  isValidBatch,
  isValidSection,
  mergeProfilePack,
  readPackedProfile,
} from '@/lib/registration/registration-fields';
import { withdrawPendingRegistrationProofs } from '@/lib/payments/withdraw-pending-proof';
import { normalizePhoneNumber, phoneValidationError, splitE164 } from '@/lib/phone';
import { createAdminClient } from '@/lib/supabase-admin';

type AdminClient = ReturnType<typeof createAdminClient>;

const REG_SELECT =
  'id,event_id,number_of_guests,guests_eating,attending,lunch,food_preference,has_parking,two_wheeler_count,four_wheeler_count,phone_number,payment_status,total_cost_paise,amount_paid_paise,donation_id,core_committee_manually_verified,bank_reference';

type RegistrationRow = {
  id: string;
  event_id: string;
  number_of_guests: number;
  guests_eating: number;
  attending: boolean;
  lunch: boolean;
  food_preference: string | null;
  has_parking: boolean;
  two_wheeler_count: number;
  four_wheeler_count: number;
  phone_number: string | null;
  payment_status: string;
  total_cost_paise: number;
  amount_paid_paise: number;
  donation_id: string | null;
  core_committee_manually_verified: boolean | null;
  bank_reference: string | null;
};

type ExistingRow = {
  id: string;
  payment_status: string;
  amount_paid_paise: number;
  donation_id: string | null;
  core_committee_manually_verified: boolean | null;
};

function profilePayload(me: AlumniAccount) {
  return {
    full_name: me.full_name,
    last_name: me.last_name,
    email: me.email,
    phone_number: me.phone_number,
    batch: me.batch,
    section: me.section,
    current_location: me.current_location,
  };
}

async function loadAccountProfile(
  admin: AdminClient,
  me: AlumniAccount
): Promise<Record<string, unknown>> {
  let profile: Record<string, unknown> = profilePayload(me);
  const fullProfile = await admin
    .from('alumni_accounts')
    .select('full_name,last_name,email,phone_number,batch,section,current_location,bio')
    .eq('id', me.id)
    .maybeSingle();
  if (!fullProfile.error && fullProfile.data) {
    const row = fullProfile.data as Record<string, unknown>;
    const packed = readPackedProfile(row.bio);
    profile = {
      ...profile,
      ...row,
      section: row.section || packed?.section || profile.section || null,
      last_name: row.last_name || packed?.lastName || profile.last_name || null,
    };
    return profile;
  }
  const minProfile = await admin
    .from('alumni_accounts')
    .select('full_name,email,phone_number,batch,current_location,bio')
    .eq('id', me.id)
    .maybeSingle();
  if (!minProfile.error && minProfile.data) {
    const row = minProfile.data as Record<string, unknown>;
    const packed = readPackedProfile(row.bio);
    profile = {
      ...profile,
      ...row,
      section: packed?.section || profile.section || null,
      last_name: packed?.lastName || profile.last_name || null,
    };
  }
  return profile;
}

type GetAccountRegistrationOpts = {
  /** Caller already ran repriceEventRegistrations for this event. */
  skipReprice?: boolean;
  /** Reuse profile from a prior load (venue-pass batch). */
  profile?: Record<string, unknown>;
  /** Pass display: no reprice, reserve, or code issuance — read stored values only. */
  readOnly?: boolean;
  storedCode?: string | null;
  donation?: import('@/lib/events/mark-paid').DonationSnapshot | null;
  pendingProof?: {
    id: string;
    utr: string | null;
    has_screenshot: boolean;
    status: 'pending';
  } | null;
};

type EnrichRegistrationCtx = {
  profile: Record<string, unknown>;
  readOnly?: boolean;
  storedCode?: string | null;
  donation?: import('@/lib/events/mark-paid').DonationSnapshot | null;
  pendingProof?: GetAccountRegistrationOpts['pendingProof'];
};

async function enrichRegistrationForClient(
  admin: AdminClient,
  me: AlumniAccount,
  reg: RegistrationRow,
  ctx: EnrichRegistrationCtx
): Promise<Record<string, unknown>> {
  const feeTotal = Math.max(0, Number(reg.total_cost_paise) || 0);
  const feePaid = Math.max(0, Number(reg.amount_paid_paise) || 0);
  const feeDue = amountDuePaise(feeTotal, feePaid);

  const donation =
    ctx.donation !== undefined ? ctx.donation : await loadDonation(admin, reg.donation_id);
  const donationDue = donationDuePaise(donation);

  let pendingProof = ctx.pendingProof;
  if (pendingProof === undefined) {
    const { data: pendingProofRows } = await admin
      .from('offline_payment_proofs')
      .select('id,utr,screenshot_path,status')
      .eq('registration_id', reg.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1);
    const pendingProofRow = Array.isArray(pendingProofRows) ? pendingProofRows[0] : null;
    pendingProof = pendingProofRow
      ? {
          id: String(pendingProofRow.id),
          utr: typeof pendingProofRow.utr === 'string' ? pendingProofRow.utr : null,
          has_screenshot: Boolean(pendingProofRow.screenshot_path),
          status: 'pending' as const,
        }
      : null;
  }

  const guestCountLoad = clampGuestCount(Number(reg.number_of_guests) || 0);
  const attendingLoad = reg.attending === true;
  const venuePass = needsVenuePass(attendingLoad, guestCountLoad);

  let storedCode: string | null;
  if (ctx.readOnly) {
    storedCode =
      ctx.storedCode !== undefined
        ? ctx.storedCode
        : await readRegistrationCode(admin as unknown as RegistrationCodeAdmin, reg.id);
  } else {
    if (!venuePass) {
      await clearRegistrationCode(admin as unknown as RegistrationCodeAdmin, reg.id);
    }
    const regSnap: import('@/lib/events/mark-paid').RegistrationSnapshot = {
      id: reg.id,
      event_id: reg.event_id,
      account_id: me.id,
      attending: attendingLoad,
      number_of_guests: guestCountLoad,
      total_cost_paise: feeTotal,
      amount_paid_paise: feePaid,
      payment_status: reg.payment_status,
      donation_id: reg.donation_id,
      razorpay_order_id: null,
      razorpay_payment_id: null,
    };
    await reserveUpiPaymentCode(admin as unknown as RegistrationCodeAdmin, reg.id, {
      venuePass,
      amountDuePaise: feeDue + donationDue,
    });
    await issueRegistrationCodeIfEligible(admin, reg.id, {
      ...passEligibilityFromRegistration(regSnap, donationDue),
      paymentStatus: reg.payment_status,
    });
    storedCode = await readRegistrationCode(admin as unknown as RegistrationCodeAdmin, reg.id);
  }

  const regSnap: import('@/lib/events/mark-paid').RegistrationSnapshot = {
    id: reg.id,
    event_id: reg.event_id,
    account_id: me.id,
    attending: attendingLoad,
    number_of_guests: guestCountLoad,
    total_cost_paise: feeTotal,
    amount_paid_paise: feePaid,
    payment_status: reg.payment_status,
    donation_id: reg.donation_id,
    razorpay_order_id: null,
    razorpay_payment_id: null,
  };
  const registrationCode = visibleRegistrationCode(storedCode, regSnap, donationDue);
  const upi_payment_ref = venuePass ? storedCode || String(reg.id) : String(reg.id);
  const passReady = isEligibleForRegistrationCode({
    paymentStatus: reg.payment_status,
    donationDuePaise: donationDue,
    attending: attendingLoad,
    guestCount: guestCountLoad,
  });
  const totalDueForPass = passReady ? 0 : feeDue + donationDue;
  const pass_state = passStateFromRegistration({
    venuePass,
    paymentStatus: reg.payment_status,
    totalDuePaise: totalDueForPass,
    pendingOfflineProof: Boolean(pendingProof),
  });
  const storedTrimmed = String(storedCode ?? '').trim();
  const preview_registration_code =
    pass_state === 'pending_verification' && storedTrimmed ? storedTrimmed : null;
  const preview_registration_qr = preview_registration_code
    ? registrationQrPayload(preview_registration_code, reg.id)
    : null;

  return {
    ...reg,
    fee_due_paise: feeDue,
    intended_donation_paise: donation?.amount_paise ?? 0,
    donation_payment_status: donation?.payment_status ?? null,
    donation_due_paise: donationDue,
    total_due_paise: totalDueForPass,
    committee_confirmed: passReady,
    pass_state,
    registration_code: registrationCode,
    upi_payment_ref,
    registration_qr: registrationCode ? registrationQrPayload(registrationCode, reg.id) : null,
    preview_registration_code,
    preview_registration_qr,
    event_fee_payment_label: formatEventFeePaymentLabel({
      attending: attendingLoad,
      guestCount: guestCountLoad,
      totalCostPaise: feeTotal,
      paymentStatus: reg.payment_status,
    }),
    pending_offline_proof: pendingProof,
  };
}

/**
 * Brings the donation row in line with the intended amount.
 * - A paid donation cannot be changed here. The committee handles it.
 * - Zero intent marks any unpaid donation as failed, meaning it was dropped before payment.
 * - A positive intent updates the unpaid donation, or creates one.
 */
async function syncDonationIntent(
  admin: AdminClient,
  input: {
    accountId: string;
    eventId: string;
    existingDonationId: string | null;
    intendedPaise: number;
  }
): Promise<{ ok: true; donation: DonationSnapshot | null } | { ok: false; status: number; error: string }> {
  const existing = await loadDonation(admin, input.existingDonationId);
  const now = new Date().toISOString();

  if (existing?.payment_status === 'paid') {
    if (input.intendedPaise === existing.amount_paise) return { ok: true, donation: existing };
    return {
      ok: false,
      status: 409,
      error: 'Your donation is already paid. Contact the committee to change it.',
    };
  }

  if (input.intendedPaise === 0) {
    if (existing) {
      const { error } = await admin
        .from('donations')
        .update({ payment_status: 'failed', updated_at: now })
        .eq('id', existing.id);
      if (error) {
        console.error('donation clear', error);
        return { ok: false, status: 500, error: 'Could not update donation' };
      }
    }
    return { ok: true, donation: null };
  }

  if (existing) {
    const { error } = await admin
      .from('donations')
      .update({ amount_paise: input.intendedPaise, payment_status: 'pending', updated_at: now })
      .eq('id', existing.id);
    if (error) {
      console.error('donation update', error);
      return { ok: false, status: 500, error: 'Could not update donation' };
    }
    return {
      ok: true,
      donation: { id: existing.id, amount_paise: input.intendedPaise, payment_status: 'pending' },
    };
  }

  const { data, error } = await admin
    .from('donations')
    .insert({
      account_id: input.accountId,
      event_id: input.eventId,
      cause_id: null,
      amount_paise: input.intendedPaise,
      payment_status: 'pending',
    })
    .select('id,amount_paise,payment_status')
    .single();
  if (error || !data) {
    console.error('donation insert', error);
    return { ok: false, status: 500, error: 'Could not save donation' };
  }
  return { ok: true, donation: data as unknown as DonationSnapshot };
}

export async function getAccountRegistrationForEvent(
  me: AlumniAccount,
  eventId: string,
  opts?: GetAccountRegistrationOpts
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const id = String(eventId || '').trim();
  if (!id) return { status: 400, payload: { error: 'eventId is required' } };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('event_registrations')
    .select(REG_SELECT)
    .eq('event_id', id)
    .eq('account_id', me.id)
    .in('payment_status', [...OPEN_PAYMENT_STATUSES])
    .maybeSingle();

  if (error) {
    console.error('reg get', error);
    return {
      status: 500,
      payload: {
        error: error.message || 'Could not load registration. Apply the event_registrations migration.',
      },
    };
  }

  let registrationRow = data;
  if (data && !opts?.skipReprice) {
    await repriceEventRegistrations(id);
    const refreshed = await admin
      .from('event_registrations')
      .select(REG_SELECT)
      .eq('event_id', id)
      .eq('account_id', me.id)
      .in('payment_status', [...OPEN_PAYMENT_STATUSES])
      .maybeSingle();
    if (!refreshed.error && refreshed.data) registrationRow = refreshed.data;
  }

  const profile =
    opts?.profile ?? (await loadAccountProfile(admin, me));

  const reg = registrationRow as RegistrationRow | null;
  if (!reg) return { status: 200, payload: { registration: null, profile } };

  const registration = await enrichRegistrationForClient(admin, me, reg, {
    profile,
    readOnly: opts?.readOnly,
    storedCode: opts?.storedCode,
    donation: opts?.donation,
    pendingProof: opts?.pendingProof,
  });

  return {
    status: 200,
    payload: {
      registration,
      profile,
    },
  };
}

export type VenuePassListItem = {
  eventId: string;
  eventTitle: string;
  starts_at: string;
  ends_at: string | null;
  venue: string;
  registration: Record<string, unknown>;
};

/** One round-trip for member entry passes: only events this account has open registrations for. */
export async function listAccountVenuePasses(
  me: AlumniAccount
): Promise<{
  status: number;
  payload: {
    passes: VenuePassListItem[];
    profile: Record<string, unknown>;
    hideVenuePass?: boolean;
  };
}> {
  if (me.role === 'admin') {
    return {
      status: 200,
      payload: { passes: [], profile: profilePayload(me), hideVenuePass: true },
    };
  }

  const admin = createAdminClient();

  const [profile, regsResult] = await Promise.all([
    loadAccountProfile(admin, me),
    admin
      .from('event_registrations')
      .select(REG_SELECT)
      .eq('account_id', me.id)
      .in('payment_status', [...OPEN_PAYMENT_STATUSES]),
  ]);

  if (regsResult.error) {
    console.error('venue pass list', regsResult.error);
    return {
      status: 500,
      payload: {
        passes: [],
        profile,
      },
    };
  }

  const regRows = (regsResult.data || []) as unknown as RegistrationRow[];
  if (!regRows.length) {
    return { status: 200, payload: { passes: [], profile } };
  }

  const regIds = regRows.map((r) => r.id);
  const eventIds = [...new Set(regRows.map((r) => String(r.event_id).trim()).filter(Boolean))];
  const donationIds = [
    ...new Set(regRows.map((r) => r.donation_id).filter((id): id is string => Boolean(id))),
  ];

  const [eventRows, codeRows, proofRows, donationRows] = await Promise.all([
    selectCatalog((columns) => admin.from('event_catalog').select(columns).in('id', eventIds)),
    admin.from('event_registrations').select('id,registration_code').in('id', regIds),
    admin
      .from('offline_payment_proofs')
      .select('registration_id,id,utr,screenshot_path,status,created_at')
      .in('registration_id', regIds)
      .eq('status', 'pending')
      .order('created_at', { ascending: false }),
    donationIds.length
      ? admin.from('donations').select('id,amount_paise,payment_status').in('id', donationIds)
      : Promise.resolve({ data: [] as { id: string; amount_paise: number; payment_status: string }[], error: null }),
  ]);

  if (eventRows.error) {
    console.error('venue pass events', eventRows.error);
    return { status: 500, payload: { passes: [], profile } };
  }

  const eventById = new Map<string, EventCatalog>();
  for (const row of (eventRows.data || []) as unknown as EventCatalog[]) {
    if (row?.id) eventById.set(String(row.id), row);
  }

  const codeByReg = new Map<string, string | null>();
  for (const row of codeRows.data || []) {
    const id = String((row as { id?: string }).id || '');
    if (!id) continue;
    const code = (row as { registration_code?: string | null }).registration_code;
    codeByReg.set(id, code != null ? String(code) : null);
  }

  const donationById = new Map<string, DonationSnapshot>();
  for (const row of donationRows.data || []) {
    const id = String((row as { id?: string }).id || '');
    if (!id) continue;
    donationById.set(id, row as unknown as DonationSnapshot);
  }

  const pendingByReg = new Map<string, NonNullable<GetAccountRegistrationOpts['pendingProof']>>();
  for (const row of proofRows.data || []) {
    const regId = String((row as { registration_id?: string }).registration_id || '');
    if (!regId || pendingByReg.has(regId)) continue;
    pendingByReg.set(regId, {
      id: String((row as { id?: string }).id || ''),
      utr: typeof (row as { utr?: string }).utr === 'string' ? (row as { utr: string }).utr : null,
      has_screenshot: Boolean((row as { screenshot_path?: string }).screenshot_path),
      status: 'pending',
    });
  }

  const enriched = await Promise.all(
    regRows.map((reg) =>
      enrichRegistrationForClient(admin, me, reg, {
        profile,
        readOnly: true,
        storedCode: codeByReg.get(reg.id) ?? null,
        donation: reg.donation_id ? donationById.get(reg.donation_id) ?? null : null,
        pendingProof: pendingByReg.get(reg.id) ?? null,
      })
    )
  );

  const passes: VenuePassListItem[] = regRows.map((reg, index) => {
    const eventId = String(reg.event_id);
    const catalog = eventById.get(eventId);
    return {
      eventId,
      eventTitle: catalog?.title || 'Event',
      starts_at: catalog?.starts_at || '',
      ends_at: catalog?.ends_at ?? null,
      venue: catalog?.venue || '',
      registration: enriched[index],
    };
  });

  passes.sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));

  return { status: 200, payload: { passes, profile } };
}

export async function registerAccountForEvent(
  me: AlumniAccount,
  body: Record<string, unknown>
): Promise<{ status: number; payload: Record<string, unknown> }> {
  if (me.role === 'admin') {
    return {
      status: 400,
      payload: { error: 'Committee accounts do not register for the event here' },
    };
  }

  const eventId = String(body.eventId || '').trim();
  if (!eventId) return { status: 400, payload: { error: 'eventId is required' } };

  const admin = createAdminClient();
  const { data: event, error: eventError } = await selectCatalog((columns) =>
    admin.from('event_catalog').select(columns).eq('id', eventId).eq('published', true).maybeSingle()
  );

  if (eventError || !event) {
    return { status: 404, payload: { error: 'Event not found or not published' } };
  }

  const catalog = event as unknown as EventCatalog;
  if (isEventSoftDeleted(catalog)) {
    return { status: 404, payload: { error: 'Event not found or not published' } };
  }

  // Attendance: the alumnus attends, or at least one guest is coming. Otherwise nothing is saved.
  const requestedGuests = Number(body.number_of_guests ?? 0);
  if (Number.isFinite(requestedGuests) && requestedGuests > MAX_GUESTS) {
    return { status: 400, payload: { error: `You can register up to ${MAX_GUESTS} guests` } };
  }
  const guestCount = clampGuestCount(requestedGuests);
  const attending = body.attending === true;

  // Donation intent (checked before donate-only save when not attending).
  let intendedDonationPaise = 0;
  if (body.intended_donation_paise != null && body.intended_donation_paise !== '') {
    const raw = Number(body.intended_donation_paise);
    if (raw !== 0) {
      try {
        intendedDonationPaise = assertDonationAmountPaise(raw);
      } catch (err) {
        return {
          status: 400,
          payload: { error: err instanceof Error ? err.message : 'Invalid donation' },
        };
      }
    }
  }

  if (!registrationSaveAllowed(attending, guestCount, intendedDonationPaise)) {
    return {
      status: 400,
      payload: {
        error:
          'Enter a donation (at least ₹1), or choose at least one person to attend: you or a guest',
      },
    };
  }

  // Parking: counts are stored only when parking is needed, and the total cannot exceed
  // the people coming (alumnus + guests).
  const hasParking = body.has_parking === true;
  const twoWheelers = hasParking ? clampVehicleCount(body.two_wheeler_count) : 0;
  const fourWheelers = hasParking ? clampVehicleCount(body.four_wheeler_count) : 0;
  if (hasParking) {
    const parkingProblem = vehicleCountsProblem(twoWheelers, fourWheelers, guestCount);
    if (parkingProblem) return { status: 400, payload: { error: parkingProblem } };
  }

  // Eating: the alumnus eats only when attending. Guests eat by count.
  const alumnusEats = attending && body.lunch !== false;
  const guestsEating = clampGuestsEating(body.guests_eating, guestCount);
  // The shared food choice is stored only when someone is eating.
  const foodPreference = anyoneEating(alumnusEats, guestsEating)
    ? normalizeFoodPreference(body.food_preference)
    : null;

  const feeBatchRaw = body.batch != null && body.batch !== '' ? Number(body.batch) : null;
  const feeBatch = isValidBatch(feeBatchRaw) ? feeBatchRaw : me.batch;

  const breakdown = getEventCostBreakdown({
    attending,
    alumnusEats,
    batch: feeBatch ?? null,
    guestCount,
    guestsEating,
  });
  const feeTotal = breakdown.totalCost;

  const rawPhone = body.phone_number ? String(body.phone_number) : me.phone_number || '';
  const phone =
    normalizePhoneNumber(rawPhone.startsWith('+') ? rawPhone : rawPhone ? `+${rawPhone}` : '') || null;
  if (!phone) {
    return {
      status: 400,
      payload: { error: 'Enter a valid phone number with country code (ISD)' },
    };
  }
  const phoneParts = splitE164(phone);
  const phoneErr = phoneValidationError(phoneParts.isd, phoneParts.national);
  if (phoneErr) return { status: 400, payload: { error: phoneErr } };

  const { data: existingRaw } = await admin
    .from('event_registrations')
    .select('id,payment_status,amount_paid_paise,donation_id,core_committee_manually_verified')
    .eq('event_id', eventId)
    .eq('account_id', me.id)
    .in('payment_status', [...OPEN_PAYMENT_STATUSES])
    .maybeSingle();
  const existing = existingRaw as ExistingRow | null;

  let withdrawnPendingProof = 0;
  if (existing?.id) {
    withdrawnPendingProof = await withdrawPendingRegistrationProofs(admin, existing.id);
    if (withdrawnPendingProof > 0) {
      await admin
        .from('event_registrations')
        .update({ bank_reference: null, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
    }
  }

  const donationSync = await syncDonationIntent(admin, {
    accountId: me.id,
    eventId,
    existingDonationId: existing?.donation_id ?? null,
    intendedPaise: intendedDonationPaise,
  });
  if (!donationSync.ok) {
    return { status: donationSync.status, payload: { error: donationSync.error } };
  }
  const donation = donationSync.donation;
  const donationId = donation?.id ?? null;
  const donationDue = donationDuePaise(donation);

  // The fee's payment status. A ₹0 fee is paid at save; the donation is tracked separately.
  const priorPaid = Math.max(0, Number(existing?.amount_paid_paise) || 0);
  const payment_status = statusFromAmounts(feeTotal, priorPaid);
  const feeDue = amountDuePaise(feeTotal, priorPaid);

  const row = {
    event_id: eventId,
    account_id: me.id,
    phone_number: phone,
    number_of_guests: guestCount,
    guests_eating: guestsEating,
    attending,
    lunch: alumnusEats,
    food_preference: foodPreference,
    has_parking: hasParking,
    two_wheeler_count: twoWheelers,
    four_wheeler_count: fourWheelers,
    total_cost_paise: feeTotal,
    amount_paid_paise: priorPaid,
    payment_status,
    donation_id: donationId,
    updated_at: new Date().toISOString(),
  };

  let regId: string | undefined = existing?.id;
  if (existing?.id) {
    const { error } = await admin.from('event_registrations').update(row).eq('id', existing.id);
    if (error) {
      console.error('reg update', error);
      return {
        status: 500,
        payload: { error: error.message || 'Could not update registration' },
      };
    }
  } else {
    const { data: inserted, error } = await admin
      .from('event_registrations')
      .insert(row)
      .select('id')
      .single();
    if (error || !inserted) {
      console.error('reg insert', error);
      return {
        status: 500,
        payload: {
          error: error?.message || 'Could not save registration. Apply the event_registrations migration.',
        },
      };
    }
    regId = inserted.id as string;
  }
  if (!regId) return { status: 500, payload: { error: 'Could not save registration' } };

  const venuePass = needsVenuePass(attending, guestCount);
  if (!venuePass) {
    await clearRegistrationCode(admin as unknown as RegistrationCodeAdmin, regId);
  }
  const snap = {
    id: regId,
    event_id: eventId,
    account_id: me.id,
    attending,
    number_of_guests: guestCount,
    total_cost_paise: feeTotal,
    amount_paid_paise: priorPaid,
    payment_status,
    donation_id: donationId,
    razorpay_order_id: null,
    razorpay_payment_id: null,
  } satisfies import('@/lib/events/mark-paid').RegistrationSnapshot;
  const totalDueBeforeJubilee = feeDue + donationDue;
  await reserveUpiPaymentCode(admin as unknown as RegistrationCodeAdmin, regId, {
    venuePass,
    amountDuePaise: totalDueBeforeJubilee,
  });
  await issueRegistrationCodeIfEligible(admin, regId, {
    ...passEligibilityFromRegistration(snap, donationDue),
    paymentStatus: payment_status,
  });
  const storedCode = await readRegistrationCode(admin as unknown as RegistrationCodeAdmin, regId);
  const registrationCode = visibleRegistrationCode(storedCode, snap, donationDue);
  const upi_payment_ref = venuePass ? storedCode || regId : regId;

  const fullName = String(body.full_name || '').trim() || me.full_name;
  const lastName = String(body.last_name || '').trim();
  const batchRaw = body.batch != null && body.batch !== '' ? Number(body.batch) : null;
  const batch = isValidBatch(batchRaw) ? batchRaw : me.batch;
  const sectionRaw = String(body.section || '').trim();
  const section = isValidSection(sectionRaw) ? sectionRaw : me.section;
  const city = String(body.city || '').trim();
  const country = String(body.country || '').trim();
  const location = formatLocation(city, country) || me.current_location || null;

  const totalDue = totalDueBeforeJubilee;
  const jubilee = catalog.is_primary
    ? totalDue > 0
      ? 'pending_payment'
      : jubileeStatusFromPayment(payment_status)
    : undefined;
  const corePatch: Record<string, unknown> = {
    full_name: fullName,
    phone_number: phone,
    batch,
    current_location: location,
  };
  if (jubilee) corePatch.jubilee_reg_status = jubilee;

  const { error: coreError } = await admin.from('alumni_accounts').update(corePatch).eq('id', me.id);
  if (coreError) console.error('reg account core update', coreError);

  // Prefer real columns when the migration is applied. Always also pack into bio so
  // Complete payment works before last_name and section exist on alumni_accounts.
  if (lastName || section) {
    const extra: Record<string, unknown> = {};
    if (lastName) extra.last_name = lastName;
    if (section) extra.section = section;
    const { error: extraError } = await admin.from('alumni_accounts').update(extra).eq('id', me.id);
    if (extraError) {
      console.error('reg account section/last_name columns', extraError.message);
    }
    const { data: currentBio } = await admin
      .from('alumni_accounts')
      .select('bio')
      .eq('id', me.id)
      .maybeSingle();
    const { error: packedError } = await admin
      .from('alumni_accounts')
      .update({
        bio: mergeProfilePack(currentBio?.bio, {
          section: section || me.section || '',
          lastName: lastName || me.last_name || '',
        }),
      })
      .eq('id', me.id);
    if (packedError) console.error('reg account bio pack', packedError);
  }

  return {
    status: 200,
    payload: {
      ok: true,
      id: regId,
      withdrawn_pending_proof: withdrawnPendingProof > 0,
      payment_status,
      total_cost_paise: feeTotal,
      amount_paid_paise: priorPaid,
      fee_due_paise: feeDue,
      donation_id: donationId,
      intended_donation_paise: donation?.amount_paise ?? 0,
      donation_due_paise: donationDue,
      total_due_paise: totalDue,
      jubilee_reg_status: jubilee,
      registration_code: registrationCode,
      upi_payment_ref,
      registration_qr: registrationCode ? registrationQrPayload(registrationCode, regId) : null,
      event_fee_payment_label: formatEventFeePaymentLabel({
        attending,
        guestCount,
        totalCostPaise: feeTotal,
        paymentStatus: payment_status,
      }),
      has_parking: hasParking,
      two_wheeler_count: twoWheelers,
      four_wheeler_count: fourWheelers,
    },
  };
}