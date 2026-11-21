/**
 * Preview due while pass is in verification (paid 3 guests, add one).
 * Run: node --experimental-strip-types scripts/check-registration-preview-verification.mjs
 */
import {
  EVENT_FEE_PER_PERSON_PAISE,
  getEventCostBreakdown,
} from '../lib/registration/registration.ts';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function creditedFeePaid(savedTotal, paidRecorded, previewFeeTotal, credit) {
  if (!credit) return paidRecorded;
  if (previewFeeTotal > savedTotal) return Math.max(paidRecorded, savedTotal);
  return Math.max(paidRecorded, savedTotal);
}

const savedGuestCount = 2;
const savedFeeTotal = getEventCostBreakdown({
  attending: true,
  alumnusEats: true,
  batch: 2010,
  guestCount: savedGuestCount,
  guestsEating: savedGuestCount,
}).totalCost;

const previewFeeTotal = getEventCostBreakdown({
  attending: true,
  alumnusEats: true,
  batch: 2010,
  guestCount: 3,
  guestsEating: 3,
}).totalCost;

const feePaid = creditedFeePaid(savedFeeTotal, 0, previewFeeTotal, true);
const feeDue = Math.max(0, previewFeeTotal - feePaid);
const expectedDelta = EVENT_FEE_PER_PERSON_PAISE;

assert(feeDue === expectedDelta, `fee due delta expected ${expectedDelta} got ${feeDue}`);

const feeDueUnpaid = Math.max(
  0,
  previewFeeTotal - creditedFeePaid(savedFeeTotal, 0, previewFeeTotal, false)
);
assert(feeDueUnpaid === previewFeeTotal, 'unpaid owes full preview total');

console.log('OK registration preview verification differential');