import { NextResponse } from 'next/server';
import { loadPortalCashfreeTransactions } from '@/lib/admin/cashfree-portal-transactions';
import { buildPortalOrderIndex, type PortalOrderLink } from '@/lib/admin/cashfree-portal-orders';
import { requireVerifiedAdmin } from '@/lib/auth/admin-guard';
import {
  cashfreeEnv,
  cashfreePublicMode,
  fetchCashfreeReconRange,
  isCashfreeConfigured,
  type CashfreeReconEvent,
} from '@/lib/payments/cashfree';
import { createAdminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

/** Cashfree /recon allows at most 30 days between start and end. */
const MAX_RECON_RANGE_DAYS = 30;
const PAYMENT_EVENT_TYPES = new Set(['PAYMENT', 'REFUND', 'REFUND_REVERSAL']);

function parseYmd(s: string | null): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function startIso(d: Date): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0)).toISOString();
}

function endIso(d: Date): string {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59)
  ).toISOString();
}

function defaultRange() {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 29);
  return { start, end };
}

function toRow(ev: CashfreeReconEvent, portal: Map<string, PortalOrderLink[]>) {
  const orderId = String(ev.order_id || '').trim();
  const portal_links = orderId ? portal.get(orderId) || [] : [];
  return {
    event_type: ev.event_type || '',
    event_status: ev.event_status || '',
    event_time: ev.event_time || '',
    order_id: orderId,
    order_amount_inr: ev.order_amount ?? null,
    payment_amount_inr: ev.payment_amount ?? null,
    payment_utr: ev.payment_utr || null,
    payment_group: ev.payment_group || null,
    payment_time: ev.payment_time || null,
    customer_name: ev.customer_name || null,
    customer_email: ev.customer_email || null,
    portal_links,
    in_portal: portal_links.length > 0,
  };
}

export async function GET(request: Request) {
  const me = await requireVerifiedAdmin();
  if (!me) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  if (!isCashfreeConfigured()) {
    return NextResponse.json(
      { error: 'Cashfree keys are not set on this deployment.' },
      { status: 503 }
    );
  }

  const url = new URL(request.url);
  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');
  const typesParam = url.searchParams.get('types') || 'payments';
  const onlyPortal = url.searchParams.get('portal') === '1';

  let start = parseYmd(fromParam);
  let end = parseYmd(toParam);
  if (!start || !end) {
    const def = defaultRange();
    start = def.start;
    end = def.end;
  }
  if (start.getTime() > end.getTime()) {
    return NextResponse.json({ error: 'from must be on or before to' }, { status: 400 });
  }
  const rangeDays = (end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
  if (rangeDays > MAX_RECON_RANGE_DAYS) {
    return NextResponse.json(
      {
        error: `Transactions from Cashfree reconciliation allow at most ${MAX_RECON_RANGE_DAYS} days. Pick a shorter range or use Settlements for a longer period.`,
      },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const portal = await buildPortalOrderIndex(admin);
  const startBound = startIso(start);
  const endBound = endIso(end);

  const recon = await fetchCashfreeReconRange(startBound, endBound);
  if (!recon.ok) {
    const portalRows = await loadPortalCashfreeTransactions(admin, startBound, endBound, portal, {
      enrichLive: true,
    });
    let rows = portalRows;
    if (onlyPortal) rows = rows.filter((r) => r.in_portal);
    return NextResponse.json({
      mode: cashfreePublicMode(),
      env: cashfreeEnv(),
      from: start.toISOString().slice(0, 10),
      to: end.toISOString().slice(0, 10),
      count: rows.length,
      rows,
      source: 'portal',
      notice:
        `Cashfree reconciliation API is unavailable (${recon.message}). Showing portal online checkout orders with live order status where possible.`,
    });
  }

  let events = recon.events;
  if (typesParam === 'payments') {
    events = events.filter((e) => PAYMENT_EVENT_TYPES.has(String(e.event_type || '').toUpperCase()));
  }

  let rows = events.map((ev) => toRow(ev, portal));
  if (onlyPortal) {
    rows = rows.filter((r) => r.in_portal);
  }
  rows.sort((a, b) => String(b.event_time).localeCompare(String(a.event_time)));

  return NextResponse.json({
    mode: cashfreePublicMode(),
    env: cashfreeEnv(),
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
    count: rows.length,
    rows,
    source: 'cashfree_recon',
  });
}