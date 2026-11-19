'use client';

import { useEffect, useId, useRef } from 'react';
import { ModalCloseButton, ModalOverlay } from '@/components/modal-shell';
import PwaInstall from '@/components/pwa-install';

export default function GetAppDialog({
  open,
  onClose,
  startPath = '/event-app',
  appLabel = 'SFS Jubilee',
  eyebrow = 'Event app',
  title = 'Get the app',
}: {
  open: boolean;
  onClose: () => void;
  startPath?: string;
  appLabel?: string;
  eyebrow?: string;
  title?: string;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <ModalOverlay
      titleId={titleId}
      backdropLabel="Close get the app dialog"
      onBackdropClose={onClose}
      panelClassName="sm:max-w-lg flex flex-col"
    >
      <div className="flex items-start justify-between gap-3 border-b border-outline-variant px-5 pb-3 pt-5">
        <div>
          <p className="text-label-sm font-bold uppercase tracking-widest text-jubilee-gold-deep">
            {eyebrow}
          </p>
          <h2 id={titleId} className="mt-1 text-headline-sm text-primary">
            {title}
          </h2>
        </div>
        <ModalCloseButton closeRef={closeRef} onClick={onClose} />
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <PwaInstall key={startPath} shareMode startPath={startPath} appLabel={appLabel} />
      </div>
    </ModalOverlay>
  );
}
