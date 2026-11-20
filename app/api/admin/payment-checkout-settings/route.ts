import { NextResponse } from 'next/server';
import { requireVerifiedAdmin } from '@/lib/auth/admin-guard';
import { bankStatementKilledByEnv } from '@/lib/admin/bank-statement-feature';
import { isCashfreeConfigured } from '@/lib/payments/cashfree';
import {
  loadCheckoutSettings,
  setBankStatementIncludeClosedLines,
  setBankStatementReconcileEnabled,
  setCheckoutSettingsEnabled,
} from '@/lib/payments/checkout-settings';

export const dynamic = 'force-dynamic';

export async function GET() {
  const me = await requireVerifiedAdmin();
  if (!me) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const settings = await loadCheckoutSettings();
  const env_kills_bank_statement = bankStatementKilledByEnv();
  return NextResponse.json({
    online_checkout_enabled: settings.online_checkout_enabled,
    bank_statement_reconcile_enabled: env_kills_bank_statement
      ? false
      : settings.bank_statement_reconcile_enabled,
    bank_statement_killed_by_env: env_kills_bank_statement,
    bank_statement_include_closed_lines: settings.bank_statement_include_closed_lines,
    cashfree_configured: isCashfreeConfigured(),
  });
}

export async function PATCH(request: Request) {
  const me = await requireVerifiedAdmin();
  if (!me) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const patchOnline = typeof body.online_checkout_enabled === 'boolean';
  const patchBank = typeof body.bank_statement_reconcile_enabled === 'boolean';
  const patchIncludeClosed = typeof body.bank_statement_include_closed_lines === 'boolean';
  if (!patchOnline && !patchBank && !patchIncludeClosed) {
    return NextResponse.json(
      {
        error:
          'Send online_checkout_enabled, bank_statement_reconcile_enabled, and/or bank_statement_include_closed_lines (boolean).',
      },
      { status: 400 }
    );
  }

  if (patchOnline && body.online_checkout_enabled && !isCashfreeConfigured()) {
    return NextResponse.json(
      {
        error:
          'Cashfree API keys are not set on the server (CASHFREE_CLIENT_ID / CASHFREE_CLIENT_SECRET). Add them in Vercel first.',
      },
      { status: 400 }
    );
  }

  if (patchOnline) {
    const saved = await setCheckoutSettingsEnabled(body.online_checkout_enabled);
    if (!saved.ok) {
      return NextResponse.json({ error: saved.error }, { status: 500 });
    }
  }

  if (patchBank) {
    const saved = await setBankStatementReconcileEnabled(body.bank_statement_reconcile_enabled);
    if (!saved.ok) {
      return NextResponse.json({ error: saved.error }, { status: 500 });
    }
  }

  if (patchIncludeClosed) {
    const saved = await setBankStatementIncludeClosedLines(body.bank_statement_include_closed_lines);
    if (!saved.ok) {
      return NextResponse.json({ error: saved.error }, { status: 500 });
    }
  }

  const settings = await loadCheckoutSettings();
  const env_kills_bank_statement = bankStatementKilledByEnv();

  return NextResponse.json({
    ok: true,
    online_checkout_enabled: settings.online_checkout_enabled,
    bank_statement_reconcile_enabled: env_kills_bank_statement
      ? false
      : settings.bank_statement_reconcile_enabled,
    bank_statement_killed_by_env: env_kills_bank_statement,
    bank_statement_include_closed_lines: settings.bank_statement_include_closed_lines,
    cashfree_configured: isCashfreeConfigured(),
  });
}