import type { AlumniAccount } from '@/lib/auth/request';
import { normalizeEmail } from '@/lib/email';

function superAdminEmailSet(): Set<string> {
  const raw = process.env.SUPER_ADMIN_EMAILS || '';
  return new Set(
    raw
      .split(/[,;\n]+/)
      .map((e) => normalizeEmail(e))
      .filter(Boolean)
  );
}

/** Verified admin whose email is listed in SUPER_ADMIN_EMAILS. */
export function isSuperAdmin(me: Pick<AlumniAccount, 'email' | 'role' | 'member_status'>): boolean {
  if (me.role !== 'admin' || me.member_status !== 'verified') return false;
  const allow = superAdminEmailSet();
  if (allow.size === 0) return false;
  return allow.has(normalizeEmail(me.email));
}