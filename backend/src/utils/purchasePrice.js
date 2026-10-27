/** Coût moyen pondéré (PMP) après entrée en stock */
export function computeWeightedPurchasePrice(qtyBefore, oldPrice, addQty, incomingPrice) {
  const stockBefore = Math.max(0, parseFloat(qtyBefore) || 0);
  const added = Math.max(0, parseFloat(addQty) || 0);
  const previous = Math.max(0, parseFloat(oldPrice) || 0);
  const incoming = Math.max(0, parseFloat(incomingPrice) || 0);

  if (added <= 0) return previous;
  if (stockBefore <= 0 || previous <= 0) return incoming;
  if (incoming <= 0) return previous;

  return (stockBefore * previous + added * incoming) / (stockBefore + added);
}
