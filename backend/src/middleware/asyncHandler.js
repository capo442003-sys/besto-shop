/** Enveloppe les handlers async Express pour transmettre les erreurs au gestionnaire global. */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
