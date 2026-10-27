# Guide commercial — Mise sur le marché BESTO SHOP v1.0.0

## 1. Livrable client

Remettre au client :

1. Dossier **`BMB-Gestion-1.0.0`** (généré par `npm run release`) **ou** clé USB avec le projet + `INSTALLER BMB.bat`
2. **`LIRE-MOI.txt`**
3. Contrat / licence d'utilisation
4. Coordonnées support

## 2. Checklist avant livraison

### Technique

- [ ] `npm run db:migrate` (migrations 008–009 : sécurité, clôture caisse)
- [ ] `npm run release` exécuté sans erreur
- [ ] `npm run test:api` → 17/17 OK
- [ ] `npm run test:modules` → 38/38 OK
- [ ] `npm run test:e2e` (avec `npm run dev` actif) — optionnel si Playwright installé
- [ ] PostgreSQL testé sur machine cible
- [ ] `INSTALLER BMB.bat` testé sur PC vierge (ou VM)
- [ ] `npm run backup:db` testé (nécessite `pg_dump` dans le PATH)

### Sécurité

- [ ] `backend\.env` avec `JWT_SECRET` unique par client
- [ ] Mot de passe admin changé au premier login (écran obligatoire)
- [ ] Comptes utilisateurs créés (vendeur, caissier, gestionnaire…)
- [ ] Pare-feu : autoriser le port **3001** en réseau local si postes clients

### Métier

- [ ] Paramètres magasin (nom, logo, téléphone)
- [ ] Points de vente configurés
- [ ] Données existantes importées (**Paramètres → Import données**) ou catalogue saisi
- [ ] Formation 1–2 h : vente, encaissement, stocks, journal d'audit

## 3. Architecture chez le client

```
[PC Magasin — serveur]
  ├── PostgreSQL (bmb_gestion)
  ├── Node.js + BMB (port 3001)
  └── Electron OU navigateur (PWA)

[Autres PC / tablettes — optionnel]
  └── Navigateur → http://IP-SERVEUR:3001 (réseau local)
```

## 4. Sauvegardes automatiques (recommandé)

Planifier dans le **Planificateur de tâches Windows** :

- Programme : `cmd.exe`
- Arguments : `/c cd /d "C:\Chemin\BMB CURSOR" && npm run backup:db`
- Fréquence : quotidienne (ex. 23h00)
- Prérequis : PostgreSQL `pg_dump` dans le PATH, `DATABASE_URL` dans `backend\.env`

Les sauvegardes sont stockées dans `backups/` et listées dans **Paramètres → Magasin**.

## 5. Journal d'audit

**Paramètres → Audit** : filtres (date, utilisateur, action), export CSV, purge &gt; 12 mois, sauvegarde BDD.

## 6. Raccourcis caisse

| Touche | Action |
|--------|--------|
| F2 | Focus recherche produit |
| Entrée | Ajouter ligne / encaisser / confirmer dialogue |
| F10 | Valider la vente |
| Ctrl+K | Menu rapide (pages) |

Option **confirmation à chaque ajout produit** : Paramètres → Magasin.

## 7. Clôture de caisse (Z)

**Finances → Caisse** : encaissements ventes + règlements + journal manuel → solde théorique. Bouton **Clôture (Z)** : saisir le montant compté, signature responsable. La journée clôturée ne accepte plus d’opérations (sauf admin via base si besoin).

## 8. Import données client existantes

Voir **`docs/IMPORT_DONNEES.md`**. Ordre : catégories → produits → clients → fournisseurs → ventes historiques. Toujours sauvegarder la base avant import.

## 9. Tarification suggérée (indicatif)

| Prestation | Description |
|------------|-------------|
| **Licence** | Installation + 1 poste principal |
| **Poste supplémentaire** | PWA / navigateur réseau local |
| **Formation** | Session sur site |
| **Maintenance** | Mises à jour, sauvegardes, support |

## 8. Mises à jour version

1. Sauvegarder PostgreSQL (`npm run backup:db` ou `pg_dump`)
2. Remplacer les fichiers (sauf `backend\.env` et `backend\uploads`)
3. `npm run install:all`
4. `npm run db:migrate`
5. `cd frontend && npm run build`
6. Relancer `BESTO SHOP`

## 9. Dépannage rapide

| Problème | Solution |
|----------|----------|
| Port 3001 occupé | `npm run stop:ports` |
| Base inaccessible | Démarrer service PostgreSQL |
| Écran blanc | Relancer `INSTALLER BMB.bat` ou `npm run build` dans frontend |
| Mot de passe oublié | Réinitialiser via PostgreSQL ou `npm run db:seed` |
| Hors ligne | Bannière rouge — reconnecter le PC serveur / réseau |
| pg_dump introuvable | Installer PostgreSQL client tools, ajouter au PATH |

## 10. Contact support

Documenter pour chaque client : nom magasin, version (`VERSION`), date installation, contact technique.
