import { jsPDF } from './jspdfSetup';
import {
  drawPdfHeader,
  drawPdfFooter,
  normalizeStore,
  pdfText,
  PDF,
  getPdfLayout,
} from './pdfDocument';
import { loadPdfLogo } from './pdfLogo';
import { formatDateForPdf } from './format';
import { suggestPrintOrientation } from './printOrientation';
import { buildReportPdfColumnStyles } from './printTableColumns';

const TABLE_THEME = {
  headStyles: {
    fillColor: PDF.primary,
    textColor: PDF.white,
    fontStyle: 'bold',
    fontSize: 8,
    cellPadding: { top: 2, right: 2, bottom: 2, left: 2 },
  },
  bodyStyles: {
    fontSize: 7.5,
    cellPadding: { top: 1.5, right: 2, bottom: 1.5, left: 2 },
    textColor: PDF.text,
  },
  footStyles: {
    fillColor: [236, 253, 245],
    textColor: PDF.primary,
    fontStyle: 'bold',
    fontSize: 8,
  },
  alternateRowStyles: { fillColor: [250, 251, 252] },
  styles: { lineColor: PDF.border, lineWidth: 0.1 },
  margin: { left: PDF.margin, right: PDF.margin },
};

function createReportPdf(orientation = 'portrait') {
  return new jsPDF({
    unit: 'mm',
    format: 'a4',
    orientation: orientation === 'landscape' ? 'landscape' : 'portrait',
  });
}

function drawPdfFilters(doc, startY, filters) {
  const active = (filters || []).filter((f) => f.value != null && f.value !== '' && f.value !== '-');
  if (!active.length) return startY;

  doc.setFontSize(7.5);
  doc.setTextColor(...PDF.muted);
  const line = active.map((f) => `${f.label}: ${f.value}`).join('  ·  ');
  doc.text(pdfText(line), PDF.margin, startY);
  return startY + 5;
}

function drawPdfSummary(doc, startY, summary) {
  const items = (summary || []).filter((s) => s?.value != null && s.value !== '');
  if (!items.length) return startY;

  doc.setFontSize(8);
  doc.setTextColor(...PDF.text);
  const line = items.map((s) => `${s.label}: ${s.value}`).join('  ·  ');
  const layout = getPdfLayout(doc);
  const lines = doc.splitTextToSize(pdfText(line), layout.contentWidth);
  doc.text(lines, PDF.margin, startY);
  return startY + lines.length * 4 + 2;
}

/**
 * Export PDF d'un rapport / liste tabulaire.
 * @param {object} opts
 * @param {object} opts.store
 * @param {string} opts.title
 * @param {string} [opts.subtitle]
 * @param {string|Date} [opts.date]
 * @param {Array<{label:string,value:string}>} [opts.filters]
 * @param {string[]} opts.head - en-têtes colonnes
 * @param {string[][]} opts.body - lignes
 * @param {string[][]} [opts.foot] - ligne(s) totaux
 * @param {Array<{label:string,value:string}>} [opts.summary] - encadré totaux (ex. inventaire ventes)
 * @param {number[]} [opts.rightAlignCols] - indices colonnes alignées à droite
 * @param {string} [opts.filename]
 * @param {string} [opts.footerNote]
 */
export async function downloadReportPdf({
  store,
  title,
  subtitle,
  date = new Date(),
  filters = [],
  head,
  body,
  foot = [],
  summary = [],
  rightAlignCols = [],
  filename = 'rapport.pdf',
  footerNote,
  orientation,
}) {
  const resolvedOrientation = orientation
    || suggestPrintOrientation(head?.length || body?.[0]?.length || 0);
  const doc = createReportPdf(resolvedOrientation);
  const s = normalizeStore(store);
  const logo = await loadPdfLogo(s);
  const dateStr = typeof date === 'string' ? date : formatDateForPdf(date);

  let y = drawPdfHeader(doc, {
    store: s,
    title,
    reference: subtitle,
    date: dateStr,
    logo,
  });

  y = drawPdfFilters(doc, y, filters);
  y = drawPdfSummary(doc, y, summary);

  const columnStyles = buildReportPdfColumnStyles(head, rightAlignCols);

  doc.autoTable({
    startY: y,
    head: head?.length ? [head.map((c) => pdfText(c))] : undefined,
    body: (body || []).map((row) => row.map((c) => pdfText(c))),
    foot: foot.length ? foot.map((row) => row.map((c) => pdfText(c))) : undefined,
    ...TABLE_THEME,
    columnStyles,
    showFoot: 'lastPage',
  });

  y = doc.lastAutoTable.finalY + 2;

  const footerLine = footerNote
    ? `${footerNote} · Emis le ${dateStr} · BESTO SHOP`
    : `Emis le ${dateStr} · BESTO SHOP`;

  drawPdfFooter(doc, [footerLine], y);
  doc.save(filename);
}

/**
 * Export PDF avec plusieurs sections (ex. historique client : paniers + versements + dettes).
 */
export async function downloadMultiSectionReportPdf({
  store,
  title,
  subtitle,
  date = new Date(),
  filters = [],
  sections = [],
  filename = 'rapport.pdf',
  footerNote,
  orientation = 'landscape',
}) {
  const firstSection = sections[0];
  const resolvedOrientation = orientation
    || suggestPrintOrientation(
      firstSection?.head?.length || firstSection?.body?.[0]?.length || 0
    );
  const doc = createReportPdf(resolvedOrientation);
  const s = normalizeStore(store);
  const logo = await loadPdfLogo(s);
  const dateStr = typeof date === 'string' ? date : formatDateForPdf(date);

  let y = drawPdfHeader(doc, {
    store: s,
    title,
    reference: subtitle,
    date: dateStr,
    logo,
  });

  y = drawPdfFilters(doc, y, filters);

  for (let i = 0; i < sections.length; i += 1) {
    const section = sections[i];
    if (!section) continue;

    if (i > 0 && y > (resolvedOrientation === 'portrait' ? 265 : 240)) {
      doc.addPage();
      y = PDF.margin + 4;
    }

    if (section.title) {
      doc.setFontSize(9.5);
      doc.setTextColor(...PDF.primary);
      doc.text(pdfText(section.title), PDF.margin, y);
      y += 5;
      if (section.subtitle) {
        doc.setFontSize(7.5);
        doc.setTextColor(...PDF.muted);
        doc.text(pdfText(section.subtitle), PDF.margin, y);
        y += 4;
      }
    }

    const columnStyles = buildReportPdfColumnStyles(section.head, section.rightAlignCols || []);

    doc.autoTable({
      startY: y,
      head: section.head?.length ? [section.head.map((c) => pdfText(c))] : undefined,
      body: (section.body || []).map((row) => row.map((c) => pdfText(c))),
      foot: section.foot?.length ? section.foot.map((row) => row.map((c) => pdfText(c))) : undefined,
      ...TABLE_THEME,
      columnStyles,
      showFoot: section.foot?.length ? 'lastPage' : undefined,
      margin: { left: PDF.margin, right: PDF.margin },
    });

    y = doc.lastAutoTable.finalY + 8;
  }

  const footerLine = footerNote
    ? `${footerNote} · Emis le ${dateStr} · BESTO SHOP`
    : `Emis le ${dateStr} · BESTO SHOP`;

  drawPdfFooter(doc, [footerLine], y);
  doc.save(filename);
}
