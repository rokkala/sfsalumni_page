// components/association-modal.tsx
'use client';

import Link from 'next/link';
import { createPortal } from 'react-dom';
import { useEffect, useId, useRef, useState } from 'react';
import CommitteeBusinessCard, {
  type PublicCommitteeMember,
} from '@/components/committee-business-card';
import { ModalCloseButton, ModalOverlay } from '@/components/modal-shell';

export type { PublicCommitteeMember };

export default function AssociationModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [members, setMembers] = useState<PublicCommitteeMember[] | null>(null);
  // Portals need a DOM node, which doesn't exist during SSR, so we wait for mount
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setMembers(null);
    (async () => {
      try {
        const res = await fetch('/api/committee', { cache: 'no-store' });
        const payload = await res.json().catch(() => ({}));
        if (!active) return;
        setMembers(res.ok && Array.isArray(payload.members) ? payload.members : []);
      } catch {
        if (active) setMembers([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;

  // Rendered into document.body so ancestor transforms, filters, or overflow
  // rules can't offset or clip the fixed overlay
  return createPortal(
    <ModalOverlay
      titleId={titleId}
      backdropLabel="Close association dialog"
      onBackdropClose={onClose}
      panelClassName="sm:max-w-3xl flex flex-col"
    >
      <div className="flex items-start justify-between gap-3 border-b border-outline-variant px-6 pb-4 pt-6">
        <div>
          <p className="text-label-sm font-bold uppercase tracking-widest text-jubilee-gold-deep">
            SFS Alumni
          </p>
          <h2 id={titleId} className="mt-1 text-headline-sm text-primary">
            Association & committee
          </h2>
          <p className="mt-2 text-body-sm text-on-surface-variant">
            The alumni association connects generations of SFS Shanthinagar. Reach the committee below
            for membership or events.
          </p>
        </div>
        <ModalCloseButton closeRef={closeRef} onClick={onClose} />
      </div>

        <div className="overflow-y-auto px-6 py-5 flex-1">
          {members === null && (
            <p className="text-body-sm text-on-surface-variant py-6 text-center">Loading…</p>
          )}
          {members && !members.length && (
            <p className="text-body-sm text-on-surface-variant py-6 text-center">
              Committee contacts will appear here once published.
            </p>
          )}
          {members && members.length > 0 && (
            <ul className="grid gap-3 sm:grid-cols-2 list-none p-0 m-0">
              {members.map((m) => (
                <li key={m.id} className="min-w-0">
                  <CommitteeBusinessCard member={m} compact />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="px-5 py-4 border-t border-outline-variant bg-surface-container-low/40">
          <Link
            href="/about-association"
            onClick={onClose}
            className="text-label-sm uppercase tracking-wider text-primary font-bold hover:underline underline-offset-2 focus:outline-none focus:ring-2 focus:ring-primary/30 rounded"
          >
            About the association →
          </Link>
        </div>
    </ModalOverlay>,
    document.body,
  );
}