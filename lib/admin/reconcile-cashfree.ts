import { parseReceivableLineKey, type ReceivableLine } from '@/lib/admin/receivable-lines';
import { applyDonationPayment } from '@/lib/donations/mark-paid';
import { applyGatewayPayment, applyRegistrationDonationPayment } from '@/lib/events/mark-paid';
import { cashfreeCapturedAmountPaise, isCashfreeConfigured } from '@/lib/payments/cashfree';
import { createAdminClient } from '@/lib/supabase-admin';

export type CashfreeSyncResult = {
  attempted: number;
  matched: number;
  pending: number;
  errors: string[];
};

export type CashfreeLineSync = 'matched' | 'pending' | 'error' | 'skip';

/** Confirms a paid Cashfree order with PG and applies it to one receivable line. */
export async function syncCashfreeReceivableLine(lineKey: string): Promise<CashfreeLineSync> {
  const parsed = parseReceivableLineKey(lineKey);
  if (!parsed) return 'skip';

  const admin = createAdminClient();

  if (parsed.kind === 'fee') {
    const { data: reg } = await admin
      .from('event_registrations')
      .select('id,razorpay_order_id')
      .eq('id', parsed.id)
      .maybeSingle();
    const orderId = String(reg?.razorpay_order_id || '').trim();
    if (!orderId) return 'skip';

    const captured = await cashfreeCapturedAmountPaise(orderId);
    if (!captured.ok) {
      if (captured.status === 409) return 'pending';
      return 'error';
    }

    const applied = await applyGatewayPayment({
      registrationId: parsed.id,
      orderId,
      paymentId: captured.paymentId,
      signature: null,
      amountPaise: captured.amountPaise,
    });
    return applied.ok ? 'matched' : 'error';
  }

  const { data: donation } = await admin
    .from('donations')
    .select('id,razorpay_order_id')
    .eq('id', parsed.id)
    .maybeSingle();

  let orderId = String(donation?.razorpay_order_id || '').trim();
  if (!orderId) {
    const { data: reg } = await admin
      .from('event_registrations')
      .select('id,razorpay_order_id')
      .eq('donation_id', parsed.id)
      .maybeSingle();
    orderId = String(reg?.razorpay_order_id || '').trim();
    if (!orderId || !reg?.id) return 'skip';

    const captured = await cashfreeCapturedAmountPaise(orderId);
    if (!captured.ok) {
      if (captured.status === 409) return 'pending';
      return 'error';
    }

    const applied = await applyGatewayPayment({
      registrationId: String(reg.id),
      orderId,
      paymentId: captured.paymentId,
      signature: null,
      amountPaise: captured.amountPaise,
    });
    return applied.ok ? 'matched' : 'error';
  }

  const captured = await cashfreeCapturedAmountPaise(orderId);
  if (!captured.ok) {
    if (captured.status === 409) return 'pending';
    return 'error';
  }

  const applied = await applyDonationPayment({
    donationId: parsed.id,
    razorpay: {
      order_id: orderId,
      payment_id: captured.paymentId,
      signature: null,
    },
  });
  if (!applied.ok) return 'error';

  await applyRegistrationDonationPayment({ donationId: parsed.id });
  return 'matched';
}

/** ponytail: caps Cashfree API calls per refresh — raise if open-order volume grows. */
export async function syncOpenCashfreeFromLines(
  lines: ReceivableLine[],
  limit = 30
): Promise<CashfreeSyncResult> {
  const empty: CashfreeSyncResult = { attempted: 0, matched: 0, pending: 0, errors: [] };
  if (!isCashfreeConfigured()) return empty;

  const orderToLine = new Map<string, string>();
  for (const line of lines) {
    if (line.due_paise < 1 || line.proof_id) continue;
    const oid = String(line.cashfree_order_id || '').trim();
    if (!oid) continue;
    const existing = orderToLine.get(oid);
    if (!existing || line.kind === 'registration_fee') {
      orderToLine.set(oid, line.line_key);
    }
  }

  const result = { ...empty };
  for (const lineKey of [...orderToLine.values()].slice(0, limit)) {
    result.attempted += 1;
    const outcome = await syncCashfreeReceivableLine(lineKey);
    if (outcome === 'matched') result.matched += 1;
    else if (outcome === 'pending') result.pending += 1;
    else if (outcome === 'error') result.errors.push(lineKey);
  }
  return result;
}