// app/api/payments/verify/route.ts
// Browser callback after Cashfree Checkout. Confirms payment with Cashfree before recording money.

import { NextResponse } from 'next/server';
import { getCurrentAccount } from '@/lib/auth/request';
import { loadRegistrationForPageLoad } from '@/lib/events/register';
import { applyGatewayPayment } from '@/lib/events/mark-paid';
import { cashfreeCapturedAmountPaise, isCashfreeConfigured } from '@/lib/payments/cashfree';
import { createAdminClient } from '@/lib/supabase-admin';

export async function POST(request: Request) {
  const me = await getCurrentAccount();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!isCashfreeConfigured()) {
    return NextResponse.json({ error: 'Payments are not configured' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const registrationId = String(body.registrationId || '').trim();
  const orderId = String(body.order_id || body.orderId || '').trim();
  if (!registrationId || !orderId) {
    return NextResponse.json({ error: 'Payment details are incomplete' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: owned } = await admin
    .from('event_registrations')
    .select('id,event_id,razorpay_order_id')
    .eq('id', registrationId)
    .eq('account_id', me.id)
    .maybeSingle();
  if (!owned) return NextResponse.json({ error: 'Registration not found' }, { status: 404 });

  if (owned.razorpay_order_id && owned.razorpay_order_id !== orderId) {
    return NextResponse.json({ error: 'Payment does not match the current order' }, { status: 400 });
  }

  const captured = await cashfreeCapturedAmountPaise(orderId);
  if (!captured.ok) {
    return NextResponse.json({ error: captured.message }, { status: captured.status });
  }

  const result = await applyGatewayPayment({
    registrationId,
    orderId,
    paymentId: captured.paymentId,
    signature: null,
    amountPaise: captured.amountPaise,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const eventId = String(owned.event_id || '').trim();
  const registrationPayload = eventId
    ? (await loadRegistrationForPageLoad(me, eventId)).payload.registration
    : null;

  return NextResponse.json({
    ok: true,
    payment_status: result.payment_status,
    amount_paid_paise: result.amount_paid_paise,
    amount_due_paise: result.amount_due_paise,
    donation_due_paise: result.donation_due_paise,
    registration_code: result.registration_code,
    registration: registrationPayload,
  });
}