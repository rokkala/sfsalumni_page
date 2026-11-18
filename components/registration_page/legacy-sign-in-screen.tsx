import Link from 'next/link';
import BackHomeLink from '@/components/back-home-link';
import { registrationPath } from '@/lib/events/choose-event';
import type { EventCatalog } from '@/lib/events/types';

export interface LegacySignInScreenProps {
    event: EventCatalog | null;
}

export function LegacySignInScreen({ event }: LegacySignInScreenProps) {
    const nextParam = event ? `?next=${encodeURIComponent(registrationPath(event.id))}` : '';
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
                        To register for the Golden Jubilee, you need to create an account or log in with your
                        existing account.
                    </p>

                    <div className="flex flex-col gap-3 mb-6">
                        <Link
                            href={event ? `/signup${nextParam}` : '/signup'}
                            className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-lg bg-secondary-container hover:bg-secondary-fixed-dim text-on-secondary-fixed text-label-md uppercase tracking-wider shadow-md transition-all"
                        >
                            <span className="material-symbols-outlined text-[20px]">person_add</span>
                            Create New Account
                        </Link>

                        <Link
                            href={event ? `/login${nextParam}` : '/login'}
                            className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-lg bg-primary hover:bg-navy-subtle text-on-primary text-label-md uppercase tracking-wider shadow-md transition-all"
                        >
                            <span className="material-symbols-outlined text-[20px]">login</span>
                            Sign In to Existing Account
                        </Link>
                    </div>

                    <p className="text-body-sm text-on-surface-variant">
                        Already have an account? Sign in to automatically prefill your registration.
                    </p>

                    <div className="mt-8">
                        <BackHomeLink signedIn={false} />
                    </div>
                </div>
            </div>
        </div>
    );
}