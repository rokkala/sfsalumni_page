'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { MemberTransactionDon, MemberTransactionReg } from '@/lib/member/transactions';
import type { PortalMenuFlags } from '@/lib/portal-menu/menu';

export type MemberHomeMember = {
  id: string;
  email: string;
  full_name: string;
  batch: number | null;
  role: string;
  member_status: string;
};

export type MemberHomeVenuePasses = {
  hideVenuePass?: boolean;
  passes?: Array<{
    eventId: string;
    eventTitle: string;
    starts_at: string;
    ends_at: string | null;
    venue: string;
    registration: Record<string, unknown>;
  }>;
  profile?: { full_name?: string | null } | null;
};

export type MemberHomeBootstrap = {
  member: MemberHomeMember;
  venuePasses: MemberHomeVenuePasses;
  transactions: { registrations: MemberTransactionReg[]; donations: MemberTransactionDon[] };
  menu: PortalMenuFlags;
};

/** Outside provider — child fetches on its own. */
export const MEMBER_HOME_OUTSIDE = Symbol('member-home-outside');

export type MemberHomeContextValue =
  | typeof MEMBER_HOME_OUTSIDE
  | undefined
  | MemberHomeBootstrap
  | null;

const MemberHomeContext = createContext<MemberHomeContextValue>(MEMBER_HOME_OUTSIDE);

export function useMemberHomeBootstrap(): MemberHomeContextValue {
  return useContext(MemberHomeContext);
}

export function MemberHomeBootstrapProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<MemberHomeBootstrap | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/member/home', { cache: 'no-store' });
        if (!active) return;
        if (!res.ok) {
          setValue(null);
          return;
        }
        const payload = (await res.json()) as MemberHomeBootstrap;
        if (active) setValue(payload);
      } catch {
        if (active) setValue(null);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return <MemberHomeContext.Provider value={value}>{children}</MemberHomeContext.Provider>;
}