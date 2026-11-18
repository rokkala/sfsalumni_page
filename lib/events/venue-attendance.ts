/** Someone is expected at the venue (alumnus and/or guests). Donation-only rows are not. */
export function needsVenuePass(attending: boolean, guestCount: number): boolean {
  const guests = Math.max(0, Math.floor(Number(guestCount) || 0));
  return attending === true || guests > 0;
}

/** Event registration fee does not apply (not attending, no guests). */
export function eventFeeNotApplicable(attending: boolean, guestCount: number): boolean {
  return !needsVenuePass(attending, guestCount);
}