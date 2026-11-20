/**
 * Self-check SIB statement parse + match shape (uses sample PDF if present).
 * Run: node scripts/check-sib-statement.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

import { parseSibStatementCredits, payerNameFromParticulars } from '../lib/admin/sib-statement-parse.ts';
import { parseStatementAccountNumber } from '../lib/admin/sib-statement-pdf.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sample = path.join(__dirname, '..', 'A569XXXXXXXXXXXXX6425_6324275435.pdf');

if (!fs.existsSync(sample)) {
  console.log('skip: sample PDF not in repo');
  process.exit(0);
}

const buf = fs.readFileSync(sample);
const doc = await getDocument({
  data: new Uint8Array(buf),
  password: process.env.SIB_PDF_PASSWORD || 'eash6278',
  useSystemFonts: true,
}).promise;
let text = '';
for (let i = 1; i <= doc.numPages; i++) {
  const page = await doc.getPage(i);
  const c = await page.getTextContent();
  text += c.items.map((x) => x.str).join(' ') + '\n';
}

const acct = parseStatementAccountNumber(text);
if (acct !== '0539053000006278') throw new Error(`account ${acct}`);

const credits = parseSibStatementCredits(text);
if (credits.length < 20) throw new Error(`expected many credits got ${credits.length}`);

const upi = credits.find((c) => c.rrn === '632323069707');
if (!upi || upi.amount_paise !== 100_000) throw new Error('SRIDEVI row');
if (!payerNameFromParticulars(upi.particulars)) throw new Error('name');

const gw = credits.filter((c) => c.kind === 'gateway');
if (gw.length < 3) throw new Error('expected gateway rows');

const imps10k = credits.find((c) => c.particulars.includes('632414345932'));
if (!imps10k || imps10k.kind !== 'credit' || imps10k.amount_paise !== 1_000_000) {
  throw new Error('IMPS 632414345932 must be member credit not gateway');
}
if (!imps10k.receipt_refs.includes('632414345932')) throw new Error('IMPS ref extract');

console.log(`ok: ${credits.length} credits, ${gw.length} gateway, account ${acct}`);