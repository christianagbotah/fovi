import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function source(path: string): string {
  return readFileSync(resolve(__dirname, path), 'utf8');
}

const signinRoute = source('../../../src/app/api/auth/signin/route.ts');
const twoFactorAuthRoute = source('../../../src/app/api/auth/two-factor/authenticate/route.ts');
const sameOrigin = source('../../../src/lib/same-origin.ts');

function expectOriginGateBefore(
  routeSource: string,
  laterMarkers: string[],
): void {
  const gate = routeSource.indexOf('if (!isSameOriginMutation(request))');
  expect(gate).toBeGreaterThan(-1);

  for (const marker of laterMarkers) {
    const index = routeSource.indexOf(marker);
    expect(index, `missing marker: ${marker}`).toBeGreaterThan(-1);
    expect(index, `${marker} must occur after same-origin validation`).toBeGreaterThan(gate);
  }
}

describe('Phase 3AR session-issuance same-origin boundary', () => {
  it('rejects cross-origin password sign-in before authentication or session mutation', () => {
    expect(signinRoute).toContain('isSameOriginMutation,');
    expect(signinRoute).toContain("Cross-origin sign-in is not allowed.");
    expect(signinRoute).toContain('{ status: 403 }');

    expectOriginGateBefore(signinRoute, [
      'const rateResult = limiter(request);',
      'await request.json()',
      'verifyPassword(password, user.passwordHash)',
      'replaceAuthSession(user.id, rememberMe, existingRefreshToken)',
      'setRefreshCookie(response, session)',
    ]);
  });

  it('rejects cross-origin 2FA authentication before challenge/TOTP/session mutation', () => {
    expect(twoFactorAuthRoute).toContain('isSameOriginMutation,');
    expect(twoFactorAuthRoute).toContain(
      "Cross-origin two-factor authentication is not allowed.",
    );
    expect(twoFactorAuthRoute).toContain('{ status: 403 }');

    expectOriginGateBefore(twoFactorAuthRoute, [
      'const rateResult = limiter(request);',
      'await request.json()',
      'verifyToken(challenge)',
      'consumeTwoFactorChallenge(challengePayload.jti, user.id)',
      'replaceAuthSession(user.id, rememberMe, existingRefreshToken)',
      'setRefreshCookie(response, session)',
    ]);
  });

  it('reuses the production fail-closed canonical-origin validator', () => {
    expect(sameOrigin).toContain("process.env.NODE_ENV === 'production'");
    expect(sameOrigin).toContain('process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL');
    expect(sameOrigin).toContain("fetchSite !== 'same-origin'");
    expect(sameOrigin).toContain('return process.env.NODE_ENV !== \'production\';');
  });
});
