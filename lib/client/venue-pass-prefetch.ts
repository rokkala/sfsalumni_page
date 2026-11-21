/** Overlap MemberGate auth with venue-passes API on signed-in pages. */

let inflight: Promise<Response> | null = null;

export function prefetchVenuePasses(): Promise<Response> {
  if (inflight) return inflight;
  const req = fetch('/api/registration/venue-passes', { cache: 'no-store' });
  inflight = req;
  void req.finally(() => {
    if (inflight === req) inflight = null;
  });
  return req;
}