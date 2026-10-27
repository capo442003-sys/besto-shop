import { jsPDF } from 'jspdf';
import { loadPdfLogo } from './pdfLogo';
import { pdfText, formatDateForPdf, employeeFunctionLabel } from './format';

const CARD_W = 85.6;
const CARD_H = 54;
const PAGE_MARGIN = 12;
const CARD_GAP = 8;

function getInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return String(name || '?').slice(0, 2).toUpperCase();
}

function drawCard(doc, x, y, employee, store, logo) {
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(15, 74, 58);
  doc.setLineWidth(0.35);
  doc.roundedRect(x, y, CARD_W, CARD_H, 3, 3, 'FD');

  doc.setFillColor(15, 74, 58);
  doc.roundedRect(x, y, CARD_W, 14, 3, 3, 'F');
  doc.rect(x, y + 11, CARD_W, 3, 'F');

  doc.setFillColor(201, 162, 39);
  doc.rect(x, y + 13.2, CARD_W, 0.9, 'F');

  if (logo?.dataUrl) {
    doc.addImage(logo.dataUrl, logo.format, x + 3.5, y + 2.5, 8, 8);
  }

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text(pdfText(store.store_name || 'BESTO SHOP'), x + (logo ? 13 : 5), y + 6.5);

  doc.setFontSize(5.5);
  doc.setFont('helvetica', 'normal');
  doc.text('CARTE EMPLOYE', x + (logo ? 13 : 5), y + 10.5);

  const photoCx = x + CARD_W - 13;
  const photoCy = y + 25;
  doc.setFillColor(240, 244, 248);
  doc.setDrawColor(45, 143, 111);
  doc.setLineWidth(0.25);
  doc.circle(photoCx, photoCy, 9, 'FD');

  doc.setTextColor(15, 74, 58);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text(getInitials(employee.name), photoCx, photoCy + 1.2, { align: 'center' });

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(10.5);
  doc.setFont('helvetica', 'bold');
  doc.text(pdfText(employee.name), x + 5, y + 22);

  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text(pdfText(employeeFunctionLabel(employee.function)), x + 5, y + 27);

  doc.setFillColor(232, 236, 242);
  doc.roundedRect(x + 5, y + 30, 52, 11, 2, 2, 'F');
  doc.setTextColor(100, 116, 139);
  doc.setFontSize(5.5);
  doc.text('MATRICULE', x + 7, y + 34.5);
  doc.setTextColor(15, 74, 58);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text(pdfText(employee.matricule || '—'), x + 7, y + 39.5);

  doc.setFontSize(5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(148, 163, 184);
  const hire = employee.hire_date
    ? `Depuis ${formatDateForPdf(employee.hire_date).split(' ')[0]}`
    : '';
  const contact = employee.contact ? pdfText(employee.contact) : '';
  const footer = [hire, contact].filter(Boolean).join(' · ') || 'BESTO SHOP';
  doc.text(footer, x + 5, y + CARD_H - 4);
}

function placeCard(doc, index, employee, store, logo) {
  const perPage = 8;
  const cols = 2;
  if (index > 0 && index % perPage === 0) doc.addPage();
  const pageIdx = index % perPage;
  const col = pageIdx % cols;
  const row = Math.floor(pageIdx / cols);
  const x = PAGE_MARGIN + col * (CARD_W + CARD_GAP);
  const y = PAGE_MARGIN + row * (CARD_H + CARD_GAP);
  drawCard(doc, x, y, employee, store, logo);
}

export async function downloadEmployeeCardPdf(employee, store = {}) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const logo = await loadPdfLogo(store);
  drawCard(doc, PAGE_MARGIN, PAGE_MARGIN, employee, store, logo);
  doc.save(`carte-${employee.matricule || employee.id}.pdf`);
}

export async function downloadAllEmployeeCardsPdf(employees, store = {}) {
  if (!employees?.length) return;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const logo = await loadPdfLogo(store);
  employees.forEach((emp, i) => placeCard(doc, i, emp, store, logo));
  doc.save('cartes-employes-besto.pdf');
}
