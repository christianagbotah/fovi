const fs = require('fs');
const path = require('path');

// Load .env from project root
const envPath = path.resolve(__dirname, '.env');
const envVars = { NODE_ENV: 'production' };

if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)/);
    if (m && m[2] !== '') {
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      envVars[m[1]] = val;
    }
  });
  console.log(`[ecosystem] Loaded ${Object.keys(envVars).length} env vars from .env`);
} else {
  console.warn('[ecosystem] WARNING: .env file not found at', envPath);
}

module.exports = {
  apps: [
    // Next.js 16 — port 3002
    {
      name: 'fovi-next',
      script: 'node_modules/.bin/next',
      args: 'start --port 3002',
      cwd: '/home/lightworld/webapps/fovi',
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '1G',
      env: envVars,
    },
    // Market Data WebSocket — port 3003
    {
      name: 'fovi-market',
      script: 'index.ts',
      cwd: '/home/lightworld/webapps/fovi/mini-services/market-service',
      exec_mode: 'fork',
      interpreter: '/root/.bun/bin/bun',
      autorestart: true,
      max_memory_restart: '256M',
      env: { ...envVars, PORT: '3003' },
    },
    // Auto-Trade Engine — port 3012
    {
      name: 'fovi-auto-trade',
      script: 'index.ts',
      cwd: '/home/lightworld/webapps/fovi/mini-services/auto-trade-engine',
      exec_mode: 'fork',
      interpreter: '/root/.bun/bin/bun',
      autorestart: true,
      max_memory_restart: '256M',
      env: { ...envVars, PORT: '3012' },
    },
    // Balance Sync — port 3013
    {
      name: 'fovi-balance-sync',
      script: 'index.ts',
      cwd: '/home/lightworld/webapps/fovi/mini-services/balance-sync',
      exec_mode: 'fork',
      interpreter: '/root/.bun/bin/bun',
      autorestart: true,
      max_memory_restart: '256M',
      env: { ...envVars, PORT: '3013' },
    },
  ],
};
