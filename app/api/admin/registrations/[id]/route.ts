// app/api/admin/registrations/[id]/route.ts
// Committee actions on one registration.
// - payment_status: 'paid' settles the fee and any linked donation in full and issues the code;
//   'pending' clears payment on both and nullifies the registration code.

import { NextResponse } from 'next/server';
import {
  displayBankReference,
  indexProofsByRegistration,
  type OfflineProofLite,
} from '@/lib/admin/registration-proof';
import { ledgerFor, loadRegistrationById, one } from '@/lib/admin/registration-rows';
import { STATE_LABELS } from '@/lib/admin/registration-ledger';
import { requireVerifiedAdmin } from '@/lib/auth/admin-guard';
import { venuePassSummary } from '@/lib/events/venue-pass';
import {
  applyRegistrationPayment,
  markRegistrationUnpaid,
} from '@/lib/events/mark-paid';
import { signedProofUrl } from '@/lib/payments/proof-storage';
import { clampGuestCount, clampGuestsEating } from '@/lib/registration/registration';
import { createAdminClient } from '@/lib/supabase-admin';

type PatchBody = {
  payment_status?: unknown;
};

async function proofAttachForRegistration(registrationId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('offline_payment_proofs')
    .select('registration_id,utr,screenshot_path,status,created_at')
    .eq('registration_id', registrationId)
    .order('created_at', { ascending: false })
    .limit(5);
  if (error) return null;
  const lite: OfflineProofLite[] = (data || [])
    .filter((row) => row.registration_id)
    .map((row) => ({
      registration_id: String(row.registration_id),
      utr: typeof row.utr === 'string' ? row.utr : null,
      screenshot_path: typeof row.screenshot_path === 'string' ? row.screenshot_path : null,
      status: String(row.status || ''),
      created_at: String(row.created_at || ''),
    }));
  const proof = indexProofsByRegistration(lite).get(registrationId);
  if (!proof) return null;
  return {
    utr: proof.utr,
    screenshot_url: await signedProofUrl(admin, proof.screenshot_path),
  };
}

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await requireVerifiedAdmin();
  if (!me) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await ctx.params;
  const registrationId = String(id || '').trim();
  if (!registrationId) return NextResponse.json({ error: 'Registration id is required' }, { status: 400 });

  const { row, error } = await loadRegistrationById(registrationId);
  if (error) return NextResponse.json({ error: 'Could not load registration' }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'Registration not found' }, { status: 404 });

  const proof = await proofAttachForRegistration(registrationId);
  const bank_reference = displayBankReference({
    bankReference: row.bank_reference,
    proofUtr: proof?.utr ?? null,
  });
  const ledger = ledgerFor({ ...row, bank_reference });
  const account = one(row.alumni_accounts);
  const event = one(row.event_catalog);
  const guestCount = clampGuestCount(Number(row.number_of_guests) || 0);
  const guestsEating = clampGuestsEating(row.guests_eating, guestCount);
  const batchRaw = account?.batch;
  const batch =
    typeof batchRaw === 'number'
      ? batchRaw
      : batchRaw != null && String(batchRaw).trim() !== ''
        ? Number(batchRaw) || null
        : null;

  const meals = venuePassSummary({
    attending: row.attending !== false,
    lunch: row.lunch !== false,
    food_preference: row.food_preference,
    number_of_guests: guestCount,
    guests_eating: guestsEating,
    payment_status: ledger.confirmed ? 'paid' : row.payment_status,
    total_due_paise: ledger.duePaise,
    registration_code: row.registration_code,
  }).meals;

  return NextResponse.json({
    id: row.id,
    event_id: row.event_id,
    full_name: account?.full_name || '—',
    email: account?.email || '—',
    phone_number: row.phone_number,
    event_title: event?.title || 'Event',
    registration_code: row.registration_code,
    batch,
    billed_paise: ledger.billedPaise,
    settled_paise: ledger.settledPaise,
    due_paise: ledger.duePaise,
    state_label: STATE_LABELS[ledger.state],
    bank_reference,
    proof_screenshot_url: proof?.screenshot_url || null,
    meals,
  });
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await requireVerifiedAdmin();
  if (!me) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await ctx.params;
  const registrationId = String(id || '').trim();
  if (!registrationId) return NextResponse.json({ error: 'Registration id is required' }, { status: 400 });

  const body = (await request.json().catch(() => ({}))) as PatchBody;
  if (body.payment_status === undefined) {
    return NextResponse.json({ error: 'Send payment_status' }, { status: 400 });
  }

  const status = String(body.payment_status || '');
  if (status !== 'paid' && status !== 'pending') {
    return NextResponse.json({ error: 'payment_status must be paid or pending' }, { status: 400 });
  }

  const result =
    status === 'paid'
      ? await applyRegistrationPayment({ registrationId, settleFull: true })
      : await markRegistrationUnpaid(registrationId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const response: Record<string, unknown> = {
    ok: true,
    payment_status: result.payment_status,
    amount_paid_paise: result.amount_paid_paise,
  };
  if ('amount_due_paise' in result) response.amount_due_paise = result.amount_due_paise;
  if ('registration_code' in result) response.registration_code = result.registration_code;

  return NextResponse.json(response);
}
