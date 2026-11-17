// app/api/payments/webhook/route.ts
// Cashfree server-to-server notification (backstop when browser verify never arrives).

import { NextResponse } from 'next/server';
import { applyDonationPayment } from '@/lib/donations/mark-paid';
import { applyGatewayPayment } from '@/lib/events/mark-paid';
import {
  cashfreeCapturedAmountPaise,
  isCashfreeConfigured,
  verifyCashfreeWebhookSignature,
} from '@/lib/payments/cashfree';
import { createAdminClient } from '@/lib/supabase-admin';

type CashfreeWebhookPayload = {
  type?: string;
  data?: {
    order?: { order_id?: string; order_tags?: Record<string, string> | null };
    payment?: { cf_payment_id?: string; payment_status?: string };
  };
};

export async function POST(request: Request) {
  if (!isCashfreeConfigured()) {
    return NextResponse.json({ error: 'Payments are not configured' }, { status: 503 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get('x-webhook-signature') || '';
  const timestamp = request.headers.get('x-webhook-timestamp') || '';
  if (!signature || !verifyCashfreeWebhookSignature(rawBody, signature, timestamp)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  let event: CashfreeWebhookPayload;
  try {
    event = JSON.parse(rawBody) as CashfreeWebhookPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const type = String(event.type || '');
  const successTypes = new Set([
    'PAYMENT_SUCCESS_WEBHOOK',
    'PAYMENT_CHARGES_WEBHOOK',
    'ORDER_PAID',
  ]);
  if (!successTypes.has(type)) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const orderId =
    event.data?.order?.order_id ||
    (event.data?.payment as { order_id?: string } | undefined)?.order_id;
  if (!orderId) return NextResponse.json({ ok: true, ignored: true });

  const captured = await cashfreeCapturedAmountPaise(String(orderId));
  if (!captured.ok) {
    if (captured.status >= 500) {
      return NextResponse.json({ error: captured.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, ignored: true });
  }

  const tags = event.data?.order?.order_tags || {};
  let registrationId = String(tags.registration_id || '').trim();
  if (!registrationId) {
    registrationId = (await lookupRegistrationIdByOrder(String(orderId))) || '';
  }

  const donationIdOnly = !registrationId ? String(tags.donation_id || '').trim() : '';
  if (donationIdOnly) {
    const donResult = await applyDonationPayment({
      donationId: donationIdOnly,
      razorpay: {
        order_id: String(orderId),
        payment_id: captured.paymentId,
        signature: null,
      },
    });
    if (!donResult.ok && (donResult.status || 0) >= 500) {
      return NextResponse.json({ error: donResult.error }, { status: 500 });
    }
    return NextResponse.json({ ok: true, donation: true, payment_status: donResult.payment_status });
  }

  if (!registrationId) {
    console.error('webhook: no registration_id for order', orderId);
    return NextResponse.json({ ok: true, unmatched: true });
  }

  const admin = createAdminClient();
  const { data: reg } = await admin
    .from('event_registrations')
    .select('id,account_id')
    .eq('id', registrationId)
    .maybeSingle();
  if (!reg) {
    console.error('webhook: registration not found', registrationId, orderId);
    return NextResponse.json({ ok: true, unmatched: true });
  }

  const result = await applyGatewayPayment({
    registrationId,
    orderId: String(orderId),
    paymentId: captured.paymentId,
    signature: null,
    amountPaise: captured.amountPaise,
  });

  if (!result.ok) {
    if (result.status >= 500) return NextResponse.json({ error: result.error }, { status: 500 });
    console.error('webhook apply', result.error, orderId);
    return NextResponse.json({ ok: true, unapplied: true });
  }

  return NextResponse.json({ ok: true, payment_status: result.payment_status });
}

async function lookupRegistrationIdByOrder(orderId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data: reg } = await admin
    .from('event_registrations')
    .select('id')
    .eq('razorpay_order_id', orderId)
    .maybeSingle();
  if (reg?.id) return reg.id;

  const { data: donation } = await admin
    .from('donations')
    .select('id,account_id')
    .eq('razorpay_order_id', orderId)
    .maybeSingle();
  if (!donation) return null;

  const { data: linkedReg } = await admin
    .from('event_registrations')
    .select('id')
    .eq('donation_id', donation.id)
    .maybeSingle();
  return linkedReg?.id ?? null;
}