import type { SupabaseClient } from '@supabase/supabase-js';

export type PortalOrderLink = {
  kind: 'donation' | 'registration';
  id: string;
  label: string;
  member_name: string;
  member_email: string;
};

function accountLabel(
  accounts: Map<string, { full_name: string; email: string }>,
  accountId: string | null | undefined
) {
  const id = String(accountId || '').trim();
  if (!id) return { member_name: '—', member_email: '' };
  const a = accounts.get(id);
  return { member_name: a?.full_name || '—', member_email: a?.email || '' };
}

export async function buildPortalOrderIndex(
  admin: SupabaseClient
): Promise<Map<string, PortalOrderLink[]>> {
  const map = new Map<string, PortalOrderLink[]>();

  const add = (orderId: string, link: PortalOrderLink) => {
    const key = orderId.trim();
    if (!key) return;
    const list = map.get(key) || [];
    list.push(link);
    map.set(key, list);
  };

  const { data: donations, error: dErr } = await admin
    .from('donations')
    .select('id,razorpay_order_id,account_id,cause_id')
    .not('razorpay_order_id', 'is', null);
  if (dErr) console.error('portal orders donations', dErr);

  const { data: regs, error: rErr } = await admin
    .from('event_registrations')
    .select('id,razorpay_order_id,account_id,event_id')
    .not('razorpay_order_id', 'is', null);
  if (rErr) console.error('portal orders registrations', rErr);

  const accountIds = new Set<string>();
  for (const row of donations || []) {
    if (row.account_id) accountIds.add(String(row.account_id));
  }
  for (const row of regs || []) {
    if (row.account_id) accountIds.add(String(row.account_id));
  }

  const causeIds = [...new Set((donations || []).map((r) => r.cause_id).filter(Boolean))] as string[];
  const eventIds = [...new Set((regs || []).map((r) => r.event_id).filter(Boolean))] as string[];

  const [accountsRes, causesRes, eventsRes] = await Promise.all([
    accountIds.size
      ? admin.from('alumni_accounts').select('id,full_name,email').in('id', [...accountIds])
      : Promise.resolve({ data: [] as { id: string; full_name: string; email: string }[] }),
    causeIds.length
      ? admin.from('donation_causes').select('id,title').in('id', causeIds)
      : Promise.resolve({ data: [] as { id: string; title: string }[] }),
    eventIds.length
      ? admin.from('event_catalog').select('id,title').in('id', eventIds)
      : Promise.resolve({ data: [] as { id: string; title: string }[] }),
  ]);

  const accounts = new Map(
    (accountsRes.data || []).map((a) => [String(a.id), { full_name: a.full_name, email: a.email }])
  );
  const causes = new Map((causesRes.data || []).map((c) => [String(c.id), c.title]));
  const events = new Map((eventsRes.data || []).map((e) => [String(e.id), e.title]));

  for (const row of donations || []) {
    const orderId = String(row.razorpay_order_id || '').trim();
    if (!orderId) continue;
    const who = accountLabel(accounts, row.account_id);
    add(orderId, {
      kind: 'donation',
      id: String(row.id),
      label: causes.get(String(row.cause_id || '')) || 'Donation',
      ...who,
    });
  }

  for (const row of regs || []) {
    const orderId = String(row.razorpay_order_id || '').trim();
    if (!orderId) continue;
    const who = accountLabel(accounts, row.account_id);
    add(orderId, {
      kind: 'registration',
      id: String(row.id),
      label: events.get(String(row.event_id || '')) || 'Event registration',
      ...who,
    });
  }

  return map;
}