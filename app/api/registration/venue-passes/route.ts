import { NextResponse } from 'next/server';
import { getCurrentAccount } from '@/lib/auth/request';
import { listAccountVenuePasses } from '@/lib/events/register';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const me = await getCurrentAccount();
    if (!me) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
    const result = await listAccountVenuePasses(me);
    return NextResponse.json(result.payload, { status: result.status });
  } catch (err) {
    console.error('registration venue-passes', err);
    return NextResponse.json({ error: 'Registration API not configured' }, { status: 500 });
  }
}