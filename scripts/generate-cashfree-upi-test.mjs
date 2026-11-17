#!/usr/bin/env node
/**
 * Creates a live ₹1 Cashfree order and writes a local HTML page that opens Checkout (choose UPI).
 * Run: node scripts/generate-cashfree-upi-test.mjs
 * Production Cashfree blocks localhost in Checkout unless you whitelist it in the merchant dashboard.
 * Prefer: log in as committee admin → /admin/cashfree-smoke on https://www.sfsalumnis.com
 *
 * Optional local HTML (sandbox or whitelisted localhost only):
 *   npx --yes serve local-pay-test -p 8765
 */
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import crypto from 'crypto';

const root = process.cwd();
const envPath = join(root, '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 1) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

const clientId = process.env.CASHFREE_CLIENT_ID?.trim() || '';
const clientSecret = process.env.CASHFREE_CLIENT_SECRET?.trim() || '';
const mode =
  (process.env.CASHFREE_ENV || process.env.NEXT_PUBLIC_CASHFREE_MODE || 'sandbox').trim() ===
  'production'
    ? 'production'
    : 'sandbox';
const base =
  mode === 'production' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg';
const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://www.sfsalumnis.com').replace(/\/$/, '');

if (!clientId || !clientSecret) {
  console.error('Set CASHFREE_CLIENT_ID and CASHFREE_CLIENT_SECRET in .env.local');
  process.exit(2);
}

const orderId = `upi_test_${crypto.randomBytes(5).toString('hex')}_${Date.now()}`.slice(0, 40);

const body = JSON.stringify({
  order_id: orderId,
  order_amount: 1,
  order_currency: 'INR',
  customer_details: {
    customer_id: 'upi_test_alumni',
    customer_name: 'UPI Test Alumni',
    customer_email: 'upi-test@sfsshanthinagar.edu',
    customer_phone: '9999999999',
  },
  order_meta: {
    return_url: `${appUrl}/registration?cf_test=1&cf_order_id=${encodeURIComponent(orderId)}`,
    notify_url: `${appUrl}/api/payments/webhook`,
  },
  order_note: 'Cashfree UPI test INR 1',
  order_tags: { smoke: 'cashfree_upi_test' },
});

const res = await fetch(`${base}/orders`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-version': '2023-08-01',
    'x-client-id': clientId,
    'x-client-secret': clientSecret,
  },
  body,
});
const data = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error('Create order failed', res.status, data);
  process.exit(1);
}

const paymentSessionId = String(data.payment_session_id || '');
if (!paymentSessionId) {
  console.error('No payment_session_id', data);
  process.exit(1);
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Cashfree UPI test — ₹1</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 28rem; margin: 2rem auto; padding: 0 1rem; }
    .warn { background: #fef3c7; border: 1px solid #d97706; padding: 0.75rem; border-radius: 8px; font-size: 14px; }
    button { width: 100%; margin-top: 1rem; padding: 0.85rem; font-size: 16px; font-weight: 700;
      border: none; border-radius: 8px; background: #1e3a5f; color: #fff; cursor: pointer; }
    button:disabled { opacity: 0.5; }
    p.muted { color: #555; font-size: 14px; }
  </style>
</head>
<body>
  <h1>Cashfree UPI — ₹1</h1>
  <p class="warn"><strong>Live production.</strong> Cashfree Checkout on <code>localhost</code> is blocked unless whitelisted.
    Use <strong>Admin → Payment accounts → Test ₹1 Cashfree UPI</strong> on your live site instead.</p>
  <p class="warn">If you still use this page: real ₹1 charge — pick <strong>UPI</strong> in checkout.</p>
  <p class="muted">Order: <code>${orderId}</code><br/>Mode: <code>${mode}</code></p>
  <button type="button" id="open">Open Cashfree checkout</button>
  <p id="status" class="muted"></p>
  <script src="https://sdk.cashfree.com/js/v3/cashfree.js"></script>
  <script>
    const paymentSessionId = ${JSON.stringify(paymentSessionId)};
    const mode = ${JSON.stringify(mode)};
    document.getElementById('open').addEventListener('click', async () => {
      const btn = document.getElementById('open');
      const st = document.getElementById('status');
      btn.disabled = true;
      try {
        const cashfree = Cashfree({ mode });
        const result = await cashfree.checkout({
          paymentSessionId,
          redirectTarget: '_modal',
        });
        if (result && result.error) {
          st.textContent = result.error.message || 'Checkout error';
        } else {
          st.textContent = 'Checkout closed. Check your UPI app or Cashfree return URL.';
        }
      } catch (e) {
        st.textContent = String(e && e.message ? e.message : e);
      } finally {
        btn.disabled = false;
      }
    });
  </script>
</body>
</html>
`;

const outDir = join(root, 'local-pay-test');
writeFileSync(join(outDir, 'index.html'), html);
writeFileSync(join(outDir, 'cashfree-upi-test.html'), html);
console.log('OK order', orderId);
console.log('payment_session_id:', paymentSessionId.slice(0, 24) + '...');
console.log('');
console.log('Recommended (whitelisted domain):');
console.log(`  ${appUrl}/admin/cashfree-smoke`);
console.log('');
console.log('Local HTML only works if Cashfree whitelists localhost (prod usually does not):');
console.log('  npx --yes serve local-pay-test -p 8765');