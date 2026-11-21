'use client';

import { useEffect, useState } from 'react';
import { PASS_QR_UNCHANGED_HINT } from '@/lib/payments/offline-proof';

export default function RegistrationQr({
  code,
  payload,
  preview = false,
}: {
  code: string;
  /** Signed scan value; defaults to code. */
  payload?: string | null;
  /** Muted styling when payment is not yet verified for entry. */
  preview?: boolean;
}) {
  const [src, setSrc] = useState('');
  const scanValue = String(payload || code).trim();

  useEffect(() => {
    let cancel = false;
    import('qrcode').then((mod) =>
      mod.default.toDataURL(scanValue, { margin: 2, width: 220, errorCorrectionLevel: 'H' })
    )
      .then((url) => {
        if (!cancel) setSrc(url);
      })
      .catch(() => {
        if (!cancel) setSrc('');
      });
    return () => {
      cancel = true;
    };
  }, [scanValue]);

  if (!src) {
    return <p className="text-body-sm text-on-surface-variant">Preparing QR code…</p>;
  }

  return (
    <img
      src={src}
      alt={
        preview
          ? `Preview QR for registration ${code}. ${PASS_QR_UNCHANGED_HINT}`
          : `QR code for registration ${code}`
      }
      width={220}
      height={220}
      className={`rounded-lg bg-white p-2 ${preview ? 'opacity-60 grayscale' : ''}`}
    />
  );
}
