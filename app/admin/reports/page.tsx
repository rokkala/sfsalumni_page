'use client';

import Link from 'next/link';
import AdminShell from '@/components/admin-shell';

const REPORTS = [
  {
    href: '/admin/reports/approvals',
    title: 'Approval audit',
    description: 'Admin decisions plus Cashfree auto-settlements and manual mark-paid — full audit.',
    icon: 'fact_check',
  },
  {
    href: '/admin/donations',
    title: 'Donation report',
    description: 'Ledger of cause and registration-linked donations.',
    icon: 'volunteer_activism',
  },
  {
    href: '/admin/cashfree-transactions',
    title: 'Cashfree reports',
    description: 'Gateway transactions and settlements vs portal records.',
    icon: 'receipt_long',
  },
] as const;

export default function AdminReportsHubPage() {
  return (
    <AdminShell title="Reports">
      <p className="text-body-sm text-on-surface-variant mb-6 max-w-3xl">
        Read-only summaries for reconciliation and accountability. Operational queues (approve, mark paid)
        stay on their day-of screens.
      </p>
      <ul className="grid gap-4 sm:grid-cols-2 max-w-3xl">
        {REPORTS.map((r) => (
          <li key={r.href}>
            <Link
              href={r.href}
              className="flex gap-3 rounded-xl border border-outline-variant/40 bg-surface-container-low p-4 hover:border-primary/40 transition-colors"
            >
              <span
                className="material-symbols-outlined text-primary shrink-0"
                aria-hidden
              >
                {r.icon}
              </span>
              <span>
                <span className="block text-title-sm text-primary font-medium">{r.title}</span>
                <span className="block text-body-sm text-on-surface-variant mt-1">{r.description}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </AdminShell>
  );
}