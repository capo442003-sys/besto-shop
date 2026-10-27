# Import des données existantes — BESTO SHOP

## Accès

**Paramètres → Import données** (administrateur uniquement).

## Ordre recommandé

1. **Catégories** (optionnel)
2. **Produits & stocks** — met à jour par `reference`, crée sinon
3. **Clients** — met à jour par `code` ou nom
4. **Fournisseurs**
5. **Ventes historiques** — après produits et clients ; **ne modifie pas le stock**

## Formats acceptés

- Excel : `.xlsx`, `.xls`
- CSV (UTF-8)

Téléchargez le **modèle** pour chaque type depuis la page d’import.

## Colonnes principales

### Produits

| Colonne | Description |
|---------|-------------|
| nom | Obligatoire |
| reference | Si vide, code auto BMB |
| categorie | Créée si absente |
| prix_achat, prix_gros, prix_detail | Nombres |
| stock | Stock initial (entrée stock) |
| stock_min | Seuil alerte |

### Clients

| Colonne | Description |
|---------|-------------|
| nom | Obligatoire |
| code | Optionnel (sinon code BMB) |
| contact, adresse | Texte |
| type | particulier, entreprise, etat |

### Ventes historiques

Une ligne = un article ; même `numero_vente` = une vente.

| Colonne | Description |
|---------|-------------|
| numero_vente | Identifiant facture (ignoré si déjà en base) |
| date_vente | AAAA-MM-JJ |
| client_code / client_nom | Sinon client comptoir |
| reference_produit / nom_produit | Produit doit exister |
| quantite, prix_unitaire | Ligne |
| montant_paye, mode_paiement | especes, paiement_mobile, virement, cheque |
| type_vente | gros ou detail |

## Fusion avec données existantes

- **Pas de suppression** : l’import ajoute ou met à jour.
- Produits : clé = `reference`
- Clients : clé = `code`, sinon nom
- Ventes : doublon sur `numero_vente` → ligne ignorée

## Avant import en production

1. `npm run backup:db`
2. Tester sur une copie de la base
3. Vérifier le rapport d’erreurs ligne par ligne

## Déploiement déjà en place (v1.0.0)

- Aucune migration SQL obligatoire pour l’import.
- Après mise à jour du logiciel : `npm install` dans `backend` (dépendance `helmet`).
- Redémarrer le backend.
