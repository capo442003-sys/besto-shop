import { alertVariant } from '../utils/alertMessage';

export default function AlertBanner({ message, onClose, className = '', variant: variantProp }) {
  if (!message) return null;
  const variant = variantProp || alertVariant(message);
  const cls = variant === 'error' ? 'alert-error' : variant === 'warning' ? 'alert-warning' : 'alert-success';
  return (
    <div className={`alert ${cls} ${className}`.trim()} role={variant === 'error' ? 'alert' : 'status'}>
      {message}
      {onClose && (
        <button type="button" className="alert-banner__close" onClick={onClose} aria-label="Fermer">×</button>
      )}
    </div>
  );
}
