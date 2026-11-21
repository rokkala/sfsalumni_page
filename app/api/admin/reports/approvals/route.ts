import { NextResponse } from 'next/server';
import {
  AUTO_REVIEWER_ID,
  MANUAL_REVIEWER_ID,
  loadApprovalAuditRows,
  type ApprovalAuditKind,
} from '@/lib/admin/approval-audit';
import { requireVerifiedAdmin } from '@/lib/auth/admin-guard';
import { createAdminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

const KINDS = new Set<ApprovalAuditKind | 'all'>([
  'all',
  'membership',
  'admin_account',
  'memory',
  'story',
  'remittance_proof',
  'registration_payment',
  'donation_payment',
]);

export async function GET(request: Request) {
  const me = await requireVerifiedAdmin();
  if (!me) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const url = new URL(request.url);
  const kindParam = String(url.searchParams.get('kind') || 'all').trim() as ApprovalAuditKind | 'all';
  const kind = KINDS.has(kindParam) ? kindParam : 'all';
  const reviewerId = String(url.searchParams.get('reviewer') || '').trim();
  const limitRaw = Number(url.searchParams.get('limit') || '10000');

  const admin = createAdminClient();
  const rows = await loadApprovalAuditRows(admin, {
    kind,
    reviewerId: reviewerId || undefined,
    limit: Number.isFinite(limitRaw) ? limitRaw : 10000,
  });

  const reviewers = new Map<string, string>();
  for (const row of rows) {
    if (row.actor !== 'admin') continue;
    if (!reviewers.has(row.reviewed_by_id)) {
      reviewers.set(row.reviewed_by_id, row.reviewed_by_name || row.reviewed_by_id);
    }
  }

  const presetReviewers = [
    { id: AUTO_REVIEWER_ID, name: 'Cashfree (auto)' },
    { id: MANUAL_REVIEWER_ID, name: 'Committee (manual)' },
  ];

  return NextResponse.json({
    count: rows.length,
    rows,
    filters: { kind, reviewer: reviewerId || null },
    reviewers: [
      ...presetReviewers,
      ...[...reviewers.entries()]
        .filter(([id]) => id !== AUTO_REVIEWER_ID && id !== MANUAL_REVIEWER_ID)
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    ],
  });
}