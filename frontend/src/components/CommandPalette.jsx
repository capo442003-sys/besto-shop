import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { canAccessReglement } from '../utils/sellerScope';

const COMMANDS = [
  { id: 'dash', label: 'Accueil', path: '/', module: 'dashboard', keywords: 'accueil home tableau bord' },
  { id: 'ventes', label: 'Module Ventes', path: '/ventes/vendre', module: 'ventes', keywords: 'caisse pos ventes' },
  { id: 'vendre', label: 'Ouvrir la caisse / Vendre', path: '/ventes/vendre', module: 'ventes', action: 'create', keywords: 'pos vente caisse' },
  { id: 'reglement', label: 'Encaisser / Règlement', path: '/ventes/reglement', module: 'ventes', action: 'edit', requireAfterSalePayment: true, keywords: 'paiement dette credit' },
  { id: 'historique', label: 'Inventaire de vente', path: '/ventes/inventaire', module: 'ventes', keywords: 'historique paniers inventaire' },
  { id: 'clients', label: 'Clients', path: '/ventes/clients', module: 'ventes', keywords: 'client' },
  { id: 'stocks', label: 'Stocks produits', path: '/produits/stocks', module: 'produits', keywords: 'stock ravitaillement' },
  { id: 'produits', label: 'Liste produits', path: '/produits/liste', module: 'produits', keywords: 'catalogue article' },
  { id: 'employes', label: 'Employés', path: '/employes', module: 'employes', keywords: 'personnel carte' },
  { id: 'caisse-fin', label: 'Caisse journalière', path: '/finances/caisse', module: 'finances', keywords: 'finance tresorerie' },
  { id: 'magasin', label: 'Paramètres magasin', path: '/parametres/magasin', module: 'parametres', keywords: 'logo config' },
  { id: 'admin', label: 'Paramètres', path: '/parametres', module: 'parametres', keywords: 'parametres admin' },
  { id: 'audit', label: 'Journal d\'audit', path: '/parametres/audit', module: 'parametres', keywords: 'audit historique trace' },
  { id: 'import', label: 'Import données Excel', path: '/parametres/import', module: 'parametres', keywords: 'importexcel migration csv' },
  { id: 'bons', label: 'Bons de commande', path: '/ventes/bons-commande', module: 'ventes', keywords: 'bc commande' },
  { id: 'fournisseurs', label: 'Fournisseurs', path: '/produits/fournisseurs', module: 'produits', keywords: 'supplier' },
  { id: 'inventaire-p', label: 'Inventaire physique', path: '/produits/inventaire', module: 'produits', action: 'edit', keywords: 'stock comptage' },
];

export default function CommandPalette({ open, onClose }) {
  const { can, user } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);

  const items = useMemo(() => {
    const allowed = COMMANDS.filter((c) => {
      if (!can(c.module, c.action || 'view')) return false;
      if (c.requireAfterSalePayment && !canAccessReglement(user)) return false;
      return true;
    });
    const s = q.trim().toLowerCase();
    if (!s) return allowed;
    return allowed.filter(
      (c) => c.label.toLowerCase().includes(s) || c.keywords.includes(s) || c.path.includes(s)
    );
  }, [q, can, user]);

  useEffect(() => {
    if (open) {
      setQ('');
      setIdx(0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, items.length - 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
      if (e.key === 'Enter' && items[idx]) {
        navigate(items[idx].path);
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, items, idx, navigate, onClose]);

  if (!open) return null;

  return (
    <div className="cmd-palette-backdrop" onClick={onClose} role="presentation">
      <div className="cmd-palette" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Recherche rapide">
        <div className="cmd-palette__search">
          <span className="cmd-palette__hint" aria-hidden>Ctrl+K</span>
          <input
            autoFocus
            value={q}
            onChange={(e) => { setQ(e.target.value); setIdx(0); }}
            placeholder="Où allez-vous ? Caisse, stocks, clients…"
            aria-label="Rechercher une page"
          />
        </div>
        <ul className="cmd-palette__list">
          {items.length === 0 ? (
            <li className="cmd-palette__empty">Aucun résultat</li>
          ) : items.map((item, i) => (
            <li key={item.id}>
              <button
                type="button"
                className={`cmd-palette__item${i === idx ? ' cmd-palette__item--active' : ''}`}
                onClick={() => { navigate(item.path); onClose(); }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
