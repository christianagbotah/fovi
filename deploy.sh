#!/usr/bin/env bash
# =============================================================================
# Fovi AI Trading Platform — VPS Deploy Script
# =============================================================================
# VPS target path: /home/lightworld/webapps/fovi
# Services:
#   - Next.js 16          (port 3002)
#   - market-service      (port 3003)
#   - auto-trade-engine   (port 3012)
#   - balance-sync        (port 3013)
# Runtime: Bun  |  PM2 for process management  |  Caddy as reverse proxy
# =============================================================================

set -euo pipefail

# ----------------------------- Configuration ---------------------------------

DEPLOY_PATH="/home/lightworld/webapps/fovi"
GIT_REPO="https://github.com/christianagbotah/fovi.git"
PM2_ECOSYSTEM="ecosystem.config.cjs"

# The git ref to deploy. Defaults to phase-1-emergency-containment.
# Override with: FOVI_DEPLOY_REF=main ./deploy.sh update
DEPLOY_REF="${FOVI_DEPLOY_REF:-phase-1-emergency-containment}"

# ----------------------------- Color helpers ----------------------------------

info()  { echo -e "\033[1;34m[INFO]\033[0m  $*"; }
ok()    { echo -e "\033[1;32m[OK]\033[0m    $*"; }
warn()  { echo -e "\033[1;33m[WARN]\033[0m  $*"; }
err()   { echo -e "\033[1;31m[ERROR]\033[0m $*"; exit 1; }

# ----------------------------- Prerequisites ----------------------------------

check_bun() {
  if ! command -v bun &>/dev/null; then
    err "Bun is not installed. Install it first: curl -fsSL https://bun.sh/install | bash"
  fi
  ok "Bun found: $(bun --version)"
}

check_pm2() {
  if ! command -v pm2 &>/dev/null; then
    info "Installing PM2 globally..."
    bun add -g pm2
  fi
  ok "PM2 found: $(pm2 --version)"
}

# ----------------------------- Env protection ---------------------------------

setup_env() {
  if [ -f "${DEPLOY_PATH}/.env" ]; then
    ok ".env already exists — preserving it (will NOT be overwritten)"
  else
    if [ -f "${DEPLOY_PATH}/.env.example" ]; then
      info "No .env found. Copying from .env.example — REVIEW AND FILL IN VALUES!"
      cp "${DEPLOY_PATH}/.env.example" "${DEPLOY_PATH}/.env"
      warn "Edit ${DEPLOY_PATH}/.env with your production values before continuing."
      exit 0
    else
      warn "No .env or .env.example found. Create ${DEPLOY_PATH}/.env manually."
      exit 0
    fi
  fi
}

# ----------------------------- Validate environment ----------------------------

validate_env() {
  info "Validating production environment..."
  cd "${DEPLOY_PATH}"

  local failures=0

  # DATABASE_URL
  if [ -z "${DATABASE_URL:-}" ]; then
    err "DATABASE_URL is not set in .env. Production deployment requires a PostgreSQL connection string."
  fi
  if [[ "${DATABASE_URL:-}" != postgresql://* && "${DATABASE_URL:-}" != postgres://* ]]; then
    err "DATABASE_URL must be a PostgreSQL connection string (postgresql://... or postgres://...)"
  fi

  # JWT_SECRET
  local jwt_len="${#JWT_SECRET:-0}"
  if [ -z "${JWT_SECRET:-}" ] || [ "$jwt_len" -lt 32 ]; then
    err "JWT_SECRET must be set and >= 32 characters (current: ${jwt_len}). Generate with: openssl rand -hex 32"
  fi

  # AUTH_PEPPER
  local pepper_len="${#AUTH_PEPPER:-0}"
  if [ -z "${AUTH_PEPPER:-}" ] || [ "$pepper_len" -lt 16 ]; then
    err "AUTH_PEPPER must be set and >= 16 characters (current: ${pepper_len}). Generate with: openssl rand -hex 32"
  fi

  # ENCRYPTION_KEY
  local enc_len="${#ENCRYPTION_KEY:-0}"
  if [ -z "${ENCRYPTION_KEY:-}" ] || [ "$enc_len" -lt 32 ]; then
    err "ENCRYPTION_KEY must be set and >= 32 characters (current: ${enc_len}). Generate with: openssl rand -base64 32"
  fi

  # INTERNAL_SERVICE_SECRET
  if [ -z "${INTERNAL_SERVICE_SECRET:-}" ]; then
    err "INTERNAL_SERVICE_SECRET must be set. Generate with: openssl rand -hex 32"
  fi

  # APP_URL / NEXT_PUBLIC_APP_URL — must be HTTPS
  for var in APP_URL NEXT_PUBLIC_APP_URL; do
    local val="${!var:-}"
    if [ -n "$val" ]; then
      case "$val" in
        https://*) ok "${var} is HTTPS: ${val}"
          ;;
        *)
          err "${var} must be a valid HTTPS URL in production (got: ${val})"
          ;;
      esac
    else
      warn "${var} is not set. Some features (email links, OAuth) may not work."
    fi
  done

  ok "Environment validation passed"
}

# ----------------------------- Install dependencies ---------------------------

install_deps() {
  info "Installing root dependencies..."
  cd "${DEPLOY_PATH}"
  bun install --frozen-lockfile
  ok "Root dependencies installed"

  for svc in mini-services/market-service mini-services/auto-trade-engine mini-services/balance-sync; do
    if [ -f "${DEPLOY_PATH}/${svc}/package.json" ]; then
      info "Installing dependencies for ${svc}..."
      cd "${DEPLOY_PATH}/${svc}"
      bun install --frozen-lockfile
      ok "${svc} dependencies installed"
    fi
  done
  cd "${DEPLOY_PATH}"
}

# ----------------------------- TypeScript gate ---------------------------------

typecheck_gate() {
  info "Running TypeScript type-check..."
  cd "${DEPLOY_PATH}"
  bunx tsc --noEmit --pretty false
  ok "Root TypeScript: zero errors"

  if [ -f "${DEPLOY_PATH}/mini-services/tsconfig.json" ]; then
    bunx tsc -p mini-services/tsconfig.json --pretty false
    ok "Mini-services TypeScript: zero errors"
  fi
}

# ----------------------------- Containment tests -------------------------------

run_containment_tests() {
  info "Running containment tests..."
  cd "${DEPLOY_PATH}"
  bun run test:containment
  ok "Containment tests passed"
}

# ----------------------------- Build application -------------------------------

build_app() {
  info "Generating Prisma client and building Next.js..."
  cd "${DEPLOY_PATH}"
  bunx prisma generate
  bun run build
  ok "Application built successfully"
}

# ----------------------------- Database migration ------------------------------

db_migrate() {
  info "Running database migrations..."
  cd "${DEPLOY_PATH}"

  if [ -d "${DEPLOY_PATH}/prisma/migrations" ]; then
    bunx prisma migrate deploy
    ok "Database migrations applied"
  else
    err "No prisma/migrations directory found. Deployment requires migrations. Stop."
  fi
}

# ----------------------------- Resolve deploy ref ------------------------------

resolve_deploy_sha() {
  cd "${DEPLOY_PATH}"
  info "Resolving deploy ref: ${DEPLOY_REF}"

  git fetch origin "${DEPLOY_REF}" || err "Failed to fetch ref '${DEPLOY_REF}' from origin. Check that the branch/tag exists."

  local sha
  sha=$(git rev-parse "origin/${DEPLOY_REF}") || err "Failed to resolve '${DEPLOY_REF}' to a commit SHA."

  ok "Deploy ref resolves to: ${sha}"
  DEPLOY_SHA="$sha"
}

# ----------------------------- Health checks ----------------------------------

health_check() {
  local max_retries=12
  local retry_delay=5
  local all_ok=true

  # Next.js
  info "Health check: Next.js (127.0.0.1:3002)..."
  local next_ok=false
  for i in $(seq 1 $max_retries); do
    if curl -sf http://127.0.0.1:3002 > /dev/null 2>&1; then
      ok "Next.js is responding on 127.0.0.1:3002"
      next_ok=true
      break
    fi
    sleep "$retry_delay"
  done
  if [ "$next_ok" = false ]; then
    warn "Next.js health check FAILED on 127.0.0.1:3002 after ${max_retries} retries"
    all_ok=false
  fi

  # market-service
  info "Health check: market-service (127.0.0.1:3003)..."
  local market_ok=false
  for i in $(seq 1 $max_retries); do
    if curl -sf http://127.0.0.1:3003/health > /dev/null 2>&1; then
      ok "market-service is responding on 127.0.0.1:3003"
      market_ok=true
      break
    fi
    sleep "$retry_delay"
  done
  if [ "$market_ok" = false ]; then
    warn "market-service health check FAILED on 127.0.0.1:3003 after ${max_retries} retries"
    all_ok=false
  fi

  # auto-trade-engine
  info "Health check: auto-trade-engine (127.0.0.1:3012)..."
  local trade_ok=false
  for i in $(seq 1 $max_retries); do
    local health_resp
    health_resp=$(curl -sf http://127.0.0.1:3012/health 2>/dev/null || true)
    if echo "$health_resp" | grep -q '"status":"ok"'; then
      ok "auto-trade-engine is responding on 127.0.0.1:3012"
      # Verify containment: automated trading must remain disabled
      if echo "$health_resp" | grep -q '"automatedTradingEnabled":false'; then
        ok "auto-trade-engine containment verified: automatedTradingEnabled=false"
      else
        warn "auto-trade-engine: automatedTradingEnabled is not false — verify containment"
      fi
      trade_ok=true
      break
    fi
    sleep "$retry_delay"
  done
  if [ "$trade_ok" = false ]; then
    warn "auto-trade-engine health check FAILED on 127.0.0.1:3012 after ${max_retries} retries"
    all_ok=false
  fi

  # balance-sync
  info "Health check: balance-sync (127.0.0.1:3013)..."
  local balance_ok=false
  for i in $(seq 1 $max_retries); do
    local bhealth_resp
    bhealth_resp=$(curl -sf http://127.0.0.1:3013/health 2>/dev/null || true)
    if echo "$bhealth_resp" | grep -q '"status":"ok"'; then
      ok "balance-sync is responding on 127.0.0.1:3013"
      # Verify containment: balance sync must remain disabled
      if echo "$bhealth_resp" | grep -q '"balanceSyncEnabled":false'; then
        ok "balance-sync containment verified: balanceSyncEnabled=false"
      else
        warn "balance-sync: balanceSyncEnabled is not false — verify containment"
      fi
      balance_ok=true
      break
    fi
    sleep "$retry_delay"
  done
  if [ "$balance_ok" = false ]; then
    warn "balance-sync health check FAILED on 127.0.0.1:3013 after ${max_retries} retries"
    all_ok=false
  fi

  if [ "$all_ok" = false ]; then
    warn "Some health checks failed. Check service logs above."
  fi
}

# ----------------------------- First-time deploy ------------------------------

first_deploy() {
  info "========== FIRST-TIME DEPLOY =========="

  # Clone repo at the correct ref
  if [ -d "${DEPLOY_PATH}" ]; then
    err "Directory ${DEPLOY_PATH} already exists. Use 'update' to redeploy."
  fi

  info "Cloning repository to ${DEPLOY_PATH} (ref: ${DEPLOY_REF})..."
  mkdir -p "$(dirname "${DEPLOY_PATH}")"
  git clone --branch "${DEPLOY_REF}" --single-branch "${GIT_REPO}" "${DEPLOY_PATH}"
  cd "${DEPLOY_PATH}"
  DEPLOY_SHA=$(git rev-parse HEAD)
  ok "Repository cloned at ref ${DEPLOY_REF} (${DEPLOY_SHA})"

  # Setup .env (never overwrites)
  setup_env

  # Source .env for validation (without printing values)
  set -a
  source "${DEPLOY_PATH}/.env"
  set +a

  # Validate production environment
  validate_env

  # Install dependencies with frozen lockfiles
  install_deps

  # Generate Prisma client
  cd "${DEPLOY_PATH}"
  bunx prisma generate
  ok "Prisma client generated"

  # TypeScript gate
  typecheck_gate

  # Containment tests
  run_containment_tests

  # Production build
  build_app

  # Database migrations (never db push)
  db_migrate

  # Create PM2 ecosystem
  create_ecosystem

  # Start all services with PM2
  info "Starting all services via PM2..."
  cd "${DEPLOY_PATH}"
  pm2 start "${PM2_ECOSYSTEM}"
  pm2 save
  ok "All services started"

  # Health checks
  health_check

  info "========== DEPLOY COMPLETE =========="
  info "Deployed ref: ${DEPLOY_REF} (${DEPLOY_SHA})"
  pm2 list
}

# ----------------------------- Update deploy ----------------------------------

update_deploy() {
  info "========== UPDATE DEPLOY =========="

  if [ ! -d "${DEPLOY_PATH}" ]; then
    err "Directory ${DEPLOY_PATH} does not exist. Run first-time deploy (no arguments or 'init')."
  fi

  cd "${DEPLOY_PATH}"

  # Verify clean source state — do not deploy dirty trees
  if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    err "Source tree is dirty (has uncommitted changes). Resolve before deploying.\n$(git status --short)"
  fi

  # Resolve the exact authorized git ref/SHA
  resolve_deploy_sha

  # Update to the exact resolved ref
  info "Checking out ${DEPLOY_REF} at ${DEPLOY_SHA}..."
  git fetch origin "${DEPLOY_REF}"
  git checkout "${DEPLOY_SHA}"

  local current_sha
  current_sha=$(git rev-parse HEAD)
  if [ "$current_sha" != "$DEPLOY_SHA" ]; then
    err "Failed to checkout ${DEPLOY_SHA} (currently at ${current_sha})"
  fi
  ok "Source tree is at ${DEPLOY_SHA}"

  # Verify still clean after checkout
  if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    err "Source tree became dirty after checkout. Resolve before deploying."
  fi

  # .env must remain outside Git tracking and must never be overwritten
  if [ ! -f "${DEPLOY_PATH}/.env" ]; then
    err ".env file is missing at ${DEPLOY_PATH}/.env. Restore it before deploying."
  fi
  ok ".env preserved (not overwritten)"

  # Source .env for validation (without printing values)
  set -a
  source "${DEPLOY_PATH}/.env"
  set +a

  # Validate production environment
  validate_env

  # Install dependencies with frozen lockfiles
  install_deps

  # Generate Prisma client
  cd "${DEPLOY_PATH}"
  bunx prisma generate
  ok "Prisma client generated"

  # TypeScript gate
  typecheck_gate

  # Containment tests
  run_containment_tests

  # Production build
  build_app

  # Database migrations (never db push)
  db_migrate

  # Recreate ecosystem (in case app list changed)
  create_ecosystem

  # Restart all PM2 processes
  info "Restarting all PM2 processes..."
  cd "${DEPLOY_PATH}"
  pm2 restart ecosystem.config.cjs
  pm2 save
  ok "All services restarted"

  # Health checks
  health_check

  info "========== UPDATE COMPLETE =========="
  info "Deployed ref: ${DEPLOY_REF} (${DEPLOY_SHA})"
  pm2 list
}

# ----------------------------- PM2 Ecosystem ---------------------------------

create_ecosystem() {
  info "Creating PM2 ecosystem file at ${DEPLOY_PATH}/${PM2_ECOSYSTEM}"
  cat > "${DEPLOY_PATH}/${PM2_ECOSYSTEM}" <<ECOSYSTEM
const fs = require('fs');
const path = require('path');

// Load .env from project root WITHOUT printing values.
const envPath = path.resolve(__dirname, '.env');
const envVars = { NODE_ENV: 'production' };

if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  let count = 0;
  for (const line of content.split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)/);
    if (m && m[2] !== '') {
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      envVars[m[1]] = val;
      count++;
    }
  }
  console.log('[ecosystem] Loaded ' + count + ' env vars from .env (values not printed)');
} else {
  console.warn('[ecosystem] WARNING: .env file not found at', envPath);
}

module.exports = {
  apps: [
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
    {
      name: 'fovi-market',
      script: 'index.ts',
      cwd: '/home/lightworld/webapps/fovi/mini-services/market-service',
      exec_mode: 'fork',
      interpreter: 'bun',
      autorestart: true,
      max_memory_restart: '256M',
      env: { ...envVars, PORT: '3003' },
    },
    {
      name: 'fovi-auto-trade',
      script: 'index.ts',
      cwd: '/home/lightworld/webapps/fovi/mini-services/auto-trade-engine',
      exec_mode: 'fork',
      interpreter: 'bun',
      autorestart: true,
      max_memory_restart: '256M',
      env: { ...envVars, PORT: '3012' },
    },
    {
      name: 'fovi-balance-sync',
      script: 'index.ts',
      cwd: '/home/lightworld/webapps/fovi/mini-services/balance-sync',
      exec_mode: 'fork',
      interpreter: 'bun',
      autorestart: true,
      max_memory_restart: '256M',
      env: { ...envVars, PORT: '3013' },
    },
  ],
};
ECOSYSTEM
  ok "Ecosystem file created"
}

# ----------------------------- Usage ------------------------------------------

usage() {
  cat <<EOF
Usage: $(basename "$0") [command]

Commands:
  (none)|init    First-time deploy: clone, setup .env, validate, install, build, migrate, PM2 start, health check
  update         Update deploy: resolve ref, validate, install, build, migrate, PM2 restart, health check

VPS path:  ${DEPLOY_PATH}
Git repo: ${GIT_REPO}
Deploy ref: ${DEPLOY_REF} (override with FOVI_DEPLOY_REF)

Services:
  fovi-next           :3002  (Next.js 16)
  fovi-market-service  :3003  (WebSocket market data, loopback-only)
  fovi-auto-trade      :3012  (Auto-trade engine, loopback-only)
  fovi-balance-sync    :3013  (Balance sync, loopback-only)

Deployment order:
  1. Resolve exact authorized git ref/SHA
  2. Verify clean source state
  3. Preserve existing .env
  4. Validate production environment
  5. Install dependencies with frozen lockfiles
  6. Prisma generate
  7. TypeScript gate
  8. Containment tests
  9. Production build
  10. Prisma migrate deploy
  11. Restart services
  12. Health checks
  13. Report deployed SHA

IMPORTANT:
  - The .env file is NEVER overwritten by this script.
  - Prisma migrate deploy is used exclusively (no db-push fallback).
  - Dirty source trees are rejected.
  - The configured deploy ref is used (default: phase-1-emergency-containment).
  - main is NOT used as a deploy target.
EOF
  exit 0
}

# ----------------------------- Main -------------------------------------------

check_bun
check_pm2

# Export DEPLOY_SHA so it's available in sub-functions
DEPLOY_SHA=""

# Load .env if it exists (for env validation in update flow)
if [ -f "${DEPLOY_PATH}/.env" ]; then
  set -a
  source "${DEPLOY_PATH}/.env"
  set +a
fi

case "${1:-init}" in
  init|deploy|"" ) first_deploy ;;
  update|upgrade  ) update_deploy ;;
  -h|--help|help  ) usage ;;
  *               ) err "Unknown command '${1}'. Run with --help for usage." ;;
esac
