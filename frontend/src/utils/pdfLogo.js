import { logoSrc } from '../context/StoreSettingsContext';
import { resolveAssetUrl } from '../config/api';
import { getToken } from './authStorage';
import { BRAND_LOGO } from '../config/brandAssets';

const FALLBACK_LOGOS = [BRAND_LOGO, '/brand/besto-logo.png'];
const LOGO_SIZE_MM = 14;

let logoCache = { key: null, logo: null };

function pdfImageFormat(mime = '', dataUrl = '') {
  const m = String(mime).toLowerCase();
  const d = String(dataUrl).toLowerCase();
  if (m.includes('jpeg') || m.includes('jpg') || d.startsWith('data:image/jp')) return 'JPEG';
  return 'PNG';
}

async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Lecture logo impossible'));
    reader.readAsDataURL(blob);
  });
}

async function rasterizeBlobToPng(blob) {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Image logo illisible'));
      el.src = objectUrl;
    });
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    const scale = Math.min(size / img.width, size / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function fetchLogoBlob(url) {
  const fullUrl = resolveAssetUrl(url);
  if (!fullUrl) throw new Error('URL logo invalide');
  const token = getToken();
  const res = await fetch(fullUrl, {
    method: 'GET',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
    mode: 'cors',
  });
  if (!res.ok) throw new Error(`Logo introuvable (${res.status})`);
  return res.blob();
}

async function loadLogoFromUrl(url) {
  const blob = await fetchLogoBlob(url);
  const mime = blob.type || '';

  if (mime.includes('svg') || String(url).toLowerCase().endsWith('.svg')) {
    const dataUrl = await rasterizeBlobToPng(blob);
    return { dataUrl, format: 'PNG', sizeMm: LOGO_SIZE_MM };
  }

  if (mime.includes('webp') || mime.includes('gif') || !mime.startsWith('image/')) {
    const dataUrl = await rasterizeBlobToPng(blob);
    return { dataUrl, format: 'PNG', sizeMm: LOGO_SIZE_MM };
  }

  const dataUrl = await blobToDataUrl(blob);
  const format = pdfImageFormat(mime, dataUrl);
  return { dataUrl, format, sizeMm: LOGO_SIZE_MM };
}

/**
 * Charge le logo magasin (upload API ou logo marque BESTO SHOP) pour jsPDF.
 * @returns {Promise<{ dataUrl: string, format: 'PNG'|'JPEG', sizeMm: number } | null>}
 */
export async function loadPdfLogo(store = {}) {
  const candidates = [];
  const custom = logoSrc(store.logo_url, store.updated_at);
  if (custom) candidates.push(store.logo_url);
  FALLBACK_LOGOS.forEach((path) => {
    if (!candidates.includes(path)) candidates.push(path);
  });

  for (const url of candidates) {
    const cacheKey = logoSrc(url === store.logo_url ? store.logo_url : url, store.updated_at) || url;
    if (logoCache.key === cacheKey && logoCache.logo) return logoCache.logo;
    try {
      const logo = await loadLogoFromUrl(url);
      logoCache = { key: cacheKey, logo };
      return logo;
    } catch {
      /* essayer le fallback suivant */
    }
  }

  return null;
}

/** Invalide le cache après changement de logo */
export function clearPdfLogoCache() {
  logoCache = { key: null, logo: null };
}

export { LOGO_SIZE_MM };
