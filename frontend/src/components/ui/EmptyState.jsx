/**
 * État vide unifié — remplace les <td className="table-empty"> et blocs ad hoc.
 */
export default function EmptyState({
  icon = '○',
  title = 'Aucun élément',
  description,
  action,
  compact = false,
  className = '',
}) {
  return (
    <div className={`bmb-empty${compact ? ' bmb-empty--compact' : ''}${className ? ` ${className}` : ''}`} role="status">
      <div className="bmb-empty__icon" aria-hidden>{icon}</div>
      <p className="bmb-empty__title">{title}</p>
      {description && <p className="bmb-empty__text">{description}</p>}
      {action}
    </div>
  );
}
