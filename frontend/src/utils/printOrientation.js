/** Orientation A4 recommandée selon le nombre de colonnes. */
export function suggestPrintOrientation(columnCount = 0) {
  return columnCount >= 6 ? 'landscape' : 'portrait';
}

/**
 * Styles @page injectés en dernier dans l'iframe d'impression
 * (react-to-print charge les CSS globaux après pageStyle — il faut réécrire l'orientation).
 */
export function getPrintPageStyle(orientation = 'portrait') {
  const landscape = orientation === 'landscape';
  if (landscape) {
    return `
      @page {
        size: 297mm 210mm;
        margin: 12mm;
      }
      @media print {
        @page {
          size: 297mm 210mm;
          margin: 12mm;
        }
        html, body {
          width: 297mm !important;
          margin: 0 !important;
          padding: 0 !important;
        }
        .printable,
        .bmb-print-doc {
          width: 100% !important;
          max-width: none !important;
        }
        .bmb-inv__table--report {
          font-size: 0.58rem;
        }
        .bmb-inv__table--report th,
        .bmb-inv__table--report td {
          padding: 0.15rem 0.2rem;
        }
      }
    `;
  }
  return `
    @page {
      size: 210mm 297mm;
      margin: 20mm;
    }
    @media print {
      @page {
        size: 210mm 297mm;
        margin: 20mm;
      }
    }
  `;
}

export function injectPrintOrientation(doc, orientation = 'portrait') {
  if (!doc?.head) return;
  doc.getElementById('bmb-print-orientation-override')?.remove();
  const style = doc.createElement('style');
  style.id = 'bmb-print-orientation-override';
  style.textContent = getPrintPageStyle(orientation);
  doc.head.appendChild(style);
  const bodyClass = orientation === 'landscape' ? 'bmb-print-body-landscape' : 'bmb-print-body-portrait';
  doc.body?.classList.remove('bmb-print-body-landscape', 'bmb-print-body-portrait');
  doc.body?.classList.add(bodyClass);
}

export function orientationLabel(orientation) {
  return orientation === 'landscape' ? 'Paysage' : 'Portrait';
}
