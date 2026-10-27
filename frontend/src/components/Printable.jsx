import { forwardRef } from 'react';

/** Conteneur léger pour listes / rapports imprimables depuis l'écran */
const Printable = forwardRef(function Printable({ children, title, subtitle }, ref) {
  return (
    <div ref={ref} className="printable bmb-print-doc bmb-print-doc--report">
      {(title || subtitle) && (
        <header className="bmb-print-doc__report-head">
          {title && <h2>{title}</h2>}
          {subtitle && <p>{subtitle}</p>}
        </header>
      )}
      {children}
    </div>
  );
});

export default Printable;
