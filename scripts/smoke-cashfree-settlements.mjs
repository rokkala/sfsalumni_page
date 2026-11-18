import { readFileSync } from 'fs';

function loadEnvLocal() {
  try {
    const text = readFileSync('.env.local', 'utf8');
    for (const line of text.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!process.env[m[1]]) process.env[m[1]] = v;
    }
  } catch {
    /* ignore */
  }
}

loadEnvLocal();

const API_VERSION = '2023-08-01';
const mode = (process.env.CASHFREE_ENV || 'sandbox').trim();
const base =
  mode === 'production' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg';
const clientId = process.env.CASHFREE_CLIENT_ID?.trim();
const clientSecret = process.env.CASHFREE_CLIENT_SECRET?.trim();

async function post(path, body) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-version': API_VERSION,
      'x-client-id': clientId,
      'x-client-secret': clientSecret,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

const end = new Date();
const start = new Date(end);
start.setUTCDate(start.getUTCDate() - 29);
const s = new Date(
  Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(), 0, 0, 0)
).toISOString();
const e = new Date(
  Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate(), 23, 59, 59)
).toISOString();

const bodies = {
  withProductNullCursor: {
    product: 'PG',
    pagination: { limit: 50, cursor: null },
    filters: { start_date: s, end_date: e },
  },
  noProductNullCursor: {
    pagination: { limit: 50, cursor: null },
    filters: { start_date: s, end_date: e },
  },
  noProductNoCursor: {
    pagination: { limit: 50 },
    filters: { start_date: s, end_date: e },
  },
};

function normalizeCfCursor(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const s = String(raw).trim();
  if (!s || s.toLowerCase() === 'null') return null;
  return s;
}

for (const [name, body] of Object.entries(bodies)) {
  const r = await post('/settlements', body);
  const count = Array.isArray(r.data?.data) ? r.data.data.length : 0;
  const normalized = normalizeCfCursor(r.data?.cursor);
  console.log(name, r.status, r.data?.message, r.data?.code, 'rows', count, 'cursor', r.data?.cursor ?? null, 'normalized', normalized);
}

const end2 = new Date();
const start2 = new Date(end2);
start2.setUTCDate(start2.getUTCDate() - 29);
const s2 = new Date(Date.UTC(start2.getUTCFullYear(), start2.getUTCMonth(), start2.getUTCDate(), 0, 0, 0)).toISOString();
const e2 = new Date(Date.UTC(end2.getUTCFullYear(), end2.getUTCMonth(), end2.getUTCDate(), 23, 59, 59)).toISOString();
const p1 = await post('/settlements', { pagination: { limit: 50 }, filters: { start_date: s2, end_date: e2 } });
const bogus = normalizeCfCursor(p1.data?.cursor);
if (bogus === 'null' || bogus === null) {
  const p2 = await post('/settlements', {
    pagination: { limit: 50, ...(bogus ? { cursor: bogus } : {}) },
    filters: { start_date: s2, end_date: e2 },
  });
  console.log('pagination after null cursor', p2.status, p2.data?.message || 'ok', p2.data?.code);
}