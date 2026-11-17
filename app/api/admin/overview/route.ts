import { NextResponse } from 'next/server';
import {
  giftsPaidPaise,
  giftsPendingPaise,
  summarizeDonationGifts,
} from '@/lib/admin/donation-summary';
import { loadReconciliationSnapshot } from '@/lib/admin/reconciliation-snapshot';
import { summarizeOverviewStats } from '@/lib/admin/registration-ledger';
import { loadRegistrationRows, one } from '@/lib/admin/registration-rows';
import { requireVerifiedAdmin } from '@/lib/auth/admin-guard';
import { createAdminClient } from '@/lib/supabase-admin';

export async function GET() {
  const me = await requireVerifiedAdmin();
  if (!me) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const admin = createAdminClient();

  const pendingMembers = await admin
    .from('alumni_accounts')
    .select('id', { count: 'exact', head: true })
    .eq('member_status', 'pending');

  let publishedEvents = 0;
  let catalogReady = false;

  const withDeleted = await admin.from('event_catalog').select('id,deleted_at').eq('published', true);
  if (!withDeleted.error) {
    catalogReady = true;
    publishedEvents = (withDeleted.data || []).filter((e) => !e.deleted_at).length;
  } else {
    const fallback = await admin.from('event_catalog').select('id').eq('published', true);
    catalogReady = !fallback.error;
    if (catalogReady) publishedEvents = fallback.data?.length || 0;
  }

  // Same ledger as Event ops: committee-verified and donations count as settled.
  const { rows } = await loadRegistrationRows('');
  const money = summarizeOverviewStats(
    rows.map((r) => ({
      payment_status: r.payment_status,
      total_cost_paise: r.total_cost_paise,
      amount_paid_paise: r.amount_paid_paise,
      core_committee_manually_verified: r.core_committee_manually_verified,
      bank_reference: r.bank_reference,
      donation: one(r.donation),
    }))
  );

  let pendingMemories = 0;
  const mem = await admin
    .from('alumni_memories')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');
  if (!mem.error) pendingMemories = mem.count || 0;

  let pendingStories = 0;
  const sto = await admin
    .from('alumni_stories')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');
  if (!sto.error) pendingStories = sto.count || 0;

  const pendingApprovals = (pendingMembers.count || 0) + pendingMemories + pendingStories;

  const [gifts, reconciliation] = await Promise.all([
    summarizeDonationGifts(admin),
    loadReconciliationSnapshot(admin),
  ]);

  return NextResponse.json({
    pendingMembers: pendingMembers.count || 0,
    publishedEvents,
    unpaidRegistrations: money.unpaidRegistrations,
    pendingMemories,
    pendingStories,
    pendingApprovals,
    registrationCount: money.registrationCount,
    amountPaidPaise: money.amountPaidPaise,
    amountDuePaise: money.amountDuePaise,
    gifts,
    giftsPaidPaise: giftsPaidPaise(gifts),
    giftsPendingPaise: giftsPendingPaise(gifts),
    totalReceivedPaise: money.amountPaidPaise + gifts.cause_gifts.paid_paise,
    reconciliation,
    catalogReady,
  });
}
