import { isCashfreeConfigured } from '@/lib/payments/cashfree';
import { createAdminClient } from '@/lib/supabase-admin';

const ROW_ID = 'default';

const CHECKOUT_SETTINGS_MIGRATION = '20261115120000_payment_checkout_settings.sql';

function checkoutSettingsTableMissing(error: {
  code?: string;
  message?: string;
} | null): boolean {
  if (!error) return false;
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    /payment_checkout_settings/i.test(error.message || '') ||
    /schema cache/i.test(error.message || '')
  );
}

export type CheckoutSettingsRow = {
  online_checkout_enabled: boolean;
};

/** Missing table (migration not applied) => online checkout off. */
export async function loadCheckoutSettings(
  admin: ReturnType<typeof createAdminClient> = createAdminClient()
): Promise<CheckoutSettingsRow> {
  const { data, error } = await admin
    .from('payment_checkout_settings')
    .select('online_checkout_enabled')
    .eq('id', ROW_ID)
    .maybeSingle();

  if (error) {
    if (error.code === '42P01' || error.message?.includes('payment_checkout_settings')) {
      return { online_checkout_enabled: false };
    }
    console.error('loadCheckoutSettings', error);
    return { online_checkout_enabled: false };
  }

  return { online_checkout_enabled: Boolean(data?.online_checkout_enabled) };
}

/** Members may use Cashfree when the committee enabled it and server keys exist. */
export function memberOnlineCheckoutAvailable(settings: CheckoutSettingsRow): boolean {
  return settings.online_checkout_enabled && isCashfreeConfigured();
}

export async function setCheckoutSettingsEnabled(enabled: boolean): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const admin = createAdminClient();
  const { error } = await admin.from('payment_checkout_settings').upsert(
    {
      id: ROW_ID,
      online_checkout_enabled: enabled,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' }
  );
  if (error) {
    console.error('setCheckoutSettingsEnabled', error);
    if (checkoutSettingsTableMissing(error)) {
      return {
        ok: false,
        error: `payment_checkout_settings is not set up yet. Run migration ${CHECKOUT_SETTINGS_MIGRATION} in Supabase (see migrations/APPLY_ORDER.md).`,
      };
    }
    return { ok: false, error: 'Could not save checkout settings' };
  }
  return { ok: true };
}