# Remplacer l’ancienne BMB par la v1.2 (même serveur)

Vous avez **déjà BMB v1.0** sur le PC serveur. Vous voulez **la nouvelle version à la place**, sans perdre produits, clients ni ventes.

---

## Méthode A — Même emplacement (recommandée)

### Sur votre PC (préparation)

```powershell
cd "C:\Users\ABEDI-TECH\Desktop\MS BMB\BMB CURSOR"
npm run release
```

Copiez sur clé USB / réseau le dossier : **`dist\BMB-Gestion-1.2.0`**

### Sur le PC serveur

1. **Arrêter** l’ancienne BMB (fermer la fenêtre ou `npm run stop:ports` dans l’ancien dossier).

2. **Sauvegarde** (dans l’ancien dossier) :
   ```powershell
   cd C:\Chemin\Ancien\BMB-Gestion-1.0.0
   npm run backup:db
   ```

3. **Décompresser** `BMB-Gestion-1.2.0` à côté de l’ancien, par exemple :
   - Ancien : `C:\BMB\BMB-Gestion-1.0.0`
   - Nouveau : `C:\BMB\BMB-Gestion-1.2.0`

4. Dans le **nouveau** dossier, double-cliquer :
   **`REMPLACER-ANCIENNE-VERSION.bat`**

5. Quand il demande le chemin, coller le chemin de l’**ancien** dossier, ex. :
   `C:\BMB\BMB-Gestion-1.0.0`

6. Quand c’est fini :
   - Renommer l’ancien en `BMB-Gestion-1.0.0-OLD` (ou supprimer après vérification)
   - Renommer `BMB-Gestion-1.2.0` → le **même nom** que l’ancien avait (raccourcis bureau inchangés), ex. `BMB-Gestion`

7. Lancer **`BESTO SHOP`** ou **`BESTO SHOP`**

8. Sur chaque poste navigateur : **Ctrl+F5**

---

## Méthode B — Écraser le dossier existant

Si vous préférez garder **exactement le même chemin** :

1. Sauvegarde + copie manuelle sur le bureau :
   - `backend\.env`
   - dossier `backups\`
   - dossier `backend\uploads\`

2. Supprimer **tout le reste** dans l’ancien dossier (ou vider le dossier).

3. Copier **tout le contenu** de `BMB-Gestion-1.2.0` dans ce dossier.

4. Remettre les 3 éléments sauvegardés (.env, backups, uploads).

5. Double-cliquer **`METTRE-A-JOUR-SERVEUR.bat`**

6. Relancer **`BESTO SHOP`**

---

## À ne jamais faire sur le serveur en production

| Interdit | Pourquoi |
|----------|----------|
| `INSTALLER BMB.bat` | Lance `db:seed` → écrase / duplique des données |
| `npm run db:seed` | Données de démo, pas pour un magasin en service |
| `npm run db:clear` | Supprime les données |
| Remplacer `backend\.env` par un fichier neuf | Perte connexion PostgreSQL + JWT |

---

## Vérification rapide

```powershell
npm run deploy:verify
```

Puis ouvrir `http://localhost:3001` (ou l’IP du serveur) et se connecter avec le **même compte qu’avant**.

---

## Résumé client

> « On remplace le programme sur le serveur. Vos données restent. Coupure 15–30 minutes. Même adresse qu’avant. »
