import pool from '../db/pool.js';
import { generateProductReference, generateClientCode } from '../utils/codes.js';
import { generateSupplierCode } from '../utils/codes.js';
import { generateCartNumber } from '../utils/codes.js';
import { parseWorkbookBuffer, normalizeRow, pick, pickNum, buildTemplateBuffer } from '../utils/excelParse.js';
import { getActiveDeliveryPoints, setStock } from '../utils/stockSync.js';
import { ensureComptoirClient } from '../utils/comptoirClient.js';
import { logAudit } from '../middleware/audit.js';

const CLIENT_TYPES = new Set(['particulier', 'entreprise', 'etat']);
const SUPPLIER_STATUS = new Set(['entreprise', 'particulier', 'cooperative', 'groupement']);
const PAYMENT_MODES = new Set(['especes', 'paiement_mobile', 'virement', 'cheque']);
const SALE_TYPES = new Set(['gros', 'detail']);

export const IMPORT_TEMPLATES = {
  products: {
    label: 'Produits & stocks',
    filename: 'modele_import_produits.xlsx',
    headers: ['nom', 'reference', 'categorie', 'prix_achat', 'prix_gros', 'prix_detail', 'stock', 'stock_min'],
    example: ['T-shirt coton Homme M', 'BESTO-TEE-001', 'Hommes', 45000, 65000, 85000, 40, 10],
  },
  clients: {
    label: 'Clients',
    filename: 'modele_import_clients.xlsx',
    headers: ['nom', 'code', 'contact', 'adresse', 'type'],
    example: ['Cliente Aissatou', '', '620000000', 'Conakry', 'particulier'],
  },
  suppliers: {
    label: 'Fournisseurs',
    filename: 'modele_import_fournisseurs.xlsx',
    headers: ['nom', 'code', 'contact', 'statut', 'adresse', 'ville', 'pays'],
    example: ['Textile Import SA', '', '621111111', 'entreprise', 'Kaloum', 'Conakry', 'Guinée'],
  },
  categories: {
    label: 'Catégories',
    filename: 'modele_import_categories.xlsx',
    headers: ['nom'],
    example: ['Chaussures'],
  },
  sales_history: {
    label: 'Ventes historiques (sans impact stock)',
    filename: 'modele_import_ventes_historique.xlsx',
    headers: [
      'numero_vente',
      'date_vente',
      'client_code',
      'client_nom',
      'reference_produit',
      'nom_produit',
      'quantite',
      'prix_unitaire',
      'montant_paye',
      'mode_paiement',
      'type_vente',
    ],
    example: [
      'HIST-2025-0001',
      '2025-12-15',
      '',
      'Client exemple',
      'BESTO-TEE-001',
      'T-shirt coton Homme M',
      2,
      85000,
      170000,
      'especes',
      'detail',
    ],
  },

  employees: {
    label: 'Employés',
    filename: 'modele_import_employes.xlsx',
    headers: ['nom', 'matricule', 'fonction', 'contact', 'salaire_mensuel', 'adresse'],
    example: ['Mamadou Diallo', '', 'vendeur', '620000001', 1500000, 'Conakry'],
  },
  debts: {
    label: 'Dettes / créances clients',
    filename: 'modele_import_dettes.xlsx',
    headers: ['client_code', 'client_nom', 'montant', 'solde', 'date_echeance', 'type', 'notes'],
    example: ['BSCL-01-01-26-PA-001', '', 500000, 300000, '2026-06-30', 'creance_commerciale', 'Reprise'],
  },
};

export async function previewImport(type, buffer) {
  const rows = (await parseWorkbookBuffer(buffer)).map(normalizeRow);
  const errors = [];
  let valid = 0;
  rows.forEach((row, i) => {
    const line = i + 2;
    if (type === 'products' && !pick(row, 'nom', 'name')) return;
    if (type === 'clients' && !pick(row, 'nom', 'name')) return;
    if (type === 'employees' && !pick(row, 'nom', 'name')) return;
    if (type === 'debts' && !pick(row, 'client_code', 'client_nom')) {
      errors.push({ line, message: 'client_code ou client_nom requis' });
      return;
    }
    valid += 1;
  });
  return {
    dry_run: true,
    total_rows: rows.length,
    valid_rows: valid,
    errors: errors.slice(0, 30),
    sample: rows.slice(0, 10),
    message: `Aperçu : ${valid} ligne(s) valide(s) sur ${rows.length}`,
  };
}

export async function getTemplateBuffer(type) {
  const t = IMPORT_TEMPLATES[type];
  if (!t) throw new Error('Type de modèle inconnu');
  return buildTemplateBuffer('Import', t.headers, t.example);
}

async function resolveCategoryId(client, name) {
  if (!name) return null;
  const { rows } = await client.query('SELECT id FROM categories WHERE LOWER(name) = LOWER($1)', [name]);
  if (rows.length) return rows[0].id;
  const ins = await client.query('INSERT INTO categories (name) VALUES ($1) ON CONFLICT (name) DO NOTHING RETURNING id', [name]);
  if (ins.rows.length) return ins.rows[0].id;
  const again = await client.query('SELECT id FROM categories WHERE LOWER(name) = LOWER($1)', [name]);
  return again.rows[0]?.id || null;
}

export async function importProductsFromBuffer(buffer, userId) {
  const rows = (await parseWorkbookBuffer(buffer)).map(normalizeRow);
  let created = 0;
  let updated = 0;
  const errors = [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const pvs = await getActiveDeliveryPoints(client);
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const line = i + 2;
      try {
        const name = pick(row, 'nom', 'name');
        if (!name) continue;
        if (['solde', 'solde a payer', 'reste'].includes(name.trim().toLowerCase())) {
          errors.push({ line, message: `Nom produit invalide : « ${name} » — utilisez le vrai nom du produit` });
          continue;
        }
        const ref = pick(row, 'reference');
        const categoryName = pick(row, 'categorie', 'category');
        const purchase = pickNum(row, 'prix_achat', 'achat');
        const wholesale = pickNum(row, 'prix_gros', 'gros');
        const retail = pickNum(row, 'prix_detail', 'detail', 'prix');
        const minStock = pickNum(row, 'stock_min', 'min');
        const stock = pickNum(row, 'stock', 'quantite', 'quantity');

        const categoryId = await resolveCategoryId(client, categoryName);
        let productId;
        const existing = ref
          ? await client.query('SELECT id FROM products WHERE reference = $1', [ref])
          : { rows: [] };

        if (existing.rows.length) {
          productId = existing.rows[0].id;
          await client.query(
            `UPDATE products SET name=$1, category_id=$2, purchase_price=$3, wholesale_price=$4,
             retail_price=$5, min_stock=$6, is_active=TRUE, updated_at=NOW() WHERE id=$7`,
            [name, categoryId, purchase, wholesale, retail, minStock, productId]
          );
          updated += 1;
        } else {
          const reference = ref || (await generateProductReference(pool));
          const ins = await client.query(
            `INSERT INTO products (name, reference, category_id, purchase_price, wholesale_price, retail_price, min_stock)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
            [name, reference, categoryId, purchase, wholesale, retail, minStock]
          );
          productId = ins.rows[0].id;
          for (const pv of pvs) {
            await client.query(
              `INSERT INTO product_stock (product_id, delivery_point_id, quantity)
               VALUES ($1,$2,0) ON CONFLICT (product_id, delivery_point_id) DO NOTHING`,
              [productId, pv.id]
            );
          }
          created += 1;
        }
        if (stock > 0) {
          const targetPv = pvs[0]?.id;
          if (targetPv) {
            await setStock(productId, targetPv, stock, {
              client,
              userId,
              movementType: 'entree',
              notes: 'Import données',
            });
          }
        }
      } catch (e) {
        errors.push({ line, message: e.message });
      }
    }
    await client.query('COMMIT');
    await logAudit(userId, 'import', 'products', null, { created, updated, errors: errors.length });
    return {
      message: `Produits : ${created} créé(s), ${updated} mis à jour${errors.length ? `, ${errors.length} ligne(s) en erreur` : ''}`,
      created,
      updated,
      errors,
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function importClientsFromBuffer(buffer, userId) {
  const rows = (await parseWorkbookBuffer(buffer)).map(normalizeRow);
  let created = 0;
  let updated = 0;
  const errors = [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const defaultPv = (await client.query(
      'SELECT id FROM delivery_points WHERE is_active = TRUE ORDER BY id LIMIT 1'
    )).rows[0]?.id || null;
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const line = i + 2;
      try {
        const name = pick(row, 'nom', 'name');
        if (!name) continue;
        if (name.toUpperCase() === 'COMPTOIR') continue;
        let code = pick(row, 'code');
        const contact = pick(row, 'contact', 'telephone');
        const address = pick(row, 'adresse', 'address');
        let clientType = pick(row, 'type', 'client_type').toLowerCase() || 'particulier';
        if (!CLIENT_TYPES.has(clientType)) clientType = 'particulier';

        const existingByCode = code
          ? await client.query('SELECT id FROM clients WHERE code = $1', [code])
          : { rows: [] };
        const existingByName = await client.query(
          'SELECT id, code FROM clients WHERE LOWER(name) = LOWER($1) AND is_active = TRUE',
          [name]
        );

        if (existingByCode.rows.length) {
          await client.query(
            `UPDATE clients SET name=$1, contact=$2, address=$3, client_type=$4, is_active=TRUE, updated_at=NOW() WHERE id=$5`,
            [name, contact, address, clientType, existingByCode.rows[0].id]
          );
          updated += 1;
        } else if (existingByName.rows.length) {
          await client.query(
            `UPDATE clients SET contact=$1, address=$2, client_type=$3, is_active=TRUE, updated_at=NOW() WHERE id=$4`,
            [contact, address, clientType, existingByName.rows[0].id]
          );
          updated += 1;
        } else {
          if (!code) code = await generateClientCode(pool, clientType);
          await client.query(
            `INSERT INTO clients (name, code, contact, address, client_type, delivery_point_id) VALUES ($1,$2,$3,$4,$5,$6)`,
            [name, code, contact, address, clientType, defaultPv]
          );
          created += 1;
        }
      } catch (e) {
        errors.push({ line, message: e.message });
      }
    }
    await client.query('COMMIT');
    await logAudit(userId, 'import', 'clients', null, { created, updated, errors: errors.length });
    return {
      message: `Clients : ${created} créé(s), ${updated} mis à jour`,
      created,
      updated,
      errors,
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function importSuppliersFromBuffer(buffer, userId) {
  const rows = (await parseWorkbookBuffer(buffer)).map(normalizeRow);
  let created = 0;
  let updated = 0;
  const errors = [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const line = i + 2;
      try {
        const name = pick(row, 'nom', 'name');
        if (!name) continue;
        let code = pick(row, 'code');
        const contact = pick(row, 'contact');
        const address = pick(row, 'adresse', 'address');
        const city = pick(row, 'ville', 'city');
        const country = pick(row, 'pays', 'country');
        let status = pick(row, 'statut', 'status').toLowerCase() || 'entreprise';
        if (!SUPPLIER_STATUS.has(status)) status = 'entreprise';

        const byCode = code ? await client.query('SELECT id FROM suppliers WHERE code = $1', [code]) : { rows: [] };
        const byName = await client.query(
          'SELECT id FROM suppliers WHERE LOWER(name) = LOWER($1)',
          [name]
        );

        if (byCode.rows.length) {
          await client.query(
            `UPDATE suppliers SET name=$1, contact=$2, address=$3, city=$4, country=$5, status=$6, is_active=TRUE, updated_at=NOW() WHERE id=$7`,
            [name, contact, address, city, country, status, byCode.rows[0].id]
          );
          updated += 1;
        } else if (byName.rows.length) {
          await client.query(
            `UPDATE suppliers SET contact=$1, address=$2, city=$3, country=$4, status=$5, is_active=TRUE, updated_at=NOW() WHERE id=$6`,
            [contact, address, city, country, status, byName.rows[0].id]
          );
          updated += 1;
        } else {
          if (!code) code = await generateSupplierCode(client, status, contact);
          await client.query(
            `INSERT INTO suppliers (name, code, status, address, city, country, contact)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [name, code, status, address, city, country, contact]
          );
          created += 1;
        }
      } catch (e) {
        errors.push({ line, message: e.message });
      }
    }
    await client.query('COMMIT');
    await logAudit(userId, 'import', 'suppliers', null, { created, updated, errors: errors.length });
    return { message: `Fournisseurs : ${created} créé(s), ${updated} mis à jour`, created, updated, errors };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function importCategoriesFromBuffer(buffer, userId) {
  const rows = (await parseWorkbookBuffer(buffer)).map(normalizeRow);
  let created = 0;
  const errors = [];
  for (let i = 0; i < rows.length; i += 1) {
    const name = pick(rows[i], 'nom', 'name');
    const line = i + 2;
    if (!name) continue;
    try {
      const { rowCount } = await pool.query(
        'INSERT INTO categories (name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
        [name]
      );
      if (rowCount > 0) created += 1;
    } catch (e) {
      errors.push({ line, message: e.message });
    }
  }
  await logAudit(userId, 'import', 'categories', null, { created, errors: errors.length });
  return { message: `Catégories : ${created} ajoutée(s)`, created, updated: 0, errors };
}

async function resolveClientId(client, code, name) {
  if (code) {
    const { rows } = await client.query('SELECT id FROM clients WHERE code = $1 AND is_active = TRUE', [code]);
    if (rows.length) return rows[0].id;
  }
  if (name) {
    const { rows } = await client.query(
      'SELECT id FROM clients WHERE LOWER(name) = LOWER($1) AND is_active = TRUE LIMIT 1',
      [name]
    );
    if (rows.length) return rows[0].id;
  }
  const comptoir = await ensureComptoirClient();
  return comptoir.id;
}

async function resolveProductId(client, reference, name) {
  if (reference) {
    const { rows } = await client.query('SELECT id FROM products WHERE reference = $1 AND is_active = TRUE', [reference]);
    if (rows.length) return rows[0].id;
  }
  if (name) {
    const { rows } = await client.query(
      'SELECT id FROM products WHERE LOWER(name) = LOWER($1) AND is_active = TRUE LIMIT 1',
      [name]
    );
    if (rows.length) return rows[0].id;
  }
  return null;
}

/** Import ventes historiques (finalisées) — ne modifie pas le stock actuel. */
export async function importSalesHistoryFromBuffer(buffer, userId) {
  const rows = (await parseWorkbookBuffer(buffer)).map(normalizeRow);
  const groups = new Map();
  for (const row of rows) {
    const numero = pick(row, 'numero_vente', 'numero', 'cart_number', 'facture', 'numero_facture');
    const key = numero || `__row_${groups.size}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  let created = 0;
  let skipped = 0;
  const errors = [];
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const { rows: dpRows } = await db.query('SELECT id FROM delivery_points WHERE is_active = TRUE ORDER BY id LIMIT 1');
    const deliveryPointId = dpRows[0]?.id || null;

    for (const [numeroKey, lines] of groups) {
      const first = lines[0];
      const lineStart = 2;
      try {
        let cartNumber = pick(first, 'numero_vente', 'numero', 'cart_number', 'facture');
        if (!cartNumber) cartNumber = await generateCartNumber(pool);

        const dup = await db.query('SELECT id FROM sales_carts WHERE cart_number = $1', [cartNumber]);
        if (dup.rows.length) {
          skipped += 1;
          errors.push({ line: lineStart, message: `Vente ${cartNumber} déjà présente — ignorée` });
          continue;
        }

        const dateStr = pick(first, 'date_vente', 'date', 'validated_at');
        const validatedAt = dateStr ? new Date(`${dateStr}T12:00:00`) : new Date();
        const clientId = await resolveClientId(
          db,
          pick(first, 'client_code', 'code_client'),
          pick(first, 'client_nom', 'client_name', 'client')
        );
        let saleType = pick(first, 'type_vente', 'sale_type').toLowerCase() || 'detail';
        if (!SALE_TYPES.has(saleType)) saleType = 'detail';
        let paymentMode = pick(first, 'mode_paiement', 'payment_mode').toLowerCase() || 'especes';
        if (!PAYMENT_MODES.has(paymentMode)) paymentMode = 'especes';
        const amountPaid = pickNum(first, 'montant_paye', 'amount_paid', 'encaisse');

        const cartIns = await db.query(
          `INSERT INTO sales_carts (
            cart_number, sale_type, client_id, delivery_point_id, status,
            total_amount, amount_paid, payment_mode, validated_at, created_by
          ) VALUES ($1,$2,$3,$4,'finalise',0,$5,$6,$7,$8) RETURNING id`,
          [cartNumber, saleType, clientId, deliveryPointId, amountPaid, paymentMode, validatedAt, userId]
        );
        const cartId = cartIns.rows[0].id;
        let total = 0;

        for (const line of lines) {
          const productId = await resolveProductId(
            db,
            pick(line, 'reference_produit', 'reference', 'ref'),
            pick(line, 'nom_produit', 'produit', 'product_name', 'nom')
          );
          if (!productId) {
            errors.push({
              line: lineStart,
              message: `Produit introuvable : ${pick(line, 'reference_produit', 'nom_produit')}`,
            });
            continue;
          }
          const qty = pickNum(line, 'quantite', 'quantity', 'qte');
          const unitPrice = pickNum(line, 'prix_unitaire', 'unit_price', 'prix');
          if (qty <= 0) continue;
          const lineTotal = unitPrice * qty;
          const prodMeta = await db.query(
            'SELECT name, reference FROM products WHERE id = $1',
            [productId]
          );
          const prod = prodMeta.rows[0] || {};
          await db.query(
            `INSERT INTO sale_lines (
               cart_id, product_id, unit_price, quantity, line_total,
               product_name_snapshot, product_reference_snapshot
             ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [
              cartId, productId, unitPrice, qty, lineTotal,
              prod.name || null, prod.reference || null,
            ]
          );
          total += lineTotal;
        }

        const paidApplied = Math.min(Math.max(0, amountPaid), total);
        await db.query(
          `UPDATE sales_carts SET total_amount=$1, amount_paid=$2, validated_at=$3 WHERE id=$4`,
          [total, paidApplied, validatedAt, cartId]
        );
        if (paidApplied > 0) {
          await db.query(
            `INSERT INTO cart_payments (cart_id, amount, payment_mode, created_by) VALUES ($1,$2,$3,$4)`,
            [cartId, paidApplied, paymentMode, userId]
          );
        }
        created += 1;
      } catch (e) {
        errors.push({ line: lineStart, message: e.message });
      }
    }
    await db.query('COMMIT');
    await logAudit(userId, 'import', 'sales_history', null, { created, skipped, errors: errors.length });
    return {
      message: `Ventes historiques : ${created} importée(s), ${skipped} ignorée(s) (doublon)`,
      created,
      updated: 0,
      skipped,
      errors,
    };
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
}

const EMP_FUNCTIONS = new Set(['vendeur', 'caissier', 'vendeur_caissier', 'controleur', 'gestionnaire', 'comptable', 'assistant', 'dg']);

export async function importEmployeesFromBuffer(buffer, userId) {
  const rows = (await parseWorkbookBuffer(buffer)).map(normalizeRow);
  let created = 0;
  let updated = 0;
  const errors = [];
  const { generateEmployeeMatricule } = await import('../utils/codes.js');
  const { findActiveDgEmployee, DG_UNIQUE_MESSAGE } = await import('../utils/dgEmployee.js');
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const line = i + 2;
    try {
      const name = pick(row, 'nom', 'name');
      if (!name) continue;
      let matricule = pick(row, 'matricule');
      let fn = pick(row, 'fonction', 'function').toLowerCase() || 'vendeur';
      if (!EMP_FUNCTIONS.has(fn)) fn = 'vendeur';
      const contact = pick(row, 'contact');
      const salary = pickNum(row, 'salaire_mensuel', 'salaire');
      const address = pick(row, 'adresse', 'address');
      const byMat = matricule
        ? await pool.query('SELECT id, function FROM employees WHERE matricule = $1', [matricule])
        : { rows: [] };
      if (fn === 'dg') {
        const dg = await findActiveDgEmployee(pool);
        if (dg && (!byMat.rows.length || dg.id !== byMat.rows[0].id)) {
          errors.push({ line, message: DG_UNIQUE_MESSAGE });
          continue;
        }
      }
      if (byMat.rows.length) {
        await pool.query(
          `UPDATE employees SET name=$1, function=$2, contact=$3, monthly_salary=$4, address=$5, is_active=TRUE, updated_at=NOW() WHERE id=$6`,
          [name, fn, contact, salary, address, byMat.rows[0].id]
        );
        updated += 1;
      } else {
        if (!matricule) matricule = await generateEmployeeMatricule(pool, contact);
        await pool.query(
          `INSERT INTO employees (name, matricule, function, contact, monthly_salary, address)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [name, matricule, fn, contact, salary, address]
        );
        created += 1;
      }
    } catch (e) {
      errors.push({ line, message: e.message });
    }
  }
  await logAudit(userId, 'import', 'employees', null, { created, updated });
  return { message: `Employés : ${created} créé(s), ${updated} mis à jour`, created, updated, errors };
}

export async function importDebtsFromBuffer(buffer, userId) {
  const rows = (await parseWorkbookBuffer(buffer)).map(normalizeRow);
  let created = 0;
  const errors = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const line = i + 2;
    try {
      const code = pick(row, 'client_code');
      const name = pick(row, 'client_nom', 'client');
      let clientId = null;
      if (code) {
        const c = await pool.query('SELECT id FROM clients WHERE code = $1', [code]);
        clientId = c.rows[0]?.id;
      }
      if (!clientId && name) {
        const c = await pool.query('SELECT id FROM clients WHERE LOWER(name) = LOWER($1) LIMIT 1', [name]);
        clientId = c.rows[0]?.id;
      }
      if (!clientId) {
        errors.push({ line, message: 'Client introuvable' });
        continue;
      }
      const amount = pickNum(row, 'montant', 'amount');
      const balance = pickNum(row, 'solde', 'balance') || amount;
      const due = pick(row, 'date_echeance', 'due_date') || null;
      const stype = pick(row, 'type') || 'creance_commerciale';
      const notes = pick(row, 'notes');
      const paid = Math.max(0, amount - balance);
      await pool.query(
        `INSERT INTO settlements (settlement_type, client_id, amount, amount_paid, balance, due_date, status, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,'en_cours',$7,$8)`,
        [stype, clientId, amount, paid, balance, due, notes, userId]
      );
      created += 1;
    } catch (e) {
      errors.push({ line, message: e.message });
    }
  }
  await logAudit(userId, 'import', 'settlements', null, { created, errors: errors.length });
  return { message: `Dettes/créances : ${created} enregistrée(s)`, created, updated: 0, errors };
}
