import { afterEach, describe, expect, it, vi } from 'vitest';
import { isSameOriginMutation } from '@/lib/same-origin';

type MutationRequest = Parameters<typeof isSameOriginMutation>[0];

function request({
  url = 'https://internal.invalid/api/auth/refresh',
  origin,
  referer,
  fetchSite,
}: {
  url?: string;
  origin?: string;
  referer?: string;
  fetchSite?: string;
} = {}): MutationRequest {
  const headers = new Headers();
  if (origin !== undefined) headers.set('origin', origin);
  if (referer !== undefined) headers.set('referer', referer);
  if (fetchSite !== undefined) headers.set('sec-fetch-site', fetchSite);

  return {
    headers,
    nextUrl: new URL(url),
  } as unknown as MutationRequest;
}

function production(appUrl = 'https://app.example.com'): void {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('APP_URL', appUrl);
  vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Phase 3J cookie mutation origin boundary', () => {
  it('accepts a matching configured production Origin behind a reverse proxy', () => {
    production();
    expect(
      isSameOriginMutation(
        request({ origin: 'https://app.example.com', fetchSite: 'same-origin' }),
      ),
    ).toBe(true);
  });

  it('rejects cross-origin and opaque Origin values', () => {
    production();
    expect(isSameOriginMutation(request({ origin: 'https://evil.example' }))).toBe(false);
    expect(isSameOriginMutation(request({ origin: 'null' }))).toBe(false);
    expect(isSameOriginMutation(request({ origin: 'not-a-url' }))).toBe(false);
  });

  it('rejects browser fetch metadata that is not same-origin even if Origin matches', () => {
    production();
    expect(
      isSameOriginMutation(
        request({ origin: 'https://app.example.com', fetchSite: 'cross-site' }),
      ),
    ).toBe(false);
    expect(
      isSameOriginMutation(
        request({ origin: 'https://app.example.com', fetchSite: 'same-site' }),
      ),
    ).toBe(false);
  });

  it('uses same-origin Referer as a fallback when Origin is unavailable', () => {
    production();
    expect(
      isSameOriginMutation(
        request({ referer: 'https://app.example.com/settings/security' }),
      ),
    ).toBe(true);
    expect(
      isSameOriginMutation(
        request({ referer: 'https://evil.example/attack' }),
      ),
    ).toBe(false);
  });

  it('fails closed in production when browser provenance or canonical app origin is missing', () => {
    production();
    expect(isSameOriginMutation(request())).toBe(false);

    vi.stubEnv('APP_URL', '');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
    expect(
      isSameOriginMutation(request({ origin: 'https://app.example.com' })),
    ).toBe(false);
  });

  it('keeps no-header direct development probes compatible without weakening production', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('APP_URL', 'https://app.example.com');
    expect(
      isSameOriginMutation(request({ url: 'http://localhost:3000/api/auth/refresh' })),
    ).toBe(true);
    expect(
      isSameOriginMutation(
        request({
          url: 'http://localhost:3000/api/auth/refresh',
          origin: 'http://localhost:3000',
          fetchSite: 'same-origin',
        }),
      ),
    ).toBe(true);
  });
});
