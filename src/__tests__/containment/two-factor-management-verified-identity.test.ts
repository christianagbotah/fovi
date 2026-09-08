import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const ROUTES = [
  ['setup', resolve(ROOT, 'src/app/api/auth/two-factor/setup/route.ts')],
  ['verify', resolve(ROOT, 'src/app/api/auth/two-factor/verify/route.ts')],
  ['disable', resolve(ROOT, 'src/app/api/auth/two-factor/disable/route.ts')],
] as const;

describe('Phase 3AA verified 2FA management identity boundary', () => {
  it.each(ROUTES)('%s derives identity only from a verified access bearer token', (_name, route) => {
    const source = readFileSync(route, 'utf8');

    expect(source).toMatch(/import \{[^}]*extractBearerToken[^}]*verifyToken[^}]*\} from '@\/lib\/auth';/);
    expect(source).toContain('const bearerToken = extractBearerToken(request);');
    expect(source).toContain('const accessPayload = await verifyToken(bearerToken);');
    expect(source).toContain("accessPayload.type !== 'access'");
    expect(source).toContain('const userId = accessPayload.sub;');
    expect(source).not.toContain("request.headers.get('X-User-Id')");
    expect(source).not.toContain('request.headers.get("X-User-Id")');
  });

  it.each(ROUTES)('%s authenticates before parsing its request body', (_name, route) => {
    const source = readFileSync(route, 'utf8');
    const identityIndex = source.indexOf('const userId = accessPayload.sub;');
    const bodyIndex = source.indexOf('const body = await request.json()');

    expect(identityIndex).toBeGreaterThan(-1);
    expect(bodyIndex).toBeGreaterThan(identityIndex);
  });

  it.each(ROUTES)('%s uses the non-cacheable auth response boundary', (_name, route) => {
    const source = readFileSync(route, 'utf8');

    expect(source).toContain("import { authJson } from '@/lib/auth-response';");
    expect(source).toContain('authJson(');
    expect(source).not.toContain('NextResponse.json');
  });

  it('keeps 2FA state changes and challenge revocation transactional', () => {
    for (const [name, route] of ROUTES) {
      const source = readFileSync(route, 'utf8');
      expect(source, name).toContain('db!.$transaction(async (tx) => {');
      expect(source, name).toContain('revokeTwoFactorChallengesForUser(tx,');
    }
  });

  it('keeps setup secret and QR material behind the no-store response boundary', () => {
    const setup = readFileSync(ROUTES[0][1], 'utf8');

    expect(setup).toContain('secret,');
    expect(setup).toContain('otpauth_url: otpauthUrl');
    expect(setup).toContain('qr_code_base64: qrCodeBase64');
    expect(setup).toContain('return authJson({');
    expect(setup).not.toContain('NextResponse.json');
  });
});
