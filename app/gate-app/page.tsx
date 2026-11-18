'use client';

import Link from 'next/link';
import PwaInstall from '@/components/pwa-install';

export default function GateAppInstallPage() {
  return (
    <main className="flex-1 px-4 py-10 max-w-lg mx-auto w-full">
      <p className="text-label-sm uppercase tracking-[0.16em] text-jubilee-gold-deep font-bold">
        Gate check-in
      </p>
      <h1 className="text-headline-md text-primary mt-2">Install volunteer app</h1>
      <p className="text-body-sm text-on-surface-variant mt-2">
        Add this to your phone home screen for faster QR scanning on event day. You still need the
        gate PIN after opening.
      </p>
      <div className="mt-6">
        <PwaInstall shareMode startPath="/gate" appLabel="SFS Gate check-in" />
      </div>
      <Link href="/gate" className="inline-flex mt-6 text-primary underline text-body-sm">
        Open gate in browser
      </Link>
    </main>
  );
}