import QRCode from 'qrcode';

/** Génère un QR code (data URL PNG) pour factures / documents */
export async function generateQrDataUrl(text, size = 88) {
  const value = String(text || '').trim();
  if (!value) return null;
  return QRCode.toDataURL(value, {
    width: size,
    margin: 1,
    color: { dark: '#000000', light: '#ffffff' },
  });
}
