import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';

export default function GlobalSearch({ className = '' }) {
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const ref = useRef(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setData(null);
      return undefined;
    }
    const t = setTimeout(() => {
      api.get('/search', { params: { q: q.trim() } }).then((r) => setData(r.data)).catch(() => setData(null));
    }, 280);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, []);

  const go = (path) => {
    setOpen(false);
    setQ('');
    nav(path);
  };

  const hasResults = data && (
    data.products?.length || data.clients?.length || data.carts?.length || data.orders?.length
  );

  return (
    <div className={`global-search ${className}`.trim()} ref={ref}>
      <input
        type="search"
        className="global-search__input"
        placeholder="Recherche produit, client, vente…"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        aria-label="Recherche globale"
      />
      {open && q.length >= 2 && (
        <div className="global-search-dropdown card-lite">
          {!hasResults && <p className="form-hint">Aucun résultat</p>}
          {data?.products?.map((p) => (
            <button key={`p-${p.id}`} type="button" className="global-search__item" onClick={() => go('/produits/liste')}>
              <span className="global-search__type">Produit</span> {p.name} <small>{p.reference}</small>
            </button>
          ))}
          {data?.clients?.map((c) => (
            <button key={`c-${c.id}`} type="button" className="global-search__item" onClick={() => go('/ventes/clients')}>
              <span className="global-search__type">Client</span> {c.name} <small>{c.code}</small>
            </button>
          ))}
          {data?.carts?.map((c) => (
            <button key={`sc-${c.id}`} type="button" className="global-search__item" onClick={() => go('/ventes/reglement')}>
              <span className="global-search__type">Vente</span> {c.cart_number}
            </button>
          ))}
          {data?.orders?.map((o) => (
            <button key={`o-${o.id}`} type="button" className="global-search__item" onClick={() => go('/ventes/bons-commande')}>
              <span className="global-search__type">BC</span> {o.order_number}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
