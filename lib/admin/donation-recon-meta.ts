export type DonationReconChannel =
  | 'cashfree'
  | 'cashfree_pending'
  | 'bank_upi'
  | 'bank_upi_pending'
  | 'registration_bundled'
  | 'awaiting_member'
  | 'failed';

export type DonationProofLink = {
  id: string;
  status: string;
} | null;

export function donationKind(eventId: string | null | undefined): 'cause' | 'event' {
  return eventId ? 'event' : 'cause';
}

export function deriveDonationReconMeta(input: {
  payment_status: string;
  event_id: string | null;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  proof: DonationProofLink;
}): { channel: DonationReconChannel; channel_label: string; recon_hint: string } {
  const status = String(input.payment_status || '');
  const hasOrder = Boolean(input.razorpay_order_id?.trim());
  const hasPayRef = Boolean(input.razorpay_payment_id?.trim());
  const isEvent = Boolean(input.event_id);

  if (status === 'failed') {
    return {
      channel: 'failed',
      channel_label: 'Failed',
      recon_hint: 'No action unless member retries.',
    };
  }

  if (status === 'paid') {
    if (hasPayRef || hasOrder) {
      return {
        channel: 'cashfree',
        channel_label: 'Cashfree',
        recon_hint: 'Settled online. Cashfree dashboard if you need the receipt.',
      };
    }
    return {
      channel: 'bank_upi',
      channel_label: 'Bank / UPI',
      recon_hint: 'Marked paid after committee approved offline proof or manual check.',
    };
  }

  if (isEvent) {
    return {
      channel: 'registration_bundled',
      channel_label: 'With registration',
      recon_hint:
        'Approve the Registration proof on Bank / UPI (fee and donation are one payment), or member pays via registration Cashfree.',
    };
  }

  if (input.proof?.status === 'pending') {
    return {
      channel: 'bank_upi_pending',
      channel_label: 'Bank / UPI',
      recon_hint: 'Pending proof on Bank / UPI → approve or reject.',
    };
  }

  if (hasOrder) {
    return {
      channel: 'cashfree_pending',
      channel_label: 'Cashfree',
      recon_hint:
        'Checkout started. Member should finish payment or return to /member/donate; webhook may still confirm.',
    };
  }

  return {
    channel: 'awaiting_member',
    channel_label: 'Not started',
    recon_hint: 'Member has not paid or submitted proof yet.',
  };
}

export const CHANNEL_LABELS: Record<DonationReconChannel, string> = {
  cashfree: 'Cashfree',
  cashfree_pending: 'Cashfree (pending)',
  bank_upi: 'Bank / UPI',
  bank_upi_pending: 'Bank / UPI (in queue)',
  registration_bundled: 'Registration bundle',
  awaiting_member: 'Awaiting member',
  failed: 'Failed',
};