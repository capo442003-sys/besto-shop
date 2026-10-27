import {
  formatGNFForPdf,
  formatDateForPdf,
  pdfText,
} from './format';
import { formatStoreActivityLine, formatStorePhonesSlash } from './storeFormat';
import { generateQrDataUrl } from './qrCode';

export const PDF = {
  margin: 18,
  pageWidth: 210,
  pageHeight: 297,
  get contentWidth() {
    return this.pageWidth - this.margin * 2;
  },
  /* Logo BESTO — forêt + or */
  primary: [10, 51, 41],
  primaryDark: [5, 28, 23],
  accent: [198, 160, 53],
  accentText: [7, 17, 14],
  primarySoft: [243, 242, 239],
  tableStripe: [250, 249, 246],
  text: [20, 26, 23],
  muted: [92, 101, 96],
  border: [226, 223, 216],
  borderDark: [200, 196, 188],
  white: [255, 255, 255],
};

const INVOICE_TABLE_COLUMN_STYLES = {
  0: { cellWidth: 8, halign: 'center' },
  1: { cellWidth: 36 },
  2: { cellWidth: 'auto' },
  3: { cellWidth: 22, halign: 'right' },
  4: { cellWidth: 12, halign: 'right' },
  5: { cellWidth: 18, halign: 'right' },
  6: { cellWidth: 22, halign: 'right' },
};

const TABLE_THEME = {
  headStyles: {
    fillColor: PDF.primary,
    textColor: PDF.white,
    fontStyle: 'bold',
    fontSize: 6.5,
    cellPadding: { top: 2, right: 1.5, bottom: 2, left: 1.5 },
  },
  bodyStyles: {
    fontSize: 7.5,
    cellPadding: { top: 2, right: 2, bottom: 2, left: 2 },
    textColor: PDF.text,
    lineColor: PDF.border,
    lineWidth: 0.15,
  },
  alternateRowStyles: {
    fillColor: PDF.tableStripe,
  },
  styles: {
    lineColor: PDF.border,
    lineWidth: 0.15,
  },
  margin: { left: PDF.margin, right: PDF.margin },
};

export function getPdfLayout(doc) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = PDF.margin;
  return {
    pageWidth,
    pageHeight,
    margin,
    contentWidth: pageWidth - margin * 2,
  };
}

export function normalizeStore(store = {}) {
  return {
    store_name: store.store_name || store.storeName || 'BESTO SHOP',
    address: store.address || store.store_address || '',
    phone: store.phone || store.store_phone || '',
    phone_2: store.phone_2 || store.store_phone_2 || '',
    phone_3: store.phone_3 || store.store_phone_3 || '',
    email: store.email || store.store_email || '',
    logo_url: store.logo_url || null,
    updated_at: store.updated_at || null,
  };
}

function drawFilledRect(doc, x, y, w, h, color) {
  doc.setFillColor(...color);
  doc.rect(x, y, w, h, 'F');
}

function drawInfoCard(doc, x, y, w, label, value) {
  doc.setFillColor(...PDF.primarySoft);
  doc.setDrawColor(...PDF.border);
  doc.setLineWidth(0.2);
  doc.rect(x, y, w, 11, 'FD');
  doc.setFillColor(...PDF.primary);
  doc.rect(x, y, 1.2, 11, 'F');
  doc.setFont(undefined, 'normal');
  doc.setFontSize(6);
  doc.setTextColor(...PDF.muted);
  doc.text(pdfText(label.toUpperCase()), x + 2.5, y + 3.5);
  doc.setFont(undefined, 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...PDF.text);
  doc.text(pdfText(value), x + 2.5, y + 8, { maxWidth: w - 4 });
}

export async function drawPdfInvoice(doc, spec, store, logo) {
  const s = normalizeStore(store);
  const x0 = PDF.margin;
  const w = PDF.contentWidth;
  const pad = 5;
  let y = PDF.margin;

  /* ── En-tête BMB (bandeau vert + filet or) ── */
  const headerH = 24;
  drawFilledRect(doc, x0, y, w, headerH, PDF.primary);
  drawFilledRect(doc, x0, y + headerH - 2.2, w, 2.2, PDF.accent);

  const logoSize = logo?.sizeMm || 14;
  if (logo?.dataUrl) {
    doc.addImage(logo.dataUrl, logo.format || 'PNG', x0 + pad, y + (headerH - logoSize - 2) / 2, logoSize, logoSize);
  }

  const brandX = x0 + pad + (logo?.dataUrl ? logoSize + 4 : 0);
  doc.setTextColor(...PDF.white);
  doc.setFont(undefined, 'bold');
  doc.setFontSize(12);
  doc.text(pdfText(s.store_name), brandX, y + 9);
  const tagline = formatStoreActivityLine(s);
  if (tagline) {
    doc.setFont(undefined, 'normal');
    doc.setFontSize(6.5);
    doc.text(pdfText(tagline), brandX, y + 14.5, { maxWidth: 88 });
  }

  const badgeLabel = pdfText((spec.title || 'FACTURE').toUpperCase());
  doc.setFontSize(7);
  const badgeW = Math.max(doc.getTextWidth(badgeLabel) + 10, 28);
  const badgeX = x0 + w - pad - badgeW;
  drawFilledRect(doc, badgeX, y + 5, badgeW, 8, PDF.accent);
  doc.setTextColor(...PDF.accentText);
  doc.setFont(undefined, 'bold');
  doc.text(badgeLabel, badgeX + badgeW / 2, y + 10.4, { align: 'center' });
  doc.setFont(undefined, 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(255, 255, 255);
  doc.text(pdfText(spec.printedAt || formatDateForPdf(new Date())), x0 + w - pad, y + 18.5, { align: 'right' });

  y += headerH + 5;
  doc.setTextColor(...PDF.text);

  /* ── Cartes référence ── */
  const cardW = 38;
  const cardGap = 3;
  let cardX = x0 + pad;
  if (spec.invoiceNumber) {
    drawInfoCard(doc, cardX, y, cardW, 'N° Facture', spec.invoiceNumber);
    cardX += cardW + cardGap;
  }
  if (spec.invoiceDate) {
    drawInfoCard(doc, cardX, y, cardW, 'Date de facturation', spec.invoiceDate);
    cardX += cardW + cardGap;
  }
  if (spec.sellerName) {
    drawInfoCard(doc, cardX, y, cardW, 'Vendeur', spec.sellerName);
  }

  const qrUrl = await generateQrDataUrl(spec.qrValue || spec.invoiceNumber, 64);
  if (qrUrl) {
    doc.addImage(qrUrl, 'PNG', x0 + w - pad - 16, y - 1, 16, 16);
  }

  y += 14;

  /* ── Émetteur / Client ── */
  const partyW = (w - pad * 2 - 4) / 2;
  const partyH = 26;
  const partyY = y;

  [0, 1].forEach((i) => {
    const px = x0 + pad + i * (partyW + 4);
    doc.setFillColor(...(i === 0 ? PDF.primarySoft : PDF.white));
    doc.setDrawColor(...PDF.border);
    doc.rect(px, partyY, partyW, partyH, 'FD');
    doc.setFont(undefined, 'bold');
    doc.setFontSize(6);
    doc.setTextColor(...PDF.primary);
    doc.text(i === 0 ? 'EMETTEUR' : 'FACTURE A', px + 3, partyY + 4);
    doc.setDrawColor(...PDF.border);
    doc.line(px + 3, partyY + 5.5, px + partyW - 3, partyY + 5.5);
  });

  doc.setFont(undefined, 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...PDF.text);
  doc.text(pdfText(s.store_name), x0 + pad + 3, partyY + 10);
  doc.setFont(undefined, 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(...PDF.muted);
  let sy = partyY + 13.5;
  [s.address, formatStorePhonesSlash(s), s.email].filter(Boolean).forEach((line) => {
    doc.text(pdfText(line), x0 + pad + 3, sy, { maxWidth: partyW - 6 });
    sy += 3.2;
  });

  const clientX = x0 + pad + partyW + 4;
  if (spec.clientName) {
    doc.setFont(undefined, 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...PDF.text);
    doc.text(pdfText(spec.clientName), clientX + 3, partyY + 10);
    doc.setFont(undefined, 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...PDF.muted);
    let cy = partyY + 13.5;
    const clientLines = [
      spec.clientCode && `Code : ${spec.clientCode}`,
      spec.clientType && `Type : ${spec.clientType}`,
      `Tel. : ${spec.clientPhone?.trim() || 'Non renseigne'}`,
      `Adresse : ${spec.clientAddress?.trim() || 'Non renseignee'}`,
    ].filter(Boolean);
    clientLines.forEach((line) => {
      doc.text(pdfText(line), clientX + 3, cy, { maxWidth: partyW - 6 });
      cy += 3.2;
    });
  }

  y = partyY + partyH + 5;

  /* ── Encaissement (reçu) ── */
  if (spec.highlight) {
    doc.setFillColor(236, 253, 245);
    doc.setDrawColor(134, 239, 172);
    doc.setLineWidth(0.25);
    doc.rect(x0 + pad, y, w - pad * 2, 11, 'FD');
    doc.setFillColor(...PDF.primary);
    doc.rect(x0 + pad, y, 1.5, 11, 'F');
    doc.setFont(undefined, 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...PDF.muted);
    doc.text(pdfText(spec.highlight.label.toUpperCase()), x0 + pad + 4, y + 4);
    doc.setFont(undefined, 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...PDF.primaryDark);
    doc.text(pdfText(spec.highlight.value), x0 + pad + 4, y + 9);
    if (spec.highlight.detail) {
      doc.setFont(undefined, 'normal');
      doc.setFontSize(7);
      doc.setTextColor(...PDF.muted);
      doc.text(pdfText(spec.highlight.detail), x0 + w - pad, y + 7.5, { align: 'right' });
    }
    y += 13;
  }

  /* ── Tableau articles ── */
  if (spec.tableBody?.length) {
    doc.autoTable({
      startY: y,
      head: [spec.tableHead.map((c) => pdfText(c))],
      body: spec.tableBody.map((row) => row.map((c) => pdfText(c))),
      ...TABLE_THEME,
      tableWidth: w - pad * 2,
      margin: { left: x0 + pad, right: x0 + pad },
      columnStyles: INVOICE_TABLE_COLUMN_STYLES,
    });
    y = doc.lastAutoTable.finalY + 4;
  }

  /* ── Versements + totaux ── */
  const totalsW = 58;
  const totalsX = x0 + w - pad - totalsW;

  if (spec.listItems?.length) {
    doc.setFont(undefined, 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(...PDF.primary);
    doc.text(pdfText((spec.listTitle || 'Versements enregistres').toUpperCase()), x0 + pad, y + 3);
    const listW = totalsX - x0 - pad * 2 - 4;
    let ly = y + 5;
    spec.listItems.forEach((line, idx) => {
      if (idx % 2 === 0) doc.setFillColor(...PDF.primarySoft);
      else doc.setFillColor(...PDF.white);
      doc.rect(x0 + pad, ly, listW, 5, 'F');
      doc.setDrawColor(...PDF.border);
      doc.line(x0 + pad, ly + 5, x0 + pad + listW, ly + 5);
      doc.setFont(undefined, 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(...PDF.text);
      doc.text(pdfText(line), x0 + pad + 2, ly + 3.5, { maxWidth: listW - 4 });
      ly += 5;
    });
    y = Math.max(y, ly + 2);
  }

  if (spec.totals?.length) {
    let ty = y;
    spec.totals.forEach((row, idx) => {
      const isDue = idx === spec.totals.length - 1;
      const rowH = isDue ? 7 : 6;
      if (isDue) {
        drawFilledRect(doc, totalsX, ty, totalsW, rowH, PDF.primary);
        doc.setTextColor(...PDF.white);
      } else {
        doc.setFillColor(...PDF.white);
        doc.setDrawColor(...PDF.border);
        doc.rect(totalsX, ty, totalsW, rowH, 'FD');
        doc.setTextColor(...PDF.muted);
      }
      doc.setFont(undefined, isDue ? 'bold' : 'normal');
      doc.setFontSize(isDue ? 8 : 7);
      doc.text(pdfText(row.label), totalsX + 2, ty + (isDue ? 4.5 : 4));
      doc.setFont(undefined, 'bold');
      doc.setTextColor(...(isDue ? PDF.white : PDF.text));
      doc.text(pdfText(row.value), totalsX + totalsW - 2, ty + (isDue ? 4.8 : 4), { align: 'right' });
      ty += rowH;
    });
    y = Math.max(y, ty + 4);
  }

  /* ── Signatures ── */
  const signY = Math.max(y + 12, PDF.pageHeight - PDF.margin - 22);
  doc.setDrawColor(...PDF.borderDark);
  doc.setLineWidth(0.3);
  doc.line(x0 + pad + 8, signY, x0 + pad + 55, signY);
  doc.line(x0 + w - pad - 55, signY, x0 + w - pad - 8, signY);
  doc.setFont(undefined, 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...PDF.muted);
  doc.text('Le Client', x0 + pad + 31.5, signY + 4, { align: 'center' });
  doc.text('Le Vendeur / La Direction', x0 + w - pad - 31.5, signY + 4, { align: 'center' });

  if (spec.footer?.length) {
    doc.setFont(undefined, 'italic');
    doc.setFontSize(6);
    doc.setTextColor(...PDF.muted);
    doc.text(pdfText(spec.footer.join(' — ')), x0 + w / 2, signY + 10, { align: 'center' });
  }

  doc.setTextColor(...PDF.text);
}

function filterRows(rows) {
  return (rows || []).filter((r) => r.value != null && r.value !== '' && r.value !== '-');
}

function pairMetaRows(left, right) {
  const l = filterRows(left);
  const r = filterRows(right);
  const n = Math.max(l.length, r.length);
  return Array.from({ length: n }, (_, i) => ({
    left: l[i],
    right: r[i],
  }));
}

/** En-tête rapports (listes, inventaires) — aligné sur la facture */
export function drawPdfHeader(doc, { store, title, reference, subtitle, date, logo }) {
  const s = normalizeStore(store);
  const { pageWidth, margin, contentWidth } = getPdfLayout(doc);
  const x0 = margin;
  const w = contentWidth;
  const pad = 5;
  const headerH = 22;
  let y = margin;

  drawFilledRect(doc, x0, y, w, headerH, PDF.primary);

  const logoSize = logo?.sizeMm || 14;
  if (logo?.dataUrl) {
    doc.addImage(logo.dataUrl, logo.format || 'PNG', x0 + pad, y + (headerH - logoSize) / 2, logoSize, logoSize);
  }

  const brandX = x0 + pad + (logo?.dataUrl ? logoSize + 4 : 0);
  doc.setTextColor(...PDF.white);
  doc.setFont(undefined, 'bold');
  doc.setFontSize(11);
  doc.text(pdfText(s.store_name), brandX, y + 8);
  const tagline = formatStoreActivityLine(s);
  if (tagline) {
    doc.setFont(undefined, 'normal');
    doc.setFontSize(6.5);
    doc.text(pdfText(tagline), brandX, y + 13, { maxWidth: w * 0.45 });
  }

  const badgeLabel = pdfText((title || 'RAPPORT').toUpperCase());
  doc.setFontSize(7);
  const badgeW = Math.min(doc.getTextWidth(badgeLabel) + 8, w * 0.45);
  const badgeX = x0 + w - pad - badgeW;
  drawFilledRect(doc, badgeX, y + 4, badgeW, 7, PDF.accent);
  doc.setTextColor(...PDF.accentText);
  doc.setFont(undefined, 'bold');
  doc.text(badgeLabel, badgeX + badgeW / 2, y + 8.8, { align: 'center' });

  const metaLine = [reference, subtitle, date].filter(Boolean).join(' · ');
  if (metaLine) {
    doc.setFont(undefined, 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(255, 255, 255);
    doc.text(pdfText(metaLine), x0 + w - pad, y + 17, { align: 'right', maxWidth: w * 0.5 });
  }

  doc.setTextColor(...PDF.text);
  return y + headerH + 5;
}

export function drawPdfFooter(doc, lines = [], afterY) {
  const text = lines.filter(Boolean).join('  |  ');
  if (!text) return;

  const { pageWidth, margin } = getPdfLayout(doc);
  const y = afterY + 3;
  doc.setDrawColor(...PDF.border);
  doc.setLineWidth(0.15);
  doc.line(margin, y, pageWidth - margin, y);

  doc.setFontSize(7);
  doc.setTextColor(...PDF.muted);
  doc.text(pdfText(text), pageWidth / 2, y + 4, { align: 'center' });
}

export { formatGNFForPdf, formatDateForPdf, pdfText };
