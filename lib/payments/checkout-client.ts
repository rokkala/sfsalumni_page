/** Browser helpers for Cashfree Checkout (PG v2023-08-01). */

export type CheckoutOrder = {
  orderId: string;
  paymentSessionId: string;
  mode: 'sandbox' | 'production';
  description?: string | null;
};

export type CheckoutFailure = { failed: true; message: string };

export type CheckoutSuccess = {
  order_id: string;
};

export type OpenCheckoutResult = CheckoutSuccess | CheckoutFailure | null;

declare global {
  interface Window {
    Cashfree?: (opts: { mode: 'sandbox' | 'production' }) => {
      checkout: (opts: {
        paymentSessionId: string;
        redirectTarget?: '_self' | '_blank' | '_modal' | '_top';
      }) => Promise<{ error?: { message?: string } } | void>;
    };
  }
}

let scriptPromise: Promise<void> | null = null;

export function loadCashfreeScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.Cashfree) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-cashfree-checkout]');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Checkout script failed')));
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://sdk.cashfree.com/js/v3/cashfree.js';
    script.async = true;
    script.dataset.cashfreeCheckout = '1';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Checkout script failed'));
    document.body.appendChild(script);
  });
  return scriptPromise;
}

export async function openCashfreeCheckout(order: CheckoutOrder): Promise<OpenCheckoutResult> {
  await loadCashfreeScript();
  if (!window.Cashfree) throw new Error('Cashfree Checkout unavailable');

  const cashfree = window.Cashfree({ mode: order.mode });
  const result = await cashfree.checkout({
    paymentSessionId: order.paymentSessionId,
    redirectTarget: '_modal',
  });

  if (result && typeof result === 'object' && 'error' in result && result.error) {
    const message =
      result.error && typeof result.error === 'object' && 'message' in result.error
        ? String(result.error.message || '')
        : '';
    return { failed: true, message: message || 'Payment failed. Please try again.' };
  }

  return { order_id: order.orderId };
}