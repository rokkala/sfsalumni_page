import { NextResponse } from 'next/server';
import { getCurrentAccount } from '@/lib/auth/request';
import { formatCostForDisplay } from '@/lib/registration/registration';
import { createAdminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

/** Printable HTML receipt for a paid registration or donation owned by the member. */
export async function GET(request: Request) {
  const me = await getCurrentAccount();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const registrationId = url.searchParams.get('registrationId')?.trim();
  const donationId = url.searchParams.get('donationId')?.trim();

  const admin = createAdminClient();

  if (donationId) {
    const { data: d } = await admin
      .from('donations')
      .select('id,account_id,amount_paise,payment_status,created_at,cause:donation_causes(title)')
      .eq('id', donationId)
      .eq('account_id', me.id)
      .maybeSingle();
    if (!d || d.payment_status !== 'paid') {
      return NextResponse.json({ error: 'Receipt not available' }, { status: 404 });
    }
    const cause = Array.isArray(d.cause) ? d.cause[0] : d.cause;
    return htmlReceipt({
      title: 'Donation receipt',
      lines: [
        ['Cause', (cause as { title?: string } | null)?.title || 'Donation'],
        ['Amount', formatCostForDisplay(Number(d.amount_paise) || 0)],
        ['Status', 'Paid'],
        ['Date', formatWhen(String(d.created_at))],
        ['Paid by', me.full_name || me.email],
      ],
    });
  }

  if (!registrationId) {
    return NextResponse.json({ error: 'registrationId or donationId required' }, { status: 400 });
  }

  const { data: reg } = await admin
    .from('event_registrations')
    .select(
      'id,account_id,payment_status,total_cost_paise,amount_paid_paise,registration_code,created_at,event_catalog(title)'
    )
    .eq('id', registrationId)
    .eq('account_id', me.id)
    .maybeSingle();
  if (!reg || reg.payment_status !== 'paid') {
    return NextResponse.json({ error: 'Receipt not available' }, { status: 404 });
  }
  const event = Array.isArray(reg.event_catalog) ? reg.event_catalog[0] : reg.event_catalog;

  return htmlReceipt({
    title: 'Registration payment receipt',
    lines: [
      ['Event', (event as { title?: string } | null)?.title || 'Event'],
      ['Registration ID', reg.registration_code || '—'],
      ['Amount received', formatCostForDisplay(Number(reg.amount_paid_paise) || 0)],
      ['Total billed', formatCostForDisplay(Number(reg.total_cost_paise) || 0)],
      ['Status', 'Paid'],
      ['Date', formatWhen(String(reg.created_at))],
      ['Paid by', me.full_name || me.email],
    ],
  });
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
}

function htmlReceipt(input: { title: string; lines: [string, string][] }): NextResponse {
  const rows = input.lines
    .map(
      ([k, v]) =>
        `<tr><th style="text-align:left;padding:8px 12px;border-bottom:1px solid #e5e7eb">${escapeHtml(k)}</th><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${escapeHtml(v)}</td></tr>`
    )
    .join('');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${escapeHtml(input.title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:2rem auto;padding:0 1rem;color:#0a1628}
h1{font-size:1.25rem}table{width:100%;border-collapse:collapse;margin-top:1rem}@media print{button{display:none}}</style></head>
<body><h1>${escapeHtml(input.title)}</h1><p style="color:#64748b;font-size:0.875rem">SFS Alumni Golden Jubilee</p>
<table>${rows}</table>
<button onclick="window.print()" style="margin-top:1.5rem;padding:0.5rem 1rem">Print / Save as PDF</button></body></html>`;
  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}