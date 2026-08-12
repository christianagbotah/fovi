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

set -e

# ----------------------------- Configuration ---------------------------------

DEPLOY_PATH="/home/lightworld/webapps/fovi"
GIT_REPO="https://github.com/nii-kofi/fovi.git"  # TODO: update to your repo URL
PM2_ECOSYSTEM="ecosystem.config.cjs"

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

# ----------------------------- PM2 Ecosystem ---------------------------------

create_ecosystem() {
  info "Creating PM2 ecosystem file at ${DEPLOY_PATH}/${PM2_ECOSYSTEM}"
  cat > "${DEPLOY_PATH}/${PM2_ECOSYSTEM}" <<'ECOSYSTEM'
module.exports = {
  apps: [
    {
      name: 'fovi-next',
      script: 'node_modules/.bin/next',
      args: 'start --port 3002',
      cwd: '/home/lightworld/webapps/fovi',
      env_file: '/home/lightworld/webapps/fovi/.env',
      instances: 1,
      autorestart: true,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3002,
      },
    },
    {
      name: 'fovi-market-service',
      script: 'index.ts',
      cwd: '/home/lightworld/webapps/fovi/mini-services/market-service',
      env_file: '/home/lightworld/webapps/fovi/.env',
      interpreter: 'bun',
      instances: 1,
      autorestart: true,
      env: {
        PORT: 3003,
      },
    },
    {
      name: 'fovi-auto-trade',
      script: 'index.ts',
      cwd: '/home/lightworld/webapps/fovi/mini-services/auto-trade-engine',
      env_file: '/home/lightworld/webapps/fovi/.env',
      interpreter: 'bun',
      instances: 1,
      autorestart: true,
      env: {
        PORT: 3012,
      },
    },
    {
      name: 'fovi-balance-sync',
      script: 'index.ts',
      cwd: '/home/lightworld/webapps/fovi/mini-services/balance-sync',
      env_file: '/home/lightworld/webapps/fovi/.env',
      interpreter: 'bun',
      instances: 1,
      autorestart: true,
      env: {
        PORT: 3013,
      },
    },
  ],
};
ECOSYSTEM
  ok "Ecosystem file created"
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

# ----------------------------- Install dependencies ---------------------------

install_deps() {
  info "Installing root dependencies..."
  cd "${DEPLOY_PATH}"
  bun install --frozen-lockfile 2>/dev/null || bun install
  ok "Root dependencies installed"

  for svc in mini-services/market-service mini-services/auto-trade-engine mini-services/balance-sync; do
    if [ -f "${DEPLOY_PATH}/${svc}/package.json" ]; then
      info "Installing dependencies for ${svc}..."
      cd "${DEPLOY_PATH}/${svc}"
      bun install --frozen-lockfile 2>/dev/null || bun install
      ok "${svc} dependencies installed"
    fi
  done
  cd "${DEPLOY_PATH}"
}

# ----------------------------- Build application -------------------------------

build_app() {
  info "Generating Prisma client and building Next.js..."
  cd "${DEPLOY_PATH}"
  bunx prisma generate
  bun run build
  ok "Application built successfully"
}

# ----------------------------- Database ---------------------------------------

db_push() {
  info "Applying Prisma schema to database..."
  cd "${DEPLOY_PATH}"

  if [ -d "${DEPLOY_PATH}/prisma/migrations" ]; then
    info "Migrations directory found — running prisma migrate deploy..."
    bunx prisma migrate deploy
    ok "Database migrations applied"
  else
    warn "No migrations directory found — falling back to prisma db push..."
    bunx prisma db push
    ok "Database schema pushed (via db push fallback)"
  fi
}

# ----------------------------- First-time deploy ------------------------------

first_deploy() {
  info "========== FIRST-TIME DEPLOY =========="

  # Clone repo
  if [ -d "${DEPLOY_PATH}" ]; then
    err "Directory ${DEPLOY_PATH} already exists. Use 'update' to redeploy."
  fi

  info "Cloning repository to ${DEPLOY_PATH}..."
  mkdir -p "$(dirname "${DEPLOY_PATH}")"
  git clone "${GIT_REPO}" "${DEPLOY_PATH}"
  ok "Repository cloned"

  # Setup .env (never overwrites)
  setup_env

  # Install dependencies
  install_deps

  # Build application (prisma generate + next build)
  build_app

  # Push database schema
  db_push

  # Create PM2 ecosystem
  create_ecosystem

  # Start all services with PM2
  info "Starting all services via PM2..."
  cd "${DEPLOY_PATH}"
  pm2 start "${PM2_ECOSYSTEM}"
  pm2 save
  ok "All services started"

  info "========== DEPLOY COMPLETE =========="
  pm2 list
  info "Caddy should already be configured. Verify with: curl -I http://localhost:3002"
}

# ----------------------------- Update deploy ----------------------------------

update_deploy() {
  info "========== UPDATE DEPLOY =========="

  if [ ! -d "${DEPLOY_PATH}" ]; then
    err "Directory ${DEPLOY_PATH} does not exist. Run first-time deploy (no arguments or 'init')."
  fi

  cd "${DEPLOY_PATH}"

  # Stash any local changes (except .env which is gitignored)
  git stash --quiet 2>/dev/null || true

  # Pull latest code
  info "Pulling latest code..."
  git pull origin main
  ok "Code updated"

  # Restore stashed changes if any
  git stash pop --quiet 2>/dev/null || true

  # Install dependencies
  install_deps

  # Build application (prisma generate + next build)
  build_app

  # Push database schema
  db_push

  # Recreate ecosystem (in case app list changed)
  create_ecosystem

  # Restart all PM2 processes
  info "Restarting all PM2 processes..."
  cd "${DEPLOY_PATH}"
  pm2 restart ecosystem.config.cjs
  sleep 2
  pm2 save
  ok "All services restarted"

  info "========== UPDATE COMPLETE =========="
  pm2 list
}

# ----------------------------- Usage ------------------------------------------

usage() {
  cat <<EOF
Usage: $(basename "$0") [command]

Commands:
  (none)|init    First-time deploy: clone, install, setup .env, build, db push, PM2 start
  update         Update deploy: pull, install, build, db push, PM2 restart

VPS path:  ${DEPLOY_PATH}
Services:
  fovi-next           :3002  (Next.js 16)
  fovi-market-service  :3003  (WebSocket market data)
  fovi-auto-trade      :3012  (Auto-trade engine)
  fovi-balance-sync    :3013  (Balance sync)

IMPORTANT: The .env file is NEVER overwritten by this script.
EOF
  exit 0
}

# ----------------------------- Main -------------------------------------------

check_bun
check_pm2

case "${1:-init}" in
  init|deploy|"" ) first_deploy ;;
  update|upgrade  ) update_deploy ;;
  -h|--help|help  ) usage ;;
  *               ) err "Unknown command '${1}'. Run with --help for usage." ;;
esac
