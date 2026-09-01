import type { NextRequest } from 'next/server';

function normalizedOrigin(value: string | null | undefined): string | null {
  if (!value || value === 'null') return null;

  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function expectedMutationOrigin(request: Pick<NextRequest, 'nextUrl'>): string | null {
  if (process.env.NODE_ENV === 'production') {
    return normalizedOrigin(process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL);
  }

  return normalizedOrigin(request.nextUrl.origin);
}

/**
 * Validate browser-only cookie mutations such as refresh and logout.
 *
 * Production fails closed when the canonical application origin is missing or
 * when neither Origin nor Referer establishes same-origin provenance. The
 * Sec-Fetch-Site signal is also enforced when browsers provide it.
 *
 * Non-production keeps the historical no-header allowance so local route
 * harnesses and direct development probes remain usable without weakening the
 * production boundary.
 */
export function isSameOriginMutation(
  request: Pick<NextRequest, 'headers' | 'nextUrl'>,
): boolean {
  const expectedOrigin = expectedMutationOrigin(request);
  if (!expectedOrigin) return false;

  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin') return false;

  const origin = request.headers.get('origin');
  if (origin) return normalizedOrigin(origin) === expectedOrigin;

  const referer = request.headers.get('referer');
  if (referer) return normalizedOrigin(referer) === expectedOrigin;

  return process.env.NODE_ENV !== 'production';
}
