import { jsPDF } from './jspdfSetup';
import { drawPdfInvoice, normalizeStore } from './pdfDocument';
import { loadPdfLogo } from './pdfLogo';
import {
  buildProformaDocument,
  buildTicketDocument,
  buildReceiptDocument,
  buildBulkReceiptDocument,
  buildPurchaseOrderDocument,
} from './documentBuilders';
import { formatDateForPdf } from './format';

async function renderPdf(spec, store) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const s = normalizeStore(store);
  const logo = await loadPdfLogo(s);

  await drawPdfInvoice(doc, {
    ...spec,
    printedAt: spec.printedAt || formatDateForPdf(new Date()),
  }, s, logo);

  doc.save(spec.filename);
}

export async function downloadTicketPdf({ cart, store, payments = [] }) {
  const doc = buildTicketDocument({ cart, store, payments });
  await renderPdf(doc.pdf, doc.store);
}

export async function downloadPaymentReceiptPdf({ cart, payment, store }) {
  const doc = buildReceiptDocument({ cart, payment, store });
  await renderPdf(doc.pdf, doc.store);
}

export async function downloadProformaPdf(detail) {
  const doc = buildProformaDocument(detail);
  await renderPdf(doc.pdf, doc.store);
}

export async function downloadPurchaseOrderPdf(order, store) {
  const doc = buildPurchaseOrderDocument(order, store);
  await renderPdf(doc.pdf, doc.store);
}

export async function downloadBulkReceiptPdf(result, store) {
  const doc = buildBulkReceiptDocument({ result, store });
  await renderPdf(doc.pdf, doc.store);
}

export { buildProformaDocument, buildTicketDocument, buildReceiptDocument, buildBulkReceiptDocument, buildPurchaseOrderDocument };
