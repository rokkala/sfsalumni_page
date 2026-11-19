export function registrationPath(eventId: string): string {
  return `/registration?event=${encodeURIComponent(eventId)}`;
}

export function newRegistrationPath(eventId: string): string {
  return `/new_registration?event=${encodeURIComponent(eventId)}`;
}

/** One open event can open directly. Several events need an explicit choice. */
export function chooseRegistrationEvent<T extends { id: string }>(events: T[]): T | null {
  if (events.length === 1) return events[0];
  return null;
}

/** Safe post-login return paths (registration or venue pass). Anything else is ignored. */
export function safeRegistrationNext(next: string | null | undefined): string | null {
  if (!next || next.startsWith('//') || next.includes('://')) return null;
  if (next.startsWith('/registration') || next.startsWith('/new_registration')) return next;
  if (next === '/event-app' || next.startsWith('/event-app?')) return next;
  if (next === '/event-app/pass' || next.startsWith('/event-app/pass?')) return next;
  if (next === '/admin-app' || next.startsWith('/admin-app/') || next.startsWith('/admin-app?')) {
    return next;
  }
  if (next === '/admin' || next.startsWith('/admin/') || next.startsWith('/admin?')) {
    return next;
  }
  return null;
}
