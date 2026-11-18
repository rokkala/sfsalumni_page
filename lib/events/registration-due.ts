/** Fee still owed from a registration row, repriced from stored attendance (not stale total_cost). */

import { repriceRegistration, type RepriceRow } from './reprice-math.ts';

export function feeDuePaiseFromRegistrationRow(row: RepriceRow): number {
  return repriceRegistration(row).amount_due_paise;
}