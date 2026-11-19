'use client';

import { useCallback, useEffect, useState } from 'react';
import AdminShell from '@/components/admin-shell';

type AdminRow = {
  id: string;
  full_name: string;
  email: string;
  phone_number: string | null;
  batch: number | null;
  member_status: string;
  username: string | null;
  created_at: string;
};

const EMPTY_FORM = {
  fullName: '',
  email: '',
  username: '',
  password: '',
};

export default function AdminAdminsPage() {
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [meId, setMeId] = useState('');
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadAdmins = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/admins', { cache: 'no-store' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload.error || 'Could not load admins');
        setAdmins([]);
        return;
      }
      setError('');
      setAdmins(Array.isArray(payload.admins) ? payload.admins : []);
      setMeId(String(payload.me_id || ''));
      setCanManage(Boolean(payload.can_manage));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAdmins();
  }, [loadAdmins]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setBusy('create');
    setMessage('');
    setError('');
    try {
      const res = await fetch('/api/admin/admins', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload.error || 'Could not create admin');
        return;
      }
      const temp = String(payload.temporaryPassword || '');
      setMessage(
        temp
          ? `Admin ${payload.admin?.full_name || 'account'} created. Initial password: ${temp} — share offline.`
          : `Admin ${payload.admin?.full_name || 'account'} created.`
      );
      if (temp && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(temp).catch(() => undefined);
      }
      setForm(EMPTY_FORM);
      setShowForm(false);
      await loadAdmins();
    } finally {
      setBusy('');
    }
  }

  async function removeAdmin(id: string, name: string) {
    if (!window.confirm(`Remove admin access for ${name}? They keep their account as a verified alumnus.`)) {
      return;
    }
    setBusy(id);
    setMessage('');
    setError('');
    try {
      const res = await fetch('/api/admin/role', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, role: 'alumni' }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload.error || 'Could not remove admin role');
        return;
      }
      setMessage(`Admin role removed for ${name}.`);
      await loadAdmins();
    } finally {
      setBusy('');
    }
  }

  async function resetPassword(row: AdminRow) {
    const custom = window.prompt(
      `Set a new password for ${row.full_name} (min 8 characters). Cancel to abort.`,
      ''
    );
    if (custom === null) return;
    const next = custom.trim();
    if (next.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setBusy(row.id);
    setMessage('');
    setError('');
    try {
      const res = await fetch(`/api/admin/members/${row.id}/password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: next }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload.error || 'Could not reset password');
        return;
      }
      const temp = String(payload.temporaryPassword || '');
      setMessage(
        temp
          ? `Password for ${row.full_name}: ${temp} — copied if possible. Share offline.`
          : `Password updated for ${row.full_name}.`
      );
      if (temp && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(temp).catch(() => undefined);
      }
    } finally {
      setBusy('');
    }
  }

  return (
    <AdminShell title="Admins">
      <p className="text-body-sm text-on-surface-variant mb-6 max-w-3xl">
        Committee logins for this admin workspace. <strong>Super admins</strong> can provision new admins
        here (name, email, password only — no alumni signup, phone, or public-email rules). Other verified
        admins can view the list and reset passwords. To promote an existing alumnus instead, use{' '}
        <a href="/admin/membership" className="text-primary underline-offset-2 hover:underline">
          Membership
        </a>
        .
      </p>
      {!loading && !canManage ? (
        <p className="rounded-xl border border-outline-variant bg-surface-container-low p-4 text-body-sm text-on-surface-variant mb-4 max-w-3xl">
          Your account is not a super admin. Ask whoever runs the server to add your login email to{' '}
          <code className="text-label-sm">SUPER_ADMIN_EMAILS</code> in Vercel / <code className="text-label-sm">.env.local</code>.
        </p>
      ) : null}

      {message ? (
        <p
          role="status"
          className="rounded-xl bg-secondary-container/30 border border-jubilee-gold-light p-4 text-body-sm text-on-secondary-fixed-variant mb-4"
        >
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-xl border border-error-container bg-error-container/40 p-4 text-body-sm text-on-error-container mb-4">
          {error}
        </p>
      ) : null}

      {canManage ? (
        <div className="flex flex-wrap gap-3 mb-6">
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="rounded-lg bg-primary text-on-primary px-5 py-3 text-label-md uppercase tracking-wider cursor-pointer hover:bg-primary-container"
          >
            {showForm ? 'Cancel' : 'Create admin'}
          </button>
        </div>
      ) : null}

      {showForm && canManage ? (
        <form
          onSubmit={(e) => void onCreate(e)}
          className="rounded-2xl border border-primary/10 bg-surface-paper p-5 mb-8 max-w-xl space-y-4 shadow-sm"
        >
          <h2 className="text-headline-sm text-primary">New admin account</h2>
          <p className="text-body-sm text-on-surface-variant">
            Creates a verified admin immediately. Share the password offline — they can change it after login.
          </p>
          <label className="block">
            <span className="text-label-sm text-on-surface-variant">Full name</span>
            <input
              required
              value={form.fullName}
              onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
              className="mt-1 w-full px-4 py-3 rounded-lg border border-primary/15 bg-surface-ivory text-body-sm"
            />
          </label>
          <label className="block">
            <span className="text-label-sm text-on-surface-variant">Email</span>
            <input
              required
              type="email"
              autoComplete="off"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              className="mt-1 w-full px-4 py-3 rounded-lg border border-primary/15 bg-surface-ivory text-body-sm"
            />
          </label>
          <label className="block">
            <span className="text-label-sm text-on-surface-variant">Username (optional)</span>
            <input
              value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
              placeholder="Defaults to email if empty"
              className="mt-1 w-full px-4 py-3 rounded-lg border border-primary/15 bg-surface-ivory text-body-sm"
            />
          </label>
          <label className="block">
            <span className="text-label-sm text-on-surface-variant">Initial password</span>
            <input
              required
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              className="mt-1 w-full px-4 py-3 rounded-lg border border-primary/15 bg-surface-ivory text-body-sm"
            />
          </label>
          <button
            type="submit"
            disabled={busy === 'create'}
            className="rounded-lg bg-primary text-on-primary px-5 py-3 text-label-md uppercase tracking-wider disabled:opacity-50 cursor-pointer"
          >
            {busy === 'create' ? 'Creating…' : 'Create admin account'}
          </button>
        </form>
      ) : null}

      <section className="rounded-2xl border border-primary/10 bg-surface-paper p-5 shadow-sm">
        <h2 className="text-headline-sm text-primary mb-1">Current admins</h2>
        <p className="text-body-sm text-on-surface-variant mb-4">
          {loading ? 'Loading…' : `${admins.length} admin${admins.length === 1 ? '' : 's'}`}
        </p>
        {loading ? (
          <p className="text-body-sm text-on-surface-variant">Loading admins…</p>
        ) : admins.length === 0 ? (
          <p className="text-body-sm text-on-surface-variant">No admin accounts yet.</p>
        ) : (
          <ul className="space-y-3">
            {admins.map((row) => {
              const isMe = row.id === meId;
              const disabled = busy === row.id;
              return (
                <li
                  key={row.id}
                  className="rounded-xl border border-primary/10 bg-surface-ivory p-4 flex flex-col lg:flex-row lg:items-center gap-4 justify-between"
                >
                  <div className="min-w-0">
                    <h3 className="text-headline-sm text-primary flex flex-wrap items-center gap-2">
                      {row.full_name}
                      {isMe ? (
                        <span className="text-label-sm text-on-surface-variant font-normal">(you)</span>
                      ) : null}
                      {row.member_status !== 'verified' ? (
                        <span className="inline-flex px-2.5 py-1 rounded-md text-label-sm bg-error-container text-error capitalize">
                          {row.member_status}
                        </span>
                      ) : null}
                    </h3>
                    <p className="text-body-sm text-on-surface-variant">
                      {row.email}
                      {row.phone_number ? ` · ${row.phone_number}` : ''}
                    </p>
                    <p className="text-label-sm text-on-surface-variant mt-1">
                      {row.username ? `@${row.username}` : 'No username'} · Joined{' '}
                      {new Date(row.created_at).toLocaleDateString('en-IN')}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 justify-end">
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => void resetPassword(row)}
                      className="rounded-lg px-3 py-2 text-label-sm border border-primary/20 bg-surface-ivory text-primary cursor-pointer hover:bg-secondary-container/30 disabled:opacity-50"
                    >
                      Reset password
                    </button>
                    {!isMe ? (
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => void removeAdmin(row.id, row.full_name)}
                        className="rounded-lg px-3 py-2 text-label-sm border border-error/30 bg-error-container/20 text-error cursor-pointer hover:bg-error-container/40 disabled:opacity-50"
                      >
                        Remove admin
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </AdminShell>
  );
}