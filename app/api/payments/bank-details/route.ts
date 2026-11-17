import { NextResponse } from 'next/server';
import {
  loadCheckoutSettings,
  memberOnlineCheckoutAvailable,
} from '@/lib/payments/checkout-settings';
import { buildUpiQuotaSnapshot } from '@/lib/payments/upi-quota';
import { createAdminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

/** Public: active offline bank / UPI account + whether online checkout is offered. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const amountRaw = url.searchParams.get('amountPaise');
  const amountPaise = amountRaw != null ? Math.floor(Number(amountRaw) || 0) : 0;

  const admin = createAdminClient();
  const [{ data, error }, settings, upi] = await Promise.all([
    admin
      .from('payment_accounts')
      .select('id,label,account_name,account_number,ifsc,bank_name,upi_id')
      .eq('active', true)
      .maybeSingle(),
    loadCheckoutSettings(admin),
    amountPaise > 0 ? buildUpiQuotaSnapshot(admin, amountPaise) : null,
  ]);

  if (error) {
    console.error('bank-details', error);
    return NextResponse.json({ error: 'Could not load bank details' }, { status: 500 });
  }

  return NextResponse.json({
    account: data || null,
    online_checkout_available: memberOnlineCheckoutAvailable(settings),
    upi: upi ?? undefined,
  });
}
