import { NextResponse } from 'next/server';
import { loadReceivableLines } from '@/lib/admin/receivable-lines';
import { requireVerifiedAdmin } from '@/lib/auth/admin-guard';
import { refreshRegistrations } from '@/lib/admin/registration-rows';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const me = await requireVerifiedAdmin();
  if (!me) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const url = new URL(request.url);
  const eventId = String(url.searchParams.get('event_id') || '').trim();
  const statusParam = String(url.searchParams.get('status') || 'all').trim();
  const q = String(url.searchParams.get('q') || '').trim();
  const status =
    statusParam === 'open' || statusParam === 'paid' || statusParam === 'pending'
      ? statusParam
      : 'all';

  await refreshRegistrations(eventId);

  const { lines, error } = await loadReceivableLines({ eventId, status, q });
  if (error) return NextResponse.json({ error }, { status: 500 });

  const summary = {
    line_count: lines.length,
    due_paise: lines.reduce((s, l) => s + l.due_paise, 0),
    settled_paise: lines.reduce((s, l) => s + l.settled_paise, 0),
  };

  return NextResponse.json({ lines, summary });
}