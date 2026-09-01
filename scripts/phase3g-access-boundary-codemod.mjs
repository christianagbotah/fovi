import { readFileSync, writeFileSync } from 'node:fs';

const path = 'src/app/page.tsx';
let source = readFileSync(path, 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(`Phase 3G codemod assertion failed: ${message}`);
}

const oldImport = "import { useTradingStore, hydrateAlertsFromStorage } from '@/lib/store/trading-store';";
const newImport = `${oldImport}\nimport { authFetch, hydrateBrowserAuthFromStorage } from '@/lib/api-fetch';`;
assert(source.includes(oldImport), 'expected trading-store import was not found');
assert(!source.includes("from '@/lib/api-fetch'"), 'api-fetch import already exists; refusing an ambiguous rewrite');
source = source.replace(oldImport, newImport);

const securityStartMarker = 'function SecuritySettings() {';
const securityEndMarker = '// ============================================================\n// Settings Sheet';
const securityStart = source.indexOf(securityStartMarker);
const securityEnd = source.indexOf(securityEndMarker, securityStart);
assert(securityStart >= 0 && securityEnd > securityStart, 'SecuritySettings boundaries were not found');

let security = source.slice(securityStart, securityEnd);
const tokenDeclaration = "  const token = typeof window !== 'undefined' ? localStorage.getItem('fovi_token') || '' : '';\n";
assert(security.includes(tokenDeclaration), 'SecuritySettings token declaration was not found');
assert((security.match(/Authorization:\s*`Bearer \$\{token\}`/g) || []).length >= 10, 'expected manual Bearer calls were not found');

security = security.replace(tokenDeclaration, '');
security = security.replaceAll('fetch(', 'authFetch(');
security = security.replace(/,\s*Authorization:\s*`Bearer \$\{token\}`/g, '');
security = security.replace(/Authorization:\s*`Bearer \$\{token\}`\s*,?/g, '');

assert(!security.includes("localStorage.getItem('fovi_token')"), 'direct access-token storage read remains in SecuritySettings');
assert(!security.includes('Authorization:'), 'manual Authorization header remains in SecuritySettings');
assert(!security.includes('Bearer ${token}'), 'manual Bearer credential remains in SecuritySettings');
source = source.slice(0, securityStart) + security + source.slice(securityEnd);

const hydrationStartMarker = '    // Restore auth state from localStorage, but validate the token with the server';
const hydrationEndMarker = '    // If no accounts loaded yet, seed from localStorage';
const hydrationStart = source.indexOf(hydrationStartMarker);
const hydrationEnd = source.indexOf(hydrationEndMarker, hydrationStart);
assert(hydrationStart >= 0 && hydrationEnd > hydrationStart, 'dashboard auth-hydration boundaries were not found');

const hydrationReplacement = `    // Restore browser auth through the central boundary, then validate it server-side.\n    // authFetch can rotate the HttpOnly refresh session once if the access token is stale.\n    const restoredAuth = hydrateBrowserAuthFromStorage();\n    if (restoredAuth) {\n      void (async () => {\n        try {\n          const res = await authFetch('/api/auth/me');\n          if (res.ok) {\n            const data = await res.json();\n            if (data.success && data.user) {\n              const currentToken = useTradingStore.getState().authToken;\n              if (currentToken) {\n                useTradingStore.getState().setAuth(data.user, currentToken);\n              }\n            }\n          }\n        } catch {\n          // Keep the hydrated identity during a transient network failure.\n        }\n      })();\n    }\n`;
source = source.slice(0, hydrationStart) + hydrationReplacement + source.slice(hydrationEnd);

assert(!source.includes("localStorage.getItem('fovi_token')"), 'direct fovi_token read remains in page.tsx');
assert(!/Authorization:\s*`Bearer \$\{/.test(source), 'manual Bearer header remains in page.tsx');

writeFileSync(path, source);
console.log('Phase 3G page auth-boundary codemod applied successfully.');
