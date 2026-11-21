/**
 * Fee and donation differential while proof is pending or after withdraw credit.
 * Run: node --experimental-strip-types scripts/check-pending-proof-due.mjs
 */
import {
  amountDuePaise,
  statusFromAmounts,
} from '../lib/events/balance.ts';

function applyWithdrawnRegistrationProofCredit(input) {
  const proof = Math.max(0, Math.floor(Number(input.proofAmountPaise) || 0));
  const feeTotal = Math.max(0, Math.floor(Number(input.feeTotal) || 0));
  const feePaidBefore = Math.max(0, Math.floor(Number(input.feePaidBefore) || 0));
  const donationAmountDue = Math.max(0, Math.floor(Number(input.donationAmountDue) || 0));

  const feeDue = amountDuePaise(feeTotal, feePaidBefore);
  const feePortion = Math.min(proof, feeDue);
  const amount_paid_paise = Math.min(feeTotal, feePaidBefore + feePortion);
  const remainder = proof - feePortion;
  const donationPortion = Math.min(remainder, donationAmountDue);
  const donationDuePaise = Math.max(0, donationAmountDue - donationPortion);
  const donationSettledByCredit =
    donationAmountDue > 0 && donationPortion >= donationAmountDue;

  return {
    amount_paid_paise,
    payment_status: statusFromAmounts(feeTotal, amount_paid_paise),
    donationDuePaise,
    donationSettledByCredit,
  };
}

function donationDueWithPendingVerification(input) {
  const status = input.paymentStatus ?? null;
  if (status === 'paid' || status === 'failed') return 0;
  const savedIntent = Math.max(0, Math.floor(Number(input.intendedPaise) || 0));
  const previewIntent =
    input.previewIntentPaise == null
      ? savedIntent
      : Math.max(0, Math.floor(Number(input.previewIntentPaise) || 0));
  if (!input.pendingVerification) return previewIntent;
  return Math.max(0, previewIntent - savedIntent);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const credited2 = applyWithdrawnRegistrationProofCredit({
  proofAmountPaise: 210_000,
  feeTotal: 200_000,
  feePaidBefore: 0,
  donationAmountDue: 50_000,
});
assert(credited2.amount_paid_paise === 200_000, 'fee cap');
assert(credited2.donationDuePaise === 40_000, 'donation incremental after proof');

const previewDonation = donationDueWithPendingVerification({
  intendedPaise: 5_000,
  paymentStatus: 'pending',
  pendingVerification: true,
  previewIntentPaise: 15_000,
});
assert(previewDonation === 10_000, 'donation preview delta');

console.log('OK pending proof due (fee + donation)');