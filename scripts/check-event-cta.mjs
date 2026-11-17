import { eventActionFromRegistration } from '../lib/events/event-cta.ts';

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg);
    process.exit(1);
  }
}

const id = 'evt-1';

const none = eventActionFromRegistration(id, null);
assert(none.kind === 'register', 'no registration → register');
assert(none.label === 'Register', 'register label');
assert(none.href.includes('event=evt-1'), 'href carries event id');

const paid = eventActionFromRegistration(id, {
  payment_status: 'paid',
  total_due_paise: 0,
  committee_confirmed: true,
});
assert(paid.kind === 'view', 'settled → view');
assert(paid.label === 'View event details', 'view label');

const due = eventActionFromRegistration(id, {
  payment_status: 'pending',
  total_due_paise: 50000,
});
assert(due.kind === 'continue', 'unpaid → continue');
assert(due.label === 'Complete payment', 'pay label');

const awaiting = eventActionFromRegistration(id, {
  payment_status: 'pending',
  total_due_paise: 50000,
  pending_offline_proof: { utr: 'UTR1' },
});
assert(awaiting.label === 'Awaiting confirmation', 'proof pending label');

console.log('PASS event cta');
