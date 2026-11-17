/**
 * Guards: user-facing payment must not reference Razorpay (Cashfree is the gateway).
 * Run: node scripts/check-no-razorpay-ui.mjs
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const root = process.cwd();

function read(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const paths = [
  'components/registration_page/registration-donation.tsx',
  'components/registration_page/registration-form.tsx',
  'app/registration/page.tsx',
  'components/registration_page/registration-success.tsx',
  'app/member/donate/page.tsx',
  'app/admin/donations/page.tsx',
];

for (const rel of paths) {
  const text = read(rel);
  assert(!/\bRazorpay\b/i.test(text), `${rel} still mentions Razorpay`);
  assert(!text.includes('openRazorpayCheckout'), `${rel} still imports Razorpay checkout`);
}

const form = read('components/registration_page/registration-form.tsx');
assert(form.includes('Pay online') || form.includes('onPayOnline'), 'registration form missing online pay');

console.log('ok: cashfree payment ui guard');