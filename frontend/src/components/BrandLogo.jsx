import { useEffect, useState } from 'react';
import { logoSrc, useStoreSettings } from '../context/StoreSettingsContext';
import { BRAND_LOGO } from '../config/brandAssets';

const DEFAULT_LOGO = BRAND_LOGO;

/** Logo BESTO SHOP — bascule sur le logo marque si l’upload magasin est cassé */
export default function BrandLogo({ variant = 'full', className = '' }) {
  const { store } = useStoreSettings();
  const storeName = store?.store_name?.trim() || 'BESTO SHOP';
  const customSrc = logoSrc(store?.logo_url, store?.updated_at);
  const [src, setSrc] = useState(customSrc || DEFAULT_LOGO);

  useEffect(() => {
    setSrc(customSrc || DEFAULT_LOGO);
  }, [customSrc]);

  const isDefaultLogo = !customSrc || src === DEFAULT_LOGO;

  const img = (
    <img
      src={src}
      alt={storeName}
      className={`brand-logo__img${isDefaultLogo ? ' brand-logo__img--round' : ''}`}
      onError={() => {
        if (src !== DEFAULT_LOGO) setSrc(DEFAULT_LOGO);
      }}
    />
  );

  if (variant === 'icon') {
    return (
      <div className={`brand-logo brand-logo--icon ${isDefaultLogo ? 'brand-logo--default' : 'brand-logo--custom'} ${className}`.trim()}>
        {img}
      </div>
    );
  }

  return (
    <div className={`brand-logo brand-logo--${variant} ${isDefaultLogo ? 'brand-logo--default' : 'brand-logo--custom'} ${className}`.trim()}>
      {img}
      <div className="brand-logo__text">
        <span className="brand-logo__name">{storeName}</span>
      </div>
    </div>
  );
}
