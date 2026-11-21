import { NextResponse } from 'next/server';
import { getCurrentAccount } from '@/lib/auth/request';
import { selectCatalog } from '@/lib/events/catalog-select';
import { eventIsOpen } from '@/lib/events/open';
import { isEventSoftDeleted } from '@/lib/events/soft-delete';
import type { EventCatalog } from '@/lib/events/types';
import { loadRegistrationForPageLoad } from '@/lib/events/register';
import { loadMemberBankDetails } from '@/lib/payments/member-bank-details';
import { createAdminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

/** One serverless hit for /registration?event=… (event + session + saved reg + bank). */
export async function GET(request: Request) {
  try {
    const eventId = new URL(request.url).searchParams.get('eventId')?.trim() || '';
    if (!eventId) {
      return NextResponse.json({ error: 'eventId is required' }, { status: 400 });
    }

    const admin = createAdminClient();
    const [catalogResult, me] = await Promise.all([
      selectCatalog((columns) =>
        admin.from('event_catalog').select(columns).eq('id', eventId).eq('published', true).maybeSingle()
      ),
      getCurrentAccount(),
    ]);
    const { data, error } = catalogResult;
    const row = data as unknown as EventCatalog | null;
    if (
      error ||
      !row ||
      isEventSoftDeleted(row) ||
      !eventIsOpen(row as { starts_at: string; ends_at?: string | null }, new Date())
    ) {
      return NextResponse.json({
        event: null,
        eventError: 'This event is not available for registration.',
      });
    }
    if (!me) {
      return NextResponse.json({
        event: row,
        member: null,
      });
    }

    if (me.role === 'admin') {
      return NextResponse.json({
        event: row,
        member: {
          id: me.id,
          email: me.email,
          full_name: me.full_name,
          last_name: me.last_name,
          phone_number: me.phone_number,
          role: me.role,
          member_status: me.member_status,
          jubilee_reg_status: me.jubilee_reg_status,
          batch: me.batch,
          section: me.section,
          current_location: me.current_location,
        },
        gate: 'admin',
      });
    }

    const [regResult, bank] = await Promise.all([
      loadRegistrationForPageLoad(me, eventId),
      loadMemberBankDetails(admin),
    ]);

    return NextResponse.json({
      event: row,
      member: {
        id: me.id,
        email: me.email,
        full_name: me.full_name,
        last_name: me.last_name,
        phone_number: me.phone_number,
        role: me.role,
        member_status: me.member_status,
        jubilee_reg_status: me.jubilee_reg_status,
        batch: me.batch,
        section: me.section,
        current_location: me.current_location,
      },
      gate: 'ok',
      registration: regResult.payload,
      bank,
    });
  } catch (err) {
    console.error('registration page bootstrap', err);
    return NextResponse.json({ error: 'Could not load registration' }, { status: 500 });
  }
}