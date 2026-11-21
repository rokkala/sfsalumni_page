import type { AlumniAccount } from '@/lib/auth/request';
import { createAdminClient } from '@/lib/supabase-admin';

export type MemberTransactionReg = {
  id: string;
  registration_code: string | null;
  payment_status: string;
  event_title: string;
};

export type MemberTransactionDon = {
  id: string;
  amount_paise: number;
  payment_status: string;
  cause_title: string;
};

export async function listMemberTransactions(me: AlumniAccount): Promise<{
  registrations: MemberTransactionReg[];
  donations: MemberTransactionDon[];
}> {
  const admin = createAdminClient();
  const [{ data: regs }, { data: dons }] = await Promise.all([
    admin
      .from('event_registrations')
      .select('id,registration_code,payment_status,event_catalog(title)')
      .eq('account_id', me.id)
      .eq('payment_status', 'paid')
      .order('updated_at', { ascending: false })
      .limit(20),
    admin
      .from('donations')
      .select('id,amount_paise,payment_status,cause:donation_causes(title)')
      .eq('account_id', me.id)
      .eq('payment_status', 'paid')
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

  const registrations = (regs || []).map((r) => {
    const ev = Array.isArray(r.event_catalog) ? r.event_catalog[0] : r.event_catalog;
    return {
      id: r.id,
      registration_code: r.registration_code,
      payment_status: r.payment_status,
      event_title: (ev as { title?: string } | null)?.title || 'Event',
    };
  });

  const donations = (dons || []).map((d) => {
    const cause = Array.isArray(d.cause) ? d.cause[0] : d.cause;
    return {
      id: d.id,
      amount_paise: d.amount_paise,
      payment_status: d.payment_status,
      cause_title: (cause as { title?: string } | null)?.title || 'Donation',
    };
  });

  return { registrations, donations };
}