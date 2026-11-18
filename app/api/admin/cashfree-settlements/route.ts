import { NextResponse } from 'next/server';
import { requireVerifiedAdmin } from '@/lib/auth/admin-guard';
import {
  cashfreeEnv,
  cashfreePublicMode,
  fetchCashfreeSettlementsRange,
  isCashfreeConfigured,
  type CashfreeSettlementBatch,
} from '@/lib/payments/cashfree';

export const dynamic = 'force-dynamic';

const MAX_RANGE_DAYS = 93;

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
  start.setUTCDate(start.getUTCDate() - 30);
  return { start, end };
}

function toRow(s: CashfreeSettlementBatch) {
  const fees =
    (Number(s.pg_service_charge) || 0) +
    (Number(s.pg_service_tax) || 0) +
    (Number(s.settlement_charge) || 0) +
    (Number(s.settlement_tax) || 0);
  return {
    cf_settlement_id: s.cf_settlement_id || null,
    status: s.status || '',
    status_description: s.status_description || null,
    settlement_utr: s.settlement_utr || null,
    payment_from: s.payment_from || null,
    payment_till: s.payment_till || null,
    settlement_initiated_on: s.settlement_initiated_on || null,
    settlement_processed_on: s.settlement_processed_on || null,
    payment_amount_inr: s.payment_amount ?? null,
    fees_inr: fees > 0 ? fees : null,
    adjustment_inr: s.adjustment ?? null,
    amount_settled_inr: s.amount_settled ?? null,
    settlement_type: s.settlement_type || null,
    order_id: s.order_id || null,
    payment_utr: s.payment_utr || null,
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
  if (rangeDays > MAX_RANGE_DAYS) {
    return NextResponse.json(
      { error: `Date range cannot exceed ${MAX_RANGE_DAYS} days` },
      { status: 400 }
    );
  }

  const result = await fetchCashfreeSettlementsRange(startIso(start), endIso(end));
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: result.status || 502 });
  }

  const rows = result.settlements.map(toRow);
  rows.sort((a, b) =>
    String(b.settlement_initiated_on || b.payment_till || '').localeCompare(
      String(a.settlement_initiated_on || a.payment_till || '')
    )
  );

  const totalSettled = rows.reduce((sum, r) => sum + (Number(r.amount_settled_inr) || 0), 0);

  return NextResponse.json({
    mode: cashfreePublicMode(),
    env: cashfreeEnv(),
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
    count: rows.length,
    total_settled_inr: Math.round(totalSettled * 100) / 100,
    rows,
  });
}