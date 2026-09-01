import { readFileSync, writeFileSync } from 'node:fs';

function replaceExact(path, before, after, label) {
  const source = readFileSync(path, 'utf8');
  if (!source.includes(before)) {
    throw new Error(`Phase 3I codemod assertion failed: ${label}`);
  }
  const next = source.replace(before, after);
  if (next === source) throw new Error(`Phase 3I codemod made no change: ${label}`);
  writeFileSync(path, next);
}

replaceExact(
  'src/lib/store/trading-store.ts',
  `  setAuth: (user, token) => {\n    set({ authUser: user, authToken: token, isAuthenticated: true });\n    localStorage.setItem('fovi_token', token);\n    localStorage.setItem('fovi_user', JSON.stringify(user));\n  },`,
  `  setAuth: (user, token) => {\n    // Phase 3I: access JWTs are memory-only. Persistent browser session\n    // continuity is provided exclusively by the HttpOnly refresh cookie.\n    set({ authUser: user, authToken: token, isAuthenticated: true });\n  },`,
  'remove access-token persistence from Zustand setAuth',
);

replaceExact(
  'src/app/page.tsx',
  `import { authFetch, hydrateBrowserAuthFromStorage } from '@/lib/api-fetch';`,
  `import { bootstrapBrowserAuth } from '@/lib/api-fetch';`,
  'replace dashboard auth-boundary import',
);

replaceExact(
  'src/app/page.tsx',
  `  // Hydrate alerts, accounts & auth from localStorage on first mount\n  // Validates JWT token with the server to ensure session is still valid\n  useEffect(() => {\n    hydrateAlertsFromStorage();\n    // Restore browser auth through the central boundary, then validate it server-side.\n    // authFetch can rotate the HttpOnly refresh session once if the access token is stale.\n    const restoredAuth = hydrateBrowserAuthFromStorage();\n    if (restoredAuth) {\n      void (async () => {\n        try {\n          const res = await authFetch('/api/auth/me');\n          if (res.ok) {\n            const data = await res.json();\n            if (data.success && data.user) {\n              const currentToken = useTradingStore.getState().authToken;\n              if (currentToken) {\n                useTradingStore.getState().setAuth(data.user, currentToken);\n              }\n            }\n          }\n        } catch {\n          // Keep the hydrated identity during a transient network failure.\n        }\n      })();\n    }`,
  `  // Hydrate non-auth browser state on first mount. Authentication itself is\n  // bootstrapped from the revocable HttpOnly refresh session into memory only.\n  useEffect(() => {\n    hydrateAlertsFromStorage();\n    void bootstrapBrowserAuth();`,
  'replace localStorage auth hydration with refresh-session bootstrap',
);

const store = readFileSync('src/lib/store/trading-store.ts', 'utf8');
if (/localStorage\.setItem\(\s*['"]fovi_token['"]/.test(store)) {
  throw new Error('Persistent fovi_token write remains in trading store');
}

const page = readFileSync('src/app/page.tsx', 'utf8');
if (page.includes('hydrateBrowserAuthFromStorage')) {
  throw new Error('Legacy browser-auth hydration remains in dashboard');
}
if (!page.includes('bootstrapBrowserAuth()')) {
  throw new Error('Dashboard does not bootstrap from refresh session');
}

console.log('Phase 3I memory-only access-token migration applied.');
