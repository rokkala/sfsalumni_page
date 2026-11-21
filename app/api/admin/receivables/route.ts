import { NextResponse } from 'next/server';
import { loadReceivableLines } from '@/lib/admin/receivable-lines';
import { syncOpenCashfreeFromLines } from '@/lib/admin/reconcile-cashfree';
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

  try {
    await refreshRegistrations(eventId);
  } catch (e) {
    console.error('admin receivables refresh', e);
  }

  const cashfreeSyncRequested = url.searchParams.get('cashfree_sync') === '1';

  let lines: Awaited<ReturnType<typeof loadReceivableLines>>['lines'];
  let error: string | null;
  let cashfree_sync: Awaited<ReturnType<typeof syncOpenCashfreeFromLines>> | undefined;

  if (cashfreeSyncRequested) {
    const first = await loadReceivableLines({ eventId, status, q });
    if (first.error) return NextResponse.json({ error: first.error }, { status: 500 });
    cashfree_sync = await syncOpenCashfreeFromLines(first.lines);
    const reloaded = await loadReceivableLines({ eventId, status, q });
    lines = reloaded.lines;
    error = reloaded.error;
  } else {
    const loaded = await loadReceivableLines({ eventId, status, q });
    lines = loaded.lines;
    error = loaded.error;
  }

  if (error) return NextResponse.json({ error }, { status: 500 });

  const summary = {
    line_count: lines.length,
    due_paise: lines.reduce((s, l) => s + l.due_paise, 0),
    settled_paise: lines.reduce((s, l) => s + l.settled_paise, 0),
  };

  return NextResponse.json({ lines, summary, cashfree_sync });
}