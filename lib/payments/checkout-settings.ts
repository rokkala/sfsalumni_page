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
  /** When false, hide bank statement upload + block its API (committee rollback). */
  bank_statement_reconcile_enabled: boolean;
};

/** Missing table (migration not applied) => online checkout off. */
export async function loadCheckoutSettings(
  admin: ReturnType<typeof createAdminClient> = createAdminClient()
): Promise<CheckoutSettingsRow> {
  const { data, error } = await admin
    .from('payment_checkout_settings')
    .select('online_checkout_enabled, bank_statement_reconcile_enabled')
    .eq('id', ROW_ID)
    .maybeSingle();

  if (error) {
    if (error.code === '42P01' || error.message?.includes('payment_checkout_settings')) {
      return { online_checkout_enabled: false, bank_statement_reconcile_enabled: false };
    }
    if (/bank_statement_reconcile_enabled/i.test(error.message || '')) {
      const legacy = await admin
        .from('payment_checkout_settings')
        .select('online_checkout_enabled')
        .eq('id', ROW_ID)
        .maybeSingle();
      return {
        online_checkout_enabled: Boolean(legacy.data?.online_checkout_enabled),
        bank_statement_reconcile_enabled: true,
      };
    }
    console.error('loadCheckoutSettings', error);
    return { online_checkout_enabled: false, bank_statement_reconcile_enabled: false };
  }

  return {
    online_checkout_enabled: Boolean(data?.online_checkout_enabled),
    bank_statement_reconcile_enabled:
      data?.bank_statement_reconcile_enabled === undefined
        ? true
        : Boolean(data.bank_statement_reconcile_enabled),
  };
}

/** Members may use Cashfree when the committee enabled it and server keys exist. */
export function memberOnlineCheckoutAvailable(settings: CheckoutSettingsRow): boolean {
  return settings.online_checkout_enabled && isCashfreeConfigured();
}

export async function setCheckoutSettingsEnabled(enabled: boolean): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const admin = createAdminClient();
  const existing = await loadCheckoutSettings(admin);
  const { error } = await admin.from('payment_checkout_settings').upsert(
    {
      id: ROW_ID,
      online_checkout_enabled: enabled,
      bank_statement_reconcile_enabled: existing.bank_statement_reconcile_enabled,
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

export async function setBankStatementReconcileEnabled(enabled: boolean): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const admin = createAdminClient();
  const existing = await loadCheckoutSettings(admin);
  const { error } = await admin.from('payment_checkout_settings').upsert(
    {
      id: ROW_ID,
      online_checkout_enabled: existing.online_checkout_enabled,
      bank_statement_reconcile_enabled: enabled,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' }
  );
  if (error) {
    console.error('setBankStatementReconcileEnabled', error);
    if (checkoutSettingsTableMissing(error)) {
      return {
        ok: false,
        error: `payment_checkout_settings is not set up yet. Run migration ${CHECKOUT_SETTINGS_MIGRATION} in Supabase (see migrations/APPLY_ORDER.md).`,
      };
    }
    if (/bank_statement_reconcile_enabled/i.test(error.message || '')) {
      return {
        ok: false,
        error:
          'Bank statement toggle is not in the database yet. Run migration 20261120140000_bank_statement_reconcile_flag.sql in Supabase, or set BANK_STATEMENT_RECONCILE_ENABLED=false in Vercel for an env-only rollback.',
      };
    }
    return { ok: false, error: 'Could not save bank statement settings' };
  }
  return { ok: true };
}