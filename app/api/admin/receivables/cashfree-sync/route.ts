import { NextResponse } from 'next/server';
import { syncCashfreeReceivableLine } from '@/lib/admin/reconcile-cashfree';
import { requireVerifiedAdmin } from '@/lib/auth/admin-guard';
import { isCashfreeConfigured } from '@/lib/payments/cashfree';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const me = await requireVerifiedAdmin();
  if (!me) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  if (!isCashfreeConfigured()) {
    return NextResponse.json({ error: 'Cashfree is not configured' }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as { line_key?: string };
  const lineKey = String(body.line_key || '').trim();
  if (!lineKey) {
    return NextResponse.json({ error: 'line_key is required' }, { status: 400 });
  }

  const outcome = await syncCashfreeReceivableLine(lineKey);
  if (outcome === 'matched') {
    return NextResponse.json({ ok: true, outcome: 'matched' });
  }
  if (outcome === 'pending') {
    return NextResponse.json({
      ok: false,
      outcome: 'pending',
      error: 'Cashfree order is not paid yet.',
    });
  }
  if (outcome === 'skip') {
    return NextResponse.json({
      ok: false,
      outcome: 'skip',
      error: 'No Cashfree order linked to this line.',
    });
  }
  return NextResponse.json({
    ok: false,
    outcome: 'error',
    error: 'Could not apply Cashfree payment to this line.',
  });
}