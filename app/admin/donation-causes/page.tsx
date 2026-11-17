'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import AdminShell from '@/components/admin-shell';

type Cause = {
  id: string;
  title: string;
  description: string | null;
  active: boolean;
  sort_order: number;
};

export default function AdminDonationCausesPage() {
  const [causes, setCauses] = useState<Cause[]>([]);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    title: '',
    description: '',
    sort_order: '0',
    active: true,
  });
  const [editingId, setEditingId] = useState<string | null>(null);

  const loadCauses = useCallback(async () => {
    const res = await fetch('/api/admin/donation-causes', { cache: 'no-store' });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.error || 'Could not load causes');
    setCauses(payload.causes || []);
  }, []);

  useEffect(() => {
    setError('');
    void loadCauses().catch((e) =>
      setError(e instanceof Error ? e.message : 'Could not load')
    );
  }, [loadCauses]);

  function startEdit(c: Cause) {
    setEditingId(c.id);
    setForm({
      title: c.title,
      description: c.description || '',
      sort_order: String(c.sort_order),
      active: c.active,
    });
    setOk('');
    setError('');
  }

  function startCreate() {
    setEditingId(null);
    setForm({ title: '', description: '', sort_order: '0', active: true });
  }

  async function onDeleteCause(id: string, title: string) {
    if (!window.confirm(`Delete donation type “${title}”? This cannot be undone.`)) return;
    setBusy(true);
    setError('');
    setOk('');
    try {
      const res = await fetch(`/api/admin/donation-causes/${id}`, { method: 'DELETE' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload.error || 'Could not delete donation type');
        return;
      }
      if (editingId === id) startCreate();
      setOk('Donation type deleted.');
      await loadCauses();
    } catch {
      setError('Could not delete donation type');
    } finally {
      setBusy(false);
    }
  }

  async function onSaveCause(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setOk('');
    try {
      const body = {
        title: form.title,
        description: form.description,
        sort_order: Number(form.sort_order) || 0,
        active: form.active,
      };
      const url = editingId
        ? `/api/admin/donation-causes/${editingId}`
        : '/api/admin/donation-causes';
      const res = await fetch(url, {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload.error || 'Save failed');
        return;
      }
      setOk(editingId ? 'Donation type updated.' : 'Donation type added.');
      startCreate();
      await loadCauses();
    } catch {
      setError('Save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminShell title="Donation types">
      <p className="text-body-sm text-on-surface-variant mb-6 max-w-3xl">
        Configure what members can give to at{' '}
        <code className="text-label-sm">/member/donate</code>. The donation ledger and reconciliation
        live under <strong className="font-semibold text-on-surface">Donation report</strong>.
      </p>

      <section className="rounded-2xl border border-outline-variant bg-white p-5 space-y-4 max-w-2xl">
        <form onSubmit={onSaveCause} className="space-y-3">
          <h3 className="text-label-md text-primary uppercase tracking-wider">
            {editingId ? 'Edit type' : 'Add type'}
          </h3>
          <label className="block">
            <span className="text-label-sm uppercase tracking-wider text-primary">Name</span>
            <input
              required
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              disabled={busy}
              placeholder="e.g. Scholarship fund"
              className="mt-1 w-full px-4 py-3.5 rounded-lg border border-outline-variant text-body-sm"
            />
          </label>
          <label className="block">
            <span className="text-label-sm uppercase tracking-wider text-primary">
              Short description
            </span>
            <textarea
              rows={3}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              disabled={busy}
              placeholder="Shown under the name when alumni choose where to give"
              className="mt-1 w-full px-4 py-3.5 rounded-lg border border-outline-variant text-body-sm resize-y"
            />
          </label>
          <label className="block">
            <span className="text-label-sm uppercase tracking-wider text-primary">Display order</span>
            <input
              inputMode="numeric"
              value={form.sort_order}
              onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))}
              disabled={busy}
              className="mt-1 w-full px-4 py-3.5 rounded-lg border border-outline-variant text-body-sm"
            />
          </label>
          <label className="flex items-center gap-2 text-body-sm text-primary font-medium">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
              disabled={busy}
            />
            Active (members can select this type)
          </label>
          {error ? (
            <p className="rounded-lg bg-error-container text-error text-body-sm p-3">{error}</p>
          ) : null}
          {ok ? (
            <p className="rounded-lg bg-secondary-container text-on-secondary-fixed text-body-sm p-3">
              {ok}
            </p>
          ) : null}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-primary text-on-primary px-4 py-2.5 text-label-sm font-bold uppercase tracking-wider disabled:opacity-50"
            >
              {busy ? 'Saving…' : editingId ? 'Save type' : 'Add type'}
            </button>
            {editingId ? (
              <button
                type="button"
                disabled={busy}
                onClick={startCreate}
                className="rounded-lg border border-outline-variant px-4 py-2.5 text-label-sm uppercase tracking-wider"
              >
                Cancel
              </button>
            ) : null}
          </div>
        </form>

        <ul className="pt-4 space-y-2 border-t border-outline-variant">
          <li className="text-label-sm uppercase tracking-wider text-on-surface-variant pb-1">
            Current types ({causes.length})
          </li>
          {!causes.length ? (
            <li className="text-body-sm text-on-surface-variant py-2">No types yet.</li>
          ) : null}
          {causes.map((c) => (
            <li key={c.id} className="flex items-start justify-between gap-2 text-body-sm py-2">
              <div>
                <p className="font-semibold text-primary">
                  {c.title}
                  {!c.active ? (
                    <span className="ml-2 text-on-surface-variant font-normal">· inactive</span>
                  ) : null}
                </p>
                {c.description ? (
                  <p className="text-on-surface-variant line-clamp-2">{c.description}</p>
                ) : null}
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => startEdit(c)}
                  className="text-primary underline underline-offset-2"
                >
                  Edit
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onDeleteCause(c.id, c.title)}
                  className="text-error underline underline-offset-2"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </AdminShell>
  );
}