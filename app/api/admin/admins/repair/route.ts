import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/auth/admin-guard';
import { resolveUsername } from '@/lib/auth/identity';
import { normalizeEmail } from '@/lib/email';
import { packProfileFields, readPackedProfile } from '@/lib/registration/registration-fields';
import { createAdminClient } from '@/lib/supabase-admin';

function missingColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const message = error.message || '';
  return error.code === 'PGRST204' || error.code === '42703' || /column/i.test(message);
}

/** Backfill username/bio on committee accounts so /login lookup works. */
export async function POST() {
  try {
    const me = await requireSuperAdmin();
    if (!me) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const admin = createAdminClient();
    const { data: rows, error } = await admin
      .from('alumni_accounts')
      .select('id,email,full_name,bio,username,role,member_status')
      .eq('role', 'admin');

    if (error) {
      console.error('admin repair list', error);
      return NextResponse.json({ error: 'Could not load admins' }, { status: 500 });
    }

    let fixed = 0;
    for (const row of rows || []) {
      const email = normalizeEmail(String(row.email || ''));
      const username = resolveUsername(String(row.username || ''), email);
      const packed = readPackedProfile(row.bio);
      const parts = String(row.full_name || '').trim().split(/\s+/);
      const first = packed?.firstName || parts[0] || email;
      const last = packed?.lastName || (parts.length > 1 ? parts.slice(1).join(' ') : first);
      const bio = packProfileFields('', last, { firstName: first, username });

      const patch: Record<string, string> = { bio };
      if (!row.username || String(row.username).trim() === '') {
        patch.username = username;
      }

      let up = await admin
        .from('alumni_accounts')
        .update({
          ...patch,
          member_status: 'verified',
          role: 'admin',
          first_name: first,
          last_name: last,
        })
        .eq('id', row.id);
      if (missingColumn(up.error)) {
        up = await admin
          .from('alumni_accounts')
          .update({ ...patch, member_status: 'verified', role: 'admin' })
          .eq('id', row.id);
      }
      if (!up.error) fixed += 1;
    }

    return NextResponse.json({ ok: true, repaired: fixed, total: rows?.length || 0 });
  } catch (err) {
    console.error('admin repair', err);
    return NextResponse.json({ error: 'Admin API not configured' }, { status: 500 });
  }
}