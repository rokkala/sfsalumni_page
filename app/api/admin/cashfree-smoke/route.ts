import { randomBytes } from 'crypto';
import { NextResponse } from 'next/server';
import { requireVerifiedAdmin } from '@/lib/auth/admin-guard';
import {
  appBaseUrl,
  cashfreePublicMode,
  createCashfreeOrder,
  isCashfreeConfigured,
} from '@/lib/payments/cashfree';

export const dynamic = 'force-dynamic';

function newGatewayOrderId(): string {
  return `upi_test_${randomBytes(5).toString('hex')}_${Date.now()}`.slice(0, 40);
}

/** Committee-only: create a live ₹1 Cashfree session for UPI/checkout smoke tests on this domain. */
export async function POST() {
  const me = await requireVerifiedAdmin();
  if (!me) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  if (!isCashfreeConfigured()) {
    return NextResponse.json(
      { error: 'Cashfree keys are not set on this deployment.' },
      { status: 503 }
    );
  }

  const base = appBaseUrl();
  const orderId = newGatewayOrderId();
  const created = await createCashfreeOrder({
    orderId,
    amountPaise: 100,
    customer: {
      id: me.id,
      name: me.full_name || 'Committee smoke test',
      email: me.email,
      phone: me.phone_number || '9999999999',
    },
    returnUrl: `${base}/admin/cashfree-smoke?cf_order_id=${encodeURIComponent(orderId)}`,
    notifyUrl: `${base}/api/payments/webhook`,
    tags: { smoke: 'admin_cashfree_upi' },
    note: 'Admin Cashfree UPI smoke INR 1',
  });

  if (!created.ok) {
    return NextResponse.json({ error: created.message }, { status: created.status || 502 });
  }

  return NextResponse.json({
    orderId: created.orderId,
    paymentSessionId: created.paymentSessionId,
    mode: cashfreePublicMode(),
  });
}