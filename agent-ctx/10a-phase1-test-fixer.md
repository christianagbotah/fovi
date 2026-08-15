---
Task ID: 10a
Agent: phase1-test-fixer
Task: Update existing tests to match new isExplicitlyDemo 3-condition mandate and auth-first behavior

Files Modified:
- `src/__tests__/containment/trading-policy.test.ts`
- `src/__tests__/containment/cross-tenant-isolation.test.ts`

Files Verified (no changes needed):
- `src/__tests__/containment/broker-spy-blocking.test.ts`
- `src/__tests__/containment/credential-intake.test.ts`
- `src/__tests__/containment/no-demo-identity.test.ts`
- `src/__tests__/containment/fabricated-success.test.ts`

Summary:
- trading-policy.test.ts: 4 edits — enforcePhase1CredentialIntake demo test now passes isDemo=true; isExplicitlyDemo test requires all 3 conditions; isLiveAccount test fixed for fail-closed behavior; null/undefined/absent isDemo tests replaced with fail-closed assertions.
- cross-tenant-isolation.test.ts: Replaced duplicate anonymous test with a real two-user isolation test that captures DB query WHERE clauses.
- All other files verified correct against new source behavior.
