/** Montants en GNF — toujours des entiers, pas de centimes. */
export const GNF_EPSILON = 1;

export function roundGnf(amount) {
  return Math.round(parseFloat(amount) || 0);
}

/** Reste à payer (0 si soldé ou écart d'arrondi ≤ 1 GNF). */
export function balanceDueGnf(total, paid) {
  const due = roundGnf(total) - roundGnf(paid);
  if (due <= GNF_EPSILON) return 0;
  return due;
}

export function isFullyPaidGnf(total, paid) {
  return balanceDueGnf(total, paid) === 0;
}

/** Ajuste un versement qui couvre le reste (arrondi affiché à la caisse). */
export function normalizeInstallmentGnf(reste, installment) {
  const r = Math.max(0, roundGnf(reste));
  const pay = roundGnf(installment);
  if (pay <= 0) return 0;
  if (pay >= r - GNF_EPSILON) return r;
  return pay;
}
