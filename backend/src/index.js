import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import config, { corsOriginCallback } from './config/index.js';
import pool from './db/pool.js';
import { initSocket } from './socket/index.js';
import { createHttpServer } from './createServer.js';

import authRoutes from './routes/auth.js';
import clientsRoutes from './routes/clients.js';
import salesRoutes from './routes/sales.js';
import productsRoutes from './routes/products.js';
import categoriesRoutes from './routes/categories.js';
import suppliersRoutes from './routes/suppliers.js';
import employeesRoutes from './routes/employees.js';
import financesRoutes from './routes/finances.js';
import settingsRoutes from './routes/settings.js';
import deliveryPointsRoutes from './routes/deliveryPoints.js';
import proformaRoutes from './routes/proforma.js';
import purchaseOrdersRoutes from './routes/purchaseOrders.js';
import settlementsRoutes from './routes/settlements.js';
import dashboardRoutes from './routes/dashboard.js';
import auditRoutes from './routes/audit.js';
import backupRoutes from './routes/backup.js';
import importRoutes from './routes/import.js';
import searchRoutes from './routes/search.js';
import systemRoutes from './routes/system.js';
import { ensureComptoirClient } from './utils/comptoirClient.js';
import { listBackups } from './services/backupService.js';
import { startScheduledBackup } from './jobs/scheduledBackup.js';
import { startScheduledReports } from './jobs/scheduledReports.js';
import { runStaleCartCleanup, startScheduledStaleCarts } from './jobs/scheduledStaleCarts.js';
import { dbErrorMessage, isDbConnectionError } from './utils/dbErrors.js';
import { globalApiRateLimit } from './middleware/rateLimit.js';

import { syncProductCatalogPvAssignments } from './utils/productCatalogPv.js';

async function cleanupOrphanProductStockOnBoot() {
  try {
    const { pv1Id, pv2Id } = await syncProductCatalogPvAssignments();
    if (pv1Id) {
      console.log(`✓ Catalogue produits synchronisé (PV principal #${pv1Id}${pv2Id ? `, PV2 #${pv2Id}` : ''})`);
    }
  } catch (err) {
    console.warn('Nettoyage stock PV:', err.message);
  }
}

async function ensureFinancePvSchemaOnBoot() {
  try {
    await pool.query(`
      ALTER TABLE daily_cash
        ADD COLUMN IF NOT EXISTS delivery_point_id INTEGER REFERENCES delivery_points(id)
    `);
    await pool.query('ALTER TABLE daily_cash DROP CONSTRAINT IF EXISTS daily_cash_cash_date_key');
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_cash_date_global
        ON daily_cash (cash_date) WHERE delivery_point_id IS NULL
    `);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_cash_date_pv
        ON daily_cash (cash_date, delivery_point_id) WHERE delivery_point_id IS NOT NULL
    `);
    await pool.query(`
      ALTER TABLE sales_carts
        ADD COLUMN IF NOT EXISTS delivery_point_id INTEGER REFERENCES delivery_points(id)
    `);
    await pool.query(`
      ALTER TABLE cart_payments
        ADD COLUMN IF NOT EXISTS delivery_point_id INTEGER REFERENCES delivery_points(id)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_daily_cash_pv_date ON daily_cash (delivery_point_id, cash_date DESC)
    `);
    await pool.query('DROP VIEW IF EXISTS cash_closure');
    await pool.query(`
      CREATE VIEW cash_closure AS
      SELECT
        id, cash_date, delivery_point_id, opening_balance, total_income, total_expense, closing_balance,
        sales_collected, settlement_collected, expected_balance, counted_balance, variance,
        signature_name, closed_at, closed_by, reopened_at, reopened_by, notes, created_at, updated_at
      FROM daily_cash
    `);
    console.log('✓ Schéma finances/PV à jour (daily_cash, ventes, reçus)');
  } catch (err) {
    console.warn('Schéma finances/PV:', err.message);
  }
}

async function backfillCartDeliveryPointsOnBoot() {
  try {

    const syncClient = await pool.query(`
      UPDATE sales_carts sc
      SET delivery_point_id = c.delivery_point_id, updated_at = NOW()
      FROM clients c
      WHERE sc.client_id = c.id
        AND c.delivery_point_id IS NOT NULL
        AND sc.delivery_point_id IS DISTINCT FROM c.delivery_point_id
    `);
    const syncSeller = await pool.query(`
      UPDATE sales_carts sc
      SET delivery_point_id = e.delivery_point_id, updated_at = NOW()
      FROM employees e
      WHERE sc.seller_id = e.id
        AND e.delivery_point_id IS NOT NULL
        AND sc.delivery_point_id IS NULL
    `);
    const syncPayments = await pool.query(`
      UPDATE cart_payments cp
      SET delivery_point_id = COALESCE(c.delivery_point_id, sc.delivery_point_id)
      FROM sales_carts sc
      LEFT JOIN clients c ON c.id = sc.client_id
      WHERE cp.cart_id = sc.id
        AND COALESCE(c.delivery_point_id, sc.delivery_point_id) IS NOT NULL
        AND cp.delivery_point_id IS DISTINCT FROM COALESCE(c.delivery_point_id, sc.delivery_point_id)
    `);
    const total = (syncClient.rowCount || 0) + (syncSeller.rowCount || 0) + (syncPayments.rowCount || 0);
    if (total > 0) {
      console.log(`✓ PV ventes/reçus resynchronisés: ${total} ligne(s)`);
    }
  } catch (err) {
    console.warn('Backfill PV paniers:', err.message);
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const { server, protocol } = createHttpServer(app);

const io = new Server(server, {
  cors: {
    origin: config.allowVercelCors ? corsOriginCallback : (config.clientUrls.length === 1 ? config.clientUrls[0] : config.clientUrls),
    methods: ['GET', 'POST'],
    credentials: true,
  },
});
initSocket(io);

if (config.nodeEnv === 'production') {
  app.set('trust proxy', 1);
}

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false,
}));
app.use(cors({
  origin: config.allowVercelCors ? corsOriginCallback : (config.clientUrls.length === 1 ? config.clientUrls[0] : config.clientUrls),
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(globalApiRateLimit);
app.use('/api/uploads', express.static(path.join(__dirname, '../uploads')));

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    const [lowStock, backups] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS cnt FROM (
           SELECT p.id FROM products p
           JOIN product_stock ps ON ps.product_id = p.id
           JOIN delivery_points dp ON dp.id = ps.delivery_point_id AND dp.is_active = TRUE
           WHERE p.is_active = TRUE
           GROUP BY p.id, p.min_stock
           HAVING MAX(ps.quantity) <= p.min_stock
         ) x`
      ),
      listBackups(1).catch(() => []),
    ]);
    const lastBackup = backups[0];
    res.json({
      status: 'ok',
      db: 'ok',
      app: 'BESTO SHOP',
      version: config.appVersion,
      low_stock_count: lowStock.rows[0]?.cnt ?? 0,
      last_backup_at: lastBackup?.created_at || null,
    });
  } catch (err) {
    console.error('Health check DB:', err.message);
    res.status(503).json({
      status: 'degraded',
      db: 'down',
      app: 'BESTO SHOP',
      version: config.appVersion,
      message: 'PostgreSQL inaccessible — vérifiez que le service est démarré',
    });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/clients', clientsRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/suppliers', suppliersRoutes);
app.use('/api/employees', employeesRoutes);
app.use('/api/finances', financesRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/delivery-points', deliveryPointsRoutes);
app.use('/api/proforma', proformaRoutes);
app.use('/api/purchase-orders', purchaseOrdersRoutes);
app.use('/api/settlements', settlementsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/backups', backupRoutes);
app.use('/api/import', importRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/system', systemRoutes);

const clientDist = path.join(__dirname, '../../frontend/dist');
const clientIndex = path.join(clientDist, 'index.html');
const serveClient =
  process.env.SERVE_CLIENT !== '0' && fs.existsSync(clientIndex);

if (serveClient) {
  app.use(express.static(clientDist, {
    setHeaders(res, filePath) {
      if (filePath.endsWith('index.html') || filePath.endsWith('sw.js') || filePath.endsWith('manifest.webmanifest')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      }
    },
  }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
    res.sendFile(clientIndex, (err) => (err ? next(err) : undefined));
  });
  console.log(`✓ Interface web servie depuis ${clientDist}`);
} else if (!fs.existsSync(clientIndex)) {
  console.warn('⚠️  frontend/dist introuvable — lancez: npm run build --prefix frontend');
}

app.use((err, _req, res, _next) => {
  if (isDbConnectionError(err)) {
    console.error('Erreur PostgreSQL:', err.message);
    return res.status(503).json({ message: dbErrorMessage(err), db: 'down' });
  }
  console.error(err);
  const status = err.status || err.statusCode || 500;
  const message = status < 500 && err.message ? err.message : 'Erreur serveur interne';
  res.status(status).json({ message });
});

process.on('unhandledRejection', (reason) => {
  const msg = reason?.message || String(reason);
  console.error('Promesse non geree (serveur maintenu actif):', msg);
});

server.listen(config.port, config.host, async () => {
  const hostLabel = config.host === '0.0.0.0' ? 'localhost' : config.host;
  console.log(`BESTO SHOP API démarrée sur ${protocol}://${hostLabel}:${config.port}`);
  if (protocol === 'http') {
    console.warn(
      '⚠️  Connexion HTTP — la PWA affichera l\'IP et « Non sécurisé ». ' +
        'Pour HTTPS : npm run ssl:generate (à la racine du projet)'
    );
  } else {
    console.log('✓ HTTPS actif — installez la PWA depuis l\'adresse https:// de ce serveur');
  }
  try {
    await cleanupOrphanProductStockOnBoot();
    await ensureFinancePvSchemaOnBoot();
    await backfillCartDeliveryPointsOnBoot();
  } catch (err) {
    console.warn('Démarrage sync PV:', err.message);
  }
  ensureComptoirClient()
    .then((c) => console.log(`✓ Client comptoir prêt (${c.code})`))
    .catch((err) => console.warn('Client comptoir:', err.message));
  runStaleCartCleanup()
    .then((n) => {
      if (n > 0) console.log(`✓ Paniers abandonnés annulés au démarrage : ${n}`);
    })
    .catch((err) => console.warn('Nettoyage paniers abandonnés:', err.message));
  startScheduledStaleCarts();
  startScheduledBackup();
  startScheduledReports();
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nErreur : le port ${config.port} est déjà utilisé.`);
    console.error('Une ancienne instance du backend tourne peut-être encore.');
    console.error('\nWindows — libérer le port :');
    console.error(`  netstat -ano | findstr :${config.port}`);
    console.error('  taskkill /PID <numéro_PID> /F');
    console.error('\nPuis relancez : npm run dev\n');
    process.exit(1);
  }
  throw err;
});
