/**
 * Self-check: Overview money/unpaid stats must use the registration ledger
 * (committee verification + donations), not raw payment_status / amount_paid.
 * Run: node --experimental-strip-types scripts/check-overview-stats.mjs
 */
import { summarizeOverviewStats } from '../lib/admin/registration-ledger.ts';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const base = {
  payment_status: 'pending',
  total_cost_paise: 10_000,
  amount_paid_paise: 0,
  core_committee_manually_verified: false,
  bank_reference: null,
  donation: null,
};

// Raw fields would count this as unpaid with ₹100 due; ledger must treat it as settled.
const verified = summarizeOverviewStats([
  { ...base, core_committee_manually_verified: true },
]);
assert(verified.registrationCount === 1, 'count');
assert(verified.unpaidRegistrations === 0, 'verified must not count as unpaid');
assert(verified.amountPaidPaise === 10_000, 'verified settles full bill');
assert(verified.amountDuePaise === 0, 'verified due is 0');

const unpaid = summarizeOverviewStats([base]);
assert(unpaid.unpaidRegistrations === 1, 'pending unpaid counts');
assert(unpaid.amountPaidPaise === 0, 'unpaid settled 0');
assert(unpaid.amountDuePaise === 10_000, 'unpaid due full');

const withDonation = summarizeOverviewStats([
  {
    ...base,
    payment_status: 'paid',
    amount_paid_paise: 10_000,
    donation: { amount_paise: 5_000, payment_status: 'paid' },
  },
]);
assert(withDonation.amountPaidPaise === 15_000, 'paid donation counts as received');
assert(withDonation.amountDuePaise === 0, 'paid+donation due 0');
assert(withDonation.unpaidRegistrations === 0, 'paid not unpaid');

const awaiting = summarizeOverviewStats([
  { ...base, bank_reference: 'NEFT123', amount_paid_paise: 0 },
]);
assert(awaiting.unpaidRegistrations === 1, 'awaiting verification still needs attention');

const cancelled = summarizeOverviewStats([
  { ...base, payment_status: 'cancelled', amount_paid_paise: 2_000 },
]);
assert(cancelled.unpaidRegistrations === 0, 'cancelled is not unpaid/partial');

console.log('ok overview stats');
