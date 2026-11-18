'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import BackHomeLink from '@/components/back-home-link';
import PasswordInput from '@/components/password-input';
import { safeRegistrationNext } from '@/lib/events/choose-event';

export type UsernameFirstAuthGateProps = {
    title: string;
  /** Shown on step 1 */
    identifierLead: string;
  /** Shown on step 2 */
    passwordLead: string;
    icon?: string;
    idPrefix: string;
  /** Post-login when there is no valid ?next= */
    defaultDest: string;
  /** ?next= for signup when the username does not exist yet */
    signupNext: string;
  /** Optional ?next= from the URL for post-login */
    postLoginNext?: string | null;
};

function resolvePostLoginDest(
    me: { role?: string; jubilee_reg_status?: string } | null,
    postLoginNext: string | null | undefined,
    defaultDest: string
): string {
    const next = safeRegistrationNext(postLoginNext);
    if (me?.role === 'admin') {
        return next &&
            (next === '/admin-app' || next.startsWith('/admin-app/') || next.startsWith('/admin-app?'))
            ? next
            : '/admin';
    }
    if (next) return next;
    if (me?.jubilee_reg_status === 'paid') return '/member';
    return defaultDest;
}

type Step = 'identifier' | 'password';

export function UsernameFirstAuthGate({
    title,
    identifierLead,
    passwordLead,
    icon = 'how_to_reg',
    idPrefix,
    defaultDest,
    signupNext,
    postLoginNext,
}: UsernameFirstAuthGateProps) {
    const router = useRouter();
    const [step, setStep] = useState<Step>('identifier');
    const [loginId, setLoginId] = useState('');
    const [password, setPassword] = useState('');
    const [checking, setChecking] = useState(false);
    const [signingIn, setSigningIn] = useState(false);
    const [error, setError] = useState('');

    const fieldClass =
        'px-4 py-3.5 rounded-lg border border-outline-variant text-body-sm bg-surface focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all disabled:bg-surface-container disabled:text-on-surface-variant w-full';

    async function handleIdentifier(e: FormEvent) {
        e.preventDefault();
        const trimmed = loginId.trim();
        if (!trimmed) {
            setError('Enter your username or email');
            return;
        }
        setChecking(true);
        setError('');
        try {
            const res = await fetch('/api/auth/lookup', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ username: trimmed }),
            });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(payload.error || 'Could not verify that username');
                setChecking(false);
                return;
            }
            if (payload.exists) {
                setStep('password');
                setChecking(false);
                return;
            }
            const params = new URLSearchParams();
            const next = safeRegistrationNext(signupNext) || signupNext;
            if (next) params.set('next', next);
            params.set('login', trimmed);
            router.push(`/signup?${params.toString()}`);
        } catch {
            setError('An unexpected error occurred');
            setChecking(false);
        }
    }

    async function handlePasswordLogin(e: FormEvent) {
        e.preventDefault();
        setSigningIn(true);
        setError('');
        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ username: loginId.trim(), password }),
            });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(payload.error || 'Invalid username or password');
                setSigningIn(false);
                return;
            }

            const meRes = await fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' });
            const me = meRes.ok ? await meRes.json() : null;
            const dest = resolvePostLoginDest(me, postLoginNext, defaultDest);
            window.location.assign(dest);
        } catch {
            setError('An unexpected error occurred');
            setSigningIn(false);
        }
    }

    function backToIdentifier() {
        setStep('identifier');
        setPassword('');
        setError('');
    }

    return (
        <div className="min-h-screen bg-surface flex items-center justify-center px-6 pt-20">
            <div className="w-full max-w-lg">
                <div className="bg-surface-paper rounded-2xl shadow-lg p-8 border border-surface-container-low text-center">
                    <div className="mb-6">
                        <span className="material-symbols-outlined text-[48px] text-jubilee-gold-deep mx-auto block">
                            {icon}
                        </span>
                    </div>

                    <h1 className="text-headline-lg text-primary mb-3">{title}</h1>

                    <p className="text-body-md text-on-surface-variant mb-8">
                        {step === 'identifier' ? identifierLead : passwordLead}
                    </p>

                    {step === 'identifier' ? (
                        <form onSubmit={handleIdentifier} className="text-left space-y-4">
                            <div className="flex flex-col">
                                <label
                                    className="text-label-md text-primary mb-2 uppercase tracking-wider"
                                    htmlFor={`${idPrefix}-login-id`}
                                >
                                    Username or email
                                </label>
                                <input
                                    id={`${idPrefix}-login-id`}
                                    type="text"
                                    value={loginId}
                                    onChange={(e) => setLoginId(e.target.value)}
                                    placeholder="you@gmail.com or your_username"
                                    required
                                    autoComplete="username"
                                    disabled={checking}
                                    className={fieldClass}
                                />
                            </div>
                            {error ? (
                                <div className="p-3 rounded-lg bg-error-container text-error text-body-sm">{error}</div>
                            ) : null}
                            <button
                                type="submit"
                                disabled={checking}
                                className="w-full py-3.5 rounded-lg bg-primary hover:bg-navy-subtle text-on-primary text-label-md uppercase tracking-wider shadow-md transition-all disabled:bg-surface-container disabled:text-on-surface-variant font-bold"
                            >
                                {checking ? 'Checking…' : 'Continue'}
                            </button>
                        </form>
                    ) : (
                        <form onSubmit={handlePasswordLogin} className="text-left space-y-4">
                            <p className="text-body-sm text-on-surface-variant rounded-lg bg-surface-container-low px-4 py-3">
                                Signing in as{' '}
                                <span className="font-semibold text-primary">{loginId.trim()}</span>
                                <button
                                    type="button"
                                    onClick={backToIdentifier}
                                    className="ml-2 text-primary underline hover:text-navy-subtle text-label-sm"
                                >
                                    Change
                                </button>
                            </p>
                            <div className="flex flex-col">
                                <label
                                    className="text-label-md text-primary mb-2 uppercase tracking-wider"
                                    htmlFor={`${idPrefix}-password`}
                                >
                                    Password
                                </label>
                                <PasswordInput
                                    id={`${idPrefix}-password`}
                                    value={password}
                                    onChange={setPassword}
                                    autoComplete="current-password"
                                    required
                                    disabled={signingIn}
                                    className={fieldClass}
                                />
                            </div>
                            {error ? (
                                <div className="p-3 rounded-lg bg-error-container text-error text-body-sm">{error}</div>
                            ) : null}
                            <button
                                type="submit"
                                disabled={signingIn}
                                className="w-full py-3.5 rounded-lg bg-primary hover:bg-navy-subtle text-on-primary text-label-md uppercase tracking-wider shadow-md transition-all disabled:bg-surface-container disabled:text-on-surface-variant font-bold"
                            >
                                {signingIn ? 'Signing in…' : 'Sign in'}
                            </button>
                            <div className="text-center pt-2">
                                <Link
                                    href={`/reset-password?email=${encodeURIComponent(loginId.trim())}`}
                                    className="text-label-sm text-primary hover:text-navy-subtle transition-colors uppercase tracking-wider"
                                >
                                    Forgot password?
                                </Link>
                            </div>
                        </form>
                    )}

                    <div className="mt-8">
                        <BackHomeLink signedIn={false} />
                    </div>
                </div>
            </div>
        </div>
    );
}