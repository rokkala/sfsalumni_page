import { appOrigin } from '@/lib/auth/app-origin';

/** Emails venue pass code when issued (Resend). No-op without RESEND_API_KEY. */
export async function sendVenuePassEmail(input: {
  to: string;
  fullName: string;
  eventTitle: string;
  registrationCode: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim() || 'SFS Alumni <admin@alumnicorner.org>';
  const passUrl = `${appOrigin()}/event-app/pass`;

  const subject = `Your SFS venue pass — ${input.registrationCode}`;
  const html = `
    <p>Hello ${input.fullName || 'Alumni'},</p>
    <p>Your registration for <strong>${input.eventTitle}</strong> is confirmed.</p>
    <p><strong>Registration ID:</strong> ${input.registrationCode}</p>
    <p>Show this ID or the QR in the alumni portal at the gate: <a href="${passUrl}">Open your pass</a></p>
    <p>— SFS Alumni Committee</p>
  `;

  if (!apiKey) {
    console.info('[venue-pass] RESEND_API_KEY unset; pass email skipped for', input.to);
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to: input.to, subject, html }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error('resend venue pass', res.status, detail);
  }
}