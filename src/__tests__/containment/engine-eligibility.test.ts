// ============================================================
// engine-eligibility.test.ts — CR4.3A R7
// Tests the canonical evaluateEngineAccountEligibility function.
// R7 Blocker A: credentials must be EXACTLY null.
//   undefined, missing, '', ' ', false, 0, [], {}, any string → REJECT.
//   Only null is accepted for apiKey, apiSecret, passphrase.
// ============================================================

import { describe, it, expect } from 'vitest';
import { evaluateEngineAccountEligibility } from '@/lib/engine-eligibility';

const VALID_DEMO: Parameters<typeof evaluateEngineAccountEligibility>[0] = {
  broker: 'demo',
  accountType: 'demo',
  isDemo: true,
  isActive: true,
  apiKey: null,
  apiSecret: null,
  passphrase: null,
};

describe('evaluateEngineAccountEligibility', () => {
  // ── 1. Valid active demo account → eligible: true ──
  it('valid active demo account → eligible: true', () => {
    const result = evaluateEngineAccountEligibility({ ...VALID_DEMO });
    expect(result).toEqual({ eligible: true });
  });

  // ── 2. null account → no-account ──
  it('null account → no-account', () => {
    const result = evaluateEngineAccountEligibility(null);
    expect(result).toEqual({ eligible: false, reason: 'no-account' });
  });

  // ── 3. undefined account → no-account ──
  it('undefined account → no-account', () => {
    const result = evaluateEngineAccountEligibility(undefined as any);
    expect(result).toEqual({ eligible: false, reason: 'no-account' });
  });

  // ── 4. isActive: false → inactive-account ──
  it('isActive: false → inactive-account', () => {
    const result = evaluateEngineAccountEligibility({ ...VALID_DEMO, isActive: false });
    expect(result).toEqual({ eligible: false, reason: 'inactive-account' });
  });

  // ── 5. isActive: null → inactive-account ──
  it('isActive: null → inactive-account', () => {
    const result = evaluateEngineAccountEligibility({ ...VALID_DEMO, isActive: null });
    expect(result).toEqual({ eligible: false, reason: 'inactive-account' });
  });

  // ── 6. isActive: undefined → inactive-account ──
  it('isActive: undefined → inactive-account', () => {
    const result = evaluateEngineAccountEligibility({ ...VALID_DEMO, isActive: undefined });
    expect(result).toEqual({ eligible: false, reason: 'inactive-account' });
  });

  // ── 7. missing isActive property → inactive-account ──
  it('missing isActive property → inactive-account', () => {
    const { isActive, ...rest } = VALID_DEMO;
    const result = evaluateEngineAccountEligibility(rest as any);
    expect(result).toEqual({ eligible: false, reason: 'inactive-account' });
  });

  // ── 8. wrong broker (binance) → wrong-broker ──
  it('wrong broker (binance) → wrong-broker', () => {
    const result = evaluateEngineAccountEligibility({ ...VALID_DEMO, broker: 'binance' });
    expect(result).toEqual({ eligible: false, reason: 'wrong-broker' });
  });

  // ── 9. wrong accountType (spot) → wrong-accountType ──
  it('wrong accountType (spot) → wrong-accountType', () => {
    const result = evaluateEngineAccountEligibility({ ...VALID_DEMO, accountType: 'spot' });
    expect(result).toEqual({ eligible: false, reason: 'wrong-accountType' });
  });

  // ── 10. isDemo: false → isDemo-not-true ──
  it('isDemo: false → isDemo-not-true', () => {
    const result = evaluateEngineAccountEligibility({ ...VALID_DEMO, isDemo: false });
    expect(result).toEqual({ eligible: false, reason: 'isDemo-not-true' });
  });

  // ── 11. isDemo: null → isDemo-not-true ──
  it('isDemo: null → isDemo-not-true', () => {
    const result = evaluateEngineAccountEligibility({ ...VALID_DEMO, isDemo: null });
    expect(result).toEqual({ eligible: false, reason: 'isDemo-not-true' });
  });

  // ── 12. credential apiKey: 'real-key' → credential-apiKey-not-null ──
  it('credential apiKey: "real-key" → credential-apiKey-not-null', () => {
    const result = evaluateEngineAccountEligibility({ ...VALID_DEMO, apiKey: 'real-key' });
    expect(result).toEqual({ eligible: false, reason: 'credential-apiKey-not-null' });
  });

  // ── 13. credential apiSecret: 'secret' → credential-apiSecret-not-null ──
  it('credential apiSecret: "secret" → credential-apiSecret-not-null', () => {
    const result = evaluateEngineAccountEligibility({ ...VALID_DEMO, apiSecret: 'secret' });
    expect(result).toEqual({ eligible: false, reason: 'credential-apiSecret-not-null' });
  });

  // ── 14. credential passphrase: 'pass' → credential-passphrase-not-null ──
  it('credential passphrase: "pass" → credential-passphrase-not-null', () => {
    const result = evaluateEngineAccountEligibility({ ...VALID_DEMO, passphrase: 'pass' });
    expect(result).toEqual({ eligible: false, reason: 'credential-passphrase-not-null' });
  });

  // ── 15. apiKey: undefined → credential-apiKey-not-null ──
  it('apiKey: undefined → credential-apiKey-not-null', () => {
    const result = evaluateEngineAccountEligibility({ ...VALID_DEMO, apiKey: undefined });
    expect(result).toEqual({ eligible: false, reason: 'credential-apiKey-not-null' });
  });

  // ── 16. apiSecret: undefined → credential-apiSecret-not-null ──
  it('apiSecret: undefined → credential-apiSecret-not-null', () => {
    const result = evaluateEngineAccountEligibility({ ...VALID_DEMO, apiSecret: undefined });
    expect(result).toEqual({ eligible: false, reason: 'credential-apiSecret-not-null' });
  });

  // ── 17. passphrase: undefined → credential-passphrase-not-null ──
  it('passphrase: undefined → credential-passphrase-not-null', () => {
    const result = evaluateEngineAccountEligibility({ ...VALID_DEMO, passphrase: undefined });
    expect(result).toEqual({ eligible: false, reason: 'credential-passphrase-not-null' });
  });

  // ── 18. apiKey: '' → credential-apiKey-not-null (R7 fix: empty string REJECTED) ──
  it('apiKey: empty string → credential-apiKey-not-null (R7 fix)', () => {
    const result = evaluateEngineAccountEligibility({ ...VALID_DEMO, apiKey: '' });
    expect(result).toEqual({ eligible: false, reason: 'credential-apiKey-not-null' });
  });

  // ── 19. apiSecret: ' ' → credential-apiSecret-not-null (R7 fix: whitespace REJECTED) ──
  it('apiSecret: single space → credential-apiSecret-not-null (R7 fix)', () => {
    const result = evaluateEngineAccountEligibility({ ...VALID_DEMO, apiSecret: ' ' });
    expect(result).toEqual({ eligible: false, reason: 'credential-apiSecret-not-null' });
  });

  // ── 20. apiKey: '   ' → credential-apiKey-not-null (R7 fix: whitespace REJECTED) ──
  it('apiKey: multiple spaces → credential-apiKey-not-null (R7 fix)', () => {
    const result = evaluateEngineAccountEligibility({ ...VALID_DEMO, apiKey: '   ' });
    expect(result).toEqual({ eligible: false, reason: 'credential-apiKey-not-null' });
  });

  // ── 21. apiKey: false → credential-apiKey-not-null ──
  it('apiKey: false → credential-apiKey-not-null', () => {
    const result = evaluateEngineAccountEligibility({ ...VALID_DEMO, apiKey: false as any });
    expect(result).toEqual({ eligible: false, reason: 'credential-apiKey-not-null' });
  });

  // ── 22. apiSecret: 0 → credential-apiSecret-not-null ──
  it('apiSecret: 0 → credential-apiSecret-not-null', () => {
    const result = evaluateEngineAccountEligibility({ ...VALID_DEMO, apiSecret: 0 as any });
    expect(result).toEqual({ eligible: false, reason: 'credential-apiSecret-not-null' });
  });

  // ── 23. missing apiKey property → credential-apiKey-not-null (R7 fix: missing REJECTED) ──
  it('missing apiKey property → credential-apiKey-not-null (R7 fix)', () => {
    const { apiKey, ...rest } = VALID_DEMO;
    const result = evaluateEngineAccountEligibility(rest as any);
    expect(result).toEqual({ eligible: false, reason: 'credential-apiKey-not-null' });
  });

  // ── 24. missing apiSecret property → credential-apiSecret-not-null ──
  it('missing apiSecret property → credential-apiSecret-not-null', () => {
    const { apiSecret, ...rest } = VALID_DEMO;
    const result = evaluateEngineAccountEligibility(rest as any);
    expect(result).toEqual({ eligible: false, reason: 'credential-apiSecret-not-null' });
  });

  // ── 25. missing passphrase property → credential-passphrase-not-null ──
  it('missing passphrase property → credential-passphrase-not-null', () => {
    const { passphrase, ...rest } = VALID_DEMO;
    const result = evaluateEngineAccountEligibility(rest as any);
    expect(result).toEqual({ eligible: false, reason: 'credential-passphrase-not-null' });
  });
});
