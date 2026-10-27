async function tableExists(client, tableName) {
  const { rows } = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS ok`,
    [tableName]
  );
  return rows[0].ok;
}

async function nullColumn(client, table, column, userId) {
  if (!(await tableExists(client, table))) return 0;
  const { rowCount } = await client.query(
    `UPDATE ${table} SET ${column} = NULL WHERE ${column} = $1`,
    [userId]
  );
  return rowCount;
}

/**
 * Supprime un compte utilisateur et détache les enregistrements liés.
 * @param {import('pg').PoolClient} client
 * @param {number} userId
 */
export async function deleteUser(client, userId) {
  const { rows: admins } = await client.query(
    `SELECT u.id
     FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     WHERE ur.role = 'administrateur' AND u.id != $1
     LIMIT 1`,
    [userId]
  );
  if (!admins.length) {
    const { rows: legacyAdmin } = await client.query(
      `SELECT id FROM users WHERE role = 'administrateur' AND id != $1 LIMIT 1`,
      [userId]
    );
    if (!legacyAdmin.length) {
      throw new Error('Impossible de supprimer le dernier administrateur');
    }
  }

  await nullColumn(client, 'stock_movements', 'user_id', userId);
  await nullColumn(client, 'sales_carts', 'created_by', userId);
  await nullColumn(client, 'cart_payments', 'created_by', userId);
  await nullColumn(client, 'purchase_orders', 'created_by', userId);
  await nullColumn(client, 'purchase_order_payments', 'created_by', userId);
  await nullColumn(client, 'settlements', 'created_by', userId);
  await nullColumn(client, 'settlement_payments', 'created_by', userId);
  await nullColumn(client, 'cash_transactions', 'created_by', userId);
  await nullColumn(client, 'charges', 'created_by', userId);
  await nullColumn(client, 'audit_log', 'user_id', userId);
  await nullColumn(client, 'product_price_history', 'changed_by', userId);
  await nullColumn(client, 'session_log', 'user_id', userId);

  if (await tableExists(client, 'daily_cash')) {
    await client.query('UPDATE daily_cash SET closed_by = NULL WHERE closed_by = $1', [userId]);
    await client.query('UPDATE daily_cash SET reopened_by = NULL WHERE reopened_by = $1', [userId]);
  }

  await client.query('DELETE FROM users WHERE id = $1', [userId]);
}
