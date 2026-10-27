import { Component } from 'react';
import { APP_VERSION } from '../constants/version';

async function hardReload() {
  if ('serviceWorker' in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
  }
  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  }
  window.location.reload();
}

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('BESTO UI error:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="card api-error-panel" style={{ margin: '2rem', maxWidth: 560 }}>
          <h2>Erreur d&apos;affichage</h2>
          <p className="alert alert-error">{this.state.error.message}</p>
          <p className="form-hint">
            Version {APP_VERSION}. Essayez : vider le cache (Ctrl+F5), relancer BESTO SHOP, ou exécuter{' '}
            <code>npm run build --prefix frontend</code> puis redémarrer le backend.
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => window.location.reload()}
            >
              Recharger
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => hardReload()}
            >
              Vider le cache et recharger
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
