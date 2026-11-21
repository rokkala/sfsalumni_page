import {
  loadCheckoutSettings,
  memberOnlineCheckoutAvailable,
} from '@/lib/payments/checkout-settings';
import type { BankAccountPublic } from '@/lib/payments/bank-details';
import { createAdminClient } from '@/lib/supabase-admin';

type AdminClient = ReturnType<typeof createAdminClient>;

export async function loadMemberBankDetails(
  admin: AdminClient = createAdminClient()
): Promise<{ account: BankAccountPublic | null; online_checkout_available: boolean }> {
  const [{ data, error }, settings] = await Promise.all([
    admin
      .from('payment_accounts')
      .select('id,label,account_name,account_number,ifsc,bank_name,upi_id')
      .eq('active', true)
      .maybeSingle(),
    loadCheckoutSettings(admin),
  ]);
  if (error) {
    console.error('bank-details', error);
    return { account: null, online_checkout_available: false };
  }
  return {
    account: (data as BankAccountPublic | null) || null,
    online_checkout_available: memberOnlineCheckoutAvailable(settings),
  };
}