import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MOJIBAKE = /Ã[\u0080-\u00BF]|Â[\u0080-\u00BF]|â€[\u0080-\u00BF]?|\uFFFD/;

function walk(dir, out = []) {
  for (const n of fs.readdirSync(dir)) {
    if (n === 'node_modules' || n === '.git') continue;
    const p = path.join(dir, n);
    let st;
    try { st = fs.statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out);
    else if (/\.(jsx?|css|html|sql)$/.test(n)) out.push(p);
  }
  return out;
}

const hits = [];
for (const f of walk(root)) {
  const rel = path.relative(root, f);
  if (rel.startsWith('frontend\\dist\\') || rel.startsWith('frontend/dist/')) continue;
  const s = fs.readFileSync(f, 'utf8');
  if (MOJIBAKE.test(s)) hits.push(rel);
}
console.log(hits.length ? hits.join('\n') : 'No mojibake found in source.');
