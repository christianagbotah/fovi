import { describe, expect, it } from 'vitest';
import { SignJWT, type JWTPayload } from 'jose';
import {
  generateAccessToken,
  generateTwoFactorChallenge,
  verifyToken,
} from '@/lib/auth';

function signingKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET must be configured by the test environment');
  return new TextEncoder().encode(secret);
}

async function signCustom(
  payload: JWTPayload,
  options?: {
    algorithm?: 'HS256' | 'HS384' | 'HS512';
    issuedAt?: boolean;
    expiration?: boolean;
    jti?: string;
  },
): Promise<string> {
  let jwt = new SignJWT(payload).setProtectedHeader({
    alg: options?.algorithm ?? 'HS256',
  });

  if (options?.jti !== undefined) jwt = jwt.setJti(options.jti);
  if (options?.issuedAt !== false) jwt = jwt.setIssuedAt();
  if (options?.expiration !== false) jwt = jwt.setExpirationTime('5m');

  return jwt.sign(signingKey());
}

describe('Phase 3AU JWT verification profile', () => {
  it('continues to accept tokens produced by the Fovi access and 2FA issuers', async () => {
    const accessToken = await generateAccessToken('user-1', 'user1@example.com');
    const accessPayload = await verifyToken(accessToken);

    expect(accessPayload?.type).toBe('access');
    expect(accessPayload?.sub).toBe('user-1');

    const challengeToken = await generateTwoFactorChallenge(
      'user-1',
      'user1@example.com',
      'challenge-1',
    );
    const challengePayload = await verifyToken(challengeToken);

    expect(challengePayload?.type).toBe('two_factor');
    expect(challengePayload?.jti).toBe('challenge-1');
  });

  it('rejects a validly signed token that uses a non-issuer HMAC algorithm', async () => {
    const token = await signCustom(
      {
        sub: 'user-1',
        email: 'user1@example.com',
        type: 'two_factor',
      },
      { algorithm: 'HS512', jti: 'challenge-1' },
    );

    expect(await verifyToken(token)).toBeNull();
  });

  it('rejects signed tokens with an unknown or missing application token type', async () => {
    const unknownType = await signCustom({
      sub: 'user-1',
      email: 'user1@example.com',
      type: 'refresh_like',
    });
    const missingType = await signCustom({
      sub: 'user-1',
      email: 'user1@example.com',
    });

    expect(await verifyToken(unknownType)).toBeNull();
    expect(await verifyToken(missingType)).toBeNull();
  });

  it('rejects a signed two-factor token without the one-time challenge jti', async () => {
    const token = await signCustom({
      sub: 'user-1',
      email: 'user1@example.com',
      type: 'two_factor',
    });

    expect(await verifyToken(token)).toBeNull();
  });

  it('requires both issuer-produced temporal claims', async () => {
    const withoutIssuedAt = await signCustom(
      {
        sub: 'user-1',
        email: 'user1@example.com',
        type: 'two_factor',
      },
      { issuedAt: false, jti: 'challenge-1' },
    );
    const withoutExpiration = await signCustom(
      {
        sub: 'user-1',
        email: 'user1@example.com',
        type: 'two_factor',
      },
      { expiration: false, jti: 'challenge-1' },
    );

    expect(await verifyToken(withoutIssuedAt)).toBeNull();
    expect(await verifyToken(withoutExpiration)).toBeNull();
  });

  it('rejects malformed optional access-session identifiers before session lookup', async () => {
    const token = await signCustom({
      sub: 'user-1',
      email: 'user1@example.com',
      type: 'access',
      sid: '   ',
    });

    expect(await verifyToken(token)).toBeNull();
  });
});
