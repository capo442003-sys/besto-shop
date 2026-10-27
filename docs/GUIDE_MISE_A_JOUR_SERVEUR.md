# Mise à jour serveur — de la v1.0 vers la v1.2

Ce guide s’applique quand **BMB v1.0 est déjà installé** chez le client (PostgreSQL + backend + données en production).

**Les données existantes sont conservées.** Aucune réinstallation complète de la base n’est nécessaire.

---

## Ce qui change

| Élément | v1.0 déployée | Après mise à jour v1.2 |
|--------|----------------|-------------------------|
| Fichiers application | Ancien dossier | Nouveau build (frontend `dist` + backend) |
| Base PostgreSQL | Inchangée en contenu | **Migrations 008 → 011** uniquement (colonnes/tables ajoutées) |
| `backend/.env` | **À garder tel quel** | Ne pas écraser |
| Sauvegardes `backups/` | À conserver | Ne pas supprimer |
| `uploads/` (logos) | À conserver | Ne pas supprimer |

**Pas de table `cash_closure`** : les clôtures sont dans **`daily_cash`** (+ vue `cash_closure` en lecture).

---

## Durée d’interruption

Comptez **10 à 30 minutes** (sauvegarde + copie + migration + redémarrage).  
Prévoir une plage **hors heures d’ouverture** du magasin.

---

## Procédure rapide (recommandée)

1. Sauvegarde : `npm run backup:db`
2. Copier la nouvelle version **en gardant** `backend\.env`, `backups\`, `uploads\`
3. Double-cliquer **`METTRE-A-JOUR-SERVEUR.bat`** (ou `npm run deploy:server`)
4. Relancer **`BESTO SHOP`** ou **`BESTO SHOP`**
5. Sur chaque poste : **Ctrl+F5**

---

## Procédure détaillée (sur le PC serveur)

### 1. Sauvegarde obligatoire

```powershell
cd C:\Chemin\Vers\BMB-CURSOR
npm run backup:db
```

Copiez aussi le fichier `backend\.env` sur une clé USB ou un autre dossier.

Option PostgreSQL (si `pg_dump` installé) :

```powershell
pg_dump -U postgres -d bmb_gestion -f "C:\Sauvegardes\bmb_avant_v12.sql"
```

### 2. Arrêter l’ancienne version

- Fermer l’application Electron **ou** arrêter le service Node
- Libérer le port :

```powershell
npm run stop:ports
```

### 3. Copier la nouvelle version

**Ne pas remplacer :**

- `backend\.env`
- `backups\`
- `backend\uploads\` (ou `uploads\` selon votre install)

**Remplacer / mettre à jour :**

- Tout le projet **sauf** les dossiers ci-dessus, **ou**
- Déployer le nouveau zip `BMB-Gestion-1.2.0` dans un dossier temporaire puis fusionner en gardant `.env` et `backups`

### 4. Installer les dépendances

```powershell
cd C:\Chemin\Vers\BMB-CURSOR
npm run install:all
```

### 5. Compiler le frontend (obligatoire)

```powershell
npm run build --prefix frontend
```

Sans cette étape : **écran blanc** sur `http://localhost:3001`.

### 6. Migrations base de données (sans perte de données)

```powershell
npm run db:migrate
```

Vous devez voir au minimum :

- `008_security_and_prefs.sql` (déjà appliqué ou OK)
- `009_cash_closure.sql`
- `010_v12_features.sql`
- `011_ensure_daily_cash.sql`

**Ne jamais lancer** `npm run db:seed` ni `npm run db:clear` sur une base en production.

### 7. Redémarrer

**Mode Electron / batch client :**

```powershell
# selon votre installateur, ex. BESTO SHOP
```

**Mode serveur seul :**

```powershell
cd backend
npm start
```

Au démarrage, le log doit afficher :

`✓ Interface web servie depuis ...\frontend\dist`

### 8. Vérifications (5 min)

1. Ouvrir `http://localhost:3001` (ou l’IP du serveur)
2. Connexion avec un compte existant (mot de passe **inchangé**)
3. Vérifier produits, clients, une vente test
4. **Paramètres → Import données** si migration Excel prévue
5. **Finances → Caisse** → clôture test (optionnel)

```powershell
npm run test:api
npm run test:modules
```

---

## Postes clients (navigateurs)

- Vider le cache une fois : **Ctrl + F5** sur chaque poste
- Ou : F12 → Application → Service Worker → Unregister (PWA)

L’URL reste la même : `http://IP-SERVEUR:3001`

---

## En cas de problème

| Symptôme | Action |
|----------|--------|
| Écran blanc | `npm run build --prefix frontend` puis redémarrer backend |
| Erreur `daily_cash` | `npm run db:migrate` (migration 011) |
| Login impossible | Vérifier `backend\.env` et que PostgreSQL tourne |
| Revenir en arrière | Restaurer la sauvegarde `.sql` + remettre l’ancien dossier v1.0 |

---

## Résumé pour le client

> « Nous mettons à jour le logiciel sur le serveur magasin. Vos produits, clients et ventes restent en place. Coupure courte (15–30 min). Ensuite : même adresse, nouvelles fonctions (import Excel, clôture caisse, sécurité). »

---

## Contact technique

Conserver : version installée avant MAJ, message d’erreur exact, résultat de `npm run db:migrate`.
