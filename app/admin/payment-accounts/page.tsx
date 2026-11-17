'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import AdminShell from '@/components/admin-shell';

type Account = {
  id: string;
  label: string;
  account_name: string;
  account_number: string;
  ifsc: string;
  bank_name: string | null;
  upi_id: string | null;
  active: boolean;
  sort_order: number;
  deleted_at?: string | null;
};

const emptyForm = {
  label: '',
  account_name: '',
  account_number: '',
  ifsc: '',
  bank_name: '',
  upi_id: '',
  sort_order: '0',
  active: false,
};

export default function AdminPaymentAccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);

  const loadAccounts = useCallback(async () => {
    const res = await fetch('/api/admin/payment-accounts', { cache: 'no-store' });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.error || 'Could not load accounts');
    setAccounts(payload.accounts || []);
  }, []);

  const load = useCallback(async () => {
    setError('');
    try {
      await loadAccounts();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load');
    }
  }, [loadAccounts]);

  useEffect(() => {
    void load();
  }, [load]);

  function startEdit(a: Account) {
    setEditingId(a.id);
    setForm({
      label: a.label,
      account_name: a.account_name,
      account_number: a.account_number,
      ifsc: a.ifsc,
      bank_name: a.bank_name || '',
      upi_id: a.upi_id || '',
      sort_order: String(a.sort_order),
      active: a.active,
    });
    setOk('');
    setError('');
  }

  function startCreate() {
    setEditingId(null);
    setForm(emptyForm);
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setOk('');
    try {
      const body = {
        label: form.label,
        accountName: form.account_name,
        accountNumber: form.account_number,
        ifsc: form.ifsc,
        bankName: form.bank_name,
        upiId: form.upi_id,
        sortOrder: Number(form.sort_order) || 0,
        active: form.active,
      };
      const url = editingId
        ? `/api/admin/payment-accounts/${editingId}`
        : '/api/admin/payment-accounts';
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
      setOk(editingId ? 'Account updated.' : 'Account added.');
      startCreate();
      await loadAccounts();
    } catch {
      setError('Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function setActive(id: string) {
    setBusy(true);
    setError('');
    setOk('');
    try {
      const res = await fetch(`/api/admin/payment-accounts/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ active: true }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload.error || 'Could not activate');
        return;
      }
      setOk('Active account updated. Members will see these details.');
      await loadAccounts();
    } catch {
      setError('Could not activate');
    } finally {
      setBusy(false);
    }
  }

  async function removeAccount(a: Account) {
    const warn = a.active
      ? `Delete “${a.label}”? It stays in the list (soft delete) and is removed from checkout. Set another account active for offline pay.`
      : `Delete “${a.label}”? It stays in the list until you restore it.`;
    if (!window.confirm(warn)) return;

    setBusy(true);
    setError('');
    setOk('');
    try {
      const res = await fetch(`/api/admin/payment-accounts/${a.id}`, { method: 'DELETE' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload.error || 'Could not delete');
        return;
      }
      if (editingId === a.id) startCreate();
      setOk(
        payload.wasActive
          ? 'Account soft-deleted. Set another account active for offline payments.'
          : 'Account soft-deleted.'
      );
      await loadAccounts();
    } catch {
      setError('Could not delete');
    } finally {
      setBusy(false);
    }
  }

  async function restoreAccount(a: Account) {
    setBusy(true);
    setError('');
    setOk('');
    try {
      const res = await fetch(`/api/admin/payment-accounts/${a.id}/restore`, { method: 'POST' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload.error || 'Could not restore');
        return;
      }
      setOk('Account restored. Set it active if members should use it for offline pay.');
      await loadAccounts();
    } catch {
      setError('Could not restore');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminShell title="Bank / UPI">
      <p className="text-body-sm text-on-surface-variant mb-6 max-w-3xl">
        Configure the bank account and UPI ID members see when paying offline. Only one account can be
        active at a time. To review UTR proofs or turn on Pay online, use{' '}
        <Link href="/admin/remittance-proofs" className="text-primary underline font-medium">
          Remittance proofs
        </Link>
        .
      </p>

      <section className="rounded-2xl border border-outline-variant bg-white p-5 space-y-4 h-fit max-w-3xl">
        <div>
          <h3 className="text-headline-sm text-primary">Payout account</h3>
          <p className="text-body-sm text-on-surface-variant mt-1">
            IFSC + account number for NEFT/IMPS, and optional UPI ID for QR scan.
          </p>
        </div>

        <form onSubmit={onSave} className="space-y-3">
          <h4 className="text-label-md text-primary uppercase tracking-wider">
            {editingId ? 'Edit account' : 'Add account'}
          </h4>
          {(
            [
              ['label', 'Label', 'e.g. Jubilee event fees'],
              ['account_name', 'Account holder name', ''],
              ['account_number', 'Account number', ''],
              ['ifsc', 'IFSC', 'SBIN0001234'],
              ['bank_name', 'Bank name (optional)', ''],
              ['upi_id', 'UPI ID (optional)', 'name@oksbi'],
            ] as const
          ).map(([key, label, placeholder]) => (
            <label key={key} className="block">
              <span className="text-label-sm uppercase tracking-wider text-primary">{label}</span>
              <input
                required={key !== 'bank_name' && key !== 'upi_id'}
                value={form[key]}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                disabled={busy}
                placeholder={placeholder}
                className="mt-1 w-full px-4 py-3.5 rounded-lg border border-outline-variant text-body-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </label>
          ))}
          <label className="block">
            <span className="text-label-sm uppercase tracking-wider text-primary">Display order</span>
            <input
              inputMode="numeric"
              value={form.sort_order}
              onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))}
              disabled={busy}
              className="mt-1 w-full px-4 py-3.5 rounded-lg border border-outline-variant text-body-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </label>
          <label className="flex items-center gap-2 text-body-sm text-primary font-medium">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
              disabled={busy}
            />
            Set as the active account (deactivates others)
          </label>
          {error ? (
            <p className="rounded-lg bg-error-container text-error text-body-sm p-3">{error}</p>
          ) : null}
          {ok ? (
            <p className="rounded-lg bg-secondary-container text-on-secondary-fixed text-body-sm p-3">
              {ok}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-primary text-on-primary px-4 py-2.5 text-label-sm font-bold uppercase tracking-wider disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {busy ? 'Saving…' : editingId ? 'Update' : 'Create'}
            </button>
            {editingId ? (
              <button
                type="button"
                onClick={startCreate}
                disabled={busy}
                className="rounded-lg border border-outline-variant px-4 py-2.5 text-label-sm font-bold uppercase tracking-wider focus:outline-none focus:ring-2 focus:ring-primary"
              >
                Cancel
              </button>
            ) : null}
          </div>
        </form>

        <ul className="divide-y divide-outline-variant border-t border-outline-variant pt-3">
          {accounts.length === 0 ? (
            <li className="py-3 text-body-sm text-on-surface-variant">No accounts yet.</li>
          ) : (
            accounts.map((a) => {
              const deleted = Boolean(a.deleted_at);
              return (
                <li
                  key={a.id}
                  className={`py-3 flex flex-wrap items-start justify-between gap-3 ${
                    deleted ? 'opacity-50' : ''
                  }`}
                >
                  <div className={deleted ? 'blur-[1px] select-none' : undefined}>
                    <p className="text-body-sm font-medium text-primary">
                      {a.label}{' '}
                      {deleted ? (
                        <span className="text-label-sm uppercase tracking-wider text-on-surface-variant">
                          Deleted
                        </span>
                      ) : a.active ? (
                        <span className="text-label-sm uppercase tracking-wider text-green-700">
                          Active
                        </span>
                      ) : null}
                    </p>
                    <p className="text-body-sm text-on-surface-variant">
                      {a.account_name} · {a.account_number} · {a.ifsc}
                      {a.upi_id ? ` · ${a.upi_id}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {deleted ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void restoreAccount(a)}
                        className="rounded-lg border border-outline-variant px-3 py-1.5 text-label-sm font-bold uppercase tracking-wider focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                      >
                        Restore
                      </button>
                    ) : (
                      <>
                        {!a.active ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void setActive(a.id)}
                            className="rounded-lg border border-outline-variant px-3 py-1.5 text-label-sm font-bold uppercase tracking-wider focus:outline-none focus:ring-2 focus:ring-primary"
                          >
                            Set active
                          </button>
                        ) : null}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => startEdit(a)}
                          className="rounded-lg border border-outline-variant px-3 py-1.5 text-label-sm font-bold uppercase tracking-wider focus:outline-none focus:ring-2 focus:ring-primary"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void removeAccount(a)}
                          className="rounded-lg border border-error/40 text-error px-3 py-1.5 text-label-sm font-bold uppercase tracking-wider focus:outline-none focus:ring-2 focus:ring-error disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })
          )}
        </ul>
      </section>
    </AdminShell>
  );
}