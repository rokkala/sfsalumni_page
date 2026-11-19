'use client';

import { createPortal } from 'react-dom';
import {
  type ReactNode,
  type RefObject,
  useLayoutEffect,
  useState,
} from 'react';

export const modalOverlayClass =
  'fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-6 touch-none';

export const modalBackdropClass =
  'fixed inset-0 z-0 bg-primary/60 backdrop-blur-md sm:backdrop-blur-lg';

export const modalPanelClass =
  'relative z-[1] w-full max-h-[92vh] overflow-hidden rounded-t-2xl sm:rounded-2xl border border-outline-variant bg-surface-paper shadow-xl';

let bodyScrollLockCount = 0;
let bodyScrollLockPrevOverflow = '';

function lockBodyScroll() {
  if (bodyScrollLockCount === 0) {
    bodyScrollLockPrevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  bodyScrollLockCount += 1;
}

function unlockBodyScroll() {
  bodyScrollLockCount = Math.max(0, bodyScrollLockCount - 1);
  if (bodyScrollLockCount === 0) {
    document.body.style.overflow = bodyScrollLockPrevOverflow;
  }
}

function useModalPortalTarget() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setTarget(document.body);
  }, []);
  return target;
}

/** Full-viewport scrim while async work runs before a modal opens (no dismiss). */
export function ModalBlockingScrim({ active }: { active: boolean }) {
  const target = useModalPortalTarget();
  useLayoutEffect(() => {
    if (!active) return;
    lockBodyScroll();
    return () => unlockBodyScroll();
  }, [active]);

  if (!active || !target) return null;

  return createPortal(
    <div
      className={`${modalBackdropClass} z-[79] pointer-events-auto`}
      aria-busy="true"
      aria-hidden="true"
    />,
    target,
  );
}

export function ModalCloseButton({
  onClick,
  disabled,
  closeRef,
  className = '',
}: {
  onClick: () => void;
  disabled?: boolean;
  closeRef?: RefObject<HTMLButtonElement>;
  className?: string;
}) {
  return (
    <button
      ref={closeRef}
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`shrink-0 rounded-lg p-2 text-primary hover:bg-surface-container focus:outline-none focus:ring-2 focus:ring-primary/30 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      aria-label="Close"
    >
      <span className="material-symbols-outlined text-[22px]">close</span>
    </button>
  );
}

export function ModalOverlay({
  onBackdropClose,
  backdropLabel,
  disableBackdropClose,
  titleId,
  panelClassName = '',
  children,
}: {
  onBackdropClose: () => void;
  backdropLabel: string;
  disableBackdropClose?: boolean;
  titleId: string;
  panelClassName?: string;
  children: ReactNode;
}) {
  const target = useModalPortalTarget();

  useLayoutEffect(() => {
    lockBodyScroll();
    return () => unlockBodyScroll();
  }, []);

  if (!target) return null;

  return createPortal(
    <div className={modalOverlayClass}>
      <button
        type="button"
        className={`${modalBackdropClass} ${disableBackdropClose ? 'cursor-default' : 'cursor-pointer'}`}
        aria-label={backdropLabel}
        disabled={disableBackdropClose}
        onClick={() => {
          if (disableBackdropClose) return;
          onBackdropClose();
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`${modalPanelClass} ${panelClassName}`}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    target,
  );
}