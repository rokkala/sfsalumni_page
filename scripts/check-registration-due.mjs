import { repriceRegistration } from '../lib/events/reprice-math.ts';

function feeDue(row) {
  return repriceRegistration(row).amount_due_paise;
}

const donateOnly = feeDue({
  attending: false,
  lunch: false,
  number_of_guests: 0,
  guests_eating: 0,
  batch: 2010,
  amount_paid_paise: 0,
});
if (donateOnly !== 0) {
  throw new Error(`donate-only fee due expected 0 got ${donateOnly}`);
}

const twoGuestsNoAlumnus = feeDue({
  attending: false,
  lunch: false,
  number_of_guests: 2,
  guests_eating: 0,
  batch: 1990,
  amount_paid_paise: 0,
});
if (twoGuestsNoAlumnus !== 200_000) {
  throw new Error(`two guests fee due expected 200000 got ${twoGuestsNoAlumnus}`);
}

console.log('PASS registration-due');