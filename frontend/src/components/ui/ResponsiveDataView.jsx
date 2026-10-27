/**
 * Affiche un tableau sur desktop et des cartes sur mobile (< 768px).
 */
export default function ResponsiveDataView({ table, cards, className = '' }) {
  return (
    <div className={`bmb-responsive-data bmb-responsive-data--cards-mobile${className ? ` ${className}` : ''}`}>
      <div className="bmb-responsive-data__table">{table}</div>
      <div className="bmb-responsive-data__cards">{cards}</div>
    </div>
  );
}
