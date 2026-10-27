import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import api from '../../api/client';
import SearchSelect from '../../components/SearchSelect';
import PrintDocument from '../../components/PrintDocument';
import PrintPreviewModal from '../../components/PrintPreviewModal';
import { formatGNF, formatQty, formatDate, parseNumberInput, purchaseOrderEncaissementStatus } from '../../utils/format';
import { buildPurchaseOrderDocument, downloadPurchaseOrderPdf } from '../../utils/printPdf';
import { apiErrorMessage } from '../../utils/apiError';
import AlertBanner from '../../components/AlertBanner';
import { useConfirm } from '../../context/ConfirmContext';
import { useNotify } from '../../hooks/useNotify';
import { extractApiItems } from '../../utils/calculations';
import { parseClientsListResponse } from '../../utils/clientsApi';
import { usePvFilter } from '../../context/PvFilterContext';
import PvFilterBar from '../../components/PvFilterBar';
import '../../styles/pos.css';
import '../../styles/bc.css';

const emptyLine = { product_id: '', quantity: 1, unit_price: 0 };

function clientSelectOption(c) {
  return { value: c.id, label: `${c.name} — ${c.code}`, raw: c };
}

export default function BonsCommande() {
  const [list, setList] = useState([]);
  const [store, setStore] = useState({});
  const [order, setOrder] = useState(null);
  const [selectedClient, setSelectedClient] = useState(null);
  const [selectedProductOpt, setSelectedProductOpt] = useState(null);
  const [lineForm, setLineForm] = useState(emptyLine);
  const [setupClientId, setSetupClientId] = useState('');
  const [setupNotes, setSetupNotes] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [booting, setBooting] = useState(false);
  const [awaitingOpen, setAwaitingOpen] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [previewOrder, setPreviewOrder] = useState(null);
  const [orientation, setOrientation] = useState('portrait');
  const creatingRef = useRef(false);
  const productInputRef = useRef(null);
  const printRef = useRef(null);
  const confirm = useConfirm();
  const notify = useNotify();
  const pvFilter = usePvFilter();

  const loadList = () => api.get('/purchase-orders', { params: pvFilter.queryParams })
    .then((r) => setList(Array.isArray(r.data) ? r.data : []))
    .catch((err) => notify.apiError(err, 'Impossible de charger les bons de commande'));

  useEffect(() => {
    loadList();
    api.get('/settings/store').then((r) => setStore(r.data || {})).catch(() => {});
  }, [pvFilter.queryParams]);

  const orderProductIds = useMemo(
    () => new Set((order?.lines || []).filter((l) => l.product_id).map((l) => String(l.product_id))),
    [order?.lines]
  );

  const searchClients = useCallback(async (q) => {
    const { data } = await api.get('/clients', { params: { search: q || undefined } });
    return parseClientsListResponse(data).clients.map((c) => clientSelectOption(c));
  }, []);

  const searchProducts = useCallback(async (q) => {
    const { data } = await api.get('/products', { params: { search: q || undefined } });
    return extractApiItems(data)
      .filter((p) => !orderProductIds.has(String(p.id)))
      .map((p) => ({ value: p.id, label: `${p.reference} — ${p.name}`, raw: p }));
  }, [orderProductIds]);

  const refreshOrder = async (id) => {
    const { data } = await api.get(`/purchase-orders/${id}`);
    setOrder(data);
    return data;
  };

  const openOrder = async (clientId, notes = '') => {
    if (creatingRef.current || !clientId) return null;
    const ok = await confirm({
      title: 'Ouvrir un bon de commande',
      message: 'Créer un nouveau bon de commande pour ce client ?',
      confirmLabel: 'Ouvrir le bon',
    });
    if (!ok) return null;
    creatingRef.current = true;
    setBooting(true);
    setLoading(true);
    setMessage('');
    try {
      const { data } = await api.post('/purchase-orders', { client_id: clientId, notes: notes || null });
      setOrder(data);
      setAwaitingOpen(false);
      setLineForm(emptyLine);
      setSelectedProductOpt(null);
      setShowHistory(false);
      setPreviewOrder(null);
      return data;
    } catch (e) {
      setMessage(apiErrorMessage(e, 'Impossible d\'ouvrir le bon'));
      return null;
    } finally {
      creatingRef.current = false;
      setBooting(false);
      setLoading(false);
    }
  };

  const closeSession = () => {
    setOrder(null);
    setLineForm(emptyLine);
    setSelectedProductOpt(null);
    setSelectedClient(null);
    setSetupClientId('');
    setSetupNotes('');
    setAwaitingOpen(true);
    loadList();
  };

  const onClientChange = async (id, opt) => {
    setSelectedClient(opt);
    if (!order) return;
    if ((order.lines?.length || 0) > 0) return;
    setLoading(true);
    try {
      const { data } = await api.patch(`/purchase-orders/${order.id}`, { client_id: id || null });
      setOrder(data);
    } catch (e) {
      setMessage(apiErrorMessage(e, 'Erreur client'));
    } finally {
      setLoading(false);
    }
  };

  const onProductChange = async (productId, opt) => {
    setSelectedProductOpt(opt || null);
    setLineForm((l) => ({ ...l, product_id: productId }));
    if (!productId || !order) return;
    if (orderProductIds.has(String(productId))) {
      setMessage('Produit déjà dans le bon');
      setLineForm(emptyLine);
      setSelectedProductOpt(null);
      return;
    }
    const product = opt?.raw;
    setLineForm((l) => ({
      ...l,
      product_id: productId,
      unit_price: product ? parseFloat(product.wholesale_price || product.retail_price || 0) : l.unit_price,
      quantity: l.quantity || 1,
    }));
  };

  const resetLineForm = () => {
    setLineForm(emptyLine);
    setSelectedProductOpt(null);
  };

  const addLine = async () => {
    if (!order) return;
    if (!lineForm.product_id) {
      setMessage('Choisissez un produit');
      return;
    }
    const qty = parseNumberInput(lineForm.quantity);
    const price = parseNumberInput(lineForm.unit_price);
    if (qty <= 0) { setMessage('Quantité invalide'); return; }
    if (price <= 0) { setMessage('Prix unitaire invalide'); return; }
    const product = selectedProductOpt?.raw;
    const ok = await confirm({
      title: 'Ajouter au bon',
      message: product
        ? `Ajouter ${formatQty(qty)} × « ${product.name} » au bon ${order.order_number} ?`
        : 'Ajouter cette ligne au bon de commande ?',
      confirmLabel: 'Ajouter',
    });
    if (!ok) return;
    setLoading(true);
    setMessage('');
    try {
      const { data } = await api.post(`/purchase-orders/${order.id}/lines`, {
        product_id: lineForm.product_id,
        description: product ? `${product.reference} — ${product.name}` : null,
        quantity: qty,
        unit_price: price,
      });
      setOrder(data);
      resetLineForm();
      productInputRef.current?.focus();
    } catch (e) {
      setMessage(apiErrorMessage(e, 'Erreur ajout'));
    } finally {
      setLoading(false);
    }
  };

  const removeLine = async (lineId) => {
    if (!order) return;
    const line = order.lines?.find((l) => l.id === lineId);
    const ok = await confirm({
      title: 'Retirer la ligne',
      message: line
        ? `Retirer « ${line.product_name} » du bon ${order.order_number} ?`
        : 'Retirer cette ligne du bon de commande ?',
      confirmLabel: 'Retirer',
      variant: 'danger',
    });
    if (!ok) return;
    setLoading(true);
    try {
      await api.delete(`/purchase-orders/${order.id}/lines/${lineId}`);
      const data = await refreshOrder(order.id);
      setOrder(data);
    } catch (e) {
      setMessage(apiErrorMessage(e, 'Erreur suppression'));
    } finally {
      setLoading(false);
    }
  };

  const emitOrder = async () => {
    if (!order || !(order.lines?.length > 0)) {
      setMessage('Ajoutez au moins un produit avant d\'émettre le bon');
      return;
    }
    if (!order.client_id) {
      setMessage('Sélectionnez un client');
      return;
    }
    const ok = await confirm({
      title: 'Émettre le bon',
      message: `Le bon ${order.order_number} sera enregistré. L'encaissement se fait ensuite dans Règlement BC.`,
      confirmLabel: 'Émettre',
    });
    if (!ok) return;
    setMessage(`Bon ${order.order_number} émis — encaissement dans Règlement BC`);
    closeSession();
  };

  useEffect(() => {
    const onKey = (e) => {
      if (document.querySelector('.confirm-overlay')) return;
      if (e.key === 'F2' && order && !awaitingOpen) {
        e.preventDefault();
        productInputRef.current?.focus();
      }
      if (e.key === 'F10' && order && !awaitingOpen && !loading) {
        const lines = (order?.lines?.length || 0) > 0;
        const client = Boolean(order?.client_id);
        if (lines && client) {
          e.preventDefault();
          emitOrder();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [order, awaitingOpen, loading, emitOrder]);

  const cancelOrder = async () => {
    if (!order) return;
    const ok = await confirm({
      title: 'Annuler le bon de commande',
      message: `Le bon ${order.order_number} sera annulé définitivement.`,
      confirmLabel: 'Annuler le bon',
      variant: 'danger',
    });
    if (!ok) return;
    setLoading(true);
    try {
      await api.post(`/purchase-orders/${order.id}/cancel`);
      setMessage(`Bon ${order.order_number} annulé`);
      closeSession();
    } catch (e) {
      setMessage(apiErrorMessage(e, 'Erreur annulation'));
    } finally {
      setLoading(false);
    }
  };

  const loadOrderForDoc = async (id) => {
    const { data } = await api.get(`/purchase-orders/${id}`);
    return data;
  };

  const openPreview = async (o) => {
    if (!o?.id) return;
    setLoading(true);
    setMessage('');
    try {
      const data = o.lines?.length ? o : await loadOrderForDoc(o.id);
      setPreviewOrder(data);
    } catch (e) {
      setMessage(apiErrorMessage(e, 'Impossible de charger le bon'));
    } finally {
      setLoading(false);
    }
  };

  const downloadPdfFor = async (o) => {
    if (!o?.id) return;
    setLoading(true);
    try {
      const data = o.lines?.length ? o : await loadOrderForDoc(o.id);
      await downloadPurchaseOrderPdf(data, store);
    } catch (e) {
      setMessage(apiErrorMessage(e, 'Erreur export PDF'));
    } finally {
      setLoading(false);
    }
  };

  const openExisting = async (o) => {
    if (o.status !== 'en_cours') {
      await openPreview(o);
      setShowHistory(true);
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.get(`/purchase-orders/${o.id}`);
      setOrder(data);
      setAwaitingOpen(false);
      setShowHistory(false);
      setPreviewOrder(null);
      if (data.client_id) {
        setSelectedClient({
          value: data.client_id,
          label: `${data.client_name}${data.client_code ? ` — ${data.client_code}` : ''}`,
        });
      }
    } catch (e) {
      setMessage(apiErrorMessage(e, 'Impossible d\'ouvrir le bon'));
    } finally {
      setLoading(false);
    }
  };

  const orderTotal = order ? parseFloat(order.total_amount || 0) : 0;
  const hasLines = (order?.lines?.length || 0) > 0;
  const hasClient = Boolean(order?.client_id);
  const linePreview = parseNumberInput(lineForm.unit_price) * parseNumberInput(lineForm.quantity);

  const docSource = previewOrder || (hasLines ? order : null);
  const printDoc = useMemo(
    () => (docSource?.lines?.length ? buildPurchaseOrderDocument(docSource, store) : null),
    [docSource, store]
  );

  if (booting && !order) {
    return (
      <div className="pos-page">
        <div className="vente-pos vente-pos--loading"><p>Ouverture du bon…</p></div>
      </div>
    );
  }

  if (awaitingOpen && !order) {
    return (
      <div className="bc-page">
        {message && (
          <AlertBanner message={message} onClose={() => setMessage('')} className="vente-pos-alert" />
        )}
        <div className="vente-pos-setup card">
          <h3>Nouveau bon de commande</h3>
          <p className="vente-pos-setup__hint">
            Sélectionnez un client puis ouvrez le bon — ajoutez les produits comme à la caisse.
            Le bon sera finalisé une fois encaissé dans Règlement BC.
          </p>
          <div className="vente-pos-setup__seller">
            <SearchSelect
              label="Client"
              required
              value={setupClientId}
              selectedOption={selectedClient}
              placeholder="Nom ou code client…"
              loadOptions={searchClients}
              onChange={(id, opt) => {
                setSetupClientId(id);
                setSelectedClient(opt);
              }}
            />
          </div>
          <div className="form-group" style={{ maxWidth: 300, margin: '0 auto 1rem' }}>
            <label>Notes (optionnel)</label>
            <input
              value={setupNotes}
              onChange={(e) => setSetupNotes(e.target.value)}
              placeholder="Conditions, délai…"
            />
          </div>
          <button
            type="button"
            className="vente-pos-setup__btn"
            disabled={!setupClientId || loading}
            onClick={() => openOrder(setupClientId, setupNotes)}
          >
            Ouvrir le bon
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            style={{ margin: '1rem auto 0', display: 'block' }}
            onClick={() => setShowHistory((v) => !v)}
          >
            {showHistory ? 'Masquer l\'historique' : 'Voir les bons émis'}
          </button>
        </div>
        {showHistory && (
          <div className="card table-main" style={{ maxWidth: 960, margin: '1rem auto' }}>
            <BcListTable list={list} onOpen={openExisting} onPreview={openPreview} onDownloadPdf={downloadPdfFor} />
          </div>
        )}
        <PrintPreviewModal
          open={Boolean(previewOrder && printDoc)}
          onClose={() => setPreviewOrder(null)}
          title={previewOrder ? `Bon de commande — ${previewOrder.order_number}` : 'Aperçu'}
          orientation={orientation}
          onOrientationChange={setOrientation}
          printRef={printRef}
          onExportPdf={() => previewOrder && downloadPurchaseOrderPdf(previewOrder, store)}
        >
          {printDoc && <PrintDocument {...printDoc} />}
        </PrintPreviewModal>
      </div>
    );
  }

  if (!order) return null;

  return (
    <div className="pos-page">
      {message && (
        <AlertBanner message={message} onClose={() => setMessage('')} className="vente-pos-alert" />
      )}

      <div className="vente-pos">
        <header className="vente-pos__header">
          <div className="vente-pos__header-left">
            <div className="vente-pos__badge">
              <span className="vente-pos__badge-label">Bon</span>
              <strong>{order.order_number}</strong>
            </div>
            <div className="vente-pos__meta">
              <span className="vente-pos__meta-label">Statut</span>
              <span className="vente-pos__meta-value">{purchaseOrderEncaissementStatus(order).label}</span>
            </div>
          </div>
          <div className={`vente-pos__header-mid${!hasClient ? ' vente-pos__header-mid--required' : ''}`}>
            <SearchSelect
              label="Client"
              required
              value={order.client_id ? String(order.client_id) : ''}
              selectedOption={selectedClient || (order.client_name ? { value: order.client_id, label: order.client_name } : null)}
              placeholder="Rechercher un client…"
              loadOptions={searchClients}
              onChange={onClientChange}
              disabled={loading || hasLines}
              hint={!hasClient ? 'Obligatoire pour émettre le bon' : undefined}
            />
          </div>
          <div className="vente-pos__header-right">
            <button type="button" className="vente-pos__cancel-btn" onClick={cancelOrder} disabled={loading}>
              Annuler
            </button>
          </div>
        </header>

        <div className="vente-pos__body">
          <div className="vente-pos__main">
            <section className="vente-pos__scan">
              <div className="vente-pos__scan-title"><h4>Ajouter un article</h4></div>
              <div className="vente-pos__scan-grid bc-pos-scan-grid">
                <div className="vente-pos__scan-product">
                  <SearchSelect
                    ref={productInputRef}
                    label="Produit"
                    value={lineForm.product_id}
                    selectedOption={selectedProductOpt}
                    placeholder="Nom ou référence… (F2)"
                    loadOptions={searchProducts}
                    onChange={onProductChange}
                    disabled={loading}
                  />
                </div>
                <div className="form-group vente-pos__scan-qty">
                  <label>Qté</label>
                  <input
                    type="number"
                    min="0.001"
                    step="0.001"
                    value={lineForm.quantity}
                    disabled={!lineForm.product_id}
                    onChange={(e) => setLineForm({ ...lineForm, quantity: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && lineForm.product_id) {
                        e.preventDefault();
                        addLine();
                      }
                    }}
                  />
                </div>
                <div className="form-group vente-pos__scan-rem">
                  <label>P.U. (GNF)</label>
                  <input
                    type="number"
                    min="1"
                    value={lineForm.unit_price}
                    disabled={!lineForm.product_id}
                    onChange={(e) => setLineForm({ ...lineForm, unit_price: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && lineForm.product_id) {
                        e.preventDefault();
                        addLine();
                      }
                    }}
                  />
                </div>
                <button
                  type="button"
                  className="vente-pos__scan-add"
                  onClick={addLine}
                  disabled={loading || !lineForm.product_id}
                >
                  Ajouter
                </button>
              </div>
              {lineForm.product_id && (
                <div className="vente-pos__stock">
                  Ligne : {formatGNF(linePreview)}
                </div>
              )}
            </section>

            <section className="vente-pos__lines">
              <div className="vente-pos__lines-head">
                <h4>Bon de commande</h4>
                <span className="vente-pos__lines-count">
                  {hasLines ? `${order.lines.length} article${order.lines.length > 1 ? 's' : ''}` : 'Vide'}
                </span>
              </div>
              {!hasLines ? (
                <div className="vente-pos__empty">
                  <p>Bon vide</p>
                  <span>Ajoutez des produits ci-dessus</span>
                </div>
              ) : (
                <div className="vente-pos__lines-table-wrap">
                  <table className="vente-pos__lines-table">
                    <thead>
                      <tr>
                        <th>#</th><th>Article</th><th className="col-num">Qté</th>
                        <th className="col-num">P.U.</th><th className="col-num">Total</th><th />
                      </tr>
                    </thead>
                    <tbody>
                      {order.lines.map((l, idx) => (
                        <tr key={l.id}>
                          <td className="col-num">{idx + 1}</td>
                          <td>
                            <span className="vente-pos__line-name">{l.product_name || l.description}</span>
                            {l.product_reference && <span className="vente-pos__line-ref">{l.product_reference}</span>}
                          </td>
                          <td className="col-num">{formatQty(l.quantity)}</td>
                          <td className="col-num">{formatGNF(l.unit_price)}</td>
                          <td className="col-num">{formatGNF(l.line_total)}</td>
                          <td>
                            <button type="button" className="vente-pos__line-del" onClick={() => removeLine(l.id)} disabled={loading}>×</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          <aside className="vente-pos__aside">
            <div className="vente-pos__summary">
              <p className="vente-pos__summary-label">Montant total</p>
              <p className="vente-pos__summary-total">{formatGNF(orderTotal)}</p>
              {hasLines && !hasClient && (
                <p className="vente-pos__credit-hint vente-pos__credit-hint--warn">
                  Sélectionnez un client pour émettre le bon.
                </p>
              )}
              {hasLines && (
                <p className="vente-pos__credit-hint">
                  Émettez le bon puis encaissez dans Ventes → Encaisser → Règlement BC.
                  Finalisation automatique au paiement complet.
                </p>
              )}
            </div>
            <div className="vente-pos__aside-actions">
              {hasLines && (
                <>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => openPreview(order)}
                    disabled={loading}
                  >
                    Aperçu
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => openPreview(order)}
                    disabled={loading || !hasLines}
                  >
                    Imprimer
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => downloadPurchaseOrderPdf(order, store)}
                    disabled={loading}
                  >
                    PDF
                  </button>
                </>
              )}
              <button
                type="button"
                className="vente-pos__btn-validate"
                onClick={emitOrder}
                disabled={loading || !hasLines || !hasClient}
                title="F10 — Émettre (Entrée dans la confirmation)"
              >
                Émettre le bon (F10)
              </button>
            </div>
          </aside>
        </div>
      </div>

      <PrintPreviewModal
        open={Boolean(previewOrder && printDoc)}
        onClose={() => setPreviewOrder(null)}
        title={previewOrder ? `Bon de commande — ${previewOrder.order_number}` : 'Aperçu'}
        orientation={orientation}
        onOrientationChange={setOrientation}
        printRef={printRef}
        onExportPdf={() => previewOrder && downloadPurchaseOrderPdf(previewOrder, store)}
      >
        {printDoc && <PrintDocument {...printDoc} />}
      </PrintPreviewModal>
    </div>
  );
}

function BcListTable({ list, onOpen, onPreview, onDownloadPdf }) {
  return (
    <>
      <div className="table-main-toolbar"><h3>Bons émis</h3><PvFilterBar /></div>
      <div className="bmb-data-table-wrap table-scroll">
        <table className="bmb-data-table table-full">
          <thead>
            <tr>
              <th>N° Bon</th><th>Client</th><th className="col-num">Total</th>
              <th className="col-num">Encaissé</th><th>Statut</th><th>Date</th><th />
            </tr>
          </thead>
          <tbody>
            {list.length === 0 ? (
              <tr><td colSpan={7} className="table-empty">Aucun bon</td></tr>
            ) : list.map((o) => {
              const st = purchaseOrderEncaissementStatus(o);
              return (
              <tr key={o.id}>
                <td><strong>{o.order_number}</strong></td>
                <td>{o.client_name || '—'}</td>
                <td className="col-num">{formatGNF(o.total_amount)}</td>
                <td className="col-num">{formatGNF(o.amount_paid || 0)}</td>
                <td><span className={`badge badge-${st.badge}`}>{st.label}</span></td>
                <td>{formatDate(o.finalized_at || o.created_at)}</td>
                <td className="actions-cell">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => onOpen(o)}>
                    {o.status === 'en_cours' ? 'Reprendre' : 'Voir'}
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => onPreview(o)}>Aperçu</button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => onDownloadPdf(o)}>PDF</button>
                </td>
              </tr>
            );})}
          </tbody>
        </table>
      </div>
    </>
  );
}
