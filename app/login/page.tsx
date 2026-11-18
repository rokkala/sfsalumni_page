'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { UsernameFirstAuthGate } from '@/components/username-first-auth-gate';
import { safeRegistrationNext } from '@/lib/events/choose-event';

export default function LoginPage() {
    return (
        <Suspense fallback={null}>
            <LoginGate />
        </Suspense>
    );
}

function LoginGate() {
    const searchParams = useSearchParams();
    const next = searchParams.get('next');
    const signupNext = safeRegistrationNext(next) || '/member';

    return (
        <UsernameFirstAuthGate
            idPrefix="login-gate"
            icon="login"
            title="Alumni account"
            identifierLead="Enter your username or email to sign in or create an account."
            passwordLead="Welcome back — enter your password to continue."
            defaultDest="/member"
            signupNext={signupNext}
            postLoginNext={next}
        />
    );
}