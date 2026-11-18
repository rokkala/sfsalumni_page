import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchCashfreeOrder, fetchCashfreePayments } from '@/lib/payments/cashfree';
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

  const mergeOrder = (orderId: string, patch: Partial<PortalCashfreeTxRow> & { created_at: string }) => {
    const key = orderId.trim();
    if (!key) return;
    const links = portal.get(key) || [];
    const acct = patch.customer_email
      ? { full_name: patch.customer_name || '', email: patch.customer_email }
      : null;
    const existing = byOrder.get(key);
    const row: PortalCashfreeTxRow = existing || {
      event_type: 'PORTAL',
      event_status: patch.event_status || '',
      event_time: patch.created_at,
      order_id: key,
      order_amount_inr: patch.order_amount_inr ?? null,
      payment_amount_inr: patch.payment_amount_inr ?? null,
      payment_utr: patch.payment_utr ?? null,
      payment_group: patch.payment_group ?? null,
      payment_time: patch.payment_time ?? patch.created_at,
      customer_name: acct?.full_name || patch.customer_name || links[0]?.member_name || null,
      customer_email: acct?.email || patch.customer_email || links[0]?.member_email || null,
      portal_links: links,
      in_portal: links.length > 0,
    };
    if (existing) {
      if (patch.event_status && !existing.event_status) row.event_status = patch.event_status;
      if (patch.payment_amount_inr != null) row.payment_amount_inr = patch.payment_amount_inr;
      if (patch.payment_utr) row.payment_utr = patch.payment_utr;
      if (patch.payment_group) row.payment_group = patch.payment_group;
      row.portal_links = links.length ? links : existing.portal_links;
      row.in_portal = row.portal_links.length > 0;
    }
    byOrder.set(key, row);
  };

  for (const d of (donations || []) as DonationRow[]) {
    const orderId = String(d.razorpay_order_id || '').trim();
    if (!orderId) continue;
    const acct = accountById.get(String(d.account_id));
    mergeOrder(orderId, {
      created_at: d.created_at,
      event_status: String(d.payment_status || '').toUpperCase() || 'PENDING',
      order_amount_inr: d.amount_paise / 100,
      payment_amount_inr: d.payment_status === 'paid' ? d.amount_paise / 100 : null,
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
      event_status: String(r.payment_status || '').toUpperCase() || 'PENDING',
      order_amount_inr: total / 100,
      payment_amount_inr: paid > 0 ? paid / 100 : null,
      customer_name: acct?.full_name || null,
      customer_email: acct?.email || null,
    });
  }

  const rows = [...byOrder.values()];

  if (options?.enrichLive) {
    const slice = rows.slice(0, 40);
    await Promise.all(
      slice.map(async (row) => {
        const order = await fetchCashfreeOrder(row.order_id);
        if (!order.ok) return;
        row.event_status = String(order.order.order_status || row.event_status).toUpperCase();
        row.order_amount_inr = order.order.order_amount ?? row.order_amount_inr;
        if (row.event_status === 'PAID') {
          const pays = await fetchCashfreePayments(row.order_id);
          if (pays.ok && pays.payments[0]) {
            row.payment_amount_inr = pays.payments[0].payment_amount;
            row.payment_group = pays.payments[0].payment_status;
          } else {
            row.payment_amount_inr = order.order.order_amount;
          }
        }
      })
    );
  }

  rows.sort((a, b) => String(b.event_time).localeCompare(String(a.event_time)));
  return rows;
}