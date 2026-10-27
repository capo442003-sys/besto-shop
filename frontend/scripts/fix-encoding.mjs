import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.join(__dirname, '../src');
const bakRoot = path.join(__dirname, '../../dist/BMB-Gestion-1.2.0/frontend/src');

const MOJIBAKE = /Ã[\u0080-\u00BF]|Â[\u0080-\u00BF]|â€[\u0080-\u00BF]?|\uFFFD/;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.(jsx?|css)$/.test(n)) out.push(p);
  }
  return out;
}

function countAccents(s) {
  return (s.match(/[\u00C0-\u017F]/g) || []).length;
}

function fixContent(content) {
  if (!MOJIBAKE.test(content)) return content;
  let fixed = Buffer.from(content, 'latin1').toString('utf8');
  fixed = fixed.replace(/^\uFEFF?/, '').replace(/^\uFFFD(?=import )/, '');
  fixed = fixed.replace(/\uFFFD[\u001D\u009D]?/g, '—');
  if (countAccents(fixed) >= countAccents(content) && !MOJIBAKE.test(fixed)) {
    return fixed;
  }
  return content
    .replace(/â€"/g, '—')
    .replace(/â€¦/g, '…')
    .replace(/Â«/g, '«')
    .replace(/Â»/g, '»')
    .replace(/Ã©/g, 'é')
    .replace(/Ã¨/g, 'è')
    .replace(/Ãª/g, 'ê')
    .replace(/Ã /g, 'à ')
    .replace(/Ã®/g, 'î')
    .replace(/Ã¯/g, 'ï')
    .replace(/Ã´/g, 'ô')
    .replace(/Ã»/g, 'û')
    .replace(/Ã§/g, 'ç')
    .replace(/Ã‰/g, 'É')
    .replace(/Ã€/g, 'À');
}

let changed = 0;
for (const f of walk(srcRoot)) {
  const original = fs.readFileSync(f, 'utf8');
  const fixed = fixContent(original);
  if (fixed !== original) {
    fs.writeFileSync(f, fixed, 'utf8');
    changed += 1;
    console.log('fixed:', path.relative(srcRoot, f));
  }
}

console.log(`Done. ${changed} file(s) updated.`);
