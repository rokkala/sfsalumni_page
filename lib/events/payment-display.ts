import { eventFeeNotApplicable } from '@/lib/events/venue-attendance';

export function formatEventFeePaymentLabel(input: {
  attending: boolean;
  guestCount: number;
  totalCostPaise: number;
  paymentStatus: string | null;
}): string {
  if (eventFeeNotApplicable(input.attending, input.guestCount) || input.totalCostPaise === 0) {
    return 'Payment N/A';
  }
  const ps = String(input.paymentStatus || 'pending').toLowerCase();
  if (ps === 'paid') return 'Paid';
  if (ps === 'partial') return 'Partial';
  if (ps === 'failed') return 'Failed';
  return 'Not paid';
}