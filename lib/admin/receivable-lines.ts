// lib/admin/receivable-lines.ts
// One ledger row per money reason (registration fee vs donation), even when both sit on one registration.

import { deriveDonationReconMeta, donationKind } from '@/lib/admin/donation-recon-meta';
import { amountDuePaise } from '@/lib/events/balance';
import { one, loadRegistrationRows, type RegistrationDbRow } from '@/lib/admin/registration-rows';
import { displayBankReference } from '@/lib/admin/registration-proof';
import { createAdminClient } from '@/lib/supabase-admin';

export type ReceivableLineKind = 'registration_fee' | 'registration_gift' | 'cause_donation';

export type ReceivableLine = {
  line_key: string;
  kind: ReceivableLineKind;
  reason: string;
  amount_paise: number;
  settled_paise: number;
  due_paise: number;
  payment_status: string;
  payer_name: string;
  payer_email: string;
  event_title: string | null;
  event_id: string | null;
  registration_id: string | null;
  donation_id: string | null;
  created_at: string;
  channel_label: string;
  recon_hint: string;
  proof_id: string | null;
  bank_reference: string | null;
  /** Cashfree PG order id stored in razorpay_order_id. */
  cashfree_order_id: string | null;
};

export function parseReceivableLineKey(lineKey: string): { kind: 'fee' | 'donation'; id: string } | null {
  const trimmed = String(lineKey || '').trim();
  const sep = trimmed.indexOf(':');
  if (sep < 1) return null;
  const head = trimmed.slice(0, sep);
  const id = trimmed.slice(sep + 1).trim();
  if (!id) return null;
  if (head === 'fee') return { kind: 'fee', id };
  if (head === 'donation') return { kind: 'donation', id };
  return null;
}

function feeLineFromRegistration(
  row: RegistrationDbRow,
  account: { full_name: string; email: string } | null,
  eventTitle: string,
  proofByReg: Map<string, { utr: string | null; proof_id: string | null }>
): ReceivableLine | null {
  const total = Math.max(0, Number(row.total_cost_paise) || 0);
  if (total < 1) return null;
  const paid = Math.max(0, Number(row.amount_paid_paise) || 0);
  const due = amountDuePaise(total, paid);
  const proof = proofByReg.get(row.id);
  const bank_reference = displayBankReference({
    bankReference: row.bank_reference,
    proofUtr: proof?.utr ?? null,
  });
  const settled = Math.min(total, paid);
  const paidLine = paid >= total;
  const cashfreeOrderId = String(row.razorpay_order_id || '').trim() || null;
  const cashfreeDue = due > 0 && cashfreeOrderId && !proof?.proof_id;
  return {
    line_key: `fee:${row.id}`,
    kind: 'registration_fee',
    reason: `Event registration fee · ${eventTitle}`,
    amount_paise: total,
    settled_paise: settled,
    due_paise: due,
    payment_status: paidLine ? 'paid' : paid > 0 ? 'partial' : 'pending',
    payer_name: account?.full_name || '—',
    payer_email: account?.email || '—',
    event_title: eventTitle,
    event_id: row.event_id,
    registration_id: row.id,
    donation_id: null,
    created_at: row.created_at,
    channel_label:
      row.payment_status === 'paid'
        ? bank_reference
          ? 'Bank / UPI'
          : 'Cashfree'
        : cashfreeOrderId
          ? 'Cashfree'
          : bank_reference
            ? 'Bank / UPI'
            : 'Awaiting payment',
    recon_hint: proof?.proof_id
      ? 'Pending remittance proof — review on Remittance proofs.'
      : cashfreeDue
        ? 'Cashfree order on file — auto-matched on refresh when PG shows paid.'
        : bank_reference
          ? 'Match bank reference on the statement.'
          : 'Mark paid after Cashfree or offline confirmation.',
    proof_id: proof?.proof_id ?? null,
    bank_reference,
    cashfree_order_id: cashfreeOrderId,
  };
}

function giftLineFromRegistration(
  row: RegistrationDbRow,
  account: { full_name: string; email: string } | null,
  eventTitle: string,
  proofByDonation: Map<string, { id: string; status: string }>,
  proofByReg: Map<string, { utr: string | null; proof_id: string | null }>
): ReceivableLine | null {
  const donation = one(row.donation);
  const donationId = row.donation_id || donation?.id || null;
  if (!donationId || !donation || donation.payment_status === 'failed') return null;
  const amount = Math.max(0, Number(donation.amount_paise) || 0);
  if (amount < 1) return null;
  const status = String(donation.payment_status || 'pending');
  const settled = status === 'paid' ? amount : 0;
  const due = status === 'paid' ? 0 : amount;
  const proof = proofByDonation.get(donationId);
  const regProof = proofByReg.get(row.id);
  const linkedProofId =
    proof?.status === 'pending'
      ? proof.id
      : regProof?.proof_id
        ? regProof.proof_id
        : null;
  const recon = deriveDonationReconMeta({
    payment_status: status,
    event_id: row.event_id,
    razorpay_order_id: null,
    razorpay_payment_id: null,
    proof: proof ? { id: proof.id, status: proof.status } : null,
  });
  const regCashfree = String(row.razorpay_order_id || '').trim();
  const donCashfree = String(donation?.razorpay_order_id || '').trim();
  const cashfreeOrderId = donCashfree || regCashfree || null;
  const cashfreeDue = due > 0 && cashfreeOrderId && !linkedProofId;
  const reconHint =
    linkedProofId && status !== 'paid'
      ? 'Same registration proof covers fee + gift — approve on either line.'
      : cashfreeDue
        ? 'Cashfree order on file — auto-matched on refresh when PG shows paid.'
        : recon.recon_hint;
  return {
    line_key: `donation:${donationId}`,
    kind: 'registration_gift',
    reason: `Gift with registration · ${eventTitle}`,
    amount_paise: amount,
    settled_paise: settled,
    due_paise: due,
    payment_status: status,
    payer_name: account?.full_name || '—',
    payer_email: account?.email || '—',
    event_title: eventTitle,
    event_id: row.event_id,
    registration_id: row.id,
    donation_id: donationId,
    created_at: row.created_at,
    channel_label: recon.channel_label,
    recon_hint: reconHint,
    proof_id: linkedProofId,
    bank_reference: null,
    cashfree_order_id: cashfreeOrderId,
  };
}

export async function loadReceivableLines(filters: {
  eventId?: string;
  status?: 'all' | 'open' | 'paid' | 'pending';
  q?: string;
}): Promise<{ lines: ReceivableLine[]; error: string | null }> {
  const { rows, error } = await loadRegistrationRows(filters.eventId || '');
  if (error) return { lines: [], error };

  const admin = createAdminClient();
  const registrationIds = rows.map((r) => r.id);
  const donationIdsFromRegs = rows.map((r) => r.donation_id).filter(Boolean) as string[];

  const proofByReg = new Map<string, { utr: string | null; proof_id: string | null }>();
  if (registrationIds.length) {
    const { data: regProofs } = await admin
      .from('offline_payment_proofs')
      .select('id,registration_id,utr,status,created_at')
      .in('registration_id', registrationIds)
      .order('created_at', { ascending: false });
    for (const p of regProofs || []) {
      const rid = String(p.registration_id || '');
      if (!rid || proofByReg.has(rid)) continue;
      if (p.status === 'pending') {
        proofByReg.set(rid, { utr: p.utr ?? null, proof_id: p.id });
      }
    }
  }

  const proofByDonation = new Map<string, { id: string; status: string }>();
  const allDonationIds = new Set(donationIdsFromRegs);
  if (allDonationIds.size) {
    const { data: donProofs } = await admin
      .from('offline_payment_proofs')
      .select('id,donation_id,status,created_at')
      .in('donation_id', [...allDonationIds])
      .order('created_at', { ascending: false });
    for (const p of donProofs || []) {
      const did = String(p.donation_id || '');
      if (!did || proofByDonation.has(did)) continue;
      proofByDonation.set(did, { id: p.id, status: String(p.status || '') });
    }
  }

  let causeQuery = admin
    .from('donations')
    .select(
      'id,amount_paise,payment_status,razorpay_order_id,created_at,event_id,account_id,donation_causes(title),alumni_accounts(full_name,email)'
    )
    .is('event_id', null)
    .order('created_at', { ascending: false })
    .limit(400);

  const { data: causeRows, error: causeErr } = await filters.eventId
    ? { data: [], error: null }
    : await causeQuery;
  if (causeErr) console.error('receivable cause donations', causeErr);

  const causeDonationIds = (causeRows || []).map((r) => r.id).filter(Boolean) as string[];
  if (causeDonationIds.length) {
    const { data: causeProofs } = await admin
      .from('offline_payment_proofs')
      .select('id,donation_id,status,created_at')
      .in('donation_id', causeDonationIds)
      .order('created_at', { ascending: false });
    for (const p of causeProofs || []) {
      const did = String(p.donation_id || '');
      if (!did || proofByDonation.has(did)) continue;
      proofByDonation.set(did, { id: p.id, status: String(p.status || '') });
    }
  }

  const lines: ReceivableLine[] = [];

  for (const row of rows) {
    const account = one(row.alumni_accounts);
    const event = one(row.event_catalog);
    const eventTitle = event?.title || 'Event';
    const fee = feeLineFromRegistration(
      row,
      account,
      eventTitle,
      proofByReg
    );
    if (fee) lines.push(fee);
    const gift = giftLineFromRegistration(row, account, eventTitle, proofByDonation, proofByReg);
    if (gift) lines.push(gift);
  }

  for (const row of causeRows || []) {
    const kind = donationKind(row.event_id);
    if (kind === 'event') continue;
    const cause = row.donation_causes as { title?: string } | { title?: string }[] | null;
    const causeRow = Array.isArray(cause) ? cause[0] : cause;
    const account = row.alumni_accounts as { full_name: string; email: string } | { full_name: string; email: string }[] | null;
    const acc = Array.isArray(account) ? account[0] : account;
    const amount = Math.max(0, Number(row.amount_paise) || 0);
    if (amount < 1) continue;
    const status = String(row.payment_status || 'pending');
    const proof = proofByDonation.get(row.id);
    const cfOrder = String(row.razorpay_order_id || '').trim() || null;
    const recon = deriveDonationReconMeta({
      payment_status: status,
      event_id: row.event_id,
      razorpay_order_id: cfOrder,
      razorpay_payment_id: null,
      proof: proof ? { id: proof.id, status: proof.status } : null,
    });
    const cashfreeDue = status !== 'paid' && cfOrder && !(proof?.status === 'pending');
    lines.push({
      line_key: `donation:${row.id}`,
      kind: 'cause_donation',
      reason: `Donation · ${causeRow?.title || 'Cause'}`,
      amount_paise: amount,
      settled_paise: status === 'paid' ? amount : 0,
      due_paise: status === 'paid' ? 0 : amount,
      payment_status: status,
      payer_name: acc?.full_name || '—',
      payer_email: acc?.email || '—',
      event_title: null,
      event_id: null,
      registration_id: null,
      donation_id: row.id,
      created_at: row.created_at,
      channel_label: recon.channel_label,
      recon_hint: cashfreeDue
        ? 'Cashfree order on file — auto-matched on refresh when PG shows paid.'
        : recon.recon_hint,
      proof_id: proof?.status === 'pending' ? proof.id : null,
      bank_reference: null,
      cashfree_order_id: cfOrder,
    });
  }

  lines.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

  const q = (filters.q || '').trim().toLowerCase();
  let filtered = lines;
  if (filters.status === 'open') {
    filtered = filtered.filter((l) => l.due_paise > 0);
  } else if (filters.status === 'paid') {
    filtered = filtered.filter((l) => l.payment_status === 'paid');
  } else if (filters.status === 'pending') {
    filtered = filtered.filter((l) => l.payment_status !== 'paid');
  }
  if (q) {
    filtered = filtered.filter(
      (l) =>
        l.reason.toLowerCase().includes(q) ||
        l.payer_name.toLowerCase().includes(q) ||
        l.payer_email.toLowerCase().includes(q) ||
        (l.bank_reference || '').toLowerCase().includes(q)
    );
  }

  return { lines: filtered, error: null };
}