import pool from '../db/pool.js';
import { emitEvent, EVENTS } from '../socket/index.js';
import { getStock, setStock } from '../utils/stockSync.js';

export async function restoreStockFromSale(productId, deliveryPointId, quantity, referenceType, referenceId, userId, client = pool) {
  const qtyBefore = await getStock(productId, deliveryPointId, client);
  const qtyAfter = qtyBefore + parseFloat(quantity);

  await setStock(productId, deliveryPointId, qtyAfter, {
    client,
    userId,
    movementType: 'annulation_vente',
    notes: `Annulation vente (${referenceType || 'sales'}) #${referenceId}`,
  });

  const prod = await client.query('SELECT name, min_stock FROM products WHERE id = $1', [productId]);
  const alert = qtyAfter <= parseFloat(prod.rows[0]?.min_stock || 0);

  emitEvent(EVENTS.STOCK_UPDATED, {
    productId,
    deliveryPointId,
    quantity: qtyAfter,
    alert,
    productName: prod.rows[0]?.name,
  });

  return { quantity: qtyAfter, alert };
}

export async function deductStock(
  productId,
  deliveryPointId,
  quantity,
  referenceType,
  referenceId,
  userId,
  dbClient = null,
) {
  const ownClient = !dbClient;
  const client = dbClient || await pool.connect();
  try {
    if (ownClient) await client.query('BEGIN');

    const qtyBefore = await getStock(productId, deliveryPointId, client);
    const qty = parseFloat(quantity);
    const qtyAfter = qtyBefore - qty;

    if (qtyAfter < -0.0001) {
      const prod = await client.query('SELECT name, reference FROM products WHERE id = $1', [productId]);
      const label = prod.rows[0]?.name || prod.rows[0]?.reference || 'Produit';
      throw Object.assign(
        new Error(
          `Stock insuffisant pour « ${label} » : disponible ${Math.round(qtyBefore)}, demandé ${Math.round(qty)}`
        ),
        { status: 409 },
      );
    }

    await setStock(productId, deliveryPointId, Math.max(0, qtyAfter), {
      client,
      userId,
      movementType: 'vente',
      notes: `Vente (${referenceType || 'sales'})`,
    });

    const prod = await client.query('SELECT name, min_stock FROM products WHERE id = $1', [productId]);
    const alert = qtyAfter <= parseFloat(prod.rows[0]?.min_stock || 0);

    if (ownClient) await client.query('COMMIT');

    emitEvent(EVENTS.STOCK_UPDATED, {
      productId,
      deliveryPointId,
      quantity: Math.max(0, qtyAfter),
      alert,
      productName: prod.rows[0]?.name,
    });

    return { quantity: Math.max(0, qtyAfter), alert };
  } catch (err) {
    if (ownClient) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (ownClient) client.release();
  }
}
