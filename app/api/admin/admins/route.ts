import { NextResponse } from 'next/server';
import { requireSuperAdmin, requireVerifiedAdmin } from '@/lib/auth/admin-guard';
import { isSuperAdmin } from '@/lib/auth/super-admin';
import { resolveUsername, usernameError } from '@/lib/auth/identity';
import { hashPassword } from '@/lib/auth/password';
import { isValidEmailShape, normalizeEmail } from '@/lib/email';
import { packProfileFields } from '@/lib/registration/registration-fields';
import { createAdminClient } from '@/lib/supabase-admin';

function missingColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const message = error.message || '';
  return error.code === 'PGRST204' || error.code === '42703' || /column/i.test(message);
}

export async function GET() {
  try {
    const me = await requireVerifiedAdmin();
    if (!me) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const admin = createAdminClient();
    const { data, error } = await admin
      .from('alumni_accounts')
      .select(
        'id,full_name,email,phone_number,batch,role,member_status,username,created_at,reviewed_at'
      )
      .eq('role', 'admin')
      .order('full_name', { ascending: true });

    if (error) {
      console.error('admin admins list', error);
      return NextResponse.json({ error: 'Could not load admins' }, { status: 500 });
    }

    return NextResponse.json({
      admins: data || [],
      me_id: me.id,
      can_manage: isSuperAdmin(me),
    });
  } catch (err) {
    console.error('admin admins list', err);
    return NextResponse.json({ error: 'Admin API not configured' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const me = await requireSuperAdmin();
    if (!me) {
      return NextResponse.json(
        {
          error:
            'Only a super admin can create admin accounts. Add your email to SUPER_ADMIN_EMAILS on the server.',
        },
        { status: 403 }
      );
    }

    const body = await request.json();
    const email = normalizeEmail(String(body.email || ''));
    const password = String(body.password || '');
    const fullNameInput = String(body.fullName || '').trim().replace(/\s+/g, ' ');
    const firstName = String(body.firstName || '').trim().replace(/\s+/g, ' ');
    const lastName = String(body.lastName || '').trim().replace(/\s+/g, ' ');
    const username = resolveUsername(String(body.username || ''), email);
    const now = new Date().toISOString();

    const fullName =
      fullNameInput ||
      [firstName, lastName].filter(Boolean).join(' ').trim();

    if (!email || !fullName) {
      return NextResponse.json({ error: 'Full name and email are required' }, { status: 400 });
    }
    if (!isValidEmailShape(email)) {
      return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 });
    }
    const nameError = usernameError(username);
    if (nameError) return NextResponse.json({ error: nameError }, { status: 400 });
    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    const nameParts = fullName.split(/\s+/);
    const first = firstName || nameParts[0] || fullName;
    const last = lastName || (nameParts.length > 1 ? nameParts.slice(1).join(' ') : '—');

    const admin = createAdminClient();
    const { data: emailOwner } = await admin
      .from('alumni_accounts')
      .select('id')
      .eq('email', email)
      .maybeSingle();
    if (emailOwner) {
      return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409 });
    }

    const passwordHash = await hashPassword(password);
    const bio = packProfileFields('', last, { firstName: first, username });
    const baseRow = {
      email,
      password_hash: passwordHash,
      full_name: fullName,
      phone_number: null as string | null,
      role: 'admin' as const,
      member_status: 'verified' as const,
      reviewed_at: now,
      reviewed_by: me.id,
      bio,
    };
    const withColumns = {
      ...baseRow,
      first_name: first,
      last_name: last,
      username,
    };

    let inserted = await admin
      .from('alumni_accounts')
      .insert(withColumns)
      .select('id,email,full_name,username')
      .single();
    if (missingColumn(inserted.error)) {
      inserted = await admin
        .from('alumni_accounts')
        .insert(baseRow)
        .select('id,email,full_name')
        .single();
    }

    if (inserted.error || !inserted.data) {
      if (inserted.error?.code === '23505') {
        return NextResponse.json(
          { error: 'An account with this email or username already exists' },
          { status: 409 }
        );
      }
      console.error('admin create', inserted.error);
      return NextResponse.json({ error: 'Could not create admin account' }, { status: 500 });
    }

    return NextResponse.json(
      {
        ok: true,
        admin: inserted.data,
        temporaryPassword: password,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error('admin create', err);
    return NextResponse.json({ error: 'Admin API not configured' }, { status: 500 });
  }
}