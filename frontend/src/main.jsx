import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { StoreSettingsProvider } from './context/StoreSettingsContext';
import { ConfirmProvider } from './context/ConfirmContext';
import { ToastProvider } from './context/ToastContext';
import DocumentBranding from './components/DocumentBranding';
import ToastStack from './components/ToastStack';
import { PwaProvider } from './context/PwaContext';
import { PvFilterProvider } from './context/PvFilterContext';
import { OnboardingProvider } from './context/OnboardingContext';
import ErrorBoundary from './components/ErrorBoundary';
import './styles/tokens.css';
import './styles/global.css';
import './styles/ui-system.css';
import './styles/pro.css';
import './styles/bmb-ui.css';
import './styles/responsive.css';
import './styles/theme-dark.css';
import './styles/brand-premium.css';
import './styles/desktop-app.css';
import './styles/mockup-2026.css';
import './styles/bmb-premium-2026.css';
import './styles/mobile-premium-2026.css';
import './styles/pwa-mobile-home.css';
import './styles/pwa-viewport.css';
import './styles/dashboard-erp.css';
import './styles/dashboard-pwa.css';
import './styles/dashboard-gestionnaire.css';
import './styles/design-balance.css';
import './styles/bmb-elite-pro.css';
import './styles/bmb-layout-pro.css';
import './styles/bmb-pos-caisse-v4.css';
import './styles/bmb-pos-refine.css';
import './styles/pwa-mobile-ops.css';
import './styles/pos-mobile-pwa.css';
import './styles/seller-dash.css';
import './styles/manager-dash.css';
import './styles/design-harmony.css';
import './styles/ventes-module-fix.css';
import { applyPwaHtmlClasses } from './utils/pwaEnv';

applyPwaHtmlClasses();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <StoreSettingsProvider>
        <ConfirmProvider>
          <DocumentBranding />
          <ToastProvider>
            <ToastStack />
            <PwaProvider>
            <AuthProvider>
              <OnboardingProvider>
              <PvFilterProvider>
              <ErrorBoundary>
                <App />
              </ErrorBoundary>
              </PvFilterProvider>
              </OnboardingProvider>
            </AuthProvider>
            </PwaProvider>
          </ToastProvider>
        </ConfirmProvider>
      </StoreSettingsProvider>
    </BrowserRouter>
  </React.StrictMode>
);
