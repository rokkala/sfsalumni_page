import { createAdminClient } from '@/lib/supabase-admin';

export type GiftBucket = {
  count: number;
  paid_paise: number;
  pending_paise: number;
};

export type DonationGiftSummary = {
  cause_gifts: GiftBucket;
  event_gifts: GiftBucket;
};

function bucketFromRows(
  rows: { payment_status: string; amount_paise: number }[]
): GiftBucket {
  let count = 0;
  let paid_paise = 0;
  let pending_paise = 0;
  for (const row of rows) {
    const status = String(row.payment_status || '');
    const amount = Math.max(0, Math.floor(Number(row.amount_paise) || 0));
    if (status === 'failed' || amount < 1) continue;
    count += 1;
    if (status === 'paid') paid_paise += amount;
    else pending_paise += amount;
  }
  return { count, paid_paise, pending_paise };
}

function missingDonationsSchema(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    /donations/i.test(error.message || '') ||
    /schema cache/i.test(error.message || '')
  );
}

/**
 * Cause gifts = /member/donate. Event gifts = jubilee add-on rows (event_id set).
 * Optional eventId scopes event_gifts only (cause gifts stay org-wide).
 */
export async function summarizeDonationGifts(
  admin: ReturnType<typeof createAdminClient> = createAdminClient(),
  opts?: { eventId?: string }
): Promise<DonationGiftSummary> {
  const empty: DonationGiftSummary = {
    cause_gifts: { count: 0, paid_paise: 0, pending_paise: 0 },
    event_gifts: { count: 0, paid_paise: 0, pending_paise: 0 },
  };

  const { data: causeRows, error: causeErr } = await admin
    .from('donations')
    .select('payment_status,amount_paise')
    .not('cause_id', 'is', null)
    .is('event_id', null);

  if (causeErr && !missingDonationsSchema(causeErr)) {
    console.error('donation summary cause', causeErr);
  }

  let eventQ = admin.from('donations').select('payment_status,amount_paise').not('event_id', 'is', null);
  if (opts?.eventId) eventQ = eventQ.eq('event_id', opts.eventId);

  const { data: eventRows, error: eventErr } = await eventQ;
  if (eventErr && !missingDonationsSchema(eventErr)) {
    console.error('donation summary event', eventErr);
  }

  return {
    cause_gifts: bucketFromRows(causeRows || []),
    event_gifts: bucketFromRows(eventRows || []),
  };
}

export function giftsPaidPaise(summary: DonationGiftSummary): number {
  return summary.cause_gifts.paid_paise + summary.event_gifts.paid_paise;
}

export function giftsPendingPaise(summary: DonationGiftSummary): number {
  return summary.cause_gifts.pending_paise + summary.event_gifts.pending_paise;
}