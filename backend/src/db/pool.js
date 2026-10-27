import pg from 'pg';
import config from '../config/index.js';

const pool = new pg.Pool({
  connectionString: config.databaseUrl,
});

pool.on('error', (err) => {
  console.error('Erreur PostgreSQL inattendue:', err);
});

export default pool;
