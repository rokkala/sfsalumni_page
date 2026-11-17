'use client';

import AdminShell from '@/components/admin-shell';
import EventOpsPanel from '@/components/admin-tools/event-ops-panel';

export default function AdminEventOpsPage() {
  return (
    <AdminShell
      title="Event ops"
      subtitle="Money summary and registration exceptions for one event or all events. Fix each row in Registrations."
    >
      <EventOpsPanel />
    </AdminShell>
  );
}
