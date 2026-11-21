import { NextResponse } from 'next/server';
import { loadMemberBankDetails } from '@/lib/payments/member-bank-details';
import { buildUpiQuotaSnapshot } from '@/lib/payments/upi-quota';
import { createAdminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

/** Public: active offline bank / UPI account + whether online checkout is offered. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const amountRaw = url.searchParams.get('amountPaise');
  const amountPaise = amountRaw != null ? Math.floor(Number(amountRaw) || 0) : 0;

  const admin = createAdminClient();
  const [bank, upi] = await Promise.all([
    loadMemberBankDetails(admin),
    amountPaise > 0 ? buildUpiQuotaSnapshot(admin, amountPaise) : null,
  ]);

  return NextResponse.json({
    account: bank.account,
    online_checkout_available: bank.online_checkout_available,
    upi: upi ?? undefined,
  });
}
