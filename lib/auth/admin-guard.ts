import { getCurrentAccount, type AlumniAccount } from '@/lib/auth/request';
import { isSuperAdmin } from '@/lib/auth/super-admin';

/** Verified committee admin, or null if the request is not allowed. */
export async function requireVerifiedAdmin(): Promise<AlumniAccount | null> {
  const me = await getCurrentAccount();
  if (!me || me.role !== 'admin' || me.member_status !== 'verified') return null;
  return me;
}

/** Verified super admin (SUPER_ADMIN_EMAILS), or null. */
export async function requireSuperAdmin(): Promise<AlumniAccount | null> {
  const me = await requireVerifiedAdmin();
  if (!me || !isSuperAdmin(me)) return null;
  return me;
}
