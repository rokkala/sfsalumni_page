import { NextResponse } from 'next/server';
import { findAccountForLogin } from '@/lib/auth/find-account';
import { normalizeLoginId } from '@/lib/auth/identity';
import { createAdminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const loginId = normalizeLoginId(String(body.username || body.email || ''));
    if (!loginId) {
      return NextResponse.json({ error: 'Enter your username or email' }, { status: 400 });
    }

    const admin = createAdminClient();
    const account = await findAccountForLogin(admin, loginId);
    if (!account) {
      return NextResponse.json({ exists: false });
    }
    const { data: meta } = await admin
      .from('alumni_accounts')
      .select('role,member_status')
      .eq('id', account.id)
      .maybeSingle();
    return NextResponse.json({
      exists: true,
      role: meta?.role === 'admin' ? 'admin' : 'alumni',
      member_status: meta?.member_status ?? null,
    });
  } catch (err) {
    console.error('auth lookup', err);
    return NextResponse.json({ error: 'Could not check that username' }, { status: 500 });
  }
}