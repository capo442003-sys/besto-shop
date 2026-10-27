/**
 * Libère un port TCP (Windows) avant de démarrer le serveur.
 * Usage: node scripts/free-port.js 3001
 */
import { execSync } from 'child_process';

const port = String(process.argv[2] || '3001');
const portPattern = new RegExp(`:${port}\\s`);

if (process.platform !== 'win32') {
  process.exit(0);
}

try {
  const out = execSync('netstat -ano -p tcp', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
  const pids = new Set();
  for (const line of out.split('\n')) {
    if (!line.includes('LISTENING') || !portPattern.test(line)) continue;
    const parts = line.trim().split(/\s+/);
    const pid = parts[parts.length - 1];
    if (pid && /^\d+$/.test(pid) && pid !== '0') pids.add(pid);
  }
  for (const pid of pids) {
    try {
      execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
      console.log(`Port ${port} : processus ${pid} arrêté.`);
    } catch {
      /* déjà fermé */
    }
  }
} catch {
  /* port libre */
}
