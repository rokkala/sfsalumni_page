import { assertOfflineProofFields, UPI_REF_NO_PATTERN } from './bank-details';
import { isUpiEligible } from './upi-quota';

export const REMITTANCE_METHODS = [
  'neft_rtgs',
  'cash_cheque',
  'class_representative',
  'foreign',
  'upi',
] as const;

export type RemittanceMethod = (typeof REMITTANCE_METHODS)[number];

export function parseRemittanceMethod(raw: unknown): RemittanceMethod | null {
  const s = String(raw ?? '').trim();
  return (REMITTANCE_METHODS as readonly string[]).includes(s) ? (s as RemittanceMethod) : null;
}

export type NeftRtgsMeta = { reference: string };
export type CashChequeMeta = { challan_number: string };
export type ClassRepMeta = {
  rep_name: string;
  batch_year: string;
  section: string;
  phone: string;
};
export type ForeignMeta = {
  reference: string;
  amount_foreign: number;
  currency: string;
  amount_inr_reported: number;
};

export type RemittanceMeta =
  | NeftRtgsMeta
  | CashChequeMeta
  | ClassRepMeta
  | ForeignMeta
  | Record<string, never>;

export type RemittanceFormFields = {
  paymentDate: unknown;
  utr: unknown;
  reference?: unknown;
  challanNumber?: unknown;
  repName?: unknown;
  batchYear?: unknown;
  section?: unknown;
  repPhone?: unknown;
  foreignReference?: unknown;
  amountForeign?: unknown;
  currency?: unknown;
  amountInrReported?: unknown;
};

export type RemittanceProofFile = { name?: string; type: string; size: number } | null;

export type ParsedRemittance = {
  method: RemittanceMethod;
  payment_date: string;
  remittance_meta: RemittanceMeta;
  utr: string;
  file: RemittanceProofFile;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertPaymentDate(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!DATE_RE.test(s)) {
    throw new Error('Enter the payment date (YYYY-MM-DD).');
  }
  const [y, m, d] = s.split('-').map((x) => Number(x));
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    throw new Error('Enter a valid payment date.');
  }
  const todayIst = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  if (s > todayIst) {
    throw new Error('Payment date cannot be in the future.');
  }
  return s;
}

function assertReference(raw: unknown, label = 'Payment reference'): string {
  const s = String(raw ?? '').trim();
  if (!s) throw new Error(`${label} is required.`);
  if (s.length > 64) throw new Error(`${label} must be 64 characters or fewer.`);
  return s;
}

function assertChallan(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) throw new Error('Challan number is required.');
  if (s.length > 64) throw new Error('Challan number must be 64 characters or fewer.');
  return s;
}

function assertClassRep(fields: RemittanceFormFields): ClassRepMeta {
  const rep_name = String(fields.repName ?? '').trim();
  if (!rep_name) throw new Error('Class representative name is required.');
  const batch_year = String(fields.batchYear ?? '').trim();
  if (!batch_year) throw new Error('Batch year is required.');
  const section = String(fields.section ?? '').trim();
  if (!section) throw new Error('Section is required.');
  const phone = String(fields.repPhone ?? '').trim().replace(/\s+/g, '');
  if (phone.length < 8) throw new Error('Class representative phone number is required.');
  return { rep_name, batch_year, section, phone };
}

function parsePositiveAmount(raw: unknown, label: string): number {
  const n = Number(String(raw ?? '').replace(/,/g, '').trim());
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${label} must be greater than zero.`);
  return n;
}

function assertForeign(fields: RemittanceFormFields): ForeignMeta {
  const reference = assertReference(fields.foreignReference ?? fields.reference, 'Payment reference');
  const amount_foreign = parsePositiveAmount(fields.amountForeign, 'Non-INR amount');
  const currency = String(fields.currency ?? '').trim().toUpperCase();
  if (currency.length < 3 || currency.length > 8) {
    throw new Error('Enter the foreign currency code (e.g. USD).');
  }
  const amount_inr_reported = parsePositiveAmount(fields.amountInrReported, 'INR amount');
  return { reference, amount_foreign, currency, amount_inr_reported };
}

export function assertRemittancePayload(input: {
  method: RemittanceMethod;
  fields: RemittanceFormFields;
  file: RemittanceProofFile;
  amountPaise: number;
}): ParsedRemittance {
  const payment_date = assertPaymentDate(input.fields.paymentDate);
  const method = input.method;
  const hasFile = Boolean(input.file && input.file.size > 0);

  if (method === 'upi') {
    if (!isUpiEligible(input.amountPaise)) {
      throw new Error(
        'UPI is available only when your total due including donation is Rs. 5,000 or more.'
      );
    }
    const proof = assertOfflineProofFields({
      utr: input.fields.utr,
      file: input.file,
      allowMissingUtr: false,
    });
    if (!proof.file) {
      throw new Error('Upload a photo of your UPI payment.');
    }
    return {
      method,
      payment_date,
      remittance_meta: {},
      utr: proof.utr,
      file: input.file,
    };
  }

  if (method === 'neft_rtgs') {
    const reference = assertReference(input.fields.reference ?? input.fields.utr);
    if (!hasFile) throw new Error('Upload a photo of your payment confirmation.');
    const proof = assertOfflineProofFields({
      utr: '',
      file: input.file,
      allowMissingUtr: true,
    });
    if (!proof.file) throw new Error('Upload a photo of your payment confirmation.');
    return {
      method,
      payment_date,
      remittance_meta: { reference },
      utr: reference.slice(0, 64),
      file: input.file,
    };
  }

  if (method === 'cash_cheque') {
    const challan_number = assertChallan(input.fields.challanNumber);
    if (!hasFile) throw new Error('Upload a photo of your deposit slip.');
    const proof = assertOfflineProofFields({
      utr: '',
      file: input.file,
      allowMissingUtr: true,
    });
    if (!proof.file) throw new Error('Upload a photo of your deposit slip.');
    return {
      method,
      payment_date,
      remittance_meta: { challan_number },
      utr: challan_number.slice(0, 64),
      file: input.file,
    };
  }

  if (method === 'class_representative') {
    const remittance_meta = assertClassRep(input.fields);
    const proof = assertOfflineProofFields({
      utr: '',
      file: input.file,
      allowMissingUtr: true,
    });
    const utr = `Class rep: ${remittance_meta.rep_name}`.slice(0, 64);
    return {
      method,
      payment_date,
      remittance_meta,
      utr: proof.utr || utr,
      file: input.file,
    };
  }

  if (method === 'foreign') {
    const remittance_meta = assertForeign(input.fields);
    if (!hasFile) throw new Error('Upload a photo of your transaction.');
    const proof = assertOfflineProofFields({
      utr: '',
      file: input.file,
      allowMissingUtr: true,
    });
    if (!proof.file) throw new Error('Upload a photo of your transaction.');
    return {
      method,
      payment_date,
      remittance_meta,
      utr: remittance_meta.reference.slice(0, 64),
      file: input.file,
    };
  }

  throw new Error('Invalid remittance method.');
}

export function remittanceMethodLabel(method: RemittanceMethod): string {
  switch (method) {
    case 'neft_rtgs':
      return 'NEFT / RTGS';
    case 'cash_cheque':
      return 'Cash / cheque deposit';
    case 'class_representative':
      return 'Class representative';
    case 'foreign':
      return 'Foreign remittance';
    case 'upi':
      return 'UPI';
    default:
      return method;
  }
}

/** Display line for admin registration bank_reference column. */
export function bankReferenceFromRemittance(input: {
  method: RemittanceMethod;
  utr: string;
  remittance_meta: RemittanceMeta;
  hasScreenshot: boolean;
  registrationUpiRef?: string | null;
}): string {
  const utr = String(input.utr ?? '').trim();
  if (input.method === 'upi' && utr && UPI_REF_NO_PATTERN.test(utr)) return utr;
  if (input.method === 'neft_rtgs' && 'reference' in input.remittance_meta) {
    return String(input.remittance_meta.reference).trim() || utr;
  }
  if (input.method === 'cash_cheque' && 'challan_number' in input.remittance_meta) {
    return `Challan ${input.remittance_meta.challan_number}`;
  }
  if (input.method === 'class_representative' && 'rep_name' in input.remittance_meta) {
    const m = input.remittance_meta;
    return `Via ${m.rep_name} (${m.batch_year}/${m.section})`;
  }
  if (input.method === 'foreign' && 'reference' in input.remittance_meta) {
    const m = input.remittance_meta as ForeignMeta;
    return `${m.reference} (${m.currency} ${m.amount_foreign})`;
  }
  if (utr) return utr;
  const regRef = String(input.registrationUpiRef ?? '').trim();
  if (regRef) return regRef;
  if (input.hasScreenshot) return 'Screenshot on file';
  throw new Error('Add payment details or a screenshot');
}