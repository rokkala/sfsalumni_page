import crypto from 'crypto';

const API_VERSION = '2023-08-01';

function envCred(name: string): string {
  let v = process.env[name]?.trim() || '';
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1).trim();
  }
  return v;
}

export function cashfreeEnv(): 'sandbox' | 'production' {
  const mode = (
    process.env.CASHFREE_ENV ||
    process.env.NEXT_PUBLIC_CASHFREE_MODE ||
    'sandbox'
  ).trim();
  return mode === 'production' ? 'production' : 'sandbox';
}

function pgBaseUrl(): string {
  return cashfreeEnv() === 'production'
    ? 'https://api.cashfree.com/pg'
    : 'https://sandbox.cashfree.com/pg';
}

export function isCashfreeConfigured(): boolean {
  const id = envCred('CASHFREE_CLIENT_ID');
  const secret = envCred('CASHFREE_CLIENT_SECRET');
  return Boolean(id && secret && !id.includes('...') && !secret.includes('...'));
}

export function cashfreePublicMode(): 'sandbox' | 'production' {
  return cashfreeEnv();
}

type CfJson = Record<string, unknown>;

async function cfRequest<T extends CfJson>(
  path: string,
  init: RequestInit & { body?: string }
): Promise<{ ok: true; data: T } | { ok: false; status: number; message: string }> {
  const clientId = envCred('CASHFREE_CLIENT_ID');
  const clientSecret = envCred('CASHFREE_CLIENT_SECRET');
  const res = await fetch(`${pgBaseUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-api-version': API_VERSION,
      'x-client-id': clientId,
      'x-client-secret': clientSecret,
      ...(init.headers || {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      message: String(data.message || res.statusText || 'Cashfree request failed'),
    };
  }
  return { ok: true, data };
}

export async function createCashfreeOrder(input: {
  orderId: string;
  amountPaise: number;
  customer: { id: string; name: string; email: string; phone: string };
  returnUrl: string;
  notifyUrl: string;
  tags: Record<string, string>;
  note?: string;
}): Promise<
  | { ok: true; orderId: string; paymentSessionId: string }
  | { ok: false; status: number; message: string }
> {
  const phoneDigits = input.customer.phone.replace(/\D/g, '');
  const customerPhone =
    phoneDigits.length >= 10 ? phoneDigits.slice(-10) : phoneDigits || '9999999999';

  const body = JSON.stringify({
    order_id: input.orderId,
    order_amount: input.amountPaise / 100,
    order_currency: 'INR',
    customer_details: {
      customer_id: input.customer.id.replace(/-/g, '').slice(0, 40),
      customer_name: input.customer.name.slice(0, 100),
      customer_email: input.customer.email.slice(0, 100),
      customer_phone: customerPhone,
    },
    order_meta: {
      return_url: input.returnUrl,
      notify_url: input.notifyUrl,
    },
    order_note: input.note?.slice(0, 200),
    order_tags: input.tags,
  });

  const result = await cfRequest<{
    order_id?: string;
    payment_session_id?: string;
  }>('/orders', { method: 'POST', body });

  if (!result.ok) return result;
  const orderId = String(result.data.order_id || input.orderId);
  const paymentSessionId = String(result.data.payment_session_id || '');
  if (!paymentSessionId) {
    return { ok: false, status: 502, message: 'Cashfree did not return a payment session' };
  }
  return { ok: true, orderId, paymentSessionId };
}

export type CashfreeOrderEntity = {
  order_id: string;
  order_status: string;
  order_amount: number;
  order_tags?: Record<string, string> | null;
};

export async function fetchCashfreeOrder(
  orderId: string
): Promise<
  { ok: true; order: CashfreeOrderEntity } | { ok: false; status: number; message: string }
> {
  const result = await cfRequest<CashfreeOrderEntity>(`/orders/${encodeURIComponent(orderId)}`, {
    method: 'GET',
  });
  if (!result.ok) return result;
  return { ok: true, order: result.data };
}

export type CashfreePaymentEntity = {
  cf_payment_id: string;
  payment_status: string;
  payment_amount: number;
  order_id: string;
};

export async function fetchCashfreePayments(orderId: string): Promise<
  | { ok: true; payments: CashfreePaymentEntity[] }
  | { ok: false; status: number; message: string }
> {
  const result = await cfRequest<{ payments?: CashfreePaymentEntity[] }>(
    `/orders/${encodeURIComponent(orderId)}/payments`,
    { method: 'GET' }
  );
  if (!result.ok) return result;
  const payments = Array.isArray(result.data.payments) ? result.data.payments : [];
  return { ok: true, payments };
}

/** Amount captured for a paid order, in paise (from Cashfree rupee amounts). */
export async function cashfreeCapturedAmountPaise(orderId: string): Promise<
  | { ok: true; paymentId: string; amountPaise: number }
  | { ok: false; status: number; message: string }
> {
  const orderResult = await fetchCashfreeOrder(orderId);
  if (!orderResult.ok) return orderResult;
  const status = String(orderResult.order.order_status || '').toUpperCase();
  if (status !== 'PAID') {
    return { ok: false, status: 409, message: 'Payment is not completed yet' };
  }

  const payResult = await fetchCashfreePayments(orderId);
  if (!payResult.ok) return payResult;

  const success = payResult.payments.find((p) => {
    const ps = String(p.payment_status || '').toUpperCase();
    return ps === 'SUCCESS' || ps === 'PAID';
  });
  if (success) {
    const rupees = Number(success.payment_amount);
    const amountPaise = Math.round(rupees * 100);
    if (!Number.isFinite(amountPaise) || amountPaise <= 0) {
      return { ok: false, status: 502, message: 'Invalid payment amount from Cashfree' };
    }
    return { ok: true, paymentId: success.cf_payment_id, amountPaise };
  }

  const rupees = Number(orderResult.order.order_amount);
  const amountPaise = Math.round(rupees * 100);
  if (status === 'PAID' && amountPaise > 0) {
    return { ok: true, paymentId: `order_${orderId}`, amountPaise };
  }
  return { ok: false, status: 409, message: 'No successful payment found for this order' };
}

export function verifyCashfreeWebhookSignature(
  rawBody: string,
  signature: string,
  timestamp: string
): boolean {
  const secret = envCred('CASHFREE_CLIENT_SECRET');
  if (!secret || !signature || !timestamp) return false;
  const signedPayload = `${timestamp}${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

export function appBaseUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return vercel.startsWith('http') ? vercel.replace(/\/$/, '') : `https://${vercel}`;
  return 'http://localhost:3000';
}