import pool from './pool.js';
import { resetAllData } from '../services/resetDataService.js';

async function clearData() {
  try {
    console.log('\n=== BMB — Vidage des données ===\n');
    const { tableCount } = await resetAllData(pool);
    console.log(`✓ ${tableCount} table(s) vidée(s)`);
    console.log('✓ Données de référence réinitialisées (magasin, rôles, catégories…)');
    console.log('✓ Compte admin recréé (admin / admin123) — fiche employé liée');
    console.log('✓ Client Comptoir vérifié');
    console.log('\n=== Base réinitialisée (données métier vides) ===\n');
  } catch (err) {
    console.error('Erreur vidage:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

clearData();
