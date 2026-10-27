/** Génération automatique des codes BESTO SHOP (préfixe BS*) */

export function isPgUniqueViolation(err) {
  return err?.code === '23505';
}

function datePart(d = new Date()) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const aa = String(d.getFullYear()).slice(-2);
  return `${dd}-${mm}-${aa}`;
}

const CLIENT_TYPE_SUFFIX = {
  particulier: 'PA',
  entreprise: 'EN',
  etat: 'ET',
};

const SUPPLIER_STATUS_SUFFIX = {
  entreprise: 'EN',
  particulier: 'PA',
  cooperative: 'CO',
  groupement: 'GR',
};

export async function generateClientCode(pool, clientType) {
  const suffix = CLIENT_TYPE_SUFFIX[clientType] || 'PA';
  const prefix = `BSCL-${datePart()}-${suffix}`;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS c FROM clients WHERE code LIKE $1',
      [`${prefix}%`]
    );
    const seq = String((rows[0]?.c || 0) + 1).padStart(3, '0');
    const code = `${prefix}-${seq}`;
    const dup = await pool.query('SELECT 1 FROM clients WHERE code = $1 LIMIT 1', [code]);
    if (!dup.rows.length) return code;
  }
  throw new Error('Impossible de générer un code client unique');
}

export async function generateSupplierCode(pool, status, contact = '') {
  const suffix = SUPPLIER_STATUS_SUFFIX[status] || 'EN';
  const digits = (contact || '').replace(/\D/g, '');
  const baseNnn = digits.length >= 6
    ? digits.slice(-6, -3)
    : digits.length >= 3
      ? digits.slice(0, 3).padEnd(3, '0')
      : '000';
  const dayPrefix = `BSF-${datePart()}-${suffix}-`;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const nnn = attempt === 0
      ? baseNnn
      : String(Math.floor(Math.random() * 1000)).padStart(3, '0');
    const code = `${dayPrefix}${nnn}`;
    const dup = await pool.query('SELECT 1 FROM suppliers WHERE code = $1 LIMIT 1', [code]);
    if (!dup.rows.length) return code;
  }
  const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM suppliers');
  return `${dayPrefix}${String((rows[0]?.c || 0) + 1).padStart(3, '0')}`;
}

export async function generateEmployeeMatricule(pool, contact = '') {
  const digits = (contact || '').replace(/\D/g, '');
  const base = digits.length >= 3 ? digits.slice(-3) : null;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const nnn = base && attempt === 0
      ? base
      : String(Math.floor(Math.random() * 1000)).padStart(3, '0');
    const matricule = `BSEMP-${datePart()}-${nnn}`;
    const { rows } = await pool.query(
      'SELECT 1 FROM employees WHERE matricule = $1',
      [matricule]
    );
    if (!rows.length) return matricule;
  }
  const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM employees');
  return `BSEMP-${datePart()}-${String((rows[0]?.c || 0) + 1).padStart(3, '0')}`;
}

export async function generateProductReference(pool) {
  const prefix = `BSPR-${datePart()}-`;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const { rows } = await pool.query(
      `SELECT COALESCE(MAX(CAST(NULLIF(SPLIT_PART(reference, '-', 5), '') AS INTEGER)), 0)::int AS max_seq
       FROM products WHERE reference LIKE $1`,
      [`${prefix}%`]
    );
    const seq = String((rows[0]?.max_seq || 0) + 1).padStart(3, '0');
    const reference = `${prefix}${seq}`;
    const dup = await pool.query('SELECT 1 FROM products WHERE reference = $1 LIMIT 1', [reference]);
    if (!dup.rows.length) return reference;
  }
  throw new Error('Impossible de générer une référence produit unique');
}

export async function generateCartNumber(db, deliveryPointId = null) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  let pvPrefix = '';
  if (deliveryPointId) {
    const { rows: dpRows } = await db.query(
      'SELECT code FROM delivery_points WHERE id = $1',
      [deliveryPointId],
    );
    if (dpRows[0]?.code) pvPrefix = `${dpRows[0].code}-`;
  }
  const prefix = `${pvPrefix}PAN-${today}-`;
  const { rows } = await db.query(
    `SELECT sc.cart_number, sc.status,
            (SELECT COUNT(*)::int FROM sale_lines sl WHERE sl.cart_id = sc.id) AS line_count
     FROM sales_carts sc
     WHERE sc.cart_number LIKE $1`,
    [`${prefix}%`],
  );

  const used = new Set();
  for (const r of rows) {
    if (r.status === 'en_cours' && (r.line_count || 0) === 0) continue;
    const m = String(r.cart_number).match(/-(\d{4})$/);
    if (m) used.add(parseInt(m[1], 10));
  }

  let seq = 1;
  while (used.has(seq)) seq += 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

export async function generateProformaNumber(db, deliveryPointId = null) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `FP-${today}-`;
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`proforma:${prefix}`]);
  const { rows } = await db.query(
    `SELECT COALESCE(MAX(
       CAST(NULLIF(SUBSTRING(invoice_number FROM '-(\\d{4})$'), '') AS INTEGER)
     ), 0)::int AS max_seq
     FROM proforma_invoices
     WHERE invoice_number LIKE $1`,
    [`${prefix}%`]
  );
  let seq = (rows[0]?.max_seq || 0) + 1;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const invoiceNumber = `${prefix}${String(seq).padStart(4, '0')}`;
    const dup = await db.query(
      'SELECT 1 FROM proforma_invoices WHERE invoice_number = $1 LIMIT 1',
      [invoiceNumber]
    );
    if (!dup.rows.length) return invoiceNumber;
    seq += 1;
  }
  throw new Error('Impossible de générer un numéro de facture unique');
}

export async function generateCollectionBatchRef(db) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `ENC-${today}-`;
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`collection:${prefix}`]);
  const { rows } = await db.query(
    `SELECT COALESCE(MAX(
       CAST(NULLIF(SPLIT_PART(batch_ref, '-', 3), '') AS INTEGER)
     ), 0)::int AS max_seq
     FROM cart_payments
     WHERE batch_ref LIKE $1`,
    [`${prefix}%`]
  ).catch(() => ({ rows: [{ max_seq: 0 }] }));
  let seq = (rows[0]?.max_seq || 0) + 1;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const batchRef = `${prefix}${String(seq).padStart(4, '0')}`;
    const dup = await db.query(
      'SELECT 1 FROM cart_payments WHERE batch_ref = $1 LIMIT 1',
      [batchRef]
    ).catch(() => ({ rows: [] }));
    if (!dup.rows.length) return batchRef;
    seq += 1;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

export async function generateOrderNumber(pool) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS c FROM purchase_orders WHERE order_number LIKE $1`,
    [`BC-${today}%`]
  );
  const seq = String((rows[0]?.c || 0) + 1).padStart(4, '0');
  return `BC-${today}-${seq}`;
}
