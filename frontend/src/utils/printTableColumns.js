const REF_LABEL_RE = /^(réf\.?|référence|reference)$/i;

export function isReferenceColumn(col) {
  if (!col) return false;
  if (col.key === 'reference' || col.key === 'product_reference') return true;
  return REF_LABEL_RE.test(String(col.label || '').trim());
}

export function isReferenceHeaderLabel(label) {
  return REF_LABEL_RE.test(String(label || '').trim());
}

/** Classes CSS pour cellules tableau impression (Réf., alignement). */
export function printTableCellClass(col) {
  const parts = [];
  if (col.align === 'right') parts.push('is-num');
  else if (col.align === 'center') parts.push('is-center');
  if (isReferenceColumn(col)) parts.push('is-ref');
  if (col.key === 'productName' || col.key === 'designation') parts.push('is-product');
  return parts.length ? parts.join(' ') : undefined;
}

/** Largeurs colonnes jsPDF-autotable pour en-têtes de rapport. */
export function buildReportPdfColumnStyles(head = [], rightAlignCols = []) {
  const columnStyles = {};
  rightAlignCols.forEach((i) => {
    columnStyles[i] = { ...(columnStyles[i] || {}), halign: 'right' };
  });
  head.forEach((label, i) => {
    if (isReferenceHeaderLabel(label)) {
      columnStyles[i] = {
        ...(columnStyles[i] || {}),
        cellWidth: 36,
      };
    }
  });
  return columnStyles;
}
