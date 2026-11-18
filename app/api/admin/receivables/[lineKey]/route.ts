import { NextResponse } from 'next/server';
import { parseReceivableLineKey } from '@/lib/admin/receivable-lines';
import { applyDonationPayment } from '@/lib/donations/mark-paid';
import { requireVerifiedAdmin } from '@/lib/auth/admin-guard';
import {
  applyRegistrationDonationPayment,
  applyRegistrationFeePayment,
  markDonationUnpaid,
  markRegistrationFeeUnpaid,
} from '@/lib/events/mark-paid';
import { createAdminClient } from '@/lib/supabase-admin';

type PatchBody = { payment_status?: unknown };

async function donationLinkedToRegistration(donationId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('event_registrations')
    .select('id')
    .eq('donation_id', donationId)
    .maybeSingle();
  return Boolean(data?.id);
}

export async function PATCH(request: Request, ctx: { params: Promise<{ lineKey: string }> }) {
  const me = await requireVerifiedAdmin();
  if (!me) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { lineKey: rawKey } = await ctx.params;
  const parsed = parseReceivableLineKey(decodeURIComponent(String(rawKey || '')));
  if (!parsed) {
    return NextResponse.json({ error: 'Invalid receivable line' }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as PatchBody;
  const status = String(body.payment_status || '');
  if (status !== 'paid' && status !== 'pending') {
    return NextResponse.json({ error: 'payment_status must be paid or pending' }, { status: 400 });
  }

  if (parsed.kind === 'fee') {
    const result =
      status === 'paid'
        ? await applyRegistrationFeePayment({ registrationId: parsed.id })
        : await markRegistrationFeeUnpaid(parsed.id);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ ok: true, payment_status: status });
  }

  if (status === 'paid') {
    const linked = await donationLinkedToRegistration(parsed.id);
    const result = linked
      ? await applyRegistrationDonationPayment({ donationId: parsed.id })
      : await applyDonationPayment({ donationId: parsed.id });
    if (!result.ok) {
      return NextResponse.json({ error: result.error || 'Update failed' }, { status: result.status || 500 });
    }
    return NextResponse.json({ ok: true, payment_status: 'paid' });
  }

  const result = await markDonationUnpaid(parsed.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, payment_status: 'pending' });
}