import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Monorepo (backend/) ou déploiement Railway (database/ copié dans backend/). */
export function resolveDatabaseDir() {
  const candidates = [
    path.join(__dirname, '../../../database'),
    path.join(__dirname, '../../database'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'schema.sql'))) return dir;
  }
  throw new Error(`database/ introuvable — chemins essayés : ${candidates.join(', ')}`);
}
