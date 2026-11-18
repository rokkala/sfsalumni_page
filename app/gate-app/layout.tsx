import type { Metadata } from 'next';

export const metadata: Metadata = {
  manifest: '/gate-app.webmanifest',
  appleWebApp: { capable: true, title: 'SFS Gate' },
};

export default function GateAppLayout({ children }: { children: React.ReactNode }) {
  return children;
}