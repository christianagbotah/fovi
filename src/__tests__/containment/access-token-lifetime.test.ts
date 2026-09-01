import { decodeJwt } from 'jose';
import { describe, expect, it } from 'vitest';
import { ACCESS_TOKEN_TTL, generateAccessToken } from '@/lib/auth';

describe('Phase 3H short-lived access tokens', () => {
  it('pins the access-token TTL to 15 minutes', () => {
    expect(ACCESS_TOKEN_TTL).toBe('15m');
  });

  it('mints access tokens with an approximately 15-minute lifetime', async () => {
    const token = await generateAccessToken('phase3h-user', 'phase3h@example.test', 'Phase 3H');
    const payload = decodeJwt(token);

    expect(payload.iat).toBeTypeOf('number');
    expect(payload.exp).toBeTypeOf('number');

    const lifetimeSeconds = (payload.exp as number) - (payload.iat as number);
    expect(lifetimeSeconds).toBe(15 * 60);
    expect(payload.type).toBe('access');
  });
});
