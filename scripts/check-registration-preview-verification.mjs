/**
 * Preview due while offline proof is pending: only the fee increment after guest adds.
 * Run: node --experimental-strip-types scripts/check-registration-preview-verification.mjs
 */
import {
  EVENT_FEE_PER_PERSON_PAISE,
  getEventCostBreakdown,
} from '../lib/registration/registration.ts';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const savedGuestCount = 1;
const savedFeeTotal = getEventCostBreakdown({
  attending: true,
  alumnusEats: true,
  batch: 2010,
  guestCount: savedGuestCount,
  guestsEating: savedGuestCount,
}).totalCost;

const creditedFeePaid = Math.max(0, savedFeeTotal);

const previewFeeTotal = getEventCostBreakdown({
  attending: true,
  alumnusEats: true,
  batch: 2010,
  guestCount: 2,
  guestsEating: 2,
}).totalCost;

const feeDue = Math.max(0, previewFeeTotal - creditedFeePaid);
const expectedDelta = EVENT_FEE_PER_PERSON_PAISE;

assert(feeDue === expectedDelta, `fee due delta expected ${expectedDelta} got ${feeDue}`);

console.log('OK registration preview verification differential');