import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchCashfreeOrder, fetchCashfreePayments } from '@/lib/payments/cashfree';
import {
  combinePortalPaymentStatus,
  formatPaymentGroup,
  paymentUtrFromEntity,
  pickPaymentForReport,
  resolveCashfreeReportStatus,
} from '@/lib/payments/cashfree-report';
import type { PortalOrderLink } from '@/lib/admin/cashfree-portal-orders';

export type PortalCashfreeTxRow = {
  event_type: string;
  event_status: string;
  event_time: string;
  order_id: string;
  order_amount_inr: number | null;
  payment_amount_inr: number | null;
  payment_utr: string | null;
  payment_group: string | null;
  payment_time: string | null;
  customer_name: string | null;
  customer_email: string | null;
  portal_links: PortalOrderLink[];
  in_portal: boolean;
  portal_payment_status: string | null;
  payment_detail: string | null;
};

type DonationRow = {
  id: string;
  account_id: string;
  amount_paise: number;
  payment_status: string;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  created_at: string;
  cause_id: string | null;
};

type RegRow = {
  id: string;
  account_id: string;
  amount_paid_paise: number;
  total_cost_paise: number;
  payment_status: string;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  created_at: string;
  event_id: string;
};

const ENRICH_CONCURRENCY = 8;
/** ponytail: ceiling — raise if committees routinely export >200 checkout orders per month. */
const ENRICH_MAX_ORDERS = 200;

async function enrichRow(row: PortalCashfreeTxRow): Promise<void> {
  const portalStatus = row.portal_payment_status || '';
  const [orderRes, payRes] = await Promise.all([
    fetchCashfreeOrder(row.order_id),
    fetchCashfreePayments(row.order_id),
  ]);

  const order = orderRes.ok ? orderRes.order : null;
  const payments = payRes.ok ? payRes.payments : [];
  const payment = pickPaymentForReport(payments);

  const { status, eventType } = resolveCashfreeReportStatus({ portalStatus, order, payment });
  row.event_status = status;
  row.event_type = eventType;

  if (order?.order_amount != null) row.order_amount_inr = order.order_amount;

  if (payment) {
    row.payment_amount_inr = payment.payment_amount;
    row.payment_group = formatPaymentGroup(payment.payment_group);
    row.payment_utr = paymentUtrFromEntity(payment);
    if (payment.payment_completion_time) row.payment_time = payment.payment_completion_time;
    const msg = String(payment.payment_message || '').trim();
    row.payment_detail = msg || null;
  } else if (status === 'PAID') {
    row.payment_amount_inr = row.payment_amount_inr ?? order?.order_amount ?? null;
  }

  if (!row.payment_utr && payments.length === 0) {
    // No PG attempt yet — keep portal gateway id if captured at verify time.
  }
}

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
}

/** Portal rows with Cashfree order ids when PG /recon is unavailable. */
export async function loadPortalCashfreeTransactions(
  admin: SupabaseClient,
  startIso: string,
  endIso: string,
  portal: Map<string, PortalOrderLink[]>,
  options?: { enrichLive?: boolean }
): Promise<PortalCashfreeTxRow[]> {
  const [{ data: donations, error: dErr }, { data: regs, error: rErr }] = await Promise.all([
    admin
      .from('donations')
      .select(
        'id,account_id,amount_paise,payment_status,razorpay_order_id,razorpay_payment_id,created_at,cause_id'
      )
      .not('razorpay_order_id', 'is', null)
      .gte('created_at', startIso)
      .lte('created_at', endIso)
      .order('created_at', { ascending: false })
      .limit(500),
    admin
      .from('event_registrations')
      .select(
        'id,account_id,amount_paid_paise,total_cost_paise,payment_status,razorpay_order_id,razorpay_payment_id,created_at,event_id'
      )
      .not('razorpay_order_id', 'is', null)
      .gte('created_at', startIso)
      .lte('created_at', endIso)
      .order('created_at', { ascending: false })
      .limit(500),
  ]);
  if (dErr) console.error('portal cashfree txs donations', dErr);
  if (rErr) console.error('portal cashfree txs registrations', rErr);

  const accountIds = new Set<string>();
  for (const r of donations || []) accountIds.add(String(r.account_id));
  for (const r of regs || []) accountIds.add(String(r.account_id));

  const { data: accounts } = accountIds.size
    ? await admin.from('alumni_accounts').select('id,full_name,email').in('id', [...accountIds])
    : { data: [] as { id: string; full_name: string; email: string }[] };
  const accountById = new Map((accounts || []).map((a) => [String(a.id), a]));

  const byOrder = new Map<string, PortalCashfreeTxRow>();

  const mergeOrder = (
    orderId: string,
    patch: {
      created_at: string;
      portal_status: string;
      order_amount_inr: number | null;
      payment_amount_inr: number | null;
      gateway_payment_id: string | null;
      customer_name: string | null;
      customer_email: string | null;
    }
  ) => {
    const key = orderId.trim();
    if (!key) return;
    const links = portal.get(key) || [];
    const existing = byOrder.get(key);
    const portalStatuses = existing
      ? [existing.portal_payment_status || '', patch.portal_status].filter(Boolean)
      : [patch.portal_status].filter(Boolean);
    const portal_payment_status = combinePortalPaymentStatus(portalStatuses);

    const preliminary = resolveCashfreeReportStatus({
      portalStatus: portal_payment_status,
      order: null,
      payment: null,
    });
    const row: PortalCashfreeTxRow = existing || {
      event_type: preliminary.eventType,
      event_status: preliminary.status,
      event_time: patch.created_at,
      order_id: key,
      order_amount_inr: patch.order_amount_inr,
      payment_amount_inr: patch.payment_amount_inr,
      payment_utr: patch.gateway_payment_id,
      payment_group: null,
      payment_time: patch.created_at,
      customer_name: patch.customer_name || links[0]?.member_name || null,
      customer_email: patch.customer_email || links[0]?.member_email || null,
      portal_links: links,
      in_portal: links.length > 0,
      portal_payment_status,
      payment_detail: null,
    };

    if (existing) {
      row.portal_payment_status = portal_payment_status;
      row.order_amount_inr = Math.max(row.order_amount_inr || 0, patch.order_amount_inr || 0) || row.order_amount_inr;
      if (patch.payment_amount_inr != null) {
        row.payment_amount_inr = Math.max(row.payment_amount_inr || 0, patch.payment_amount_inr);
      }
      if (!row.payment_utr && patch.gateway_payment_id) row.payment_utr = patch.gateway_payment_id;
      if (patch.customer_name) row.customer_name = patch.customer_name;
      if (patch.customer_email) row.customer_email = patch.customer_email;
      row.portal_links = links.length ? links : existing.portal_links;
      row.in_portal = row.portal_links.length > 0;
      row.event_status = preliminary.status;
      row.event_type = preliminary.eventType;
    }
    byOrder.set(key, row);
  };

  for (const d of (donations || []) as DonationRow[]) {
    const orderId = String(d.razorpay_order_id || '').trim();
    if (!orderId) continue;
    const acct = accountById.get(String(d.account_id));
    mergeOrder(orderId, {
      created_at: d.created_at,
      portal_status: String(d.payment_status || 'pending'),
      order_amount_inr: d.amount_paise / 100,
      payment_amount_inr: d.payment_status === 'paid' ? d.amount_paise / 100 : null,
      gateway_payment_id: d.razorpay_payment_id,
      customer_name: acct?.full_name || null,
      customer_email: acct?.email || null,
    });
  }

  for (const r of (regs || []) as RegRow[]) {
    const orderId = String(r.razorpay_order_id || '').trim();
    if (!orderId) continue;
    const acct = accountById.get(String(r.account_id));
    const paid = Number(r.amount_paid_paise) || 0;
    const total = Number(r.total_cost_paise) || 0;
    mergeOrder(orderId, {
      created_at: r.created_at,
      portal_status: String(r.payment_status || 'pending'),
      order_amount_inr: total / 100,
      payment_amount_inr: paid > 0 ? paid / 100 : null,
      gateway_payment_id: r.razorpay_payment_id,
      customer_name: acct?.full_name || null,
      customer_email: acct?.email || null,
    });
  }

  const rows = [...byOrder.values()];

  if (options?.enrichLive) {
    const slice = rows.slice(0, ENRICH_MAX_ORDERS);
    await mapWithConcurrency(slice, ENRICH_CONCURRENCY, enrichRow);
  }

  rows.sort((a, b) => String(b.event_time).localeCompare(String(a.event_time)));
  return rows;
}