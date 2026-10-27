import { Router } from 'express';
import multer from 'multer';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  IMPORT_TEMPLATES,
  getTemplateBuffer,
  importProductsFromBuffer,
  importClientsFromBuffer,
  importSuppliersFromBuffer,
  importCategoriesFromBuffer,
  importSalesHistoryFromBuffer,
  importEmployeesFromBuffer,
  importDebtsFromBuffer,
  previewImport,
} from '../services/dataImportService.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

router.use(authenticate);
router.use(requireAdmin);

router.get('/templates', (_req, res) => {
  res.json(
    Object.entries(IMPORT_TEMPLATES).map(([id, t]) => ({
      id,
      label: t.label || id,
      filename: t.filename,
      headers: t.headers,
    }))
  );
});

router.get('/templates/:type', asyncHandler(async (req, res) => {
  const type = req.params.type;
  const meta = IMPORT_TEMPLATES[type];
  if (!meta) return res.status(404).json({ message: 'Modèle introuvable' });
  const buf = await getTemplateBuffer(type);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${meta.filename}"`);
  res.send(buf);
}));

const handlers = {
  products: importProductsFromBuffer,
  clients: importClientsFromBuffer,
  suppliers: importSuppliersFromBuffer,
  categories: importCategoriesFromBuffer,
  sales_history: importSalesHistoryFromBuffer,
  employees: importEmployeesFromBuffer,
  debts: importDebtsFromBuffer,
};

for (const [type, handler] of Object.entries(handlers)) {
  router.post(`/${type}/preview`, upload.single('file'), asyncHandler(async (req, res) => {
    if (!req.file?.buffer) return res.status(400).json({ message: 'Fichier requis' });
    if (!IMPORT_TEMPLATES[type]) return res.status(404).json({ message: 'Type inconnu' });
    res.json(await previewImport(type, req.file.buffer));
  }));
  router.post(`/${type}`, upload.single('file'), asyncHandler(async (req, res) => {
    if (!req.file?.buffer) return res.status(400).json({ message: 'Fichier Excel (.xlsx, .xls) ou CSV requis' });
    const result = await handler(req.file.buffer, req.user.id);
    res.json(result);
  }));
}

export default router;
