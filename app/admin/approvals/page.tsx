'use client';

import AdminShell from '@/components/admin-shell';
import ApprovalsPanel from '@/components/admin-tools/approvals-panel';

export default function AdminApprovalsPage() {
  return (
    <AdminShell
      title="Approvals"
      subtitle="One inbox for new members, memories, and stories — approve or reject without scrolling three pages."
    >
      <ApprovalsPanel />
    </AdminShell>
  );
}
