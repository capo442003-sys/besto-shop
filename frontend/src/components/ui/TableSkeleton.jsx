/**
 * Placeholder pendant le chargement des listes tabulaires.
 */
export default function TableSkeleton({ rows = 5, columns = 4 }) {
  return (
    <div className="bmb-table-skeleton" aria-hidden aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="bmb-table-skeleton__row">
          {Array.from({ length: columns }, (__, j) => (
            <div
              key={j}
              className={`bmb-skeleton bmb-skeleton--text${j === 0 ? ' bmb-skeleton--title' : ''}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
