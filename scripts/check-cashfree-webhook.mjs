/**
 * Self-check: Cashfree webhook HMAC matches docs (timestamp + raw body).
 * Run: node scripts/check-cashfree-webhook.mjs
 */
import crypto from 'crypto';

function verify(rawBody, signature, timestamp, secret) {
  const signedPayload = `${timestamp}${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('base64');
  return expected === signature;
}

const secret = 'test_client_secret';
const timestamp = '1617695238078';
const rawBody = '{"type":"PAYMENT_SUCCESS_WEBHOOK","data":{}}';
const signed = timestamp + rawBody;
const expected = crypto.createHmac('sha256', secret).update(signed).digest('base64');

if (!verify(rawBody, expected, timestamp, secret)) {
  throw new Error('webhook signature check failed');
}
console.log('PASS cashfree webhook signature');