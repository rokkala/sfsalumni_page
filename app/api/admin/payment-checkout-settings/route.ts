import { NextResponse } from 'next/server';
import { requireVerifiedAdmin } from '@/lib/auth/admin-guard';
import { isCashfreeConfigured } from '@/lib/payments/cashfree';
import {
  loadCheckoutSettings,
  setCheckoutSettingsEnabled,
} from '@/lib/payments/checkout-settings';

export const dynamic = 'force-dynamic';

export async function GET() {
  const me = await requireVerifiedAdmin();
  if (!me) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const settings = await loadCheckoutSettings();
  return NextResponse.json({
    online_checkout_enabled: settings.online_checkout_enabled,
    cashfree_configured: isCashfreeConfigured(),
  });
}

export async function PATCH(request: Request) {
  const me = await requireVerifiedAdmin();
  if (!me) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  if (typeof body.online_checkout_enabled !== 'boolean') {
    return NextResponse.json(
      { error: 'online_checkout_enabled must be a boolean' },
      { status: 400 }
    );
  }

  if (body.online_checkout_enabled && !isCashfreeConfigured()) {
    return NextResponse.json(
      {
        error:
          'Cashfree API keys are not set on the server (CASHFREE_CLIENT_ID / CASHFREE_CLIENT_SECRET). Add them in Vercel first.',
      },
      { status: 400 }
    );
  }

  const saved = await setCheckoutSettingsEnabled(body.online_checkout_enabled);
  if (!saved.ok) {
    return NextResponse.json({ error: saved.error }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    online_checkout_enabled: body.online_checkout_enabled,
    cashfree_configured: isCashfreeConfigured(),
  });
}