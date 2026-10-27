import { createContext, useCallback, useContext, useMemo, useState } from 'react';

const STORAGE_KEY = 'bmb_onboarding_v1';

const DEFAULT_STEPS = [
  { id: 'profile', label: 'Complétez votre profil (nom, mot de passe)' },
  { id: 'pv', label: 'Vérifiez votre point de vente' },
  { id: 'sale', label: 'Créez votre première vente' },
  { id: 'reglement', label: 'Découvrez l\'encaissement' },
];

function readState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeState(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

const OnboardingContext = createContext(null);

export function OnboardingProvider({ children }) {
  const [state, setState] = useState(() => readState() || {
    dismissed: false,
    completed: {},
  });

  const persist = useCallback((next) => {
    setState(next);
    writeState(next);
  }, []);

  const steps = DEFAULT_STEPS;
  const completedCount = steps.filter((s) => state.completed?.[s.id]).length;
  const allDone = completedCount >= steps.length;
  const showCard = !state.dismissed && !allDone;

  const completeStep = useCallback((stepId) => {
    persist({
      ...state,
      completed: { ...state.completed, [stepId]: true },
    });
  }, [persist, state]);

  const dismiss = useCallback(() => {
    persist({ ...state, dismissed: true });
  }, [persist, state]);

  const reset = useCallback(() => {
    persist({ dismissed: false, completed: {} });
  }, [persist]);

  const value = useMemo(() => ({
    steps,
    completed: state.completed || {},
    completedCount,
    allDone,
    showCard,
    completeStep,
    dismiss,
    reset,
  }), [steps, state.completed, completedCount, allDone, showCard, completeStep, dismiss, reset]);

  return (
    <OnboardingContext.Provider value={value}>
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error('useOnboarding requires OnboardingProvider');
  return ctx;
}
