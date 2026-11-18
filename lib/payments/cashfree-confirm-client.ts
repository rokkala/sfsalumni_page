/** Browser helpers after Cashfree Checkout — server verify with short retry on PG lag. */

import type { VerifyResponse } from '@/lib/registration/payment-types';

export const CASHFREE_CHECKOUT_CANCELLED =
  'Payment was cancelled. You can use Pay online again when ready.';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const PENDING_VERIFY_MESSAGE =
  'Payment is still processing at Cashfree. Wait a minute, refresh this page, or contact the committee if money was debited.';

async function postJson<T>(url: string, body: Record<string, unknown>): Promise<{ status: number; data: T }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, data };
}

export async function confirmRegistrationCashfreePayment(input: {
  registrationId: string;
  orderId: string;
  maxAttempts?: number;
}): Promise<{ ok: true; verified: VerifyResponse } | { ok: false; message: string; pending?: boolean }> {
  const attempts = Math.max(1, Math.min(input.maxAttempts ?? 3, 5));
  let lastMessage = PENDING_VERIFY_MESSAGE;
  let sawPending = false;

  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(1200 * i);
    const { status, data } = await postJson<VerifyResponse>('/api/payments/verify', {
      registrationId: input.registrationId,
      order_id: input.orderId,
    });
    if (status >= 200 && status < 300) {
      return { ok: true, verified: data };
    }
    lastMessage =
      typeof data.error === 'string' && data.error.trim()
        ? data.error
        : 'Payment could not be confirmed. If money was debited, contact the committee.';
    if (status === 409) sawPending = true;
    else break;
  }

  return {
    ok: false,
    message: sawPending ? PENDING_VERIFY_MESSAGE : lastMessage,
    pending: sawPending,
  };
}

export async function confirmDonationCashfreePayment(input: {
  orderId: string;
  donationId?: string;
  maxAttempts?: number;
}): Promise<
  | { ok: true; amount_paise?: number; donationId?: string }
  | { ok: false; message: string; pending?: boolean }
> {
  const attempts = Math.max(1, Math.min(input.maxAttempts ?? 3, 5));
  let lastMessage = PENDING_VERIFY_MESSAGE;
  let sawPending = false;

  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(1200 * i);
    const { status, data } = await postJson<{
      error?: string;
      amount_paise?: number;
      donationId?: string;
    }>('/api/donations/verify', {
      ...(input.donationId ? { donationId: input.donationId } : {}),
      order_id: input.orderId,
    });
    if (status >= 200 && status < 300) {
      return {
        ok: true,
        amount_paise: data.amount_paise,
        donationId: data.donationId,
      };
    }
    lastMessage =
      typeof data.error === 'string' && data.error.trim()
        ? data.error
        : 'Payment could not be confirmed. If money was debited, contact the committee.';
    if (status === 409) sawPending = true;
    else break;
  }

  return {
    ok: false,
    message: sawPending ? PENDING_VERIFY_MESSAGE : lastMessage,
    pending: sawPending,
  };
}