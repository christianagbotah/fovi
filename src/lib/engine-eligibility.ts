// ============================================================
// engine-eligibility.ts — SINGLE SOURCE OF TRUTH for engine
// account eligibility. CR4.3A R7.
//
// Eligibility requires ALL of these to be exactly true:
//   broker === 'demo'
//   accountType === 'demo'
//   isDemo === true (strict, no coercion)
//   isActive === true (strict, no coercion)
//   apiKey === null    (EXACTLY null — not undefined, missing, '', ' ')
//   apiSecret === null   (EXACTLY null)
//   passphrase === null  (EXACTLY null)
//
// Fail closed for: undefined credential, missing credential property,
// empty credential, whitespace credential, isActive false/null/
// undefined/missing, wrong broker, wrong accountType, isDemo false/null.
// ============================================================

export interface EngineAccountDescriptor {
  broker: string;
  accountType: string;
  isDemo: boolean | null | undefined;
  isActive: boolean | null | undefined;
  apiKey: string | null | undefined;
  apiSecret: string | null | undefined;
  passphrase: string | null | undefined;
}

export interface EligibilityResult {
  eligible: boolean;
  reason?: string;
}

/**
 * Evaluate whether a trading account is eligible for engine processing.
 *
 * This is the canonical eligibility check — all engine code MUST
 * delegate to this function. Returns { eligible: false, reason } for
 * any condition that doesn't strictly match the demo invariant.
 *
 * CRITICAL: This function must be the FIRST check in processBotCore.
 * ZERO side effects may occur before this check passes.
 *
 * CR4.3A R7 Blocker A: Credentials must be EXACTLY null.
 * Only null is accepted for apiKey, apiSecret, passphrase.
 * undefined, missing property, '', ' ', false, 0, [], {}, any populated string → REJECT.
 */
export function evaluateEngineAccountEligibility(
  account: EngineAccountDescriptor | null,
): EligibilityResult {
  // Null/undefined account → fail closed
  if (account === null || account === undefined) {
    return { eligible: false, reason: 'no-account' };
  }

  // Check isActive: must be EXACTLY true
  if (account.isActive !== true) {
    return { eligible: false, reason: 'inactive-account' };
  }

  // Check broker must be exactly 'demo'
  if (account.broker !== 'demo') {
    return { eligible: false, reason: 'wrong-broker' };
  }

  // Check accountType must be exactly 'demo'
  if (account.accountType !== 'demo') {
    return { eligible: false, reason: 'wrong-accountType' };
  }

  // Check isDemo must be exactly true (no coercion)
  if (account.isDemo !== true) {
    return { eligible: false, reason: 'isDemo-not-true' };
  }

  // Check credentials: must be EXACTLY null for each field.
  // CR4.3A R7 Blocker A: Only null is accepted.
  // undefined, missing property, '', ' ', false, 0, [], {}, any populated string → REJECT.
  const credentialFields = ['apiKey', 'apiSecret', 'passphrase'] as const;
  for (const field of credentialFields) {
    const value = account[field];
    if (value !== null) {
      return { eligible: false, reason: `credential-${field}-not-null` };
    }
  }

  // ALL conditions pass
  return { eligible: true };
}
