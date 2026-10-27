import { useState } from 'react';

const STEPS = [
  { title: 'Tableau de bord', text: 'Suivez ventes, stocks bas et alertes du jour.' },
  { title: 'Caisse', text: 'Ventes → Vendre (F2 recherche, F10 valider). Ctrl+K pour naviguer.' },
  { title: 'Import', text: 'Paramètres → Import données pour reprendre votre ancien catalogue.' },
  { title: 'Clôture', text: 'Finances → Caisse → Clôture (Z) en fin de journée.' },
];

const KEY = 'bmb-tutorial-v12-done';

export default function TutorialModal() {
  const [open, setOpen] = useState(() => !localStorage.getItem(KEY));
  const [step, setStep] = useState(0);

  if (!open) return null;

  const finish = () => {
    localStorage.setItem(KEY, '1');
    setOpen(false);
  };

  const s = STEPS[step];

  return (
    <div className="tutorial-overlay" role="dialog" aria-modal="true">
      <div className="tutorial-card card">
        <h2>Bienvenue dans BESTO SHOP</h2>
        <p><strong>{s.title}</strong> — {s.text}</p>
        <p className="form-hint">Étape {step + 1} / {STEPS.length}</p>
        <div className="toolbar-actions">
          {step > 0 && (
            <button type="button" className="btn btn-secondary" onClick={() => setStep((n) => n - 1)}>Précédent</button>
          )}
          {step < STEPS.length - 1 ? (
            <button type="button" className="btn btn-primary" onClick={() => setStep((n) => n + 1)}>Suivant</button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={finish}>Commencer</button>
          )}
          <button type="button" className="btn btn-ghost" onClick={finish}>Passer</button>
        </div>
      </div>
    </div>
  );
}
