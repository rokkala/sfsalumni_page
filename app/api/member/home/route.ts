import { NextResponse } from 'next/server';
import { getCurrentAccount } from '@/lib/auth/request';
import { listAccountVenuePasses } from '@/lib/events/register';
import { listMemberTransactions } from '@/lib/member/transactions';
import { getPortalMenuFlags } from '@/lib/portal-menu/load';

export const dynamic = 'force-dynamic';

/** One auth + one serverless hit for My home (pass, receipts, nav flags). */
export async function GET() {
  try {
    const me = await getCurrentAccount();
    if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const [venue, transactions, menu] = await Promise.all([
      listAccountVenuePasses(me),
      listMemberTransactions(me),
      getPortalMenuFlags(),
    ]);

    return NextResponse.json({
      member: {
        id: me.id,
        email: me.email,
        full_name: me.full_name,
        batch: me.batch,
        role: me.role,
        member_status: me.member_status,
      },
      venuePasses: venue.payload,
      transactions,
      menu,
    });
  } catch (err) {
    console.error('member home', err);
    return NextResponse.json({ error: 'Could not load member home' }, { status: 500 });
  }
}