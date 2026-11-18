'use client';

import { type ReactNode, type RefObject } from 'react';

export const modalOverlayClass =
  'fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-6';

export const modalBackdropClass =
  'absolute inset-0 bg-primary/50 backdrop-blur-[2px] cursor-pointer';

export const modalPanelClass =
  'relative z-[81] w-full max-h-[92vh] overflow-hidden rounded-t-2xl sm:rounded-2xl border border-outline-variant bg-surface-paper shadow-xl';

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
  return (
    <div className={modalOverlayClass}>
      <button
        type="button"
        className={modalBackdropClass}
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
      >
        {children}
      </div>
    </div>
  );
}