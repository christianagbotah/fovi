import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(
  resolve(__dirname, '../../../mini-services/market-service/index.ts'),
  'utf8',
);

describe('market-service health routing', () => {
  it('keeps /health on the plain HTTP server instead of Socket.IO root interception', () => {
    expect(source).toContain("req.url === '/health'");
    expect(source).toContain('new Server(httpServer');
    expect(source).not.toContain("path: '/'");
  });
});
