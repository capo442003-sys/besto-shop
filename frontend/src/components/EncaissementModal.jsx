import BmbFormModal from './BmbFormModal';
import { PAYMENT_MODES } from '../utils/format';

/**
 * Modal d’encaissement — montant, mode de paiement, récapitulatif.
 */
export default function EncaissementModal({
  open,
  onClose,
  title,
  subtitle,
  stats = [],
  amount,
  onAmountChange,
  paymentMode,
  onPaymentModeChange,
  onSubmit,
  submitLabel = 'Enregistrer l\'encaissement',
  submitDisabled = false,
  loading = false,
  hint,
  maxAmount,
  children,
  footerExtra,
}) {
  const fillMax = () => {
    if (maxAmount != null && maxAmount > 0) {
      onAmountChange(String(Math.round(maxAmount)));
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!submitDisabled && !loading) onSubmit();
  };

  return (
    <BmbFormModal
      open={open}
      onClose={onClose}
      title={title}
      titleId="encaissement-modal-title"
      panelClassName="bmb-encaisse-modal-panel"
      hideHeader
    >
      <div className="bmb-encaisse-modal">
        <header className="bmb-encaisse-modal__header">
          <div className="bmb-encaisse-modal__header-text">
            <span className="bmb-encaisse-modal__eyebrow">Encaissement</span>
            <h3 id="encaissement-modal-title" className="bmb-encaisse-modal__title">{title}</h3>
            {subtitle && <p className="bmb-encaisse-modal__subtitle">{subtitle}</p>}
          </div>
          <button
            type="button"
            className="bmb-encaisse-modal__close"
            onClick={onClose}
            aria-label="Fermer"
            disabled={loading}
          >
            ×
          </button>
        </header>

        {stats.length > 0 && (
          <div className="bmb-encaisse-modal__stats">
            {stats.map((s) => (
              <div
                key={s.label}
                className={`bmb-encaisse-modal__stat${s.variant ? ` bmb-encaisse-modal__stat--${s.variant}` : ''}`}
              >
                <span className="bmb-encaisse-modal__stat-label">{s.label}</span>
                <strong className="bmb-encaisse-modal__stat-value">{s.value}</strong>
              </div>
            ))}
          </div>
        )}

        {children}

        <form className="bmb-encaisse-modal__form" onSubmit={handleSubmit}>
          <div className="bmb-encaisse-modal__amount-block">
            <label htmlFor="encaisse-amount" className="bmb-encaisse-modal__field-label">
              Montant de ce versement
            </label>
            <div className="bmb-encaisse-modal__amount-row">
              <input
                id="encaisse-amount"
                type="text"
                inputMode="numeric"
                className="bmb-encaisse-modal__amount-input"
                placeholder={maxAmount != null && maxAmount > 0 ? String(Math.round(maxAmount)) : '0'}
                value={amount}
                disabled={loading}
                onChange={(e) => onAmountChange(e.target.value)}
                autoFocus
              />
              {maxAmount != null && maxAmount > 0 && (
                <button
                  type="button"
                  className="bmb-encaisse-modal__fill-btn"
                  onClick={fillMax}
                  disabled={loading}
                >
                  Solde total
                </button>
              )}
            </div>
          </div>

          <fieldset className="bmb-encaisse-modal__modes">
            <legend className="bmb-encaisse-modal__field-label">Mode de paiement</legend>
            <div className="bmb-encaisse-modal__mode-grid" role="radiogroup" aria-label="Mode de paiement">
              {PAYMENT_MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  role="radio"
                  aria-checked={paymentMode === m.value}
                  className={`bmb-encaisse-modal__mode-btn${paymentMode === m.value ? ' bmb-encaisse-modal__mode-btn--active' : ''}`}
                  disabled={loading}
                  onClick={() => onPaymentModeChange(m.value)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </fieldset>

          {hint && <p className="bmb-encaisse-modal__hint">{hint}</p>}

          <div className="bmb-encaisse-modal__actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={loading}>
              Annuler
            </button>
            {footerExtra}
            <button
              type="submit"
              className="btn btn-primary bmb-encaisse-modal__submit"
              disabled={submitDisabled || loading}
            >
              {loading ? 'Enregistrement…' : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </BmbFormModal>
  );
}
