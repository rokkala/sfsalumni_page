/**
 * Self-check for bank / UPI helpers and offline-proof validation (no DB).
 * Run: node --experimental-strip-types scripts/check-bank-details.mjs
 */
import {
  assertOfflineProofFields,
  assertUpiRefNo,
  buildUpiPayUri,
  formatInr,
  normalizeUpiRefNoInput,
  normalizeUpiTransactionId,
  shortUpiPaymentRef,
  upiMemberRef,
  validateBankAccountFields,
} from '../lib/payments/bank-details.ts';
import {
  PENDING_PROOF_LOCK_MESSAGE,
  SCREENSHOT_BANK_REFERENCE,
  bankReferenceFromProof,
  passStateFromRegistration,
  pendingPaymentMemberLabel,
  pendingProofDisplay,
  REGISTRATION_DONATION_ONLY_THANKS,
  registrationFormHeading,
  venuePassPaymentCue,
  verificationStatusLabel,
} from '../lib/payments/offline-proof.ts';
import {
  isUpiEligible,
  istDayUtcBounds,
  nextUpiWindowOpensAt,
  upiQuotaForAmount,
} from '../lib/payments/upi-quota.ts';

if (formatInr(50000) !== '₹500') throw new Error(`formatInr 50000 → ${formatInr(50000)}`);
if (formatInr(10150) !== '₹101.5') throw new Error(`formatInr 10150 → ${formatInr(10150)}`);

if (buildUpiPayUri({ upiId: '', amountPaise: 100 }) !== null) throw new Error('empty upi');
if (buildUpiPayUri({ upiId: 'a@ok', amountPaise: 0 }) !== null) throw new Error('zero amount');

const uri = buildUpiPayUri({
  upiId: 'alumni@okaxis',
  amountPaise: 50000,
  payeeName: 'SFS Alumni',
  note: 'Jubilee',
});
if (!uri || !uri.startsWith('upi://pay?')) throw new Error('uri prefix');
const q = new URL(uri).searchParams;
if (q.get('pa') !== 'alumni@okaxis') throw new Error('pa');
if (q.get('pn') !== 'SFS Alumni') throw new Error('pn');
if (q.get('am') !== '500.00') throw new Error(`am ${q.get('am')}`);
if (q.get('cu') !== 'INR') throw new Error('cu');
if (q.get('tn') !== 'Jubilee') throw new Error('tn');
if (q.get('tr')) throw new Error('tr should be absent');

const uriWithTr = buildUpiPayUri({
  upiId: 'alumni@okaxis',
  amountPaise: 100,
  transactionId: 'SFS-4K7M2',
  note: 'Jubilee',
});
if (!uriWithTr.includes('pa=alumni@okaxis')) throw new Error('pa should stay unencoded');
const qTr = new URL(uriWithTr.replace('upi://pay?', 'https://u/?')).searchParams;
if (qTr.get('tr') !== 'SFS-4K7M2') throw new Error(`tr code ${qTr.get('tr')}`);
if (qTr.get('tn') !== 'SFS-4K7M2') throw new Error(`tn code ${qTr.get('tn')}`);
if (qTr.get('pn') !== 'SFS-4K7M2') throw new Error(`pn code ${qTr.get('pn')}`);
if (normalizeUpiTransactionId('a'.repeat(40)).length !== 35) throw new Error('tr max len');

const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const uriUuid = buildUpiPayUri({
  upiId: 'alumni@okaxis',
  amountPaise: 100,
  payeeName: 'SFS Alumni',
  transactionId: uuid,
});
const qUuid = new URL(String(uriUuid).replace('upi://pay?', 'https://u/?')).searchParams;
const memberRef = upiMemberRef(uuid);
if (memberRef.display !== 'SFSa1b2c3d4') throw new Error(`display ${memberRef.display}`);
if (qUuid.get('tn') !== memberRef.display) throw new Error('QR tn must match UI display');
const memberCode = upiMemberRef('SFS-4K7M2');
if (memberCode.display !== 'SFS-4K7M2' || memberCode.tr !== 'SFS-4K7M2') {
  throw new Error('paid reg code in UPI');
}

const okAccount = validateBankAccountFields({
  label: 'Jubilee',
  account_name: 'Holder',
  account_number: '123456789012',
  ifsc: 'sbin0001234',
  bank_name: 'SBI',
  upi_id: 'alumni@okaxis',
});
if (okAccount.ifsc !== 'SBIN0001234') throw new Error('ifsc upper');
if (okAccount.account_number !== '123456789012') throw new Error('acct');

try {
  validateBankAccountFields({
    label: 'x',
    account_name: 'y',
    account_number: '12',
    ifsc: 'SBIN0001234',
  });
  throw new Error('expected short account');
} catch (e) {
  if (!(e instanceof Error) || !/account number/i.test(e.message)) throw e;
}

try {
  validateBankAccountFields({
    label: 'x',
    account_name: 'y',
    account_number: '123456',
    ifsc: 'BAD',
  });
  throw new Error('expected ifsc fail');
} catch (e) {
  if (!(e instanceof Error) || !/ifsc/i.test(e.message)) throw e;
}

try {
  validateBankAccountFields({
    label: 'x',
    account_name: 'y',
    account_number: '123456',
    ifsc: 'SBIN0001234',
    upi_id: 'noupper',
  });
  throw new Error('expected upi fail');
} catch (e) {
  if (!(e instanceof Error) || !/upi/i.test(e.message)) throw e;
}

const REF12 = '123456789012';
if (normalizeUpiRefNoInput(' 12 34 56 78 90 12 ') !== REF12) {
  throw new Error('normalizeUpiRefNoInput spaces');
}
if (normalizeUpiRefNoInput('12ab34cd5678') !== '12345678') {
  throw new Error('normalizeUpiRefNoInput non-digit');
}
if (assertUpiRefNo(REF12) !== REF12) throw new Error('assertUpiRefNo ok');

try {
  assertUpiRefNo('');
  throw new Error('expected upi ref required');
} catch (e) {
  if (!(e instanceof Error) || e.message !== 'UPI Ref No. is required') throw e;
}

try {
  assertUpiRefNo('12345');
  throw new Error('expected upi ref length');
} catch (e) {
  if (!(e instanceof Error) || !/12-digit/i.test(e.message)) throw e;
}

try {
  assertOfflineProofFields({ utr: '', file: null });
  throw new Error('expected utr required');
} catch (e) {
  if (!(e instanceof Error) || e.message !== 'UPI Ref No. is required') throw e;
}

const regNoUtr = assertOfflineProofFields({ utr: '', file: null, allowMissingUtr: true });
if (regNoUtr.utr !== '' || regNoUtr.file) throw new Error('allowMissingUtr registration');

try {
  assertOfflineProofFields({
    utr: '',
    file: { type: 'image/png', size: 100, name: 'x.png' },
  });
  throw new Error('expected utr required even with screenshot');
} catch (e) {
  if (!(e instanceof Error) || e.message !== 'UPI Ref No. is required') throw e;
}

const withUtr = assertOfflineProofFields({ utr: `  ${REF12.slice(0, 6)} ${REF12.slice(6)}  `, file: null });
if (withUtr.utr !== REF12 || withUtr.file) throw new Error('utr only');

const withBoth = assertOfflineProofFields({
  utr: REF12,
  file: { type: 'image/png', size: 100, name: 'x.png' },
});
if (withBoth.utr !== REF12 || !withBoth.file || withBoth.file.ext !== 'png') {
  throw new Error('utr + file');
}

try {
  assertOfflineProofFields({
    utr: REF12,
    file: { type: 'image/gif', size: 10, name: 'x.gif' },
  });
  throw new Error('expected mime fail');
} catch (e) {
  if (!(e instanceof Error) || !/JPEG|PNG|WebP/i.test(e.message)) throw e;
}

try {
  assertOfflineProofFields({
    utr: REF12,
    file: { type: 'image/jpeg', size: 4_000_001, name: 'x.jpg' },
  });
  throw new Error('expected size fail');
} catch (e) {
  if (!(e instanceof Error) || !/4 MB/i.test(e.message)) throw e;
}

if (bankReferenceFromProof({ utr: '  REF1  ', hasScreenshot: false }) !== 'REF1') {
  throw new Error('bank ref from utr');
}
if (bankReferenceFromProof({ utr: '', hasScreenshot: true }) !== SCREENSHOT_BANK_REFERENCE) {
  throw new Error('bank ref from screenshot');
}
if (bankReferenceFromProof({ utr: '', hasScreenshot: false, registrationUpiRef: 'abc12' }) !== 'abc12') {
  throw new Error('bank ref from registrationUpiRef');
}
try {
  bankReferenceFromProof({ utr: '', hasScreenshot: false });
  throw new Error('expected empty proof bank ref fail');
} catch (e) {
  if (!(e instanceof Error) || !/UTR|screenshot/i.test(e.message)) throw e;
}

if (verificationStatusLabel({ paymentStatus: 'pending', pendingProof: false, bankReference: '' }) !== 'not submitted') {
  throw new Error('status not submitted');
}
if (
  verificationStatusLabel({ paymentStatus: 'pending', pendingProof: true, bankReference: '' }) !==
  'pending verification'
) {
  throw new Error('status pending proof');
}
if (
  verificationStatusLabel({ paymentStatus: 'pending', pendingProof: false, bankReference: 'ABC' }) !==
  'pending verification'
) {
  throw new Error('status bank ref');
}
if (
  verificationStatusLabel({
    paymentStatus: 'paid',
    pendingProof: true,
    bankReference: 'x',
    totalDuePaise: 0,
  }) !== 'pending verification'
) {
  throw new Error('proof pending keeps pending verification until cleared');
}
if (
  verificationStatusLabel({
    paymentStatus: 'paid',
    pendingProof: false,
    bankReference: '',
    totalDuePaise: 50000,
  }) !== 'pending verification'
) {
  throw new Error('status paid with donation still due');
}

const shown = pendingProofDisplay({ utr: 'UTR99', screenshot_path: null });
if (shown.utr !== 'UTR99' || !shown.label.includes('UTR99') || !shown.label.includes('pending')) {
  throw new Error('pending display utr');
}
if (!PENDING_PROOF_LOCK_MESSAGE.includes('pending committee review')) {
  throw new Error('lock message');
}

if (pendingPaymentMemberLabel(false) !== 'Complete payment') {
  throw new Error('cta unpaid');
}
if (passStateFromRegistration({
  venuePass: true,
  paymentStatus: 'pending',
  totalDuePaise: 50000,
  pendingOfflineProof: true,
}) !== 'pending_verification') {
  throw new Error('pass pending verification');
}
if (
  passStateFromRegistration({
    venuePass: true,
    paymentStatus: 'paid',
    totalDuePaise: 0,
    pendingOfflineProof: false,
  }) !== 'verified'
) {
  throw new Error('pass verified');
}
if (
  passStateFromRegistration({
    venuePass: false,
    paymentStatus: 'pending',
    totalDuePaise: 0,
    pendingOfflineProof: true,
  }) !== 'none'
) {
  throw new Error('pass none donation-only');
}
if (
  passStateFromRegistration({
    venuePass: true,
    paymentStatus: 'pending',
    totalDuePaise: 50000,
    pendingOfflineProof: false,
    hasRegistrationCode: false,
  }) !== 'payment_required'
) {
  throw new Error('pass payment required');
}
if (
  passStateFromRegistration({
    venuePass: true,
    paymentStatus: 'partial',
    totalDuePaise: 100000,
    pendingOfflineProof: false,
    hasRegistrationCode: true,
  }) !== 'pending_verification'
) {
  throw new Error('pass keeps preview QR when Reg ID reserved');
}

if (pendingPaymentMemberLabel(true) !== 'Awaiting confirmation') {
  throw new Error('cta awaiting');
}
if (registrationFormHeading({ formMode: 'pay', verificationPending: false }) !== 'Complete payment') {
  throw new Error('heading pay');
}
if (registrationFormHeading({ formMode: 'pay', verificationPending: true }) !== 'Awaiting confirmation') {
  throw new Error('heading awaiting');
}
if (registrationFormHeading({ formMode: 'update', verificationPending: true }) !== 'Awaiting confirmation') {
  throw new Error('heading update awaiting');
}
if (registrationFormHeading({ formMode: 'new', verificationPending: false }) !== 'Event Registration') {
  throw new Error('heading new');
}

const homeUnpaid = venuePassPaymentCue({
  confirmed: false,
  dueLabel: 'Due ₹1000.00',
  pendingOfflineProof: false,
  bankReference: '',
});
if (!homeUnpaid || homeUnpaid.ctaLabel !== 'Complete payment' || !homeUnpaid.message.includes('Complete payment')) {
  throw new Error('home unpaid cue');
}

const homeAwaiting = venuePassPaymentCue({
  confirmed: false,
  dueLabel: 'Due ₹1000.00',
  pendingOfflineProof: true,
  bankReference: 'UTR99',
});
if (
  !homeAwaiting ||
  homeAwaiting.badge !== 'Awaiting confirmation' ||
  homeAwaiting.ctaLabel !== 'View registration' ||
  homeAwaiting.message.includes('Complete payment')
) {
  throw new Error('home awaiting cue');
}

const homeAwaitingByBankRef = venuePassPaymentCue({
  confirmed: false,
  dueLabel: 'Due ₹1000.00',
  pendingOfflineProof: false,
  bankReference: 'Screenshot on file',
});
if (!homeAwaitingByBankRef || homeAwaitingByBankRef.badge !== 'Awaiting confirmation') {
  throw new Error('home awaiting via bank ref');
}

if (venuePassPaymentCue({ confirmed: true, dueLabel: 'Due ₹0', pendingOfflineProof: true }) !== null) {
  throw new Error('home confirmed hides cue');
}

const giftAwaiting = venuePassPaymentCue({
  confirmed: false,
  dueLabel: 'Gift ₹10.00',
  pendingOfflineProof: true,
  donationOnly: true,
});
if (
  !giftAwaiting ||
  giftAwaiting.ctaLabel !== 'View gift details' ||
  giftAwaiting.message.includes('entry pass')
) {
  throw new Error('donation-only awaiting cue');
}

if (!REGISTRATION_DONATION_ONLY_THANKS.includes('Thank you for the Donation')) {
  throw new Error('donation-only thanks copy');
}

if (isUpiEligible(0)) throw new Error('upi zero not eligible');
if (!isUpiEligible(100)) throw new Error('upi positive eligible');

const blocked = upiQuotaForAmount({
  amountPaise: 500_000,
  daily_total_paise: 9_600_000,
  daily_txn_count: 0,
});
if (blocked.quota_available || blocked.limit_reached_reason !== 'volume') {
  throw new Error('upi volume cap');
}

const blockedCount = upiQuotaForAmount({
  amountPaise: 500_000,
  daily_total_paise: 0,
  daily_txn_count: 20,
});
if (blockedCount.quota_available || blockedCount.limit_reached_reason !== 'count') {
  throw new Error('upi count cap');
}

const bounds = istDayUtcBounds(new Date('2026-11-17T10:00:00+05:30'));
if (bounds.dayLabel !== '2026-11-17') throw new Error(`ist day ${bounds.dayLabel}`);

const nextOpen = nextUpiWindowOpensAt(new Date('2026-11-17T10:00:00+05:30'));
if (!nextOpen.includes('T')) throw new Error('next open iso');

console.log('ok: bank details');
