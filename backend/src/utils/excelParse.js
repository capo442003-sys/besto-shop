import ExcelJS from 'exceljs';

function cellValue(value) {
  if (value == null) return '';
  if (typeof value === 'object' && value.text != null) return String(value.text);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value;
}

/** Lit la première feuille Excel en tableau d'objets (1ère ligne = en-têtes). */
export async function parseWorkbookBuffer(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const headers = [];
  const rows = [];

  sheet.eachRow((row, rowNumber) => {
    const values = row.values.slice(1).map(cellValue);
    if (rowNumber === 1) {
      headers.push(...values.map((v) => String(v ?? '').trim()));
      return;
    }
    if (values.every((v) => v === '' || v == null)) return;
    const obj = {};
    headers.forEach((header, index) => {
      if (!header) return;
      obj[header] = values[index] ?? '';
    });
    rows.push(obj);
  });

  return rows;
}

/** Génère un fichier .xlsx modèle (Buffer). */
export async function buildTemplateBuffer(sheetName, headers, exampleRow = null) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.addRow(headers);
  if (exampleRow) sheet.addRow(exampleRow);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function normKey(k) {
  return String(k)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_');
}

export function normalizeRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[normKey(k)] = v;
  }
  return out;
}

export function pick(row, ...keys) {
  for (const k of keys) {
    const v = row[k] ?? row[normKey(k)];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

export function pickNum(row, ...keys) {
  const s = pick(row, ...keys);
  if (!s) return 0;
  const n = parseFloat(String(s).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}
