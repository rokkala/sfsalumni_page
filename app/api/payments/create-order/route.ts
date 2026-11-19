// app/api/payments/create-order/route.ts
// Creates one Cashfree order for everything still due on a registration: the event fee plus
// the linked donation. Both amounts are computed here from the database, never from the browser.

import { randomBytes } from 'crypto';
import { NextResponse } from 'next/server';
import { getCurrentAccount } from '@/lib/auth/request';
import { amountDuePaise, OPEN_PAYMENT_STATUSES } from '@/lib/events/balance';
import { repriceEventRegistrations } from '@/lib/events/reprice';
import {
  applyRegistrationPayment,
  donationDuePaise,
  loadDonation,
} from '@/lib/events/mark-paid';
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

/** Cashfree refuses orders below ₹1. */
const MIN_ONLINE_PAISE = 100;

function newGatewayOrderId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString('hex')}_${Date.now()}`.slice(0, 40);
}

export async function POST(request: Request) {
  const me = await getCurrentAccount();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (me.role === 'admin') {
    return NextResponse.json({ error: 'Committee accounts do not pay here' }, { status: 400 });
  }

  const admin = createAdminClient();
  const checkoutSettings = await loadCheckoutSettings(admin);

  if (!memberOnlineCheckoutAvailable(checkoutSettings)) {
    return NextResponse.json(
      {
        error: isCashfreeConfigured()
          ? 'Online checkout is turned off. Pay by Bank / UPI or ask the committee.'
          : 'Payments are not configured yet. Ask the committee to mark your payment, or try again later.',
        configured: false,
      },
      { status: 503 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const registrationId = String(body.registrationId || '').trim();
  if (!registrationId) {
    return NextResponse.json({ error: 'registrationId is required' }, { status: 400 });
  }

  const registrationSelect =
    'id,event_id,account_id,payment_status,total_cost_paise,amount_paid_paise,donation_id';

  const { data: reg, error } = await admin
    .from('event_registrations')
    .select(registrationSelect)
    .eq('id', registrationId)
    .eq('account_id', me.id)
    .in('payment_status', [...OPEN_PAYMENT_STATUSES])
    .maybeSingle();

  if (error || !reg) {
    return NextResponse.json({ error: 'Registration not found' }, { status: 404 });
  }

  await repriceEventRegistrations(String(reg.event_id || ''));

  const { data: priced } = await admin
    .from('event_registrations')
    .select(registrationSelect)
    .eq('id', reg.id)
    .maybeSingle();
  const current = priced || reg;

  const feeTotal = Math.max(0, Number(current.total_cost_paise) || 0);
  const feePaid = Math.max(0, Number(current.amount_paid_paise) || 0);
  const feeDue = amountDuePaise(feeTotal, feePaid);

  const donation = await loadDonation(admin, current.donation_id);
  const donationDue = donationDuePaise(donation);
  const totalDue = feeDue + donationDue;

  if (totalDue === 0) {
    const settled = await applyRegistrationPayment({ registrationId: reg.id, settleFull: true });
    if (!settled.ok) {
      return NextResponse.json({ error: settled.error }, { status: settled.status });
    }
    return NextResponse.json({
      ok: true,
      skipCheckout: true,
      amount_due_paise: 0,
      payment_status: settled.payment_status,
      registration_code: settled.registration_code,
    });
  }

  if (totalDue < MIN_ONLINE_PAISE) {
    return NextResponse.json(
      { error: 'Amount due must be at least ₹1 to pay online' },
      { status: 400 }
    );
  }

  const base = appBaseUrl();
  const gatewayOrderId = newGatewayOrderId(`reg_${reg.id.slice(0, 8)}`);
  const created = await createCashfreeOrder({
    orderId: gatewayOrderId,
    amountPaise: totalDue,
    customer: {
      id: me.id,
      name: me.full_name || 'Alumni',
      email: me.email || 'alumni@example.com',
      phone: me.phone_number || '',
    },
    returnUrl: `${base}/registration?cf_order_id=${encodeURIComponent(gatewayOrderId)}`,
    notifyUrl: `${base}/api/payments/webhook`,
    tags: {
      registration_id: reg.id,
      donation_id: donation?.id ?? '',
      account_id: me.id,
    },
    note: 'SFS Alumni Meet 2026 Donation',
  });

  if (!created.ok) {
    console.error('cashfree create-order', created.message);
    if (created.status === 401) {
      return NextResponse.json(
        {
          error:
            'Payment gateway authentication failed. Check CASHFREE_CLIENT_ID and CASHFREE_CLIENT_SECRET in your environment, then redeploy.',
        },
        { status: 502 }
      );
    }
    return NextResponse.json({ error: 'Could not create payment order' }, { status: 500 });
  }

  const now = new Date().toISOString();
  const { error: regUpdError } = await admin
    .from('event_registrations')
    .update({ razorpay_order_id: created.orderId, updated_at: now })
    .eq('id', reg.id);
  if (regUpdError) {
    console.error('create-order persist registration', regUpdError);
    return NextResponse.json({ error: 'Could not save payment order' }, { status: 500 });
  }

  if (donation && donationDue > 0) {
    const { error: donUpdError } = await admin
      .from('donations')
      .update({ razorpay_order_id: created.orderId, updated_at: now })
      .eq('id', donation.id);
    if (donUpdError) {
      console.error('create-order persist donation', donUpdError);
      return NextResponse.json({ error: 'Could not save payment order' }, { status: 500 });
    }
  }

  return NextResponse.json({
    ok: true,
    orderId: created.orderId,
    paymentSessionId: created.paymentSessionId,
    checkoutMode: cashfreePublicMode(),
    amount: totalDue,
    fee_due_paise: feeDue,
    donation_due_paise: donationDue,
    currency: 'INR',
  });
}