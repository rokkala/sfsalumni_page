'use client';

import AdminShell from '@/components/admin-shell';
import RemittanceProofsPanel from '@/components/admin-tools/remittance-proofs-panel';

export default function AdminRemittanceProofsPage() {
  return (
    <AdminShell title="Remittance proofs">
      <RemittanceProofsPanel />
    </AdminShell>
  );
}