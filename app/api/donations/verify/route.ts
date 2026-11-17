import { NextResponse } from 'next/server';
import { getCurrentAccount } from '@/lib/auth/request';
import { applyDonationPayment } from '@/lib/donations/mark-paid';
import { cashfreeCapturedAmountPaise, isCashfreeConfigured } from '@/lib/payments/cashfree';
import { createAdminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const me = await getCurrentAccount();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!isCashfreeConfigured()) {
    return NextResponse.json({ error: 'Payments are not configured' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const donationId = String(body.donationId || '').trim();
  const orderId = String(body.order_id || body.orderId || '').trim();
  if (!orderId) {
    return NextResponse.json({ error: 'Payment details are incomplete' }, { status: 400 });
  }

  const admin = createAdminClient();
  let donation: {
    id: string;
    account_id: string;
    razorpay_order_id: string | null;
    amount_paise: number;
    payment_status: string;
  } | null = null;

  if (donationId) {
    const { data } = await admin
      .from('donations')
      .select('id,account_id,razorpay_order_id,amount_paise,payment_status')
      .eq('id', donationId)
      .eq('account_id', me.id)
      .maybeSingle();
    donation = data;
  } else {
    const { data } = await admin
      .from('donations')
      .select('id,account_id,razorpay_order_id,amount_paise,payment_status')
      .eq('razorpay_order_id', orderId)
      .eq('account_id', me.id)
      .maybeSingle();
    donation = data;
  }

  if (!donation) {
    return NextResponse.json({ error: 'Donation not found' }, { status: 404 });
  }
  if (donation.razorpay_order_id && donation.razorpay_order_id !== orderId) {
    return NextResponse.json({ error: 'Payment does not match the current order' }, { status: 400 });
  }

  const captured = await cashfreeCapturedAmountPaise(orderId);
  if (!captured.ok) {
    return NextResponse.json({ error: captured.message }, { status: captured.status });
  }

  const result = await applyDonationPayment({
    donationId: donation.id,
    razorpay: {
      order_id: orderId,
      payment_id: captured.paymentId,
      signature: null,
    },
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error || 'Could not record payment' }, { status: result.status || 500 });
  }

  return NextResponse.json({
    ok: true,
    payment_status: result.payment_status,
    amount_paise: result.amount_paise,
  });
}