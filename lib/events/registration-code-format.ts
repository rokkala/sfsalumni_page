/** Client-safe registration code formatting (no node:crypto). */

/** Accepts "sfs 4k7m2", "4K7M2", or the stored "SFS-4K7M2". */
export function normalizeRegistrationCode(raw: string): string {
  const compact = String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!compact) return '';
  const body = compact.startsWith('SFS') ? compact.slice(3) : compact;
  if (body.length !== 5) return '';
  return `SFS-${body}`;
}