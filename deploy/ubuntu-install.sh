#!/bin/bash
# Installation BMB Gestion sur Ubuntu + Cloudflare (bmbgestion.com)
# Usage : sudo bash deploy/ubuntu-install.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$SCRIPT_DIR/.deploy.env"

if [ "$(id -u)" -ne 0 ]; then
  echo "Relancez avec sudo : sudo bash deploy/ubuntu-install.sh"
  exit 1
fi

echo "══════════════════════════════════════════"
echo "  BMB Gestion — Installation Ubuntu"
echo "══════════════════════════════════════════"

# ─── Paquets système ───
apt-get update -qq
apt-get install -y curl git build-essential postgresql postgresql-contrib

# Node.js 20 LTS
if ! command -v node >/dev/null 2>&1 || [ "$(node -p "process.version.slice(1,3)" 2>/dev/null || echo 0)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

# PM2
if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi

# cloudflared (tunnel Cloudflare)
if ! command -v cloudflared >/dev/null 2>&1; then
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | gpg --dearmor -o /usr/share/keyrings/cloudflare.gpg
  echo 'deb [signed-by=/usr/share/keyrings/cloudflare.gpg] https://pkg.cloudflare.com/cloudflared jammy main' \
    > /etc/apt/sources.list.d/cloudflared.list
  apt-get update -qq
  apt-get install -y cloudflared
fi

cd "$ROOT"

if [ ! -f "$ENV_FILE" ]; then
  cp "$SCRIPT_DIR/.deploy.env.example" "$ENV_FILE"
  echo ""
  echo "⚠️  Éditez deploy/.deploy.env (mot de passe PostgreSQL, domaine)"
  echo "   Puis relancez : sudo bash deploy/ubuntu-install.sh"
  exit 0
fi

# shellcheck source=/dev/null
source "$ENV_FILE"

for v in DOMAIN DB_USER DB_PASSWORD DB_NAME WEB_PORT POSTGRES_PORT; do
  if [ -z "${!v:-}" ] || [ "${!v}" = "CHANGEZ_MOI_MOT_DE_PASSE_FORT" ]; then
    echo "Configurez $v dans deploy/.deploy.env"
    exit 1
  fi
done

# ─── PostgreSQL ───
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};" 2>/dev/null || true

# ─── Application ───
bash "$SCRIPT_DIR/generate-config.sh"

echo "[1/4] Dépendances npm..."
npm run install:all

echo "[2/4] Migrations base..."
npm run db:migrate

echo "[3/4] Données initiales (admin)..."
npm run db:seed || true

echo "[4/4] Build frontend..."
npm run build:prod

mkdir -p "$ROOT/logs" "$ROOT/backend/uploads"

# PM2 — API Node (HTTP local, Cloudflare Tunnel expose en HTTPS)
pm2 delete bmb-api 2>/dev/null || true
pm2 start "$SCRIPT_DIR/ecosystem.config.cjs"
pm2 save
pm2 startup systemd -u "${SUDO_USER:-root}" --hp "/root" 2>/dev/null || pm2 startup

echo ""
echo "══════════════════════════════════════════"
echo "  Application démarrée (PM2 : bmb-api)"
echo "  URL publique cible : https://${DOMAIN}"
echo "══════════════════════════════════════════"
echo ""
echo "Cloudflare Tunnel (cloudflared deja installe sur ce serveur) :"
echo "  bash deploy/generated/configure-cloudflared.sh"
echo ""
echo "Connexion initiale : admin / admin123 — changez le mot de passe."
echo "Santé API locale : curl http://127.0.0.1:${WEB_PORT}/api/health"
echo ""
