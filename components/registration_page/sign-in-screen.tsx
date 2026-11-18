'use client';

import { usePathname } from 'next/navigation';
import { UsernameFirstAuthGate } from '@/components/username-first-auth-gate';
import { newRegistrationPath, registrationPath } from '@/lib/events/choose-event';
import type { EventCatalog } from '@/lib/events/types';

export interface SignInScreenProps {
    event: EventCatalog | null;
}

export function SignInScreen({ event }: SignInScreenProps) {
    const pathname = usePathname() || '';
    const onNewGate = pathname === '/new_registration' || pathname.startsWith('/new_registration/');
    const nextPath = event
        ? onNewGate
            ? newRegistrationPath(event.id)
            : registrationPath(event.id)
        : onNewGate
          ? '/new_registration'
          : '/registration';

    return (
        <UsernameFirstAuthGate
            idPrefix="reg-gate"
            title="Registration Required"
            identifierLead="Enter your username or email to sign in or create an account."
            passwordLead="Welcome back — enter your password to continue."
            defaultDest="/registration"
            signupNext={nextPath}
            postLoginNext={nextPath}
        />
    );
}