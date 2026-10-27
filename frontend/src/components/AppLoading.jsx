import BrandLogo from './BrandLogo';

/** Chargement léger après connexion — sans carrousel (évite erreurs JS). */
export default function AppLoading({ message = 'Chargement…' }) {
  return (
    <div className="app-loading" role="status" aria-live="polite">
      <div className="app-loading__card">
        <BrandLogo variant="icon" className="app-loading__logo" />
        <h1 className="app-loading__title">BESTO SHOP</h1>
        <p className="app-loading__msg">{message}</p>
        <div className="app-loading__bar" aria-hidden>
          <span />
        </div>
      </div>
    </div>
  );
}
