# Changelog BESTO SHOP

## 1.2.0 — 2026-05-23

### Ajouts
- Import données (produits, clients, fournisseurs, employés, dettes, ventes historiques) + aperçu avant import
- Clôture de caisse (Z), PDF, réouverture admin
- Recherche globale (barre supérieure)
- Thème sombre, interface adaptée mobile / tablette / grand écran
- Verrou inventaire (suspend les ventes)
- Déconnexion auto caisse (inactivité)
- Alertes dashboard : stock bas, caisse non clôturée, dettes échues
- Historique des prix produits
- Suggestions réapprovisionnement (`/products/reorder-suggestions`)
- État système + journal des versions
- Tutoriel première ouverture
- Socket.io authentifié (JWT)
- Journal des sessions (login / logout)

### Sécurité
- Helmet, limite connexion, audit échecs login
- Permission `finances/edit` pour clôture

### Migration
- `009_cash_closure.sql`
- `010_v12_features.sql`

## 1.0.0
- Version initiale
