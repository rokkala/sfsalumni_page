/** Bank / UPI account helpers and offline-proof field validation. */

export type BankAccountPublic = {
  id: string;
  label: string;
  account_name: string;
  account_number: string;
  ifsc: string;
  bank_name: string | null;
  upi_id: string | null;
};

export const OFFLINE_PROOF_MAX_BYTES = 4_000_000;

const PROOF_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const ACCOUNT_NUMBER_RE = /^\d{6,18}$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

/** NPCI UPI Ref No. on payment receipts (not the app’s shorter Transaction ID). */
export const UPI_REF_NO_PATTERN = /^\d{12}$/;
export const UPI_REF_NO_LEN = 12;

/** Strip spaces and non-digits; cap at 12 for inputs and pasted text. */
export function normalizeUpiRefNoInput(raw: unknown): string {
  return String(raw ?? '')
    .replace(/\s+/g, '')
    .replace(/\D/g, '')
    .slice(0, UPI_REF_NO_LEN);
}

export function assertUpiRefNo(raw: unknown): string {
  const value = normalizeUpiRefNoInput(raw);
  if (!value) {
    throw new Error('UPI Ref No. is required');
  }
  if (!UPI_REF_NO_PATTERN.test(value)) {
    throw new Error(
      'Enter the 12-digit UPI Ref No. from your payment receipt (not the app Transaction ID)'
    );
  }
  return value;
}

export function normalizeIfsc(raw: unknown): string | null {
  const s = String(raw ?? '')
    .trim()
    .toUpperCase();
  if (!IFSC_RE.test(s)) return null;
  return s;
}

export function formatInr(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

/** NPCI UPI `tr` (transaction reference) — alphanumeric, max 35. */
export const UPI_TRANSACTION_ID_MAX_LEN = 35;

/** NPCI `tr`: letters, digits, dot, hyphen only (no underscore). */
export function normalizeUpiTransactionId(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .replace(/-/g, '')
    .replace(/[^A-Za-z0-9.-]/g, '')
    .slice(0, UPI_TRANSACTION_ID_MAX_LEN);
}

/** Same rules as gate entry codes (SFS + 5 glyphs). */
export function normalizeSfsEntryCode(raw: unknown): string {
  const compact = String(raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!compact) return '';
  const body = compact.startsWith('SFS') ? compact.slice(3) : compact;
  return body.length === 5 ? `SFS-${body}` : '';
}

/** Bank narration is short — show SFS + first 8 hex of the registration UUID (still unique at event scale). */
export function shortUpiPaymentRef(fullRegistrationRef: string): string {
  const hex = normalizeUpiTransactionId(fullRegistrationRef).toLowerCase();
  if (!hex) return '';
  return `SFS${hex.slice(0, 8)}`;
}

function upiQueryValue(raw: string): string {
  return encodeURIComponent(raw).replace(/%20/g, '+');
}

/** Pure helper — no framework deps */
export function buildUpiPayUri(opts: {
  upiId: string;
  amountPaise: number;
  payeeName?: string;
  note?: string;
  /** Embedded in the QR as UPI `tr` so payers and the bank share a custom reference. */
  transactionId?: string;
}): string | null {
  const pa = String(opts.upiId || '').trim();
  const amountPaise = Math.floor(Number(opts.amountPaise) || 0);
  if (!pa || amountPaise <= 0) return null;
  const am = (amountPaise / 100).toFixed(2);
  const note = String(opts.note || '').trim();
  const regCode = normalizeSfsEntryCode(opts.transactionId);
  const tr = regCode || normalizeUpiTransactionId(opts.transactionId);
  // Unpaid registrations: short ref for bank recon; SFS-XXXXX only exists after payment settles.
  const tn = regCode || (tr ? shortUpiPaymentRef(tr) : note);
  const pn = regCode || String(opts.payeeName || '').trim();
  const parts = [`pa=${pa}`];
  if (pn) parts.push(`pn=${upiQueryValue(pn)}`);
  if (tr) parts.push(`tr=${tr}`);
  if (tn) parts.push(`tn=${upiQueryValue(tn)}`);
  parts.push(`am=${am}`, 'cu=INR');
  return `upi://pay?${parts.join('&')}`;
}

export type BankAccountInput = {
  label: string;
  account_name: string;
  account_number: string;
  ifsc: string;
  bank_name?: string | null;
  upi_id?: string | null;
};

/** Throws Error with an admin-facing message when invalid. */
export function validateBankAccountFields(input: BankAccountInput): {
  label: string;
  account_name: string;
  account_number: string;
  ifsc: string;
  bank_name: string | null;
  upi_id: string | null;
} {
  const label = String(input.label || '').trim();
  if (!label) throw new Error('Label is required');

  const account_name = String(input.account_name || '').trim();
  if (!account_name) throw new Error('Account name is required');

  const account_number = String(input.account_number || '').replace(/\s+/g, '');
  if (!ACCOUNT_NUMBER_RE.test(account_number)) {
    throw new Error('Account number must be 6–18 digits');
  }

  const ifsc = normalizeIfsc(input.ifsc);
  if (!ifsc) {
    throw new Error('IFSC must look like SBIN0001234');
  }

  const bankRaw = input.bank_name != null ? String(input.bank_name).trim() : '';
  const bank_name = bankRaw || null;

  const upiRaw = input.upi_id != null ? String(input.upi_id).trim() : '';
  if (upiRaw && !upiRaw.includes('@')) {
    throw new Error('UPI ID must look like name@bank');
  }
  const upi_id = upiRaw || null;

  return { label, account_name, account_number, ifsc, bank_name, upi_id };
}

export type OfflineProofFile = { name?: string; type: string; size: number };

export type OfflineProofOk = {
  utr: string;
  file: { ext: string; type: string; size: number; name?: string } | null;
};

/** Throws Error with a member-facing message when invalid. Screenshot optional. */
export function assertOfflineProofFields(input: {
  utr: unknown;
  file: OfflineProofFile | null | undefined;
  /** Registration payments carry ref in the UPI note; UTR may be omitted. */
  allowMissingUtr?: boolean;
}): OfflineProofOk {
  const utrRaw = normalizeUpiRefNoInput(input.utr);
  let utr = '';
  if (utrRaw) {
    if (!UPI_REF_NO_PATTERN.test(utrRaw)) {
      throw new Error(
        'Enter the 12-digit UPI Ref No. from your payment receipt (not the app Transaction ID)'
      );
    }
    utr = utrRaw;
  } else if (!input.allowMissingUtr) {
    throw new Error('UPI Ref No. is required');
  }
  const file = input.file ?? null;

  if (file) {
    if (file.size > OFFLINE_PROOF_MAX_BYTES) {
      throw new Error('Screenshot must be 4 MB or smaller');
    }
    const ext = PROOF_MIME[file.type];
    if (!ext) throw new Error('Screenshot must be JPEG, PNG, or WebP');
    return {
      utr,
      file: { ext, type: file.type, size: file.size, name: file.name },
    };
  }

  return { utr, file: null };
}

export function toBankAccountPublic(row: {
  id: string;
  label: string;
  account_name: string;
  account_number: string;
  ifsc: string;
  bank_name: string | null;
  upi_id: string | null;
}): BankAccountPublic {
  return {
    id: String(row.id),
    label: String(row.label || ''),
    account_name: String(row.account_name || ''),
    account_number: String(row.account_number || ''),
    ifsc: String(row.ifsc || ''),
    bank_name: row.bank_name ? String(row.bank_name) : null,
    upi_id: row.upi_id ? String(row.upi_id) : null,
  };
}

/** Admin form input (camelCase or snake_case). */
export function assertPaymentAccountInput(body: Record<string, unknown>): {
  label: string;
  account_name: string;
  account_number: string;
  ifsc: string;
  bank_name: string | null;
  upi_id: string | null;
  active: boolean;
  sort_order: number;
} {
  const base = validateBankAccountFields({
    label: String(body.label ?? ''),
    account_name: String(body.accountName ?? body.account_name ?? ''),
    account_number: String(body.accountNumber ?? body.account_number ?? ''),
    ifsc: String(body.ifsc ?? ''),
    bank_name: (body.bankName ?? body.bank_name) as string | null | undefined,
    upi_id: (body.upiId ?? body.upi_id) as string | null | undefined,
  });
  const active = body.active === true || body.active === 'true';
  const sort_order = Math.trunc(Number(body.sortOrder ?? body.sort_order) || 0);
  return { ...base, active, sort_order };
}
