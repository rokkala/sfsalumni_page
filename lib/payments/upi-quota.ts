/** UPI eligibility and IST daily caps for offline UPI remittance proofs. */

/** @deprecated Use {@link isUpiEligible}; kept for scripts that import the constant. */
export const UPI_MIN_TOTAL_PAISE = 0;
export const UPI_DAILY_MAX_PAISE = 10_000_000;
export const UPI_DAILY_MAX_TXNS = 20;
export const UPI_QUOTA_TZ = 'Asia/Kolkata';

export type UpiLimitReason = 'amount' | 'volume' | 'count' | null;

export type UpiQuotaSnapshot = {
  eligible: boolean;
  quota_available: boolean;
  daily_total_paise: number;
  daily_txn_count: number;
  limit_reached_reason: UpiLimitReason;
  next_opens_at: string | null;
};

export function isUpiEligible(amountPaise: number): boolean {
  return Math.floor(Number(amountPaise) || 0) > 0;
}

/** Start/end of calendar day in IST as UTC Date bounds for DB `created_at` filters. */
export function istDayUtcBounds(at: Date = new Date()): { start: string; end: string; dayLabel: string } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: UPI_QUOTA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const dayLabel = fmt.format(at);
  const start = new Date(`${dayLabel}T00:00:00+05:30`).toISOString();
  const end = new Date(`${dayLabel}T23:59:59.999+05:30`).toISOString();
  return { start, end, dayLabel };
}

/** Tomorrow 00:01 IST as ISO instant. */
export function nextUpiWindowOpensAt(at: Date = new Date()): string {
  const { dayLabel } = istDayUtcBounds(at);
  const noonIst = new Date(`${dayLabel}T12:00:00+05:30`);
  noonIst.setDate(noonIst.getDate() + 1);
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: UPI_QUOTA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const nextLabel = fmt.format(noonIst);
  return new Date(`${nextLabel}T00:01:00+05:30`).toISOString();
}

export function formatNextUpiWindowIst(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: UPI_QUOTA_TZ,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export async function getUpiDailyUsage(
  // ponytail: Supabase query builders are thenable; avoid mirroring generic filter types.
  admin: {
    from: (table: string) => unknown;
  },
  at: Date = new Date()
): Promise<{ daily_total_paise: number; daily_txn_count: number }> {
  const { start, end } = istDayUtcBounds(at);
  const res = (await (
    admin.from('offline_payment_proofs') as {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          in: (col: string, vals: string[]) => {
            gte: (col: string, val: string) => {
              lte: (
                col: string,
                val: string
              ) => Promise<{ data: { amount_paise: number }[] | null; error: unknown }>;
            };
          };
        };
      };
    }
  )
    .select('amount_paise')
    .eq('remittance_method', 'upi')
    .in('status', ['pending', 'approved'])
    .gte('created_at', start)
    .lte('created_at', end)) as { data: { amount_paise: number }[] | null; error: unknown };
  const { data, error } = res;

  if (error || !data) {
    return { daily_total_paise: 0, daily_txn_count: 0 };
  }
  let daily_total_paise = 0;
  for (const row of data) {
    daily_total_paise += Math.max(0, Number(row.amount_paise) || 0);
  }
  return { daily_total_paise, daily_txn_count: data.length };
}

export function upiQuotaForAmount(input: {
  amountPaise: number;
  daily_total_paise: number;
  daily_txn_count: number;
  at?: Date;
}): UpiQuotaSnapshot {
  const amountPaise = Math.floor(Number(input.amountPaise) || 0);
  const eligible = isUpiEligible(amountPaise);
  const next_opens_at = nextUpiWindowOpensAt(input.at ?? new Date());

  if (!eligible) {
    return {
      eligible: false,
      quota_available: false,
      daily_total_paise: input.daily_total_paise,
      daily_txn_count: input.daily_txn_count,
      limit_reached_reason: 'amount',
      next_opens_at: null,
    };
  }

  let limit_reached_reason: UpiLimitReason = null;
  if (input.daily_txn_count >= UPI_DAILY_MAX_TXNS) {
    limit_reached_reason = 'count';
  } else if (input.daily_total_paise + amountPaise > UPI_DAILY_MAX_PAISE) {
    limit_reached_reason = 'volume';
  }

  const quota_available = limit_reached_reason === null;
  return {
    eligible: true,
    quota_available,
    daily_total_paise: input.daily_total_paise,
    daily_txn_count: input.daily_txn_count,
    limit_reached_reason,
    next_opens_at: quota_available ? null : next_opens_at,
  };
}

export async function buildUpiQuotaSnapshot(
  admin: { from: (table: string) => unknown },
  amountPaise: number,
  at: Date = new Date()
): Promise<UpiQuotaSnapshot> {
  const usage = await getUpiDailyUsage(admin, at);
  return upiQuotaForAmount({ amountPaise, ...usage, at });
}

export class UpiQuotaError extends Error {
  readonly snapshot: UpiQuotaSnapshot;
  constructor(message: string, snapshot: UpiQuotaSnapshot) {
    super(message);
    this.name = 'UpiQuotaError';
    this.snapshot = snapshot;
  }
}

export async function assertUpiQuotaForSubmit(
  admin: { from: (table: string) => unknown },
  amountPaise: number,
  at: Date = new Date()
): Promise<UpiQuotaSnapshot> {
  const snapshot = await buildUpiQuotaSnapshot(admin, amountPaise, at);
  if (!snapshot.eligible) {
    throw new UpiQuotaError('UPI is not available for this amount. Use NEFT/RTGS or other options.', snapshot);
  }
  if (!snapshot.quota_available) {
    const when = snapshot.next_opens_at
      ? formatNextUpiWindowIst(snapshot.next_opens_at)
      : 'tomorrow from 00:01 IST';
    throw new UpiQuotaError(`UPI limit reached for today. Try again from ${when}.`, snapshot);
  }
  return snapshot;
}