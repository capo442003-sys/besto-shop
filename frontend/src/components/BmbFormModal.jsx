import { useEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * Formulaire modal centré (portail document.body) — même rendu que l’ajout produit.
 */
export default function BmbFormModal({
  open,
  onClose,
  title,
  titleId = 'bmb-form-title',
  children,
  panelClassName = '',
  hideHeader = false,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="bmb-form-overlay bmb-print-skip"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className={`bmb-form-overlay__panel inline-form-panel${panelClassName ? ` ${panelClassName}` : ''}`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {!hideHeader && (
          <div className="inline-form-panel-header">
            <h3 id={titleId}>{title}</h3>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} aria-label="Fermer">
              ×
            </button>
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body
  );
}
