import { loadCheckoutSettings } from '@/lib/payments/checkout-settings';

/** Vercel env kill switch — set BANK_STATEMENT_RECONCILE_ENABLED=false without redeploying code. */
export function bankStatementKilledByEnv(): boolean {
  const v = String(process.env.BANK_STATEMENT_RECONCILE_ENABLED ?? '').trim().toLowerCase();
  return v === '0' || v === 'false' || v === 'off' || v === 'no';
}

export async function isBankStatementReconcileEnabled(): Promise<boolean> {
  if (bankStatementKilledByEnv()) return false;
  const settings = await loadCheckoutSettings();
  return settings.bank_statement_reconcile_enabled;
}