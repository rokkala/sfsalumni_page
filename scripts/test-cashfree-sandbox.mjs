#!/usr/bin/env node
/**
 * Live Cashfree PG sandbox smoke test (create order → fetch order).
 * Requires CASHFREE_CLIENT_ID + CASHFREE_CLIENT_SECRET in env or .env.local.
 *
 * Run: node scripts/test-cashfree-sandbox.mjs
 */
import { readFileSync, existsSync } from 'fs';
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
const mode = (process.env.CASHFREE_ENV || 'sandbox').trim() === 'production' ? 'production' : 'sandbox';
const base =
  mode === 'production' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg';

if (!clientId || !clientSecret || clientId.includes('...')) {
  console.error(
    'SKIP live test: set CASHFREE_CLIENT_ID and CASHFREE_CLIENT_SECRET in .env.local (Cashfree Dashboard → Developers → API Keys, sandbox).'
  );
  process.exit(2);
}

const orderId = `smoke_${crypto.randomBytes(6).toString('hex')}_${Date.now()}`.slice(0, 40);

async function pg(path, init) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-api-version': '2023-08-01',
      'x-client-id': clientId,
      'x-client-secret': clientSecret,
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  return { res, data };
}

console.log(`Cashfree smoke (${mode}): create order ${orderId} for ₹1.00`);

const created = await pg('/orders', {
  method: 'POST',
  body: JSON.stringify({
    order_id: orderId,
    order_amount: 1,
    order_currency: 'INR',
    customer_details: {
      customer_id: 'smoke_test_alumni',
      customer_name: 'Smoke Test',
      customer_email: 'smoke@test.local',
      customer_phone: '9999999999',
    },
    order_meta: {
      return_url: `${(process.env.NEXT_PUBLIC_APP_URL || 'https://www.sfsalumnis.com').replace(/\/$/, '')}/registration`,
      notify_url: `${(process.env.NEXT_PUBLIC_APP_URL || 'https://www.sfsalumnis.com').replace(/\/$/, '')}/api/payments/webhook`,
    },
    order_note: 'integration smoke test',
    order_tags: { smoke: '1' },
  }),
});

if (!created.res.ok) {
  console.error('FAIL create order', created.res.status, created.data);
  process.exit(1);
}

const paymentSessionId = created.data.payment_session_id;
if (!paymentSessionId) {
  console.error('FAIL: missing payment_session_id', created.data);
  process.exit(1);
}

console.log('OK create order');
console.log('  payment_session_id:', paymentSessionId);

const fetched = await pg(`/orders/${encodeURIComponent(orderId)}`, { method: 'GET' });
if (!fetched.res.ok) {
  console.error('FAIL fetch order', fetched.res.status, fetched.data);
  process.exit(1);
}

console.log('OK fetch order');
console.log('  order_status:', fetched.data.order_status);
console.log('\nNext: npm run dev, open /registration, Save then Pay online — use Cashfree sandbox test UPI/card.');
process.exit(0);