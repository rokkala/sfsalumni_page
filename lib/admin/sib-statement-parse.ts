export type SibStatementCredit = {
  /** Stable id for apply UI (index in parse order). */
  credit_id: string;
  stmt_date: string;
  amount_paise: number;
  particulars: string;
  rrn: string | null;
  receipt_refs: string[];
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

/** UPI RRN, IMPS numeric refs, and other 10–16 digit receipt ids in narration. */
export function extractReceiptRefs(particulars: string): string[] {
  const refs = new Set<string>();
  const rrn = extractRrn(particulars);
  if (rrn) refs.add(rrn);
  for (const m of particulars.matchAll(/RRN-?(\d{10,16})/gi)) {
    refs.add(m[1].length > 12 ? m[1].slice(-12) : m[1]);
  }
  for (const m of particulars.matchAll(/\bIMPS\/[A-Z]+\/(\d{10,16})/gi)) {
    const d = m[1];
    refs.add(d.length > 12 ? d.slice(-12) : d);
  }
  return [...refs];
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
  for (const p of parts) {
    if (/RRN/i.test(p) || /^SFS/i.test(p)) continue;
    if (/^UPI$/i.test(p) || /^PA$/i.test(p) || /^PAYMENT$/i.test(p)) continue;
    if (/^[A-Z]{2,5}$/.test(p)) continue;
    if (!/[A-Za-z]{2}/.test(p)) continue;
    if (p.replace(/[^A-Za-z]/g, '').length < 4) continue;
    return p;
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

const TXN_START = /(?=\d{2}-\d{2}-\d{2}\s+(?:IMPS|UPI|NEFT|RTGS|INF|REV))/g;

function parseTxnTail(tail: string): { particulars: string; deposit: string } | null {
  const m = tail.match(/^(.+?)\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})Cr\b/);
  if (!m) return null;
  return { particulars: m[1].trim(), deposit: m[2] };
}

/** Parse deposit rows from flattened SIB PDF text. */
export function parseSibStatementCredits(text: string): SibStatementCredit[] {
  const normalized = text.replace(/\s+/g, ' ');
  const credits: SibStatementCredit[] = [];
  const seen = new Set<string>();
  let idx = 0;

  const pushCredit = (stmt_date: string, particulars: string, deposit: string) => {
    const amount_paise = rupeesToPaise(deposit);
    if (amount_paise < 1) return;
    const key = `${stmt_date}|${amount_paise}|${particulars.slice(0, 80)}`;
    if (seen.has(key)) return;
    seen.add(key);
    const gateway = GATEWAY_RE.test(particulars);
    credits.push({
      credit_id: String(idx++),
      stmt_date,
      amount_paise,
      particulars,
      rrn: gateway ? null : extractRrn(particulars),
      receipt_refs: gateway ? [] : extractReceiptRefs(particulars),
      sfs_tokens: gateway ? [] : extractSfsTokens(particulars),
      payer_name: gateway ? null : payerNameFromParticulars(particulars),
      kind: gateway ? 'gateway' : 'credit',
    });
  };

  for (const m of normalized.matchAll(TXN_BLOCK)) {
    pushCredit(m[1], String(m[2]).replace(/\s+/g, ' ').trim(), m[3]);
  }

  for (const chunk of normalized.split(TXN_START)) {
    const head = chunk.match(/^(\d{2}-\d{2}-\d{2})\s+(.+)/);
    if (!head) continue;
    const parsed = parseTxnTail(head[2]);
    if (!parsed) continue;
    pushCredit(head[1], parsed.particulars.replace(/\s+/g, ' ').trim(), parsed.deposit);
  }

  credits.forEach((c, i) => {
    c.credit_id = String(i);
  });
  return credits;
}