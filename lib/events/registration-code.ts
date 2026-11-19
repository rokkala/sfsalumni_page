import { randomInt } from 'node:crypto';
export { normalizeRegistrationCode } from './registration-code-format';
import { needsVenuePass } from '@/lib/events/venue-attendance';

/** No 0/O or 1/I/L — these are read aloud at the venue gate. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function registrationCodeFrom(bytes: ArrayLike<number>): string {
  let body = '';
  for (let i = 0; i < 5; i++) {
    const n = Math.abs(Math.floor(Number(bytes[i]) || 0));
    body += ALPHABET[n % ALPHABET.length];
  }
  return `SFS-${body}`;
}

export function newRegistrationCode(): string {
  return registrationCodeFrom([0, 1, 2, 3, 4].map(() => randomInt(ALPHABET.length)));
}

export function shouldIssueRegistrationCode(
  status: string,
  existing: string | null | undefined
): boolean {
  return status === 'paid' && !String(existing || '').trim();
}

/** Fee paid, donation settled, and someone is attending — only then issue a venue pass / QR. */
export function isEligibleForRegistrationCode(input: {
  paymentStatus: string;
  donationDuePaise: number;
  attending: boolean;
  guestCount: number;
}): boolean {
  if (!needsVenuePass(input.attending, input.guestCount)) return false;
  return input.paymentStatus === 'paid' && input.donationDuePaise === 0;
}

export function shouldExposeRegistrationCode(
  code: string | null | undefined,
  input: {
    paymentStatus: string;
    donationDuePaise: number;
    attending: boolean;
    guestCount: number;
  }
): string | null {
  if (!code || !String(code).trim()) return null;
  if (!isEligibleForRegistrationCode(input)) return null;
  return String(code).trim();
}

export function missingColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const message = error.message || '';
  return error.code === 'PGRST204' || error.code === '42703' || /column/i.test(message);
}

type CodeResult = {
  data: { registration_code?: string | null } | null;
  error: { code?: string; message?: string } | null;
};

type CodeQuery = {
  select: (cols: string) => CodeQuery;
  update: (patch: { registration_code: string | null }) => CodeQuery;
  eq: (col: string, val: string) => CodeQuery;
  is: (col: string, val: null) => CodeQuery;
  maybeSingle: () => Promise<CodeResult>;
};

export type RegistrationCodeAdmin = {
  from: (table: string) => CodeQuery;
};

export async function readRegistrationCode(
  admin: RegistrationCodeAdmin,
  registrationId: string
): Promise<string | null> {
  const current = await admin
    .from('event_registrations')
    .select('registration_code')
    .eq('id', registrationId)
    .maybeSingle();
  if (current.error) return null;
  return current.data?.registration_code || null;
}

/** Gives an ID to registrations that are already fully paid and still have none. */
export async function issueMissingPaidCodes(admin: RegistrationCodeAdmin): Promise<void> {
  const listed = (await admin
    .from('event_registrations')
    .select('id')
    .eq('payment_status', 'paid')
    .is('registration_code', null)) as unknown as {
    data: { id?: string }[] | null;
    error: { code?: string; message?: string } | null;
  };
  if (listed.error || !listed.data) return;
  for (const row of listed.data) {
    if (row.id) await ensureRegistrationCode(admin, row.id, 'paid');
  }
}

/** Assigns SFS-XXXXX before payment when money is still due so UPI notes match the gate code. */
export async function reserveUpiPaymentCode(
  admin: RegistrationCodeAdmin,
  registrationId: string,
  input: { venuePass: boolean; amountDuePaise: number }
): Promise<string | null> {
  if (!input.venuePass) return null;
  if (input.amountDuePaise <= 0) {
    return readRegistrationCode(admin, registrationId);
  }
  return reserveRegistrationCode(admin, registrationId);
}

/** Reserves SFS-XXXXX only when a venue pass will be needed (not donation-only). */
export async function reserveRegistrationCode(
  admin: RegistrationCodeAdmin,
  registrationId: string,
  makeCode: () => string = newRegistrationCode
): Promise<string | null> {
  const existing = await readRegistrationCode(admin, registrationId);
  if (existing) return existing;

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = makeCode();
    const saved = await admin
      .from('event_registrations')
      .update({ registration_code: code })
      .eq('id', registrationId)
      .is('registration_code', null)
      .select('registration_code')
      .maybeSingle();
    if (saved.error) {
      if (missingColumn(saved.error)) return null;
      continue;
    }
    if (saved.data?.registration_code) return saved.data.registration_code;
  }
  return null;
}

/** Writes a code when fully paid; reuses an earlier reserved code when present. */
export async function ensureRegistrationCode(
  admin: RegistrationCodeAdmin,
  registrationId: string,
  paymentStatus: string,
  makeCode: () => string = newRegistrationCode
): Promise<string | null> {
  const existing = await readRegistrationCode(admin, registrationId);
  if (existing) return existing;
  if (paymentStatus !== 'paid') return null;
  return reserveRegistrationCode(admin, registrationId, makeCode);
}

/** Clears the registration code when payment is reversed (mark unpaid). */
export async function clearRegistrationCode(
  admin: RegistrationCodeAdmin,
  registrationId: string
): Promise<boolean> {
  const saved = await admin
    .from('event_registrations')
    .update({ registration_code: null })
    .eq('id', registrationId)
    .select('registration_code')
    .maybeSingle();
  if (saved.error) {
    if (missingColumn(saved.error)) return false;
    return false;
  }
  return true;
}
