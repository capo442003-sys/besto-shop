#!/bin/bash
# Mise à jour BMB Gestion sur Ubuntu (sans écraser .env ni relancer db:seed)
# Usage : bash deploy/ubuntu-update.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "══════════════════════════════════════════"
echo "  BMB Gestion — Mise à jour serveur"
echo "══════════════════════════════════════════"

cd "$ROOT"

if [ ! -f "$ROOT/backend/.env" ]; then
  echo "❌ backend/.env introuvable — conservez le fichier de l'installation existante."
  exit 1
fi

echo "[1/5] Sauvegarde recommandée : npm run backup:db"
echo "[2/5] Dépendances npm..."
npm run install:all

echo "[3/5] Migrations base (sans seed)..."
npm run db:migrate

echo "[4/5] Build frontend..."
npm run build:prod

echo "[5/5] Redémarrage PM2..."
if command -v pm2 >/dev/null 2>&1; then
  pm2 restart bmb-api 2>/dev/null || pm2 start "$SCRIPT_DIR/ecosystem.config.cjs"
  pm2 save
else
  echo "⚠️  PM2 non installé — redémarrez manuellement : cd backend && npm start"
fi

echo ""
echo "✓ Mise à jour terminée."
echo "  Santé API : curl http://127.0.0.1:3001/api/health"
echo "  Ne pas lancer db:seed sur une base en production."
echo ""
