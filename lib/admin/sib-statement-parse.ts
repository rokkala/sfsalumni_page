export type SibStatementCredit = {
  /** Stable id for apply UI (index in parse order). */
  credit_id: string;
  stmt_date: string;
  amount_paise: number;
  particulars: string;
  rrn: string | null;
  sfs_tokens: string[];
  payer_name: string | null;
  kind: 'credit' | 'gateway';
};

const TXN_BLOCK =
  /(\d{2}-\d{2}-\d{2})\s+(.+?)\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})Cr/g;

const GATEWAY_RE =
  /cashfree|api banking eb\/payout|sbm p2a\/sbm p2a/i;

function rupeesToPaise(raw: string): number {
  const n = Number(String(raw).replace(/,/g, ''));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

function extractRrn(particulars: string): string | null {
  const m = particulars.match(/RRN-?(\d{12})/i);
  return m ? m[1] : null;
}

/** Tokens after SFS (handles `SFS0313e7ce` and broken `SFS Alu`). */
function extractSfsTokens(particulars: string): string[] {
  const upper = particulars.toUpperCase();
  const tokens: string[] = [];
  const re = /SFS\s*([A-Z0-9]{3,12})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(upper))) {
    const body = m[1].replace(/[^A-Z0-9]/g, '');
    if (body.length >= 3) tokens.push(body);
  }
  return [...new Set(tokens)];
}

function nameFromUpi(particulars: string): string | null {
  const parts = particulars.split('/').map((p) => p.trim());
  const rrnIdx = parts.findIndex((p) => /RRN-?\d{12}/i.test(p));
  if (rrnIdx >= 0 && parts[rrnIdx + 1]) {
    const cand = parts[rrnIdx + 1];
    if (!/^SFS/i.test(cand) && !/^PA$/i.test(cand) && !/^UPI$/i.test(cand)) {
      return cand;
    }
  }
  return null;
}

function nameFromNeft(particulars: string): string | null {
  const m = particulars.match(/^NEFT:\s*(.+)$/i);
  if (!m) return null;
  return m[1].trim();
}

function nameFromImps(particulars: string): string | null {
  if (!/^IMPS\//i.test(particulars)) return null;
  return null;
}

export function payerNameFromParticulars(particulars: string): string | null {
  return (
    nameFromUpi(particulars) ||
    nameFromNeft(particulars) ||
    nameFromImps(particulars) ||
    null
  );
}

export function normalizeNameForMatch(name: string): string {
  return String(name || '')
    .toUpperCase()
    .replace(/[^A-Z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function nameMatchScore(stmtName: string, regName: string): number {
  const a = normalizeNameForMatch(stmtName)
    .split(' ')
    .filter((t) => t.length > 1);
  const b = normalizeNameForMatch(regName)
    .split(' ')
    .filter((t) => t.length > 1);
  if (!a.length || !b.length) return 0;
  let hits = 0;
  for (const t of a) {
    if (b.some((u) => u === t || u.includes(t) || t.includes(u))) hits += 1;
  }
  return hits;
}

/** Parse deposit rows from flattened SIB PDF text. */
export function parseSibStatementCredits(text: string): SibStatementCredit[] {
  const normalized = text.replace(/\s+/g, ' ');
  const credits: SibStatementCredit[] = [];
  let idx = 0;
  for (const m of normalized.matchAll(TXN_BLOCK)) {
    const stmt_date = m[1];
    const particulars = String(m[2]).replace(/\s+/g, ' ').trim();
    const amount_paise = rupeesToPaise(m[3]);
    if (amount_paise < 1) continue;

    const gateway = GATEWAY_RE.test(particulars);
    credits.push({
      credit_id: String(idx),
      stmt_date,
      amount_paise,
      particulars,
      rrn: gateway ? null : extractRrn(particulars),
      sfs_tokens: gateway ? [] : extractSfsTokens(particulars),
      payer_name: gateway ? null : payerNameFromParticulars(particulars),
      kind: gateway ? 'gateway' : 'credit',
    });
    idx += 1;
  }
  return credits;
}