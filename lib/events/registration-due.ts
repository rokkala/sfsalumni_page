/** Fee still owed from a registration row, repriced from stored attendance (not stale total_cost). */

import { donationDuePaise, type DonationSnapshot } from '@/lib/events/mark-paid';
import { repriceRegistration, type RepriceRow } from './reprice-math.ts';

export function feeDuePaiseFromRegistrationRow(row: RepriceRow): number {
  return repriceRegistration(row).amount_due_paise;
}

/** Cashfree / Bank-UPI: fee and donation still owed from DB (respects amount_paid_paise). */
export function registrationPaymentDuePaise(
  row: RepriceRow,
  donation: DonationSnapshot | null | undefined
): { feeDuePaise: number; donationDuePaise: number; totalDuePaise: number } {
  const feeDuePaise = feeDuePaiseFromRegistrationRow(row);
  const donationDue = donationDuePaise(donation);
  return {
    feeDuePaise,
    donationDuePaise: donationDue,
    totalDuePaise: feeDuePaise + donationDue,
  };
}