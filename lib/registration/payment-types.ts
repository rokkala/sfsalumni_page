// lib/registration/payment-types.ts
// API response shapes and the checkout-order guard for the payment flow.

export interface SaveRegistrationResponse {
    error?: string;
    id?: string;
    amount_paid_paise?: number;
    amount_due_paise?: number;
    total_cost_paise?: number;
    payment_status?: string;
}

/** Raw body of POST /api/payments/create-order. */
export interface OrderApiResponse {
    error?: string;
    configured?: boolean;
    skipCheckout?: boolean;
    orderId?: string;
    paymentSessionId?: string;
    checkoutMode?: 'sandbox' | 'production';
    amount?: number;
    currency?: string;
    registration_code?: string | null;
    amount_paid_paise?: number;
}

export interface VerifyResponse {
    error?: string;
    amount_paid_paise?: number;
    amount_due_paise?: number;
    donation_due_paise?: number;
    payment_status?: string;
    registration_code?: string | null;
    registration?: Record<string, unknown> | null;
}

/** Fully validated order handed to Cashfree Checkout. */
export interface CheckoutOrderPayload {
    orderId: string;
    paymentSessionId: string;
    mode: 'sandbox' | 'production';
    description?: string;
}

/**
 * Turns a raw order response into a checkout payload. Returns null when
 * required fields are missing, so Cashfree is never opened with incomplete data.
 */
export function toCheckoutOrder(
    response: OrderApiResponse,
    _fallback?: { name: string; email: string; contact: string }
): CheckoutOrderPayload | null {
    if (!response.orderId || !response.paymentSessionId) return null;
    return {
        orderId: response.orderId,
        paymentSessionId: response.paymentSessionId,
        mode: response.checkoutMode === 'production' ? 'production' : 'sandbox',
        description: 'Event registration',
    };
}