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
import './styles/maison/index.css';
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
