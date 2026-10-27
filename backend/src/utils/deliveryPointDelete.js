async function hasSupplyDepotColumn(client) {
  const { rows } = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'delivery_points'
         AND column_name = 'supply_depot_id'
     ) AS ok`
  );
  return rows[0].ok;
}

/**
 * Supprime un point de vente / dépôt et détache les enregistrements liés.
 * @param {import('pg').PoolClient} client
 * @param {number} pointId
 * @returns {Promise<{ employees: number, carts: number }>}
 */
export async function deleteDeliveryPoint(client, pointId) {
  if (await hasSupplyDepotColumn(client)) {
    await client.query(
      'UPDATE delivery_points SET supply_depot_id = NULL WHERE supply_depot_id = $1',
      [pointId]
    );
  }

  const { rowCount: employees } = await client.query(
    'UPDATE employees SET delivery_point_id = NULL WHERE delivery_point_id = $1',
    [pointId]
  );
  const { rowCount: carts } = await client.query(
    'UPDATE sales_carts SET delivery_point_id = NULL WHERE delivery_point_id = $1',
    [pointId]
  );
  await client.query('DELETE FROM product_stock WHERE delivery_point_id = $1', [pointId]);
  await client.query(
    'UPDATE stock_movements SET delivery_point_id = NULL WHERE delivery_point_id = $1',
    [pointId]
  );
  await client.query('DELETE FROM delivery_points WHERE id = $1', [pointId]);

  return { employees, carts };
}
