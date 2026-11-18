import { randomBytes } from 'crypto';
import { NextResponse } from 'next/server';
import { getCurrentAccount } from '@/lib/auth/request';
import {
  assertDonationAmountPaise,
  assertDonationMessage,
} from '@/lib/donations/validate';
import {
  appBaseUrl,
  cashfreePublicMode,
  createCashfreeOrder,
  isCashfreeConfigured,
} from '@/lib/payments/cashfree';
import {
  loadCheckoutSettings,
  memberOnlineCheckoutAvailable,
} from '@/lib/payments/checkout-settings';
import { createAdminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

function newGatewayOrderId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString('hex')}_${Date.now()}`.slice(0, 40);
}

export async function POST(request: Request) {
  const me = await getCurrentAccount();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (me.role === 'admin') {
    return NextResponse.json({ error: 'Committee accounts do not pay here' }, { status: 400 });
  }
  if (me.member_status === 'rejected' || me.member_status === 'suspended') {
    return NextResponse.json({ error: 'Account cannot donate at this time' }, { status: 403 });
  }

  const admin = createAdminClient();
  const checkoutSettings = await loadCheckoutSettings(admin);

  if (!memberOnlineCheckoutAvailable(checkoutSettings)) {
    return NextResponse.json(
      {
        error: isCashfreeConfigured()
          ? 'Online checkout is turned off. Pay by Bank / UPI or ask the committee.'
          : 'Payments are not configured yet. Please try again later.',
        configured: false,
      },
      { status: 503 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const causeId = String(body.causeId || '').trim();
  if (!causeId) {
    return NextResponse.json({ error: 'causeId is required' }, { status: 400 });
  }

  let amountPaise: number;
  let message: string | null;
  try {
    amountPaise = assertDonationAmountPaise(body.amountPaise);
    message = assertDonationMessage(body.message);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Invalid donation' },
      { status: 400 }
    );
  }

  const { data: cause, error: causeErr } = await admin
    .from('donation_causes')
    .select('id,title,active')
    .eq('id', causeId)
    .maybeSingle();

  if (causeErr || !cause || !cause.active) {
    return NextResponse.json({ error: 'Cause not found or inactive' }, { status: 400 });
  }

  const { data: donation, error: insErr } = await admin
    .from('donations')
    .insert({
      account_id: me.id,
      cause_id: cause.id,
      amount_paise: amountPaise,
      message,
      payment_status: 'pending',
    })
    .select('id,amount_paise')
    .single();

  if (insErr || !donation) {
    console.error('donation insert', insErr);
    return NextResponse.json({ error: 'Could not start donation' }, { status: 500 });
  }

  const base = appBaseUrl();
  const gatewayOrderId = newGatewayOrderId(`don_${donation.id.slice(0, 8)}`);
  const created = await createCashfreeOrder({
    orderId: gatewayOrderId,
    amountPaise,
    customer: {
      id: me.id,
      name: me.full_name || 'Alumni',
      email: me.email || 'alumni@example.com',
      phone: me.phone_number || '',
    },
    returnUrl: `${base}/member/donate?cf_order_id=${encodeURIComponent(gatewayOrderId)}`,
    notifyUrl: `${base}/api/payments/webhook`,
    tags: {
      donation_id: donation.id,
      cause_id: cause.id,
      account_id: me.id,
    },
    note: `Donation · ${cause.title}`,
  });

  if (!created.ok) {
    console.error('donation cashfree order', created.message);
    await admin
      .from('donations')
      .update({ payment_status: 'failed', updated_at: new Date().toISOString() })
      .eq('id', donation.id);
    return NextResponse.json({ error: 'Could not create payment order' }, { status: 502 });
  }

  const { error: updError } = await admin
    .from('donations')
    .update({
      razorpay_order_id: created.orderId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', donation.id);

  if (updError) {
    console.error('donation order persist', updError);
    return NextResponse.json({ error: 'Could not save payment order' }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    donationId: donation.id,
    orderId: created.orderId,
    paymentSessionId: created.paymentSessionId,
    checkoutMode: cashfreePublicMode(),
    amount: amountPaise,
    currency: 'INR',
    description: `Donation · ${cause.title}`,
  });
}