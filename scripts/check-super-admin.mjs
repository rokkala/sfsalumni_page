#!/usr/bin/env node
/** Run: node scripts/check-super-admin.mjs */

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function superAdminEmailSet() {
  const raw = process.env.SUPER_ADMIN_EMAILS || '';
  return new Set(
    raw
      .split(/[,;\n]+/)
      .map((e) => normalizeEmail(e))
      .filter(Boolean)
  );
}

function isSuperAdmin(me) {
  if (me.role !== 'admin' || me.member_status !== 'verified') return false;
  const allow = superAdminEmailSet();
  if (allow.size === 0) return false;
  return allow.has(normalizeEmail(me.email));
}

process.env.SUPER_ADMIN_EMAILS = '  A@Example.COM , other@test.org ';
const base = { role: 'admin', member_status: 'verified' };
const ok = isSuperAdmin({ ...base, email: 'a@example.com' });
const no = isSuperAdmin({ ...base, email: 'nope@example.com' });
const alumni = isSuperAdmin({ role: 'alumni', member_status: 'verified', email: 'a@example.com' });
const empty = (() => {
  process.env.SUPER_ADMIN_EMAILS = '';
  return isSuperAdmin({ ...base, email: 'a@example.com' });
})();

if (!ok || no || alumni || empty) {
  console.error('check-super-admin: failed', { ok, no, alumni, empty });
  process.exit(1);
}
console.log('check-super-admin: ok');