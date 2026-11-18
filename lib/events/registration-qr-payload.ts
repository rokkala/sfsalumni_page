import crypto from 'crypto';
import { normalizeRegistrationCode } from './registration-code-format';

/** QR payload: human code + short HMAC so casual forgery is harder; gate accepts legacy plain codes. */
export function registrationQrPayload(code: string, registrationId: string): string {
  const normalized = normalizeRegistrationCode(code);
  if (!normalized || !registrationId) return normalized || code;
  const secret =
    process.env.REGISTRATION_QR_SECRET?.trim() ||
    process.env.AUTH_SECRET?.trim() ||
    process.env.GATE_PIN?.trim() ||
    '';
  if (!secret) return normalized;
  const mac = crypto
    .createHmac('sha256', secret)
    .update(`${normalized}:${registrationId}`)
    .digest('base64url')
    .slice(0, 10);
  return `${normalized}~${mac}`;
}

export function parseRegistrationQrScan(raw: string): { code: string; mac: string | null } {
  const s = String(raw || '').trim();
  const tilde = s.lastIndexOf('~');
  if (tilde > 0) {
    const maybeMac = s.slice(tilde + 1);
    if (/^[A-Za-z0-9_-]{6,16}$/.test(maybeMac)) {
      return { code: normalizeRegistrationCode(s.slice(0, tilde)), mac: maybeMac };
    }
  }
  return { code: normalizeRegistrationCode(s), mac: null };
}

export function verifyRegistrationQrMac(
  code: string,
  registrationId: string,
  mac: string | null
): boolean {
  if (!mac) return true;
  const expected = registrationQrPayload(code, registrationId);
  const parts = expected.split('~');
  return parts.length === 2 && parts[1] === mac;
}