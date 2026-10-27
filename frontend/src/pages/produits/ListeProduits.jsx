import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import api from '../../api/client';
import { formatGNF, formatQty, formatGNFForPdf, parseNumberInput } from '../../utils/format';
import PrintReport from '../../components/PrintReport';
import PrintPreviewModal from '../../components/PrintPreviewModal';
import { downloadReportPdf } from '../../utils/printReportPdf';
import { suggestPrintOrientation } from '../../utils/printOrientation';
import { parseProductsApiResponse } from '../../utils/calculations';
import { useStoreSettings } from '../../context/StoreSettingsContext';
import { useAuth } from '../../context/AuthContext';
import { canAccessAllPvs, isPvScoped, pvDisplayLabel, stockQueryParams } from '../../utils/pvScope';
import { useConfirm } from '../../context/ConfirmContext';
import BmbFormModal from '../../components/BmbFormModal';
import EmptyState from '../../components/ui/EmptyState';
import TableSkeleton from '../../components/ui/TableSkeleton';
import ResponsiveDataView from '../../components/ui/ResponsiveDataView';
import DataCard from '../../components/ui/DataCard';

const emptyForm = {
  name: '',
  category_id: '',
  purchase_price: '',
  min_stock: '',
  initial_quantity: '',
};

const PRODUCT_COLUMNS = [
  { key: 'reference', label: 'Réf.' },
  { key: 'name', label: 'Nom' },
  { key: 'category', label: 'Catégorie' },
  { key: 'stock', label: 'Stock', align: 'right' },
  { key: 'purchase', label: 'Prix moyen', align: 'right' },
  { key: 'wholesale', label: 'Prix gros', align: 'right' },
  { key: 'retail', label: 'Détail', align: 'right' },
  { key: 'min', label: 'Min', align: 'right' },
];

export default function ListeProduits() {
  const { user, can } = useAuth();
  const { store } = useStoreSettings();
  const confirm = useConfirm();
  const pvLocked = isPvScoped(user);
  const canPickPv = canAccessAllPvs(user);
  const [deliveryPoints, setDeliveryPoints] = useState([]);
  const [selectedPvId, setSelectedPvId] = useState('');
  const [list, setList] = useState([]);
  const [productSummary, setProductSummary] = useState(null);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editId, setEditId] = useState(null);
  const [newCat, setNewCat] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [orientation, setOrientation] = useState('landscape');
  const printRef = useRef();
  const nameInputRef = useRef(null);

  const importExcel = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ok = await confirm({
      title: 'Importer des produits',
      message: `Le fichier « ${file.name} » mettra à jour les produits existants et en ajoutera de nouveaux. Continuer ?`,
      confirmLabel: 'Importer',
    });
    if (!ok) {
      e.target.value = '';
      return;
    }
    const fd = new FormData();
    fd.append('file', file);
    try {
      const { data } = await api.post('/products/import', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      const errHint = data.errors?.length ? ` (${data.errors.length} ligne(s) en erreur)` : '';
      setMsg(data.message + errHint);
      load();
    } catch (err) {
      setMsg(err.response?.data?.message || 'Erreur import');
    }
    e.target.value = '';
  };

  const pvParams = useMemo(() => stockQueryParams(user, selectedPvId), [user, selectedPvId]);
  const pvLabel = pvLocked ? pvDisplayLabel(user) : (
    deliveryPoints.find((dp) => String(dp.id) === String(selectedPvId))?.code || ''
  );

  const load = () => {
    setLoading(true);
    const pvFilterId = pvParams.delivery_point_id;
    if (canPickPv && deliveryPoints.length > 1 && !pvFilterId) {
      setList([]);
      setProductSummary(null);
      setLoading(false);
      return Promise.resolve();
    }
    return api.get('/products', { params: { search, ...pvParams } })
      .then((r) => {
        const parsed = parseProductsApiResponse(r.data);
        let items = parsed.items;
        if (pvFilterId) {
          items = items.filter((p) => (
            p.delivery_point_id != null
            && String(p.delivery_point_id) === String(pvFilterId)
          ));
        }
        setList(items);
        setProductSummary(parsed.summary ? { ...parsed.summary, count: items.length } : null);
      })
      .catch(() => {
        setList([]);
        setProductSummary(null);
      })
      .finally(() => setLoading(false));
  };
  const loadCats = () => api.get('/categories').then((r) => setCategories(r.data));

  const totals = useMemo(() => ({
    count: productSummary?.count ?? list.length,
    stock: productSummary
      ? parseFloat(productSummary.total_stock || 0)
      : list.reduce((s, p) => s + (parseFloat(p.total_stock) || 0), 0),
  }), [productSummary, list]);

  const reportFilters = useMemo(() => [
    { label: 'Recherche', value: search.trim() ? `« ${search.trim()} »` : '' },
  ], [search]);

  const reportRows = useMemo(() => list.map((p) => ({
    id: p.id,
    reference: p.reference,
    name: p.name,
    category: p.category_name || '—',
    stock: formatQty(p.total_stock),
    purchase: formatGNF(p.purchase_price),
    wholesale: formatGNF(p.wholesale_price),
    retail: formatGNF(p.retail_price),
    min: formatQty(p.min_stock),
  })), [list]);

  const reportFoot = useMemo(() => (
    list.length
      ? [{
        cells: [
          { value: `Total (${totals.count} produit${totals.count > 1 ? 's' : ''})`, colSpan: 3 },
          { value: formatQty(totals.stock), align: 'right' },
          { value: '', colSpan: 4 },
        ],
      }]
      : []
  ), [list.length, totals]);

  const exportPdf = useCallback(() => {
    downloadReportPdf({
      store,
      title: 'Liste des produits',
      subtitle: 'Liste des produits et stocks BESTO SHOP',
      filters: reportFilters,
      head: PRODUCT_COLUMNS.map((c) => c.label),
      body: list.map((p) => [
        p.reference,
        p.name,
        p.category_name || '—',
        formatQty(p.total_stock),
        formatGNFForPdf(p.purchase_price),
        formatGNFForPdf(p.wholesale_price),
        formatGNFForPdf(p.retail_price),
        formatQty(p.min_stock),
      ]),
      foot: list.length
        ? [[`Total (${list.length})`, '', '', formatQty(totals.stock), '', '', '', '']]
        : [],
      rightAlignCols: [3, 4, 5, 6, 7],
      filename: 'liste-produits.pdf',
      orientation,
    });
  }, [store, reportFilters, list, totals, orientation]);

  useEffect(() => {
    api.get('/delivery-points').then((r) => {
      const points = r.data || [];
      setDeliveryPoints(points);
      if (user?.delivery_point_id) {
        setSelectedPvId(String(user.delivery_point_id));
      } else if (points[0]?.id) {
        setSelectedPvId(String(points[0].id));
      }
    }).catch(() => {});
  }, [user?.delivery_point_id]);

  useEffect(() => { loadCats(); }, []);

  useEffect(() => {
    if (canPickPv && deliveryPoints.length > 1 && !selectedPvId) return;
    load();
  }, [search, pvParams, canPickPv, deliveryPoints.length, selectedPvId]);

  const focusNameField = () => {
    window.setTimeout(() => nameInputRef.current?.focus(), 50);
  };

  useEffect(() => {
    if (showForm) focusNameField();
  }, [showForm]);

  const buildPayload = () => {
    const qty = parseNumberInput(form.initial_quantity);
    const payload = {
      name: form.name.trim(),
      category_id: form.category_id || null,
      purchase_price: parseNumberInput(form.purchase_price),
      min_stock: parseNumberInput(form.min_stock),
    };
    if (pvParams.delivery_point_id) {
      payload.delivery_point_id = pvParams.delivery_point_id;
    }
    if (editId) {
      payload.stock_quantity = qty;
    } else {
      payload.initial_quantity = qty;
    }
    return payload;
  };

  const removeProduct = async (p) => {
    const ok = await confirm({
      title: 'Désactiver le produit',
      message: `« ${p.name} » (${p.reference}) sera retiré de la liste active. Continuer ?`,
      confirmLabel: 'Désactiver',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.delete(`/products/${p.id}`);
      setMsg('Produit désactivé');
      load();
    } catch (err) {
      setMsg(err.response?.data?.message || 'Erreur');
    }
  };

  const save = async () => {
    if (!form.name.trim()) {
      setMsg('Le nom du produit est requis');
      return;
    }
    const upper = form.name.trim().toUpperCase();
    if (upper === 'SOLDE' || upper === 'SOLDE A PAYER' || upper === 'RESTE') {
      setMsg('« SOLDE » n\'est pas un nom d\'article — saisissez le nom réel (ex. Jean Femme 38)');
      return;
    }
    const ok = await confirm({
      title: editId ? 'Modifier le produit' : 'Ajouter le produit',
      message: editId
        ? `Enregistrer les modifications pour « ${form.name.trim()} » ?`
        : `Créer le produit « ${form.name.trim()} » ?`,
      confirmLabel: 'Enregistrer',
    });
    if (!ok) return;
    try {
      if (editId) {
        await api.put(`/products/${editId}`, buildPayload());
        setMsg('Produit modifié');
        closeForm();
      } else {
        await api.post('/products', buildPayload());
        setMsg('Produit ajouté');
        setForm(emptyForm);
        setEditId(null);
        focusNameField();
      }
      load();
    } catch (e) { setMsg(e.response?.data?.message || 'Erreur'); }
  };

  const addCategory = async () => {
    if (!newCat) return;
    const ok = await confirm({
      title: 'Ajouter une catégorie',
      message: `Créer la catégorie « ${newCat.trim()} » ?`,
      confirmLabel: 'Créer',
    });
    if (!ok) return;
    await api.post('/categories', { name: newCat });
    setNewCat('');
    loadCats();
  };

  const closeForm = () => {
    setShowForm(false);
    setEditId(null);
    setForm(emptyForm);
  };

  const openCreate = () => {
    closeForm();
    setShowForm(true);
  };

  const openEdit = (p) => {
    setEditId(p.id);
    setForm({
      name: p.name,
      category_id: p.category_id || '',
      purchase_price: p.purchase_price ?? '',
      min_stock: formatQty(p.min_stock),
      initial_quantity: p.total_stock != null && p.total_stock !== '' ? formatQty(p.total_stock) : '',
    });
    setShowForm(true);
  };

  return (
    <>
      {msg && <div className={`alert ${msg.includes('Erreur') || msg.includes('requis') ? 'alert-warning' : 'alert-success'}`}>{msg}</div>}
      <div className="card table-main liste-produits-page">
        <div className="table-main-toolbar bmb-print-skip">
          <h3>Liste des produits</h3>
          <div className="toolbar-actions">
            {can('produits', 'create') && <button type="button" className="btn btn-accent" onClick={openCreate}>+ Ajouter</button>}
            {can('produits', 'edit') && (
              <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
                Import Excel
                <input type="file" accept=".xlsx,.xls" hidden onChange={importExcel} />
              </label>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setOrientation(suggestPrintOrientation(PRODUCT_COLUMNS.length));
                setPreviewOpen(true);
              }}
            >
              Aperçu / Imprimer
            </button>
            <button type="button" className="btn btn-secondary" onClick={exportPdf}>Exporter PDF</button>
          </div>
        </div>

        <div className="bmb-filters-panel bmb-print-skip">
          {canPickPv && deliveryPoints.length > 1 && (
            <div className="form-group bmb-filters-panel__item">
              <label>Point de vente</label>
              <select
                className="filter-select"
                value={selectedPvId}
                onChange={(e) => setSelectedPvId(e.target.value)}
              >
                {deliveryPoints.map((dp) => (
                  <option key={dp.id} value={dp.id}>{dp.code} — {dp.name}</option>
                ))}
              </select>
            </div>
          )}
          {pvLocked && (
            <div className="form-group bmb-filters-panel__item">
              <label>Point de vente</label>
              <p className="vente-pos-setup__seller-name bmb-page-hint" style={{ margin: 0 }}>{pvDisplayLabel(user)}</p>
            </div>
          )}
          <div className="bmb-filters-panel__item" style={{ gridColumn: 'span 2' }}>
            <label>Recherche (nom, référence)</label>
            <input
              className="search-input search-input--full"
              placeholder="Rechercher un produit..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && load()}
            />
          </div>
          <div className="bmb-filters-panel__item" style={{ alignSelf: 'end' }}>
            <button type="button" className="btn btn-primary" onClick={load}>Rechercher</button>
          </div>
        </div>

        {loading ? (
          <TableSkeleton rows={8} columns={4} />
        ) : (
          <ResponsiveDataView
            className="liste-produits-data-view"
            cards={
              list.length === 0 ? (
                <EmptyState
                  icon="📦"
                  title="Aucun produit"
                  description={search.trim()
                    ? 'Aucun résultat pour cette recherche.'
                    : 'Ajoutez votre premier produit pour commencer.'}
                  action={can('produits', 'create') ? (
                    <button type="button" className="btn btn-accent" onClick={openCreate}>+ Ajouter un produit</button>
                  ) : null}
                  compact
                />
              ) : list.map((p) => (
                <DataCard
                  key={p.id}
                  title={p.name}
                  subtitle={p.reference}
                  fields={[
                    { label: 'Catégorie', value: p.category_name || '—' },
                    { label: 'Stock', value: formatQty(p.total_stock), strong: true },
                    { label: 'Détail', value: formatGNF(p.retail_price) },
                    { label: 'Gros', value: formatGNF(p.wholesale_price) },
                  ]}
                  actions={(
                    <>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEdit(p)}>Modifier</button>
                      {can('produits', 'delete') && (
                        <button type="button" className="btn btn-danger btn-sm" onClick={() => removeProduct(p)}>Supprimer</button>
                      )}
                    </>
                  )}
                />
              ))
            }
            table={(
        <div className="bmb-data-table-wrap table-scroll bmb-table-scroll-contained liste-produits-table-wrap bmb-print-skip">
          <table className="bmb-data-table table-full liste-produits-table">
            <thead>
              <tr><th>Réf.</th><th>Nom</th><th>Catégorie</th><th className="col-num">Stock</th><th className="col-num">Achat</th><th className="col-num">Gros</th><th className="col-num">Détail</th><th className="col-num">Min</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {list.length === 0 ? (
                <tr><td colSpan={9} className="table-empty">Aucun produit — cliquez sur + Ajouter</td></tr>
              ) : list.map((p) => (
                <tr key={p.id}>
                  <td>{p.reference}</td>
                  <td>{p.name}</td>
                  <td>{p.category_name}</td>
                  <td className="col-num">{formatQty(p.total_stock)}</td>
                  <td className="col-num">{formatGNF(p.purchase_price)}</td>
                  <td className="col-num">{formatGNF(p.wholesale_price)}</td>
                  <td className="col-num">{formatGNF(p.retail_price)}</td>
                  <td className="col-num">{formatQty(p.min_stock)}</td>
                  <td className="actions-cell">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEdit(p)}>Modifier</button>
                    {can('produits', 'delete') && (
                      <button type="button" className="btn btn-danger btn-sm" onClick={() => removeProduct(p)}>Supp.</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            {list.length > 0 && (
              <tfoot>
                <tr className="bmb-data-table-total-row">
                  <td colSpan={3}><strong>Total ({totals.count} produit{totals.count > 1 ? 's' : ''})</strong></td>
                  <td className="col-num"><strong>{formatQty(totals.stock)}</strong></td>
                  <td colSpan={5} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
            )}
          />
        )}
      </div>

      <PrintPreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title="Aperçu — Liste des produits"
        orientation={orientation}
        onOrientationChange={setOrientation}
        onExportPdf={exportPdf}
        printRef={printRef}
      >
        <PrintReport
          store={store}
          title="Liste des produits"
          subtitle="Catalogue articles — vêtements & chaussures"
          date={new Date()}
          filters={reportFilters}
          columns={PRODUCT_COLUMNS}
          rows={reportRows}
          footRows={reportFoot}
          emptyMessage="Aucun produit"
        />
      </PrintPreviewModal>

      <BmbFormModal
        open={showForm}
        onClose={closeForm}
        title={editId ? 'Modifier le produit' : 'Nouveau produit'}
        titleId="product-form-title"
      >
            <div className="inline-form-grid form-compact">
              <div className="form-group"><label>Nom</label><input ref={nameInputRef} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div className="form-group">
                <label>Catégorie</label>
                <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
                  <option value="">—</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Prix d&apos;achat moyen (GNF)</label>
                <input type="text" inputMode="numeric" value={form.purchase_price} onChange={(e) => setForm({ ...form, purchase_price: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Stock minimum (alerte)</label>
                <input type="text" inputMode="decimal" placeholder="ex. 10" value={form.min_stock} onChange={(e) => setForm({ ...form, min_stock: e.target.value })} />
              </div>
            </div>

            <p style={{ marginTop: '.75rem', color: 'var(--text-muted)', fontSize: '.9rem' }}>
              {editId
                ? 'Le prix d\'achat moyen se recalcule à chaque ravitaillement (Stocks). Vous pouvez aussi le corriger ici.'
                : 'Les prix de vente (gros / détail) se saisissent lors de la vente en caisse.'}
            </p>
            <div className="form-group" style={{ maxWidth: 280, marginTop: '1rem' }}>
              <label>Quantité en stock{pvLabel ? ` (${pvLabel})` : ''}</label>
              <input
                type="text"
                inputMode="decimal"
                placeholder="ex. 50"
                value={form.initial_quantity}
                onChange={(e) => setForm({ ...form, initial_quantity: e.target.value })}
              />
              <small style={{ color: 'var(--text-muted)' }}>
                {editId
                  ? 'Stock au point de vente sélectionné. Un ajustement sera enregistré si la quantité change.'
                  : 'Stock initial pour le point de vente sélectionné uniquement.'}
              </small>
            </div>

            <div className="btn-group" style={{ marginTop: '1rem' }}>
              <button type="button" className="btn btn-primary" onClick={save}>Enregistrer</button>
              <button type="button" className="btn btn-secondary" onClick={closeForm}>Annuler</button>
            </div>
            <div style={{ marginTop: '1rem', display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
              <input placeholder="Nouvelle catégorie" value={newCat} onChange={(e) => setNewCat(e.target.value)} />
              <button type="button" className="btn btn-accent btn-sm" onClick={addCategory}>+ Catégorie</button>
            </div>
      </BmbFormModal>
    </>
  );
}
