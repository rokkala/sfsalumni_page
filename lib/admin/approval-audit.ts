import type { SupabaseClient } from '@supabase/supabase-js';

export type ApprovalAuditKind =
  | 'membership'
  | 'admin_account'
  | 'memory'
  | 'story'
  | 'remittance_proof'
  | 'registration_payment'
  | 'donation_payment';

export type ApprovalAuditActor = 'admin' | 'auto' | 'manual';

export const AUTO_REVIEWER_ID = '__auto__';
export const MANUAL_REVIEWER_ID = '__manual__';

export type ApprovalAuditRow = {
  kind: ApprovalAuditKind;
  actor: ApprovalAuditActor;
  entity_id: string;
  decision: string;
  subject: string;
  subject_detail: string | null;
  reviewed_at: string;
  reviewed_by_id: string;
  reviewed_by_name: string | null;
  note: string | null;
  link_href: string | null;
};

/** ponytail: one cap for every source query; raise if audit truncates in prod. */
const ROW_CAP = 5000;
const DEFAULT_LIMIT = 10000;
const MAX_LIMIT = 20000;

export function membershipApprovalKind(role: string): ApprovalAuditKind {
  return role === 'admin' ? 'admin_account' : 'membership';
}

export function paymentSettlementActor(gatewayPaymentId: string | null | undefined): ApprovalAuditActor {
  return String(gatewayPaymentId || '').trim() ? 'auto' : 'manual';
}

export function actorDisplayName(actor: ApprovalAuditActor): string {
  if (actor === 'auto') return 'Cashfree (auto)';
  if (actor === 'manual') return 'Committee (manual)';
  return '';
}

export function formatProofSubject(
  sourceType: string,
  amountPaise: number | null,
  utr: string | null,
  payerName: string | null
): string {
  const inr =
    amountPaise != null && Number.isFinite(amountPaise)
      ? `₹${(amountPaise / 100).toLocaleString('en-IN')}`
      : null;
  const bits = [
    sourceType === 'registration' ? 'Registration payment' : 'Donation payment',
    payerName,
    inr,
    utr ? `UTR ${utr}` : null,
  ].filter(Boolean);
  return bits.join(' · ') || 'Remittance proof';
}

function sortRows(rows: ApprovalAuditRow[]): ApprovalAuditRow[] {
  return [...rows].sort(
    (a, b) => new Date(b.reviewed_at).getTime() - new Date(a.reviewed_at).getTime()
  );
}

async function reviewerNames(
  admin: SupabaseClient,
  ids: Iterable<string>
): Promise<Map<string, { full_name: string; email: string }>> {
  const unique = [...new Set(ids)].filter(
    (id) => id && id !== AUTO_REVIEWER_ID && id !== MANUAL_REVIEWER_ID
  );
  const map = new Map<string, { full_name: string; email: string }>();
  if (!unique.length) return map;
  const { data } = await admin.from('alumni_accounts').select('id,full_name,email').in('id', unique);
  for (const a of data || []) {
    map.set(String(a.id), {
      full_name: String(a.full_name || ''),
      email: String(a.email || ''),
    });
  }
  return map;
}

async function approvedProofTargets(admin: SupabaseClient): Promise<{
  registrationIds: Set<string>;
  donationIds: Set<string>;
}> {
  const registrationIds = new Set<string>();
  const donationIds = new Set<string>();
  const { data, error } = await admin
    .from('offline_payment_proofs')
    .select('registration_id,donation_id')
    .eq('status', 'approved')
    .limit(ROW_CAP);
  if (error) {
    console.error('approval audit proof targets', error);
    return { registrationIds, donationIds };
  }
  for (const p of data || []) {
    if (p.registration_id) registrationIds.add(String(p.registration_id));
    if (p.donation_id) donationIds.add(String(p.donation_id));
  }
  return { registrationIds, donationIds };
}

function applyReviewerFilter(rows: ApprovalAuditRow[], reviewerId: string): ApprovalAuditRow[] {
  if (!reviewerId) return rows;
  if (reviewerId === AUTO_REVIEWER_ID) return rows.filter((r) => r.actor === 'auto');
  if (reviewerId === MANUAL_REVIEWER_ID) return rows.filter((r) => r.actor === 'manual');
  return rows.filter((r) => r.actor === 'admin' && r.reviewed_by_id === reviewerId);
}

export type LoadApprovalAuditOptions = {
  kind?: ApprovalAuditKind | 'all';
  reviewerId?: string;
  limit?: number;
};

/** Admin reviews plus payment settlements (Cashfree auto vs committee manual). */
export async function loadApprovalAuditRows(
  admin: SupabaseClient,
  options: LoadApprovalAuditOptions = {}
): Promise<ApprovalAuditRow[]> {
  const kindFilter = options.kind || 'all';
  const limitParam = options.limit ?? DEFAULT_LIMIT;
  const limit = Math.min(Math.max(limitParam, 1), MAX_LIMIT);
  const reviewerId = options.reviewerId?.trim() || '';

  const autoOnly = reviewerId === AUTO_REVIEWER_ID;
  const manualOnly = reviewerId === MANUAL_REVIEWER_ID;
  const humanReviewer = reviewerId && !autoOnly && !manualOnly;

  const rows: ApprovalAuditRow[] = [];
  const reviewerIds: string[] = [];

  const wantAdminKinds = !autoOnly && !manualOnly;
  const wantMembership =
    wantAdminKinds &&
    (kindFilter === 'all' || kindFilter === 'membership' || kindFilter === 'admin_account');

  if (wantMembership) {
    let q = admin
      .from('alumni_accounts')
      .select('id,full_name,email,role,member_status,reviewed_at,reviewed_by')
      .not('reviewed_by', 'is', null)
      .not('reviewed_at', 'is', null)
      .order('reviewed_at', { ascending: false })
      .limit(ROW_CAP);
    if (humanReviewer) q = q.eq('reviewed_by', reviewerId);
    const { data, error } = await q;
    if (error) {
      console.error('approval audit memberships', error);
    } else {
      for (const m of data || []) {
        const kind = membershipApprovalKind(String(m.role || ''));
        if (kindFilter !== 'all' && kindFilter !== kind) continue;
        const by = String(m.reviewed_by);
        reviewerIds.push(by);
        rows.push({
          kind,
          actor: 'admin',
          entity_id: String(m.id),
          decision: String(m.member_status || ''),
          subject: String(m.full_name || m.email || 'Member'),
          subject_detail: m.email ? String(m.email) : null,
          reviewed_at: String(m.reviewed_at),
          reviewed_by_id: by,
          reviewed_by_name: null,
          note: null,
          link_href: kind === 'admin_account' ? '/admin/admins' : '/admin/membership',
        });
      }
    }
  }

  if (wantAdminKinds && (kindFilter === 'all' || kindFilter === 'memory')) {
    let q = admin
      .from('alumni_memories')
      .select('id,title,status,review_note,reviewed_at,reviewed_by')
      .not('reviewed_by', 'is', null)
      .not('reviewed_at', 'is', null)
      .order('reviewed_at', { ascending: false })
      .limit(ROW_CAP);
    if (humanReviewer) q = q.eq('reviewed_by', reviewerId);
    const { data, error } = await q;
    if (error) console.error('approval audit memories', error);
    else {
      for (const m of data || []) {
        const by = String(m.reviewed_by);
        reviewerIds.push(by);
        rows.push({
          kind: 'memory',
          actor: 'admin',
          entity_id: String(m.id),
          decision: String(m.status || ''),
          subject: String(m.title || 'Memory'),
          subject_detail: null,
          reviewed_at: String(m.reviewed_at),
          reviewed_by_id: by,
          reviewed_by_name: null,
          note: m.review_note ? String(m.review_note) : null,
          link_href: '/admin/memories',
        });
      }
    }
  }

  if (wantAdminKinds && (kindFilter === 'all' || kindFilter === 'story')) {
    let q = admin
      .from('alumni_stories')
      .select('id,title,status,review_note,reviewed_at,reviewed_by')
      .not('reviewed_by', 'is', null)
      .not('reviewed_at', 'is', null)
      .order('reviewed_at', { ascending: false })
      .limit(ROW_CAP);
    if (humanReviewer) q = q.eq('reviewed_by', reviewerId);
    const { data, error } = await q;
    if (error) console.error('approval audit stories', error);
    else {
      for (const s of data || []) {
        const by = String(s.reviewed_by);
        reviewerIds.push(by);
        rows.push({
          kind: 'story',
          actor: 'admin',
          entity_id: String(s.id),
          decision: String(s.status || ''),
          subject: String(s.title || 'Story'),
          subject_detail: null,
          reviewed_at: String(s.reviewed_at),
          reviewed_by_id: by,
          reviewed_by_name: null,
          note: s.review_note ? String(s.review_note) : null,
          link_href: '/admin/stories',
        });
      }
    }
  }

  if (wantAdminKinds && (kindFilter === 'all' || kindFilter === 'remittance_proof')) {
    let q = admin
      .from('offline_payment_proofs')
      .select(
        'id,source_type,registration_id,donation_id,account_id,amount_paise,utr,status,admin_note,reviewed_at,reviewed_by'
      )
      .not('reviewed_by', 'is', null)
      .not('reviewed_at', 'is', null)
      .in('status', ['approved', 'rejected'])
      .order('reviewed_at', { ascending: false })
      .limit(ROW_CAP);
    if (humanReviewer) q = q.eq('reviewed_by', reviewerId);
    const { data, error } = await q;
    if (error) {
      console.error('approval audit proofs', error);
    } else {
      const accountIds = [...new Set((data || []).map((r) => r.account_id).filter(Boolean))] as string[];
      const payers = new Map<string, string>();
      if (accountIds.length) {
        const { data: accounts } = await admin
          .from('alumni_accounts')
          .select('id,full_name')
          .in('id', accountIds);
        for (const a of accounts || []) payers.set(String(a.id), String(a.full_name || ''));
      }
      for (const p of data || []) {
        const by = String(p.reviewed_by);
        reviewerIds.push(by);
        const payer = p.account_id ? payers.get(String(p.account_id)) ?? null : null;
        const subject = formatProofSubject(
          String(p.source_type || ''),
          p.amount_paise as number | null,
          p.utr ? String(p.utr) : null,
          payer
        );
        let link_href: string | null = '/admin/remittance-proofs';
        if (p.source_type === 'registration' && p.registration_id) {
          link_href = '/admin/registrations';
        } else if (p.donation_id) {
          link_href = '/admin/donations';
        }
        rows.push({
          kind: 'remittance_proof',
          actor: 'admin',
          entity_id: String(p.id),
          decision: String(p.status || ''),
          subject,
          subject_detail: p.registration_id
            ? `Registration ${p.registration_id}`
            : p.donation_id
              ? `Donation ${p.donation_id}`
              : null,
          reviewed_at: String(p.reviewed_at),
          reviewed_by_id: by,
          reviewed_by_name: null,
          note: p.admin_note ? String(p.admin_note) : null,
          link_href,
        });
      }
    }
  }

  const wantPayments =
    !humanReviewer &&
    (kindFilter === 'all' || kindFilter === 'registration_payment' || kindFilter === 'donation_payment');

  if (wantPayments) {
    const proofTargets = await approvedProofTargets(admin);

    if (kindFilter === 'all' || kindFilter === 'registration_payment') {
      const { data, error } = await admin
        .from('event_registrations')
        .select(
          'id,event_id,account_id,payment_status,amount_paid_paise,total_cost_paise,razorpay_payment_id,razorpay_order_id,updated_at'
        )
        .or('payment_status.eq.paid,payment_status.eq.partial,amount_paid_paise.gt.0')
        .order('updated_at', { ascending: false })
        .limit(ROW_CAP);

      if (error) console.error('approval audit registrations', error);
      else {
        const regRows = data || [];
        const eventIds = [...new Set(regRows.map((r) => r.event_id).filter(Boolean))] as string[];
        const accountIds = [...new Set(regRows.map((r) => r.account_id).filter(Boolean))] as string[];

        const eventTitle = new Map<string, string>();
        const memberName = new Map<string, string>();

        await Promise.all([
          eventIds.length
            ? admin
                .from('event_catalog')
                .select('id,title')
                .in('id', eventIds)
                .then(({ data: events }) => {
                  for (const e of events || []) eventTitle.set(String(e.id), String(e.title || ''));
                })
            : Promise.resolve(),
          accountIds.length
            ? admin
                .from('alumni_accounts')
                .select('id,full_name,email')
                .in('id', accountIds)
                .then(({ data: accounts }) => {
                  for (const a of accounts || []) {
                    memberName.set(String(a.id), String(a.full_name || a.email || ''));
                  }
                })
            : Promise.resolve(),
        ]);

        for (const r of regRows) {
          const regId = String(r.id);
          if (proofTargets.registrationIds.has(regId)) continue;

          const actor = paymentSettlementActor(r.razorpay_payment_id as string | null);
          if (autoOnly && actor !== 'auto') continue;
          if (manualOnly && actor !== 'manual') continue;

          const paid = Math.max(0, Number(r.amount_paid_paise) || 0);
          const inr = `₹${(paid / 100).toLocaleString('en-IN')}`;
          const who = memberName.get(String(r.account_id)) || 'Registration';
          const event = eventTitle.get(String(r.event_id)) || 'Event';
          const gatewayId = String(r.razorpay_payment_id || '').trim();
          const orderId = String(r.razorpay_order_id || '').trim();

          rows.push({
            kind: 'registration_payment',
            actor,
            entity_id: regId,
            decision: String(r.payment_status || 'paid'),
            subject: `${who} · ${event}`,
            subject_detail: `${inr} collected`,
            reviewed_at: String(r.updated_at),
            reviewed_by_id: actor === 'auto' ? AUTO_REVIEWER_ID : MANUAL_REVIEWER_ID,
            reviewed_by_name: actorDisplayName(actor),
            note:
              actor === 'auto' && (gatewayId || orderId)
                ? [orderId && `order ${orderId}`, gatewayId && `pg ${gatewayId}`].filter(Boolean).join(' · ')
                : 'Marked paid without Cashfree id (receivables or zero-fee)',
            link_href: '/admin/registrations',
          });
        }
      }
    }

    if (kindFilter === 'all' || kindFilter === 'donation_payment') {
      const { data, error } = await admin
        .from('donations')
        .select(
          'id,amount_paise,payment_status,razorpay_payment_id,razorpay_order_id,updated_at,account_id,cause_id,event_id'
        )
        .eq('payment_status', 'paid')
        .order('updated_at', { ascending: false })
        .limit(ROW_CAP);

      if (error) console.error('approval audit donations', error);
      else {
        const donRows = data || [];
        const accountIds = [...new Set(donRows.map((d) => d.account_id).filter(Boolean))] as string[];
        const memberName = new Map<string, string>();
        if (accountIds.length) {
          const { data: accounts } = await admin
            .from('alumni_accounts')
            .select('id,full_name,email')
            .in('id', accountIds);
          for (const a of accounts || []) {
            memberName.set(String(a.id), String(a.full_name || a.email || ''));
          }
        }

        for (const d of donRows) {
          const donId = String(d.id);
          if (proofTargets.donationIds.has(donId)) continue;

          const actor = paymentSettlementActor(d.razorpay_payment_id as string | null);
          if (autoOnly && actor !== 'auto') continue;
          if (manualOnly && actor !== 'manual') continue;

          const amount = Math.max(0, Number(d.amount_paise) || 0);
          const inr = `₹${(amount / 100).toLocaleString('en-IN')}`;
          const who = d.account_id ? memberName.get(String(d.account_id)) || 'Donor' : 'Donor';
          const gatewayId = String(d.razorpay_payment_id || '').trim();
          const orderId = String(d.razorpay_order_id || '').trim();
          const channel = d.event_id ? 'Registration gift' : 'Cause gift';

          rows.push({
            kind: 'donation_payment',
            actor,
            entity_id: donId,
            decision: 'paid',
            subject: `${who} · ${channel}`,
            subject_detail: inr,
            reviewed_at: String(d.updated_at),
            reviewed_by_id: actor === 'auto' ? AUTO_REVIEWER_ID : MANUAL_REVIEWER_ID,
            reviewed_by_name: actorDisplayName(actor),
            note:
              actor === 'auto' && (gatewayId || orderId)
                ? [orderId && `order ${orderId}`, gatewayId && `pg ${gatewayId}`].filter(Boolean).join(' · ')
                : 'Marked paid without Cashfree id',
            link_href: '/admin/donations',
          });
        }
      }
    }
  }

  const names = await reviewerNames(admin, reviewerIds);
  for (const row of rows) {
    if (row.actor !== 'admin') continue;
    const rev = names.get(row.reviewed_by_id);
    row.reviewed_by_name = rev?.full_name || rev?.email || null;
  }

  const filtered = applyReviewerFilter(rows, reviewerId);
  return sortRows(filtered).slice(0, limit);
}

if (process.env.NODE_ENV !== 'production' && typeof require !== 'undefined') {
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`approval-audit self-check: ${msg}`);
  };
  assert(membershipApprovalKind('admin') === 'admin_account', 'admin role');
  assert(membershipApprovalKind('member') === 'membership', 'member role');
  assert(formatProofSubject('registration', 10000, 'U1', 'A').includes('Registration'), 'proof label');
  assert(paymentSettlementActor('cf_123') === 'auto', 'gateway id');
  assert(paymentSettlementActor(null) === 'manual', 'no gateway');
  assert(actorDisplayName('auto') === 'Cashfree (auto)', 'auto label');
}