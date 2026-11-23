import { useState } from 'react';
import SearchSelect from '../../components/SearchSelect';
import AlertBanner from '../../components/AlertBanner';
import EmptyState from '../../components/ui/EmptyState';
import { formatGNF, formatQty, SALE_TYPES, PAYMENT_MODES } from '../../utils/format';

function effectiveStockDispo(info) {
  if (!info) return null;
  const v = info.effectively_available ?? info.remaining ?? info.pos_available ?? info.available;
  return v == null ? null : parseFloat(v);
}

export default function VendrePosView({
  message,
  onCloseMessage,
  cart,
  prefs,
  lineForm,
  setLineForm,
  loading,
  lineAdding = false,
  hasLines,
  hasClient,
  canValidate,
  cartTotal,
  stockInfo,
  stockLoading = false,
  linePreview,
  selectedClient,
  selectedProductOpt,
  sellerHeaderLabel,
  comptoirClient,
  productInputRef,
  quantityInputRef,
  searchClients,
  searchProducts,
  onClientChange,
  selectComptoirClient,
  onSaleTypeChange,
  onProductChange,
  addLine,
  removeLine,
  cancelCart,
  onRequestValidate,
  onPayLater,
  allowReglementToggle = true,
  showPayLater = true,
  payment,
  setPayment,
  useClientAdvance = false,
  setUseClientAdvance,
  clientAdvanceBalance = 0,
  dejaEncaisse,
  resteActuel,
  validateLabel,
  createClientFromSearch,
  onQuitCaisse,
}) {
  const nowStr = new Date().toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
  const lineCount = cart?.lines?.length || 0;
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const advanceAvailable = Math.max(0, Number(clientAdvanceBalance) || 0);
  const advanceApplied = useClientAdvance && advanceAvailable > 0.005
    ? Math.min(resteActuel, advanceAvailable)
    : 0;
  const cashDueAfterAdvance = Math.max(0, resteActuel - advanceApplied);

  const toggleMobileCart = () => {
    if (lineCount > 0) setMobileCartOpen((v) => !v);
  };

  const renderCheckout = (variant) => (
    <div className={`pos-pro__checkout pos-pro__checkout--${variant}`}>
      <div className="pos-pro__totals-stack">
        <div className="pos-pro__cart-total">
          <span className="pos-pro__cart-total-label">Total</span>
          <span className="pos-pro__total-amt">{formatGNF(cartTotal)}</span>
          {hasLines && dejaEncaisse > 0 && (
            <div className="pos-pro__total-meta">
              <span>Encaissé {formatGNF(dejaEncaisse)}</span>
              {resteActuel > 0 && <span>Reste {formatGNF(resteActuel)}</span>}
            </div>
          )}
        </div>

        {hasLines && cartTotal > 0 && (
          <div className="pos-pro__cart-total pos-pro__pay-amount-total">
            <label htmlFor={`pos-pay-amount-${variant}`} className="pos-pro__cart-total-label">
              {useClientAdvance && advanceApplied > 0.005
                ? 'Espèces / complément'
                : 'Montant à encaisser'}
            </label>
            <input
              id={`pos-pay-amount-${variant}`}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              className="pos-pro__total-amt pos-pro__pay-amount-input"
              placeholder={cashDueAfterAdvance > 0 ? String(Math.round(cashDueAfterAdvance)) : '0'}
              value={payment?.amount_paid ?? ''}
              disabled={loading}
              onChange={(e) => setPayment((p) => ({ ...p, amount_paid: e.target.value }))}
            />
            <button
              type="button"
              className="pos-pro__pay-fill-total"
              disabled={loading || cashDueAfterAdvance <= 0}
              onClick={() => setPayment((p) => ({
                ...p,
                amount_paid: cashDueAfterAdvance > 0 ? String(Math.round(cashDueAfterAdvance)) : '',
              }))}
            >
              = Total
            </button>
          </div>
        )}
      </div>

      {hasLines && cartTotal > 0 && advanceAvailable > 0.005 && (
        <label className="pos-pro__advance-use">
          <input
            type="checkbox"
            checked={useClientAdvance}
            disabled={loading}
            onChange={(e) => setUseClientAdvance?.(e.target.checked)}
          />
          <span>
            Utiliser l&apos;avance client ({formatGNF(advanceAvailable)} disponible)
          </span>
        </label>
      )}

      {hasLines && useClientAdvance && advanceApplied > 0.005 && (
        <div className="pos-pro__advance-breakdown" role="status">
          <span>Déduit de l&apos;avance : <strong>{formatGNF(advanceApplied)}</strong></span>
          <span>
            Solde avance après vente :{' '}
            <strong>{formatGNF(Math.max(0, advanceAvailable - advanceApplied))}</strong>
          </span>
          {cashDueAfterAdvance > 0.005 ? (
            <span>Complément à encaisser : <strong>{formatGNF(cashDueAfterAdvance)}</strong></span>
          ) : (
            <span>Panier entièrement couvert par l&apos;avance</span>
          )}
        </div>
      )}

      {hasLines && cartTotal > 0 && (
        <div className="pos-pro__pay-mode-row">
          <label htmlFor={`pos-pay-mode-${variant}`} className="pos-pro__cart-total-label">
            Mode de paiement
          </label>
          <select
            id={`pos-pay-mode-${variant}`}
            className="pos-pro__pay-mode-select"
            value={payment?.payment_mode || 'especes'}
            disabled={loading}
            onChange={(e) => setPayment((p) => ({ ...p, payment_mode: e.target.value }))}
          >
            {PAYMENT_MODES.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );

  const renderCheckoutActions = (variant) => (
    <div className={`pos-pro__checkout-actions pos-pro__checkout-actions--${variant}`}>
      <button
        type="button"
        className="pos-pro__validate-btn"
        onClick={onRequestValidate}
        disabled={loading || !canValidate}
      >
        {validateLabel}
      </button>
      {showPayLater && hasLines && cartTotal > 0 && (
        <button
          type="button"
          className="pos-pro__pay-later-btn"
          onClick={onPayLater}
          disabled={loading || !canValidate}
        >
          Encaisser plus tard
        </button>
      )}
    </div>
  );

  return (
    <div className={`pos-pro pos-pro--v3${mobileCartOpen ? ' pos-pro--cart-open' : ''}`}>
      {message && (
        <AlertBanner message={message} onClose={onCloseMessage} className="pos-pro__alert" />
      )}

      <header className="pos-pro__header">
        <button type="button" className="pos-pro__back" onClick={onQuitCaisse}>
          Quitter
        </button>
        <div className="pos-pro__brand">
          <strong>BESTO SHOP</strong>
          <small>Caisse</small>
        </div>
        <div className="pos-pro__meta-block pos-pro__meta-block--type">
          <label>Type de vente</label>
          <div className="pos-pro__type-toggle" role="group">
            {SALE_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                className={`pos-pro__type-btn${(cart.sale_type || prefs.sale_type) === t.value ? ' pos-pro__type-btn--active' : ''}`}
                disabled={loading || hasLines}
                onClick={() => onSaleTypeChange(t.value)}
              >
                {t.label.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <div className="pos-pro__meta-block pos-pro__meta-block--seller">
          <label>Vendeur</label>
          <strong>{sellerHeaderLabel.split(' — ')[0]}</strong>
        </div>
        <div className="pos-pro__datetime">{nowStr}</div>
        <div className="pos-pro__mobile-total" aria-hidden="true">
          {formatGNF(cartTotal)}
        </div>
      </header>

      <div className="pos-pro__workspace">
        {/* ——— Écran saisie (gauche / haut mobile) ——— */}
        <section className="pos-pro__main-col" aria-label="Saisie des articles">
          <div className="pos-pro__panel-head">
            <h2>Saisie article</h2>
            <span className="pos-pro__panel-hint">Recherche, quantité et prix</span>
          </div>

          <div className="pos-pro__entry-block">
          <div className="pos-pro__client-row">
            <SearchSelect
              className="search-select--pos-client"
              listClassName="search-select__list--pos-client"
              listMaxHeight={280}
              label="Client"
              value={cart.client_id ? String(cart.client_id) : ''}
              selectedOption={selectedClient || (cart.client_name ? { value: cart.client_id, label: cart.client_name } : null)}
              placeholder="Rechercher un client…"
              loadOptions={searchClients}
              onChange={onClientChange}
              disabled={loading}
              allowCreate={Boolean(createClientFromSearch)}
              onCreateOption={createClientFromSearch}
            />
            <div className="pos-pro__client-actions">
              {comptoirClient && (
                <button
                  type="button"
                  className={`pos-pro__client-btn pos-pro__comptoir-btn${String(cart.client_id) === String(comptoirClient.id) ? ' pos-pro__comptoir-btn--active' : ''}`}
                  onClick={selectComptoirClient}
                  disabled={loading}
                >
                  Comptoir
                </button>
              )}
              <button
                type="button"
                className="pos-pro__client-btn pos-pro__cancel-btn"
                onClick={cancelCart}
                disabled={loading}
              >
                Annuler
              </button>
            </div>
          </div>

          <div className="pos-pro__toolbar">
            <div className="pos-pro__toolbar-product">
              <SearchSelect
                ref={productInputRef}
                className="search-select--pos-product"
                listClassName="search-select__list--pos-product"
                listMaxHeight={280}
                label="Article"
                value={lineForm.product_id}
                selectedOption={selectedProductOpt}
                placeholder="Code, nom ou référence…"
                loadOptions={searchProducts}
                onChange={onProductChange}
                disabled={loading}
              />
            </div>
            <div className="pos-pro__toolbar-line">
              <div className="pos-pro__field pos-pro__field--qty">
                <label>Qté</label>
                <input
                  ref={quantityInputRef}
                  type="text"
                  inputMode="decimal"
                  value={lineForm.quantity}
                  disabled={!lineForm.product_id}
                  onChange={(e) => setLineForm({ ...lineForm, quantity: e.target.value })}
                  onFocus={(e) => e.target.select()}
                  onKeyDown={(e) => { if (e.key === 'Enter' && lineForm.product_id) { e.preventDefault(); addLine(); } }}
                />
              </div>
              <div className="pos-pro__field pos-pro__field--price">
                <label>Prix</label>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="0"
                  value={lineForm.unit_price}
                  disabled={!lineForm.product_id}
                  onChange={(e) => setLineForm({ ...lineForm, unit_price: e.target.value })}
                  onFocus={(e) => e.target.select()}
                  onKeyDown={(e) => { if (e.key === 'Enter' && lineForm.product_id) { e.preventDefault(); addLine(); } }}
                />
              </div>
              <button
                type="button"
                className="pos-pro__add-btn"
                onClick={addLine}
                disabled={loading || lineAdding || !lineForm.product_id}
              >
                {lineAdding ? 'AJOUT…' : 'AJOUTER'}
              </button>
            </div>
          </div>
          </div>

          {lineForm.product_id && (
            <p
              className={`pos-pro__stock-line${
                stockInfo && (stockInfo.reserved_others > 0.005 || effectiveStockDispo(stockInfo) < parseFloat(stockInfo.available ?? stockInfo.total_stock ?? 0) - 0.005)
                  ? ' pos-pro__stock-line--reserved'
                  : ''
              }`}
              aria-live="polite"
            >
              {stockLoading
                ? 'Stock : chargement…'
                : stockInfo
                  ? (() => {
                    const dispo = effectiveStockDispo(stockInfo) ?? 0;
                    const magasin = parseFloat(stockInfo.available ?? stockInfo.total_stock ?? dispo);
                    const reserved = parseFloat(stockInfo.reserved_others || 0);
                    const reservedNote = reserved > 0.005
                      ? ` — ${formatQty(magasin)} en magasin, ${formatQty(reserved)} réservé(s) dans d'autres paniers ouverts`
                      : '';
                    return `Stock disponible caisse : ${formatQty(dispo)}${reservedNote}${stockInfo.in_cart > 0 ? ` · dont ${formatQty(stockInfo.in_cart)} dans le panier` : ''} · Ligne : ${formatGNF(linePreview)}`;
                  })()
                  : `Stock : — · Ligne : ${formatGNF(linePreview)}`}
            </p>
          )}

          {!hasClient && hasLines && (
            <p className="pos-pro__warn">
              Sélectionnez un client pour valider la vente.
            </p>
          )}

          <div className="pos-pro__select-hint pos-pro__select-hint--legacy">
            {renderCheckout('main')}
            {renderCheckoutActions('main')}
          </div>
        </section>

        {/* ——— Écran panier (droite / bas mobile) ——— */}
        <aside className="pos-pro__cart-panel" aria-label="Contenu du panier">
          <div className="pos-pro__cart-head">
            <span>Panier {cart.cart_number ? `— ${cart.cart_number}` : ''}</span>
            <span className="pos-pro__cart-badge">{lineCount} article{lineCount > 1 ? 's' : ''}</span>
          </div>

          <div className="pos-pro__body pos-pro__body--cart">
            {!hasLines ? (
              <EmptyState
                icon="🛒"
                title="Panier vide"
                description="Recherchez un article et cliquez sur Ajouter."
                compact
                className="pos-pro__cart-empty"
              />
            ) : (
              <ul className="pos-cart-list">
                {cart.lines.map((l, idx) => (
                  <li key={l.id} className="pos-cart-line">
                    <span className="pos-cart-line__idx" aria-hidden="true">{idx + 1}</span>
                    <div className="pos-cart-line__info">
                      <span className="pos-cart-line__name" title={l.product_name}>{l.product_name}</span>
                      <span className="pos-cart-line__meta">
                        {formatQty(l.quantity)} × {formatGNF(l.unit_price)}
                      </span>
                    </div>
                    <span className="pos-cart-line__total">{formatGNF(l.line_total)}</span>
                    <button
                      type="button"
                      className="pos-cart-line__del"
                      onClick={() => removeLine(l.id)}
                      disabled={loading}
                      aria-label={`Retirer ${l.product_name}`}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="pos-cart-foot pos-cart-foot--legacy">
            {renderCheckout('cart')}
            {renderCheckoutActions('cart')}
          </div>
        </aside>

        <aside className="pos-pro__pay-panel" aria-label="Encaissement">
          <div className="pos-pro__pay-panel-head">
            <h2>Encaissement</h2>
            <span className="pos-pro__cart-badge">{lineCount} art.</span>
          </div>
          <div className="pos-pro__pay-panel-body">
            {renderCheckout('pay')}
          </div>
          <div className="pos-pro__pay-panel-foot">
            {renderCheckoutActions('pay')}
          </div>
        </aside>
      </div>

      <div className="pos-pro__mobile-bar" aria-label="Raccourci validation">
        <button
          type="button"
          className="pos-pro__mobile-bar-info"
          onClick={toggleMobileCart}
          disabled={!lineCount}
          aria-expanded={mobileCartOpen}
          aria-label={mobileCartOpen ? 'Masquer le panier' : 'Afficher le panier'}
        >
          <span>{lineCount} article{lineCount > 1 ? 's' : ''}{lineCount > 0 ? (mobileCartOpen ? ' ▼' : ' ▲') : ''}</span>
          <strong>{formatGNF(cartTotal)}</strong>
        </button>
        <button
          type="button"
          className="pos-pro__mobile-bar-btn"
          onClick={onRequestValidate}
          disabled={loading || !canValidate}
        >
          {hasLines ? 'Valider' : 'Panier vide'}
        </button>
      </div>
    </div>
  );
}
