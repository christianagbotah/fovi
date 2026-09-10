// ============================================================
// oauth-pkce.ts — Secure OAuth 2.0 flows with PKCE (Proof Key
// for Code Exchange) for broker connections
//
// SECURITY CONTRACT:
//   - PKCE (RFC 7636) prevents authorization code interception
//   - S256 code_challenge_method (SHA-256) — plain NOT supported
//   - State parameter with CSRF protection
//   - All tokens encrypted via CredentialVault before storage
//   - Least-privilege scopes: only minimum required scopes requested
//   - PKCE state stored with TTL, auto-cleanup of expired states
//   - Phase 1: OAuth flows are blocked for non-demo providers
//     (enforcePhase1CredentialIntake in CredentialVault handles this
//     when tokens are stored)
// ============================================================

import { createHash, randomBytes } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { getCredentialVault, type BrokerCredentials } from './credential-vault';
import { logSecurityEvent } from '@/lib/trading-policy';

// ── PKCE types ──

/**
 * PKCE challenge pair: code_verifier and code_challenge.
 * The verifier stays client-side; the challenge is sent to the
 * authorization server. S256 transformation (SHA-256 + base64url).
 */
export interface PKCEChallengePair {
  /** Random high-entropy string (43-128 chars, base64url-encoded) */
  codeVerifier: string;
  /** SHA-256 hash of code_verifier, base64url-encoded */
  codeChallenge: string;
  /** Always "S256" — plain method is NOT supported */
  codeChallengeMethod: 'S256';
}

/**
 * OAuth provider configuration.
 * Defines the endpoints and scope requirements for a provider.
 */
export interface OAuthProviderConfig {
  /** Provider identifier (e.g., "alpaca", "coinbase") */
  providerId: string;
  /** Authorization endpoint URL */
  authorizationEndpoint: string;
  /** Token exchange endpoint URL */
  tokenEndpoint: string;
  /** Minimum required scopes (least privilege) */
  scopes: string[];
  /** Optional: additional scopes that MAY be requested */
  optionalScopes?: string[];
  /** Client ID (NOT a secret for OAuth public clients with PKCE) */
  clientId: string;
  /** Redirect URI registered with the provider */
  redirectUri: string;
}

/**
 * Stored PKCE state for an in-progress OAuth flow.
 * Expires after stateTtlMs to prevent stale states from
 * being accepted.
 */
export interface PKCEStateRecord {
  /** Unique state parameter (also serves as CSRF token) */
  state: string;
  /** The code_verifier for this flow */
  codeVerifier: string;
  /** Provider configuration reference */
  providerId: string;
  /** Tenant ID for isolation */
  tenantId: string;
  /** Connection ID this flow is for */
  connectionId: string;
  /** ISO-8601 timestamp when this state was created */
  createdAt: string;
  /** TTL in milliseconds */
  ttlMs: number;
}

/**
 * Result of building an authorization URL.
 */
export interface AuthorizationUrlResult {
  /** The full authorization URL to redirect the user to */
  url: string;
  /** The state parameter (for CSRF validation on callback) */
  state: string;
}

/**
 * Result of exchanging an authorization code for tokens.
 */
export interface TokenExchangeResult {
  success: boolean;
  accessToken?: string;
  refreshToken?: string;
  expiresInSeconds?: number;
  error?: string;
}

/**
 * Result of refreshing an access token.
 */
export interface TokenRefreshResult {
  success: boolean;
  accessToken?: string;
  refreshToken?: string;
  expiresInSeconds?: number;
  error?: string;
}

// ── Constants ──

/** PKCE code_verifier length in bytes (before base64url encoding) */
const CODE_VERIFIER_BYTES = 32;

/** Default TTL for PKCE state records (10 minutes) */
const DEFAULT_STATE_TTL_MS = 10 * 60 * 1000;

/** Cleanup interval for expired PKCE states (1 minute) */
const CLEANUP_INTERVAL_MS = 60 * 1000;

// ── Base64url encoding (RFC 7636 Section Appendix B) ──

/**
 * Base64url-encode a buffer without padding.
 * Per RFC 7636: base64url encoding uses URL-safe characters
 * (no '+' or '/') and omits trailing '=' padding.
 */
function base64urlEncode(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ── OAuthPKCE class ──

/**
 * OAuthPKCE manages OAuth 2.0 Authorization Code flows with PKCE
 * for broker connections.
 *
 * SECURITY FEATURES:
 *   1. PKCE S256 challenge (SHA-256) — prevents code interception
 *   2. State parameter with CSRF protection
 *   3. PKCE state stored with TTL — auto-cleanup of expired states
 *   4. All tokens encrypted via CredentialVault before storage
 *   5. Least-privilege scope requests
 *
 * FLOW:
 *   1. generatePKCEChallenge() → code_verifier + code_challenge
 *   2. buildAuthorizationUrl() → redirect user to auth server
 *   3. On callback: validateStateParameter() → CSRF check
 *   4. exchangeCodeForToken() → swap code for tokens
 *   5. Tokens encrypted and stored via CredentialVault
 */
export class OAuthPKCE {
  private readonly states = new Map<string, PKCEStateRecord>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly stateTtlMs: number = DEFAULT_STATE_TTL_MS,
  ) {
    // Start auto-cleanup of expired states
    this.startCleanup();
  }

  /**
   * Generate a PKCE code_verifier and code_challenge pair.
   *
   * code_verifier: 32 random bytes, base64url-encoded (43 chars)
   * code_challenge: SHA-256(code_verifier), base64url-encoded
   * code_challenge_method: "S256" (plain NOT supported)
   *
   * Per RFC 7636 Section 4:
   *   - code_verifier must be 43-128 characters
   *   - code_challenge = BASE64URL(SHA256(ASCII(code_verifier)))
   */
  generatePKCEChallenge(): PKCEChallengePair {
    const verifierBytes = randomBytes(CODE_VERIFIER_BYTES);
    const codeVerifier = base64urlEncode(verifierBytes);

    // S256 transformation: SHA-256 hash of the verifier
    const challengeBytes = createHash('sha256')
      .update(codeVerifier, 'ascii')
      .digest();
    const codeChallenge = base64urlEncode(challengeBytes);

    return {
      codeVerifier,
      codeChallenge,
      codeChallengeMethod: 'S256',
    };
  }

  /**
   * Build the full authorization URL for an OAuth flow.
   *
   * Includes:
   *   - response_type=code (Authorization Code flow)
   *   - client_id from provider config
   *   - redirect_uri from provider config
   *   - scope with minimum required scopes only (least privilege)
   *   - state parameter for CSRF protection
   *   - code_challenge + code_challenge_method=S256 for PKCE
   *
   * The PKCE state is stored internally with a TTL for later
   * validation during the callback.
   */
  buildAuthorizationUrl(
    providerConfig: OAuthProviderConfig,
    state: string,
    codeChallenge: string,
    codeVerifier: string,
    tenantId: string,
    connectionId: string,
  ): AuthorizationUrlResult {
    const correlationId = uuidv4();

    // Store PKCE state for later validation
    const stateRecord: PKCEStateRecord = {
      state,
      codeVerifier,
      providerId: providerConfig.providerId,
      tenantId,
      connectionId,
      createdAt: new Date().toISOString(),
      ttlMs: this.stateTtlMs,
    };
    this.states.set(state, stateRecord);

    // Build URL with least-privilege scopes
    const scope = providerConfig.scopes.join(' ');
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: providerConfig.clientId,
      redirect_uri: providerConfig.redirectUri,
      scope,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    const url = `${providerConfig.authorizationEndpoint}?${params.toString()}`;

    logSecurityEvent({
      eventType: 'OAUTH_AUTH_URL_BUILT',
      correlationId,
      reason: `Authorization URL built for provider=${providerConfig.providerId} tenant=${tenantId} connection=${connectionId}`,
    });

    return { url, state };
  }

  /**
   * Validate the state parameter from an OAuth callback.
   *
   * CSRF PROTECTION:
   *   - The state parameter must match a stored PKCE state record
   *   - The stored record must not be expired
   *   - The state is consumed (deleted) after validation to prevent
   *     replay attacks
   *
   * Returns the PKCE state record if valid, null otherwise.
   */
  validateStateParameter(
    state: string,
    tenantId: string,
  ): PKCEStateRecord | null {
    const correlationId = uuidv4();
    const record = this.states.get(state);

    if (!record) {
      logSecurityEvent({
        eventType: 'OAUTH_STATE_INVALID',
        correlationId,
        reason: `State parameter not found: possible CSRF attack or expired state`,
      });
      return null;
    }

    // Check TTL
    const createdAt = new Date(record.createdAt).getTime();
    const now = Date.now();
    if (now - createdAt > record.ttlMs) {
      this.states.delete(state);
      logSecurityEvent({
        eventType: 'OAUTH_STATE_EXPIRED',
        correlationId,
        reason: `State parameter expired for provider=${record.providerId} tenant=${record.tenantId}`,
      });
      return null;
    }

    // Check tenant isolation
    if (record.tenantId !== tenantId) {
      logSecurityEvent({
        eventType: 'OAUTH_STATE_TENANT_MISMATCH',
        correlationId,
        reason: `State parameter tenant mismatch: stored=${record.tenantId} requested=${tenantId}`,
      });
      return null;
    }

    // Consume the state (prevent replay)
    this.states.delete(state);

    logSecurityEvent({
      eventType: 'OAUTH_STATE_VALIDATED',
      correlationId,
      reason: `State validated for provider=${record.providerId} tenant=${tenantId} connection=${record.connectionId}`,
    });

    return record;
  }

  /**
   * Exchange an authorization code for access and refresh tokens.
   *
   * This method:
   *   1. Validates the state parameter (CSRF protection)
   *   2. Sends the code + code_verifier to the token endpoint
   *   3. Encrypts and stores tokens via CredentialVault
   *
   * NOTE: The actual HTTP request to the token endpoint is
   * represented here as a placeholder. In production, this
   * would use fetch() to the provider's token endpoint.
   * Phase 1 containment is enforced by CredentialVault when
   * tokens are stored.
   *
   * @param code - Authorization code from the callback
   * @param codeVerifier - PKCE code_verifier for this flow
   * @param state - State parameter from the callback
   * @param providerConfig - OAuth provider configuration
   * @param tenantId - Tenant identifier
   * @param connectionId - Connection identifier
   */
  async exchangeCodeForToken(
    code: string,
    codeVerifier: string,
    state: string,
    providerConfig: OAuthProviderConfig,
    tenantId: string,
    connectionId: string,
    accountContext: {
      broker: string;
      accountType: string;
      isDemo?: boolean | null;
    },
  ): Promise<TokenExchangeResult> {
    const correlationId = uuidv4();

    // Validate state parameter
    const stateRecord = this.validateStateParameter(state, tenantId);
    if (!stateRecord) {
      logSecurityEvent({
        eventType: 'OAUTH_TOKEN_EXCHANGE_STATE_INVALID',
        correlationId,
        reason: `Token exchange rejected: invalid state for provider=${providerConfig.providerId}`,
      });
      return {
        success: false,
        error: 'Invalid or expired state parameter. Possible CSRF attack.',
      };
    }

    // Verify code_verifier matches
    if (stateRecord.codeVerifier !== codeVerifier) {
      logSecurityEvent({
        eventType: 'OAUTH_TOKEN_EXCHANGE_VERIFIER_MISMATCH',
        correlationId,
        reason: `Token exchange rejected: code_verifier mismatch for provider=${providerConfig.providerId}`,
      });
      return {
        success: false,
        error: 'Code verifier mismatch.',
      };
    }

    // Phase 1: Token exchange to external providers is blocked
    // In Phase 1, only demo providers are allowed.
    // The CredentialVault.storeCredentials() call below enforces
    // this via enforcePhase1CredentialIntake().

    logSecurityEvent({
      eventType: 'OAUTH_TOKEN_EXCHANGE_ATTEMPT',
      correlationId,
      reason: `Token exchange initiated for provider=${providerConfig.providerId} tenant=${tenantId} connection=${connectionId}`,
    });

    // In a real implementation, this would POST to the token endpoint:
    //   POST providerConfig.tokenEndpoint
    //   Body: grant_type=authorization_code, code, redirect_uri, client_id, code_verifier
    //
    // For Phase 1, we simulate the exchange result and store via vault.

    // Store tokens via CredentialVault (enforces Phase 1 containment)
    const vault = getCredentialVault();
    const credentials: BrokerCredentials = {
      token: code, // In production, this would be the actual access_token
      refreshToken: codeVerifier, // In production, the actual refresh_token
    };

    const storeResult = await vault.storeCredentials(
      connectionId,
      tenantId,
      credentials,
      accountContext,
    );

    if (!storeResult.success) {
      logSecurityEvent({
        eventType: 'OAUTH_TOKEN_STORAGE_BLOCKED',
        correlationId,
        reason: `Token storage blocked (Phase 1) for provider=${providerConfig.providerId} tenant=${tenantId}`,
      });
      return {
        success: false,
        error: storeResult.error ?? 'Token storage blocked by containment policy.',
      };
    }

    logSecurityEvent({
      eventType: 'OAUTH_TOKEN_EXCHANGE_SUCCESS',
      correlationId,
      reason: `Tokens exchanged and stored for provider=${providerConfig.providerId} tenant=${tenantId}`,
    });

    return {
      success: true,
      // Never return actual tokens — they're stored encrypted
      expiresInSeconds: 3600, // placeholder
    };
  }

  /**
   * Refresh an access token using a stored refresh token.
   *
   * 1. Retrieves the current refresh token from CredentialVault
   * 2. Sends it to the token endpoint
   * 3. Encrypts and stores the new token pair
   *
   * Phase 1: blocked for non-demo providers.
   */
  async refreshAccessToken(
    refreshToken: string,
    providerConfig: OAuthProviderConfig,
    tenantId: string,
    connectionId: string,
    accountContext: {
      broker: string;
      accountType: string;
      isDemo?: boolean | null;
    },
  ): Promise<TokenRefreshResult> {
    const correlationId = uuidv4();

    logSecurityEvent({
      eventType: 'OAUTH_TOKEN_REFRESH_ATTEMPT',
      correlationId,
      reason: `Token refresh initiated for provider=${providerConfig.providerId} tenant=${tenantId} connection=${connectionId}`,
    });

    // In a real implementation, this would POST to the token endpoint:
    //   POST providerConfig.tokenEndpoint
    //   Body: grant_type=refresh_token, refresh_token, client_id
    //
    // For Phase 1, we store the refreshed token via vault.

    const vault = getCredentialVault();
    const credentials: BrokerCredentials = {
      token: refreshToken, // In production, the new access_token
      refreshToken, // In production, the new refresh_token (if rotated)
    };

    const storeResult = await vault.storeCredentials(
      connectionId,
      tenantId,
      credentials,
      accountContext,
    );

    if (!storeResult.success) {
      logSecurityEvent({
        eventType: 'OAUTH_TOKEN_REFRESH_BLOCKED',
        correlationId,
        reason: `Token refresh storage blocked (Phase 1) for provider=${providerConfig.providerId}`,
      });
      return {
        success: false,
        error: storeResult.error ?? 'Token refresh blocked by containment policy.',
      };
    }

    logSecurityEvent({
      eventType: 'OAUTH_TOKEN_REFRESH_SUCCESS',
      correlationId,
      reason: `Token refreshed and stored for provider=${providerConfig.providerId} tenant=${tenantId}`,
    });

    return {
      success: true,
      expiresInSeconds: 3600, // placeholder
    };
  }

  /**
   * Get the minimum required scopes for a provider.
   * Least-privilege: only returns the scopes defined in
   * providerConfig.scopes, NOT the optional scopes.
   */
  getMinimumScopes(providerConfig: OAuthProviderConfig): string[] {
    return [...providerConfig.scopes];
  }

  /**
   * Get all available scopes for a provider (required + optional).
   * Callers should prefer getMinimumScopes() for least-privilege.
   */
  getAllScopes(providerConfig: OAuthProviderConfig): string[] {
    return [
      ...providerConfig.scopes,
      ...(providerConfig.optionalScopes ?? []),
    ];
  }

  /**
   * Check if a PKCE state record exists and is not expired.
   */
  hasValidState(state: string): boolean {
    const record = this.states.get(state);
    if (!record) return false;

    const createdAt = new Date(record.createdAt).getTime();
    const now = Date.now();
    if (now - createdAt > record.ttlMs) {
      return false;
    }

    return true;
  }

  // ── Lifecycle ──

  /**
   * Start the auto-cleanup timer for expired PKCE states.
   */
  private startCleanup(): void {
    if (this.cleanupTimer) return;

    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [state, record] of this.states.entries()) {
        const createdAt = new Date(record.createdAt).getTime();
        if (now - createdAt > record.ttlMs) {
          this.states.delete(state);
        }
      }
    }, CLEANUP_INTERVAL_MS);
  }

  /**
   * Stop the auto-cleanup timer.
   * Call this when shutting down to prevent timer leaks.
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.states.clear();
  }
}

// ── Singleton instance ──

let _instance: OAuthPKCE | null = null;

export function getOAuthPKCE(): OAuthPKCE {
  if (!_instance) {
    _instance = new OAuthPKCE();
  }
  return _instance;
}

/**
 * Reset the singleton (for testing only).
 */
export function resetOAuthPKCE(): void {
  if (_instance) {
    _instance.destroy();
  }
  _instance = null;
}
