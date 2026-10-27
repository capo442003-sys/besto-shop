/**
 * Carte mobile pour une ligne de données (complément du tableau desktop).
 */
export default function DataCard({
  title,
  subtitle,
  badge,
  fields = [],
  actions,
  onClick,
}) {
  const Tag = onClick ? 'button' : 'article';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      className="bmb-data-card"
      onClick={onClick}
    >
      <div className="bmb-data-card__head">
        <div>
          <div className="bmb-data-card__title">{title}</div>
          {subtitle && <div className="bmb-data-card__subtitle">{subtitle}</div>}
        </div>
        {badge}
      </div>
      {fields.length > 0 && (
        <div className="bmb-data-card__grid">
          {fields.map((f) => (
            <div key={f.label} className="bmb-data-card__field">
              <span className="bmb-data-card__label">{f.label}</span>
              <span className={`bmb-data-card__value${f.strong ? ' bmb-data-card__value--strong' : ''}`}>
                {f.value ?? '—'}
              </span>
            </div>
          ))}
        </div>
      )}
      {actions && <div className="bmb-data-card__actions">{actions}</div>}
    </Tag>
  );
}
