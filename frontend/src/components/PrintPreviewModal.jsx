import { useRef, useMemo, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useReactToPrint } from 'react-to-print';
import { injectPrintOrientation } from '../utils/printOrientation';

/**
 * Aperçu document plein écran (modal) — factures, bons, rapports.
 * Format A4 portrait ou paysage, boutons Imprimer / PDF / Fermer.
 */
export default function PrintPreviewModal({
  open,
  onClose,
  title,
  orientation = 'portrait',
  onOrientationChange,
  allowOrientationToggle = true,
  onExportPdf,
  printRef,
  children,
  closeOnOverlayClick = false,
}) {
  const orientationRef = useRef(orientation);
  orientationRef.current = orientation;

  const runPrint = useCallback(async (printIframe) => {
    const doc = printIframe?.contentDocument;
    injectPrintOrientation(doc, orientationRef.current);
    const win = printIframe?.contentWindow;
    if (!win) return;
    win.focus();
    win.print();
  }, []);

  const printOptions = useMemo(() => ({
    content: () => printRef?.current,
    documentTitle: title || 'Document BESTO SHOP',
    print: runPrint,
  }), [printRef, title, runPrint]);

  const handlePrint = useReactToPrint(printOptions);

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  const frameClass = orientation === 'landscape'
    ? 'bmb-print-preview-frame bmb-print-preview-frame--landscape'
    : 'bmb-print-preview-frame bmb-print-preview-frame--portrait';

  const toggleOrientation = () => {
    if (!onOrientationChange) return;
    onOrientationChange(orientation === 'portrait' ? 'landscape' : 'portrait');
  };

  return createPortal(
    <div
      className="bmb-print-modal-overlay bmb-print-skip"
      role="presentation"
      onClick={closeOnOverlayClick ? (e) => { if (e.target === e.currentTarget) onClose(); } : undefined}
    >
      <div
        className="bmb-print-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="print-preview-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="bmb-print-modal__toolbar">
          <h3 id="print-preview-title">{title}</h3>
          <div className="bmb-print-modal__actions">
            {allowOrientationToggle && onOrientationChange && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={toggleOrientation}>
                {orientation === 'portrait' ? 'Format paysage' : 'Format portrait'}
              </button>
            )}
            <button type="button" className="btn btn-primary btn-sm" onClick={handlePrint}>Imprimer</button>
            {onExportPdf && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={onExportPdf}>Exporter PDF</button>
            )}
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} aria-label="Fermer">Fermer</button>
          </div>
        </header>
        <div className="bmb-print-modal__body">
          <div className={frameClass} data-orientation={orientation}>
            <div
              ref={printRef}
              className={`printable bmb-print-preview-print-target bmb-print-orientation-${orientation}`}
              data-orientation={orientation}
            >
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
