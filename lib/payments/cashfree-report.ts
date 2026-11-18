import type { CashfreeOrderEntity, CashfreePaymentEntity } from '@/lib/payments/cashfree';

export function combinePortalPaymentStatus(statuses: string[]): string {
  const s = statuses.map((x) => String(x || '').trim().toLowerCase()).filter(Boolean);
  if (s.length === 0) return '';
  if (s.every((x) => x === 'paid')) return 'paid';
  if (s.some((x) => x === 'failed')) return 'failed';
  if (s.some((x) => x === 'partial')) return 'partial';
  if (s.some((x) => x === 'pending')) return 'pending';
  if (s.some((x) => x === 'cancelled')) return 'cancelled';
  return s[0];
}

/** Latest payment attempt for admin report (by completion time). */
export function pickPaymentForReport(payments: CashfreePaymentEntity[]): CashfreePaymentEntity | null {
  if (!payments.length) return null;
  const sorted = [...payments].sort((a, b) => {
    const ta = Date.parse(a.payment_completion_time || '') || 0;
    const tb = Date.parse(b.payment_completion_time || '') || 0;
    return tb - ta;
  });
  return sorted[0];
}

export function paymentUtrFromEntity(payment: CashfreePaymentEntity | null): string | null {
  if (!payment) return null;
  const bank = String(payment.bank_reference || '').trim();
  if (bank) return bank;
  const auth = String(payment.auth_id || '').trim();
  if (auth) return auth;
  const cf = String(payment.cf_payment_id || '').trim();
  return cf || null;
}

export function formatPaymentGroup(group: string | null | undefined): string | null {
  const raw = String(group || '').trim();
  if (!raw) return null;
  if (raw.toLowerCase() === 'upi') return 'UPI';
  return raw
    .split('_')
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}

/** Committee-facing status: payment attempt, portal ledger, then Cashfree order state. */
export function resolveCashfreeReportStatus(input: {
  portalStatus: string;
  order: CashfreeOrderEntity | null;
  payment: CashfreePaymentEntity | null;
}): { status: string; eventType: string } {
  const payStatus = String(input.payment?.payment_status || '').trim().toUpperCase();
  if (payStatus) {
    if (payStatus === 'SUCCESS') return { status: 'PAID', eventType: 'PAYMENT' };
    if (payStatus === 'FAILED' || payStatus === 'FAILED_DECLINED' || payStatus === 'CANCELLED') {
      return { status: 'FAILED', eventType: 'PAYMENT' };
    }
    if (payStatus === 'USER_DROPPED' || payStatus === 'NOT_ATTEMPTED') {
      return { status: 'UNPAID', eventType: 'PAYMENT' };
    }
    if (payStatus === 'PENDING' || payStatus === 'PENDING_CONFIRMATION') {
      return { status: 'PAYMENT_PENDING', eventType: 'PAYMENT' };
    }
    return { status: payStatus.replace(/_/g, ' '), eventType: 'PAYMENT' };
  }

  const orderStatus = String(input.order?.order_status || '').trim().toUpperCase();
  if (orderStatus === 'PAID') return { status: 'PAID', eventType: 'PAYMENT' };
  if (orderStatus === 'EXPIRED') return { status: 'EXPIRED', eventType: 'ORDER' };

  const portal = String(input.portalStatus || '').trim().toLowerCase();
  if (portal === 'paid') return { status: 'PAID', eventType: 'PORTAL' };
  if (portal === 'failed') return { status: 'FAILED', eventType: 'PORTAL' };
  if (portal === 'partial') return { status: 'PARTIAL', eventType: 'PORTAL' };
  if (portal === 'pending') return { status: 'UNPAID', eventType: 'PORTAL' };
  if (portal === 'cancelled') return { status: 'CANCELLED', eventType: 'PORTAL' };

  if (orderStatus === 'ACTIVE') return { status: 'UNPAID', eventType: 'ORDER' };
  if (portal) return { status: portal.toUpperCase(), eventType: 'PORTAL' };
  if (orderStatus) return { status: orderStatus, eventType: 'ORDER' };
  return { status: 'UNKNOWN', eventType: 'PORTAL' };
}