import { NextResponse } from 'next/server';
import { getCurrentAccount } from '@/lib/auth/request';
import { listMemberTransactions } from '@/lib/member/transactions';

export const dynamic = 'force-dynamic';

export async function GET() {
  const me = await getCurrentAccount();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const payload = await listMemberTransactions(me);
  return NextResponse.json(payload);
}