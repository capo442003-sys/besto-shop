#!/bin/bash
# Génère backend/.env, cloudflared et nginx depuis deploy/.deploy.env
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$SCRIPT_DIR/.deploy.env"
OUT_DIR="$SCRIPT_DIR/generated"

if [ ! -f "$ENV_FILE" ]; then
  echo "Créez d'abord : cp deploy/.deploy.env.example deploy/.deploy.env"
  exit 1
fi

# shellcheck source=/dev/null
source "$ENV_FILE"

required=(DOMAIN DB_USER DB_PASSWORD DB_NAME WEB_PORT POSTGRES_PORT)
for v in "${required[@]}"; do
  if [ -z "${!v:-}" ] || [ "${!v}" = "A_REMPLIR" ]; then
    echo "❌ Remplissez $v dans deploy/.deploy.env"
    exit 1
  fi
done

POSTGRES_HOST="${POSTGRES_HOST:-localhost}"
WWW_DOMAIN="${WWW_DOMAIN:-www.${DOMAIN}}"
JWT="${JWT_SECRET:-$(openssl rand -hex 32)}"
CLIENT_URL="https://${DOMAIN}"
SERVE_CLIENT="${SERVE_CLIENT:-1}"
NODE_ENV="${NODE_ENV:-production}"

mkdir -p "$OUT_DIR"

# ─── backend/.env ───
cat > "$ROOT/backend/.env" <<EOF
# Généré par deploy/generate-config.sh — ne pas éditer à la main
PORT=${WEB_PORT}
NODE_ENV=${NODE_ENV}
DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${DB_NAME}
JWT_SECRET=${JWT}
JWT_EXPIRES_IN=${JWT_EXPIRES_IN:-12h}
CLIENT_URL=${CLIENT_URL}
SERVE_CLIENT=${SERVE_CLIENT}
GOOGLE_DRIVE_CLIENT_EMAIL=${GOOGLE_DRIVE_CLIENT_EMAIL:-}
GOOGLE_DRIVE_PRIVATE_KEY=${GOOGLE_DRIVE_PRIVATE_KEY:-}
GOOGLE_DRIVE_FOLDER_ID=${GOOGLE_DRIVE_FOLDER_ID:-}
EOF

# ─── PM2 (variables d'environnement) ───
cat > "$OUT_DIR/pm2.env" <<EOF
NODE_ENV=${NODE_ENV}
SERVE_CLIENT=${SERVE_CLIENT}
CLIENT_URL=${CLIENT_URL}
PORT=${WEB_PORT}
EOF

# ─── Cloudflare Tunnel ───
if [ -n "${TUNNEL_UUID:-}" ] && [ "${TUNNEL_UUID}" != "A_REMPLIR" ]; then
  CREDS="${CLOUDFLARED_CREDENTIALS:-/root/.cloudflared/${TUNNEL_UUID}.json}"
  cat > "$OUT_DIR/cloudflared-config.yml" <<EOF
# Copier sur le serveur : sudo cp deploy/generated/cloudflared-config.yml /etc/cloudflared/config.yml
tunnel: ${TUNNEL_UUID}
credentials-file: ${CREDS}

ingress:
  - hostname: ${DOMAIN}
    service: http://127.0.0.1:${WEB_PORT}
  - hostname: ${WWW_DOMAIN}
    service: http://127.0.0.1:${WEB_PORT}
  - service: http_status:404
EOF
  echo "✓ deploy/generated/cloudflared-config.yml"
else
  echo "⚠️  TUNNEL_UUID non renseigné — cloudflared-config.yml non généré"
fi

# ─── Nginx (optionnel) ───
if [ -f "$SCRIPT_DIR/nginx-bmb.conf.example" ]; then
  sed "s/bmb.votredomaine.com/${DOMAIN}/g" "$SCRIPT_DIR/nginx-bmb.conf.example" \
    | sed "s|www.bmb.votredomaine.com|${WWW_DOMAIN}|g" \
    | sed "s|127.0.0.1:3001|127.0.0.1:${WEB_PORT}|g" \
    > "$OUT_DIR/nginx-bmb.conf"
  echo "✓ deploy/generated/nginx-bmb.conf"
fi

# ─── Résumé ───
cat > "$OUT_DIR/DEPLOI.txt" <<EOF
BMB Gestion — configuration générée
====================================
Domaine      : https://${DOMAIN}
API locale   : http://127.0.0.1:${WEB_PORT}
Base         : ${DB_NAME} (user: ${DB_USER})
Chemin app   : ${APP_PATH:-/opt/bmbgestion}

Fichiers générés :
  - backend/.env
  - deploy/generated/pm2.env
  - deploy/generated/cloudflared-config.yml (si tunnel UUID)
  - deploy/generated/nginx-bmb.conf

Sur le serveur Ubuntu :
  cd ${APP_PATH:-/opt/bmbgestion}
  npm run install:all
  npm run db:migrate && npm run db:seed
  npm run build:prod
  pm2 start deploy/ecosystem.config.cjs
  pm2 save

Cloudflare Tunnel :
  sudo cp deploy/generated/cloudflared-config.yml /etc/cloudflared/config.yml
  sudo systemctl restart cloudflared
EOF

echo ""
echo "✓ backend/.env généré"
echo "✓ deploy/generated/pm2.env"
echo "✓ deploy/generated/DEPLOI.txt"
echo ""
echo "URL publique : ${CLIENT_URL}"
echo "Voir deploy/generated/DEPLOI.txt pour la suite."
