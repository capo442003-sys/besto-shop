export default function LoadingInline({ label = 'Chargement…' }) {
  return (
    <div className="bmb-loading-inline" role="status" aria-live="polite">
      <span className="bmb-loading-inline__spinner" aria-hidden />
      <span>{label}</span>
    </div>
  );
}
