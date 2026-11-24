import { useEffect } from 'react';

const PANEL_SELECTOR = '.inline-form-panel';

function reveal(panel) {
  // Les fenêtres (modales) gèrent déjà leur affichage.
  if (!panel || panel.closest('.bmb-form-overlay, .bmb-encaisse-modal, .confirm-overlay')) return;
  window.requestAnimationFrame(() => {
    const rect = panel.getBoundingClientRect();
    const fullyVisible = rect.top >= 0 && rect.bottom <= window.innerHeight;
    if (!fullyVisible) {
      panel.scrollIntoView({ behavior: 'smooth', block: rect.height > window.innerHeight * 0.8 ? 'start' : 'center' });
    }
    const field = panel.querySelector('input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])');
    if (field && !panel.contains(document.activeElement)) {
      field.focus({ preventScroll: true });
    }
  });
}

/**
 * Les formulaires « en ligne » (Opération de caisse, Clôture, Charge,
 * Ravitaillement, Salaire…) s'ouvraient parfois sous les cartes, hors de
 * l'écran : rien ne semblait se passer. À leur apparition, on les amène
 * dans la vue et on place le curseur dans le premier champ.
 */
export default function useRevealInlineForms() {
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return undefined;
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          // Seul un panneau ajouté lui-même (ouverture d'un formulaire) est
          // concerné : un panneau présent dès le chargement de la page ne
          // provoque ni défilement ni prise de curseur.
          if (node.matches(PANEL_SELECTOR)) reveal(node);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
}
