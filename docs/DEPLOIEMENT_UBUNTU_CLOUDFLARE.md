# Déploiement Ubuntu + Cloudflare — bmbgestion.uk

Guide pour héberger BESTO SHOP sur un serveur **Ubuntu** avec le domaine **bmbgestion.uk** (Cloudflare).

---

## Architecture recommandée

```
Internet → Cloudflare (HTTPS) → Tunnel cloudflared → Node.js :3001 → PostgreSQL
```

- Pas besoin d’ouvrir les ports 80/443 sur le serveur
- HTTPS géré par Cloudflare (certificat valide, PWA installable)
- Le domaine **bmbgestion.uk** doit être géré dans votre compte Cloudflare

---

## 1. Prérequis

- Serveur Ubuntu 22.04 ou 24.04 (1 Go RAM minimum, 2 Go recommandé)
- Accès SSH `root` ou `sudo`
- Domaine **bmbgestion.uk** pointant vers Cloudflare (nameservers Cloudflare)

---

## 2. Copier le projet sur le serveur

Depuis votre PC :

```bash
scp -r "BESTO SHOP" user@votre-serveur:/opt/bmbgestion
```

Ou clone Git si le dépôt est en ligne.

```bash
ssh user@votre-serveur
cd /opt/bmbgestion
```

---

## 3. Configuration

```bash
cp deploy/.deploy.env.example deploy/.deploy.env
nano deploy/.deploy.env
```

Exemple :

```env
DOMAIN=bmbgestion.uk
WEB_PORT=3001
POSTGRES_PORT=5432
DB_NAME=bmb_gestion
DB_USER=bmb
DB_PASSWORD=votre_mot_de_passe_fort
```

---

## 4. Installation automatique

```bash
sudo bash deploy/ubuntu-install.sh
```

Cela installe : Node 20, PostgreSQL, PM2, cloudflared, migrations, build frontend, démarrage PM2.

---

## 5. Cloudflare Tunnel (HTTPS public)

Exécuter **en root** ou avec sudo :

```bash
# Connexion compte Cloudflare
cloudflared tunnel login

# Créer le tunnel
cloudflared tunnel create bmbgestion
# Notez l'UUID affiché (ex. a1b2c3d4-...)

# DNS automatique Cloudflare
cloudflared tunnel route dns bmbgestion bmbgestion.uk
cloudflared tunnel route dns bmbgestion www.bmbgestion.uk
```

Copier et éditer la config tunnel :

```bash
sudo mkdir -p /etc/cloudflared
sudo cp deploy/cloudflared-config.yml.example /etc/cloudflared/config.yml
sudo nano /etc/cloudflared/config.yml
```

Remplacez `REMPLACEZ_PAR_UUID_TUNNEL` par l’UUID du tunnel (2 endroits).

Installer le service :

```bash
sudo cloudflared service install
sudo systemctl enable cloudflared
sudo systemctl start cloudflared
sudo systemctl status cloudflared
```

---

## 6. Cloudflare — réglages dashboard

Dans [dash.cloudflare.com](https://dash.cloudflare.com) → **bmbgestion.uk** :

| Réglage | Valeur |
|---------|--------|
| SSL/TLS | **Full** (tunnel) ou **Full (strict)** |
| Always Use HTTPS | Activé |
| WebSockets | Activé (pour Socket.io) |

---

## 7. Vérification

```bash
# Sur le serveur
curl http://127.0.0.1:3001/api/health

# Depuis un navigateur
https://bmbgestion.uk
```

Connexion : `admin` / `admin123` → **changer le mot de passe immédiatement**.

Installation PWA : Chrome/Edge → **Installer l’application** depuis https://bmbgestion.uk

---

## 8. Commandes utiles

```bash
pm2 status
pm2 logs bmb-api
sudo systemctl status cloudflared
npm run backup:db          # sauvegarde PostgreSQL
```

Mise à jour :

```bash
cd /opt/bmbgestion
git pull   # ou recopier les fichiers
npm run install:all
npm run db:migrate
npm run build --prefix frontend
pm2 restart bmb-api
```

---

## 9. Sécurité

- [ ] `JWT_SECRET` unique dans `backend/.env` (généré par `generate-config.sh`)
- [ ] Mot de passe admin changé
- [ ] Mot de passe PostgreSQL fort
- [ ] Sauvegardes planifiées (`cron` + `npm run backup:db`)
- [ ] Comptes utilisateurs par employé (pas tout le monde admin)

---

## Alternative : Nginx sans tunnel

Si vous préférez Nginx + certificat Let’s Encrypt (ports 80/443 ouverts) :

```bash
bash deploy/generate-config.sh
sudo apt install nginx certbot python3-certbot-nginx
sudo cp deploy/nginx-bmb-active.conf /etc/nginx/sites-available/bmb
sudo ln -sf /etc/nginx/sites-available/bmb /etc/nginx/sites-enabled/bmb
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d bmbgestion.uk -d www.bmbgestion.uk
```

Dans Cloudflare : mode SSL **Full (strict)**.
