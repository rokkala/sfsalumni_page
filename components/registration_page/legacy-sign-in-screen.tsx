import Link from 'next/link';
import BackHomeLink from '@/components/back-home-link';
import { registrationPath } from '@/lib/events/choose-event';
import type { EventCatalog } from '@/lib/events/types';

export interface LegacySignInScreenProps {
    event: EventCatalog | null;
}

export function LegacySignInScreen({ event }: LegacySignInScreenProps) {
    const loginHref = event
        ? `/login?next=${encodeURIComponent(registrationPath(event.id))}`
        : '/login';
    return (
        <div className="min-h-screen bg-surface flex items-center justify-center px-6 pt-20">
            <div className="w-full max-w-lg">
                <div className="bg-surface-paper rounded-2xl shadow-lg p-8 border border-surface-container-low text-center">
                    <div className="mb-6">
                        <span className="material-symbols-outlined text-[48px] text-jubilee-gold-deep mx-auto block">
                            how_to_reg
                        </span>
                    </div>

                    <h1 className="text-headline-lg text-primary mb-3">Registration Required</h1>

                    <p className="text-body-md text-on-surface-variant mb-8">
                        Sign in or create an account to register for the Golden Jubilee. We&apos;ll check whether
                        you already have an account from your username or email.
                    </p>

                    <Link
                        href={loginHref}
                        className="inline-flex items-center justify-center gap-2 w-full px-6 py-3.5 rounded-lg bg-primary hover:bg-navy-subtle text-on-primary text-label-md uppercase tracking-wider shadow-md transition-all"
                    >
                        <span className="material-symbols-outlined text-[20px]">login</span>
                        Continue
                    </Link>

                    <div className="mt-8">
                        <BackHomeLink signedIn={false} />
                    </div>
                </div>
            </div>
        </div>
    );
}