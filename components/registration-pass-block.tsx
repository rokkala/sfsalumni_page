'use client';

import RegistrationQr from '@/components/registration-qr';
import {
  PASS_PAYMENT_VERIFIED_MESSAGE,
  PASS_PENDING_VERIFICATION_MESSAGE,
  passStatusBadge,
  type VenuePassState,
} from '@/lib/payments/offline-proof';

type Props = {
  state: 'pending_verification' | 'verified';
  code: string;
  payload: string | null;
};

export function RegistrationPassBlock({ state, code, payload }: Props) {
  const preview = state === 'pending_verification';
  const badge = passStatusBadge(state);

  return (
    <div
      className={`rounded-lg border px-4 py-5 text-center ${
        preview ? 'border-outline-variant/80 bg-surface-container-low' : 'border-outline-variant bg-surface'
      }`}
    >
      {badge ? (
        <p
          className={`inline-block rounded-full px-3 py-1 text-label-sm font-bold ${
            preview
              ? 'bg-surface-container text-on-surface-variant'
              : 'bg-secondary-container text-on-secondary-fixed'
          }`}
        >
          {badge}
        </p>
      ) : null}
      <p className="mt-3 text-label-md text-primary uppercase tracking-wider">Registration ID</p>
      <p className="mt-2 text-headline-md text-primary tracking-[0.18em] font-bold">{code}</p>
      <div className="mt-4 flex justify-center">
        <RegistrationQr code={code} payload={payload} preview={preview} />
      </div>
      <p className="mt-3 text-body-sm text-on-surface-variant">
        {preview ? PASS_PENDING_VERIFICATION_MESSAGE : PASS_PAYMENT_VERIFIED_MESSAGE}
      </p>
    </div>
  );
}

export function passBlockFromMoney(input: {
  passState: VenuePassState;
  registrationCode: string | null;
  registrationQr: string | null;
  previewRegistrationCode: string | null;
  previewRegistrationQr: string | null;
}): Props | null {
  if (input.passState === 'verified' && input.registrationCode) {
    return {
      state: 'verified',
      code: input.registrationCode,
      payload: input.registrationQr,
    };
  }
  if (input.passState === 'pending_verification' && input.previewRegistrationCode) {
    return {
      state: 'pending_verification',
      code: input.previewRegistrationCode,
      payload: input.previewRegistrationQr,
    };
  }
  return null;
}