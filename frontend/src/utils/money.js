/** Montants en GNF — entiers uniquement (aligné backend). */
export const GNF_EPSILON = 1;

export function roundGnf(amount) {
  return Math.round(parseFloat(amount) || 0);
}

export function balanceDueGnf(total, paid) {
  const due = roundGnf(total) - roundGnf(paid);
  if (due <= GNF_EPSILON) return 0;
  return due;
}

export function isFullyPaidGnf(total, paid) {
  return balanceDueGnf(total, paid) === 0;
}
