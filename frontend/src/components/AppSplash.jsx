import BrandLogo from './BrandLogo';
import { BRAND_APP_NAME } from '../config/brandAssets';

/** Splash léger — sans carrousel d’images (évite clignotements). */
export default function AppSplash({ message = 'Chargement…' }) {
  return (
    <div className="app-splash app-splash--solid" role="status" aria-live="polite">
      <div className="app-splash__inner">
        <BrandLogo variant="icon" className="app-splash__logo" />
        <h1 className="app-splash__title">{BRAND_APP_NAME}</h1>
        <p className="app-splash__msg">{message}</p>
        <div className="app-splash__bar" aria-hidden>
          <span />
        </div>
      </div>
    </div>
  );
}
