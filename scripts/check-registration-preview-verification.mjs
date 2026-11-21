/**
 * Preview due while pass is in verification (add guests; partial proof amount).
 * Run: node --experimental-strip-types scripts/check-registration-preview-verification.mjs
 */
import {
  EVENT_FEE_PER_PERSON_PAISE,
  getEventCostBreakdown,
} from '../lib/registration/registration.ts';
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function feePortionFromPendingProofAmount(input) {
  const proof = Math.max(0, Math.floor(Number(input.proofAmountPaise) || 0));
  if (proof < 1) return 0;
  const donationPending =
    input.donationPaymentStatus !== 'paid' &&
    input.donationPaymentStatus !== 'failed' &&
    input.donationIntendedPaise > 0;
  const feePart = donationPending
    ? Math.max(0, proof - input.donationIntendedPaise)
    : proof;
  return Math.max(0, feePart);
}

function creditedFeePaidPaise(savedTotal, paidRecorded, previewFeeTotal, proofAmount, donation = 0) {
  const proofFee = feePortionFromPendingProofAmount({
    proofAmountPaise: proofAmount,
    feeTotalPaise: savedTotal,
    donationIntendedPaise: donation,
    donationPaymentStatus: donation > 0 ? 'pending' : null,
  });
  let covered = paidRecorded;
  if (proofAmount > 0) {
    covered = Math.max(covered, proofFee);
  } else {
    covered = Math.max(covered, savedTotal);
  }
  if (previewFeeTotal > covered) return covered;
  return covered;
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

const feePaidFullProof = creditedFeePaidPaise(savedFeeTotal, 0, previewFeeTotal, savedFeeTotal);
const feeDueDelta = Math.max(0, previewFeeTotal - feePaidFullProof);
assert(feeDueDelta === EVENT_FEE_PER_PERSON_PAISE, `full proof: fee due delta expected ${EVENT_FEE_PER_PERSON_PAISE} got ${feeDueDelta}`);

const onePersonProof = EVENT_FEE_PER_PERSON_PAISE;
const previewOneGuest = getEventCostBreakdown({
  attending: true,
  alumnusEats: true,
  batch: 2010,
  guestCount: 1,
  guestsEating: 1,
}).totalCost;

const feePaidPartial = creditedFeePaidPaise(onePersonProof, 0, previewOneGuest, onePersonProof);
assert(
  Math.max(0, previewOneGuest - feePaidPartial) === onePersonProof,
  'proof for one person: adding one guest shows ₹1000 due not ₹2000'
);

const feePaidMismatch = creditedFeePaidPaise(savedFeeTotal, 0, previewFeeTotal, onePersonProof);
assert(feePaidMismatch === onePersonProof, 'proof below saved fee must not credit full saved total');
assert(
  Math.max(0, previewFeeTotal - feePaidMismatch) === previewFeeTotal - onePersonProof,
  'incremental due from partial proof'
);

function savedFeeTreatedAsCovered(saved) {
  return (
    saved.feeTotal > 0 &&
    saved.feeDue === 0 &&
    saved.paymentStatus !== 'paid' &&
    (saved.passState === 'pending_verification' || saved.totalDue === 0)
  );
}

assert(
  savedFeeTreatedAsCovered({
    feeTotal: 100_000,
    feeDue: 0,
    totalDue: 0,
    paymentStatus: 'pending',
    passState: 'payment_required',
  }),
  'fee due 0 on saved row means fee in flight'
);

const coveredInFlight = creditedFeePaidPaise(100_000, 0, 200_000, 0);
assert(
  Math.max(0, 200_000 - coveredInFlight) === 100_000,
  'in-flight saved fee credits one guest add'
);

console.log('OK registration preview verification differential');