/**
 * Time listAccountVenuePasses for one account (needs .env.local Supabase + session cookie optional).
 * Usage: node scripts/bench-venue-passes.mjs [account-uuid]
 */
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
registerHooks({
  resolve(specifier, context, nextResolve) {
    let spec = specifier;
    if (spec.startsWith('@/')) spec = pathToFileURL(path.join(root, spec.slice(2))).href;
    if (spec.startsWith('.')) {
      const parent = context.parentURL ? fileURLToPath(context.parentURL) : root;
      const abs = path.resolve(path.dirname(parent), spec);
      if (!path.extname(abs) && existsSync(`${abs}.ts`)) spec = pathToFileURL(`${abs}.ts`).href;
    } else if (spec.startsWith('file:')) {
      const abs = fileURLToPath(spec);
      if (!path.extname(abs) && existsSync(`${abs}.ts`)) spec = pathToFileURL(`${abs}.ts`).href;
    }
    return nextResolve(spec, context);
  },
});

function loadEnvFile(name) {
  const p = path.join(root, name);
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq);
    let val = trimmed.slice(eq + 1);
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = val;
  }
}

loadEnvFile('.env.local');
loadEnvFile('.env');

const accountId = process.argv[2];
if (!accountId) {
  console.error('Usage: node scripts/bench-venue-passes.mjs <account-uuid>');
  process.exit(1);
}

const { createAdminClient } = await import('../lib/supabase-admin.ts');
const { listAccountVenuePasses } = await import('../lib/events/register.ts');

const admin = createAdminClient();
const { data: row, error } = await admin
  .from('alumni_accounts')
  .select(
    'id,email,full_name,last_name,phone_number,batch,section,current_location,role,member_status'
  )
  .eq('id', accountId)
  .maybeSingle();

if (error || !row) {
  console.error('Account not found', error?.message);
  process.exit(1);
}

const me = row;
const runs = 5;
const timings = [];
for (let i = 0; i < runs; i++) {
  const t0 = performance.now();
  const result = await listAccountVenuePasses(me);
  timings.push(performance.now() - t0);
  if (i === 0) {
    console.log('passes:', result.payload.passes?.length ?? 0, 'status:', result.status);
  }
}

const avg = timings.reduce((a, b) => a + b, 0) / timings.length;
const min = Math.min(...timings);
const max = Math.max(...timings);
console.log(`listAccountVenuePasses ms: avg=${avg.toFixed(0)} min=${min.toFixed(0)} max=${max.toFixed(0)} (${runs} runs)`);