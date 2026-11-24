import { useState } from 'react';

/**
 * Échantillon de matière affiché à la place d'une photo produit.
 * La matière est déduite automatiquement de la catégorie (ou du nom) de l'article ;
 * la teinte varie selon le nom pour donner un nuancier vivant.
 * Si une photo est fournie, elle remplace l'échantillon.
 */

const MATERIALS = [
  { key: 'denim', label: 'DENIM', words: ['jean', 'denim', 'jeans'] },
  { key: 'wax', label: 'WAX', words: ['robe', 'wax', 'pagne', 'boubou', 'jupe', 'bazin', 'complet'] },
  { key: 'lin', label: 'LIN', words: ['chemise', 'lin', 'blouse', 'pantalon', 'costume', 'veste', 'tenue'] },
  { key: 'jersey', label: 'JERSEY', words: ['t-shirt', 'tshirt', 'tee', 'polo', 'pull', 'sweat', 'debardeur', 'débardeur', 'body', 'maillot'] },
  { key: 'toile', label: 'TOILE', words: ['basket', 'sneaker', 'tennis', 'toile', 'espadrille'] },
  { key: 'cuir', label: 'CUIR', words: ['chaussure', 'sandale', 'mocassin', 'escarpin', 'botte', 'sac', 'ceinture', 'portefeuille', 'cuir', 'talon', 'babouche', 'mule', 'claquette'] },
  { key: 'serge', label: 'SERGÉ', words: ['casquette', 'chapeau', 'bonnet', 'short', 'bermuda'] },
  { key: 'soie', label: 'SOIE', words: ['foulard', 'echarpe', 'écharpe', 'soie', 'voile', 'cravate', 'bijou', 'montre', 'lunette', 'parfum', 'accessoire'] },
];

const TONES = ['denim', 'terracotta', 'noir', 'sable', 'ivoire', 'olive'];

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export function materialFor(category, name) {
  const hay = `${normalize(category)} ${normalize(name)}`;
  const found = MATERIALS.find((m) => m.words.some((w) => hay.includes(normalize(w))));
  return found || { key: 'lin', label: 'TISSU' };
}

function toneFor(seed, material) {
  if (material === 'denim') return 'denim';
  const s = String(seed || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return TONES[h % TONES.length];
}

export default function Etoffe({ category, name, photo, tone: toneProp, mini = false, className = '', title }) {
  const [broken, setBroken] = useState(false);
  const mat = materialFor(category, name);
  const tone = toneProp || toneFor(name || category, mat.key);
  const showPhoto = photo && !broken;
  return (
    <span
      className={`etoffe etoffe--${mat.key} etoffe--tone-${tone}${mini ? ' etoffe--mini' : ''}${showPhoto ? ' etoffe--photo' : ''}${className ? ` ${className}` : ''}`}
      aria-hidden={title ? undefined : 'true'}
      title={title}
    >
      {showPhoto ? (
        <img src={photo} alt="" loading="lazy" onError={() => setBroken(true)} />
      ) : (
        !mini && <span className="etoffe__label">{mat.label}</span>
      )}
    </span>
  );
}
