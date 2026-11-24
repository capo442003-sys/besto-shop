import { useEffect, useRef, useState } from 'react';
import SearchSelect from '../../components/SearchSelect';
import AlertBanner from '../../components/AlertBanner';
import Etoffe from '../../components/ui/Etoffe';
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

  const saleType = cart.sale_type || prefs.sale_type || 'detail';
  const rawProduct = selectedProductOpt?.raw || null;
  const catalogPrice = rawProduct
    ? Number(saleType === 'gros' ? rawProduct.wholesale_price : rawProduct.retail_price) || 0
    : 0;
  const typedPrice = Number(String(lineForm.unit_price ?? '').replace(/[^\d.]/g, '')) || 0;
  const priceChanged = Boolean(lineForm.product_id && catalogPrice > 0 && typedPrice > 0 && Math.round(typedPrice) !== Math.round(catalogPrice));

  const amountTyped = Number(String(payment?.amount_paid ?? '').replace(/[^\d.]/g, '')) || 0;
  let payStatus = null;
  if (hasLines && cartTotal > 0) {
    if (advanceApplied > 0.005 && amountTyped <= 0.005 && cashDueAfterAdvance <= 0.005) {
      payStatus = { tone: 'ok', text: 'Panier entièrement couvert par l’avance client.' };
    } else if (amountTyped <= 0.005 && advanceApplied <= 0.005) {
      payStatus = {
        tone: 'info',
        text: showPayLater
          ? 'Saisissez le montant reçu, cochez l’avance ou choisissez « Encaisser plus tard ».'
          : 'Saisissez le montant reçu ou cochez l’avance client.',
      };
    } else if (amountTyped > cashDueAfterAdvance + 1) {
      payStatus = { tone: 'warn', text: `Montant trop élevé — reste ${formatGNF(cashDueAfterAdvance)}.` };
    } else if (amountTyped < cashDueAfterAdvance - 0.5) {
      payStatus = { tone: 'warn', text: `Encaissement partiel : reste ${formatGNF(cashDueAfterAdvance - amountTyped)} à régler par la caisse.` };
    } else {
      payStatus = { tone: 'ok', text: 'Paiement complet.' };
    }
  }

  // Petit effet visuel quand le total change
  const [bump, setBump] = useState(false);
  const prevTotal = useRef(cartTotal);
  useEffect(() => {
    if (prevTotal.current !== cartTotal) {
      prevTotal.current = cartTotal;
      setBump(true);
      const t = setTimeout(() => setBump(false), 450);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [cartTotal]);

  const stockText = (() => {
    if (!lineForm.product_id) return null;
    if (stockLoading) return { tag: 'Stock : chargement…', note: '' };
    if (!stockInfo) return { tag: 'Stock : —', note: '' };
    const dispo = effectiveStockDispo(stockInfo) ?? 0;
    const magasin = parseFloat(stockInfo.available ?? stockInfo.total_stock ?? dispo);
    const reserved = parseFloat(stockInfo.reserved_others || 0);
    const notes = [];
    if (reserved > 0.005) notes.push(`${formatQty(magasin)} en magasin, ${formatQty(reserved)} réservé(s) dans d'autres paniers ouverts`);
    if (stockInfo.in_cart > 0) notes.push(`dont ${formatQty(stockInfo.in_cart)} dans le panier`);
    return { tag: `Stock disponible caisse : ${formatQty(dispo)}`, note: notes.join(' · '), low: dispo <= 5, reserved: reserved > 0.005 };
  })();

  return (
    <div className={`pos-pro pos-pro--maison${mobileCartOpen ? ' pos-pro--cart-open' : ''}`}>
      {message && (
        <AlertBanner message={message} onClose={onCloseMessage} className="pos-pro__alert" />
      )}

      <header className="pos-pro__header">
        <button type="button" className="pos-pro__back" onClick={onQuitCaisse}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="m15 18-6-6 6-6" /></svg>
          Quitter
        </button>
        <div className="pos-pro__brand">
          <strong>Caisse</strong>
          <small>{cart.cart_number ? `Panier ${cart.cart_number}` : 'BESTO SHOP'}</small>
        </div>
        <div className="pos-pro__meta-block pos-pro__meta-block--type">
          <label>Type de vente</label>
          <div className="pos-pro__type-toggle" role="group" aria-label="Type de vente">
            {SALE_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                className={`pos-pro__type-btn${saleType === t.value ? ' pos-pro__type-btn--active' : ''}`}
                disabled={loading || hasLines}
                onClick={() => onSaleTypeChange(t.value)}
                title={hasLines ? 'Verrouillé : le panier contient des articles' : undefined}
              >
                {t.value === 'gros' ? 'GROS' : 'DÉTAIL'}
              </button>
            ))}
          </div>
          {hasLines && <span className="pos-pro__type-lock">Verrouillé tant que le panier contient des articles</span>}
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
        <section className="pos-pro__main-col" aria-label="Saisie des articles">
          <div className="pos-pro__card pos-pro__client-row">
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
              {advanceAvailable > 0.005 && (
                <span className="pos-pro__advance-chip">Avance {formatGNF(advanceAvailable)}</span>
              )}
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
                Annuler le panier
              </button>
            </div>
          </div>

          <div className="pos-pro__card pos-pro__entry-block">
            <div className="pos-pro__toolbar">
              <div className="pos-pro__toolbar-product">
                {rawProduct && (
                  <Etoffe
                    className="pos-pro__entry-swatch"
                    category={rawProduct.category_name}
                    name={rawProduct.name}
                    photo={rawProduct.image_url}
                    mini
                  />
                )}
                <SearchSelect
                  ref={productInputRef}
                  className="search-select--pos-product"
                  listClassName="search-select__list--pos-product"
                  listMaxHeight={320}
                  label="Article"
                  value={lineForm.product_id}
                  selectedOption={selectedProductOpt}
                  placeholder="Code, nom ou référence…"
                  loadOptions={searchProducts}
                  onChange={onProductChange}
                  disabled={loading}
                />
              </div>
              <div className="pos-pro__field pos-pro__field--qty">
                <label htmlFor="pos-qty">Qté</label>
                <input
                  id="pos-qty"
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
              <div className={`pos-pro__field pos-pro__field--price${priceChanged ? ' pos-pro__field--changed' : ''}`}>
                <label htmlFor="pos-price">
                  Prix unitaire
                  {priceChanged && (
                    <button
                      type="button"
                      className="pos-pro__price-reset"
                      onClick={() => setLineForm({ ...lineForm, unit_price: String(catalogPrice) })}
                    >
                      Rétablir
                    </button>
                  )}
                </label>
                <input
                  id="pos-price"
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

            {stockText && (
              <div className="pos-pro__stock-line" aria-live="polite">
                <span className={`pos-pro__stock-tag${stockText.low ? ' pos-pro__stock-tag--low' : ''}`}>{stockText.tag}</span>
                {stockText.note && <span className="pos-pro__stock-note">{stockText.note}</span>}
                {priceChanged && (
                  <span className="pos-pro__price-note">Prix modifié (catalogue {formatGNF(catalogPrice)})</span>
                )}
                <strong className="pos-pro__line-preview">Ligne : {formatGNF(linePreview)}</strong>
              </div>
            )}
          </div>

          {!hasClient && hasLines && (
            <p className="pos-pro__warn">Sélectionnez un client pour valider la vente.</p>
          )}

          <div className="pos-pro__card pos-pro__cart-panel" aria-label="Contenu du panier">
            <div className="pos-pro__cart-head">
              <h2>Panier {cart.cart_number ? <span>— {cart.cart_number}</span> : null}</h2>
              <span className="pos-pro__cart-badge">{lineCount} article{lineCount > 1 ? 's' : ''}</span>
            </div>
            <div className="pos-pro__body pos-pro__body--cart">
              {!hasLines ? (
                <div className="pos-pro__cart-empty">
                  <Etoffe category="sac" name="panier" />
                  <p>Panier vide.<br />Recherchez un article, ajustez la quantité ou le prix, puis touchez « Ajouter ».</p>
                </div>
              ) : (
                <ul className="pos-cart-list">
                  {cart.lines.map((l, idx) => (
                    <li key={l.id} className="pos-cart-line">
                      <span className="pos-cart-line__idx" aria-hidden="true">{idx + 1}</span>
                      <Etoffe
                        className="pos-cart-line__swatch"
                        category={l.category_name}
                        name={l.product_name}
                        photo={l.image_url}
                        mini
                      />
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
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>

        <aside className="pos-pro__pay-panel" aria-label="Encaissement">
          <div className="pos-pro__cart-total">
            <span className="pos-pro__cart-total-label">
              Total · {saleType === 'gros' ? 'vente en gros' : 'vente en détail'}
            </span>
            <span className={`pos-pro__total-amt${bump ? ' is-bump' : ''}`}>{formatGNF(cartTotal)}</span>
            {hasLines && dejaEncaisse > 0 && (
              <div className="pos-pro__total-meta">
                <span>Encaissé <strong>{formatGNF(dejaEncaisse)}</strong></span>
                {resteActuel > 0 && <span className="is-due">Reste <strong>{formatGNF(resteActuel)}</strong></span>}
              </div>
            )}
          </div>

          {hasLines && cartTotal > 0 && advanceAvailable > 0.005 && (
            <div className="pos-pro__advance">
              <label className="pos-pro__advance-use">
                <input
                  type="checkbox"
                  checked={useClientAdvance}
                  disabled={loading}
                  onChange={(e) => setUseClientAdvance?.(e.target.checked)}
                />
                <span>Utiliser l&apos;avance client ({formatGNF(advanceAvailable)} disponible)</span>
              </label>
              {useClientAdvance && advanceApplied > 0.005 && (
                <div className="pos-pro__advance-breakdown" role="status">
                  <span>Déduit de l&apos;avance : <strong>{formatGNF(advanceApplied)}</strong></span>
                  <span>Solde avance après vente : <strong>{formatGNF(Math.max(0, advanceAvailable - advanceApplied))}</strong></span>
                  {cashDueAfterAdvance > 0.005 ? (
                    <span>Complément à encaisser : <strong>{formatGNF(cashDueAfterAdvance)}</strong></span>
                  ) : (
                    <span>Panier entièrement couvert par l&apos;avance</span>
                  )}
                </div>
              )}
            </div>
          )}

          {hasLines && cartTotal > 0 && (
            <div className="pos-pro__pay-amount">
              <label htmlFor="pos-pay-amount" className="pos-pro__pay-label">
                {useClientAdvance && advanceApplied > 0.005 ? 'Espèces / complément' : 'Montant à encaisser'}
              </label>
              <input
                id="pos-pay-amount"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                className="pos-pro__pay-amount-input"
                placeholder={cashDueAfterAdvance > 0 ? String(Math.round(cashDueAfterAdvance)) : '0'}
                value={payment?.amount_paid ?? ''}
                disabled={loading}
                onChange={(e) => setPayment((p) => ({ ...p, amount_paid: e.target.value }))}
                onFocus={(e) => e.target.select()}
              />
              <span className="pos-pro__pay-hint">Rempli automatiquement avec le total · modifiable pour un paiement partiel</span>
            </div>
          )}

          {hasLines && cartTotal > 0 && (
            <div className="pos-pro__pay-modes">
              <span className="pos-pro__pay-label">Mode de paiement</span>
              <div className="pos-pro__mode-grid" role="radiogroup" aria-label="Mode de paiement">
                {PAYMENT_MODES.map((m) => {
                  const active = (payment?.payment_mode || 'especes') === m.value;
                  return (
                    <button
                      key={m.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      className={`pos-pro__mode-btn${active ? ' pos-pro__mode-btn--active' : ''}`}
                      disabled={loading}
                      onClick={() => setPayment((p) => ({ ...p, payment_mode: m.value }))}
                    >
                      {m.value === 'paiement_mobile' ? 'Mobile' : m.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {payStatus && (
            <p className={`pos-pro__pay-status pos-pro__pay-status--${payStatus.tone}`} role="status">{payStatus.text}</p>
          )}

          {!hasLines && (
            <div className="pos-pro__pay-empty">
              <p>Ajoutez un article pour encaisser.</p>
            </div>
          )}

          <div className="pos-pro__checkout-actions">
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
          <span>{lineCount} article{lineCount > 1 ? 's' : ''}</span>
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
