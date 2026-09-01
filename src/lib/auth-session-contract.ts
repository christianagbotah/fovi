// Phase 3F refresh-session contract marker.
//
// This module intentionally contains no secrets or runtime state. It provides
// a stable version string for diagnostics/tests while the implementation lives
// in auth-sessions.ts.
export const AUTH_SESSION_CONTRACT_VERSION = 'phase3f-revocable-refresh-v1' as const;
