import { forwardRef } from 'react';
import BrandLogo from './BrandLogo';
import { useStoreSettings } from '../context/StoreSettingsContext';
import { formatDate } from '../utils/format';
import { formatStoreActivityLine, formatStorePhonesSlash } from '../utils/storeFormat';
import { printTableCellClass } from '../utils/printTableColumns';

function formatReportDate(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'string' && /^\d{2}\/\d{2}\/\d{4}/.test(value.trim())) return value;
  return formatDate(value);
}

/**
 * Rapport / liste — même design que la facture client (bandeau vert, tableau pro).
 */
const PrintReport = forwardRef(function PrintReport({
  store: storeProp,
  title,
  subtitle,
  date,
  filters = [],
  columns = [],
  rows = [],
  footRows = [],
  footerNote,
  summary = [],
  emptyMessage = 'Aucune donnée',
}, ref) {
  const { store: ctxStore } = useStoreSettings();
  const s = storeProp || ctxStore || {};
  const dateLabel = formatReportDate(date);
  const printedAt = dateLabel || formatDate(new Date());
  const activeFilters = filters.filter((f) => f.value != null && f.value !== '' && f.value !== '—');
  const tagline = formatStoreActivityLine(s);
  const phones = formatStorePhonesSlash(s);

  return (
    <article ref={ref} className="bmb-print-doc bmb-print-doc--invoice">
      <div className="bmb-inv">
        <header className="bmb-inv__header">
          <div className="bmb-inv__header-brand">
            <BrandLogo variant="icon" className="bmb-inv__logo" />
            <div className="bmb-inv__header-text">
              <h1 className="bmb-inv__store-name">{s.store_name || 'BESTO SHOP'}</h1>
              {tagline ? <p className="bmb-inv__tagline">{tagline}</p> : null}
            </div>
          </div>
          <div className="bmb-inv__header-doc">
            <div className="bmb-inv__doc-badge">{title}</div>
            <time className="bmb-inv__doc-date">{printedAt}</time>
          </div>
        </header>

        <div className="bmb-inv__body">
          {(subtitle || activeFilters.length > 0) && (
            <section className="bmb-inv__refs bmb-inv__refs--report">
              <div className="bmb-inv__refs-grid">
                {subtitle && (
                  <div className="bmb-inv__ref-card">
                    <span className="bmb-inv__ref-label">Document</span>
                    <span className="bmb-inv__ref-value">{subtitle}</span>
                  </div>
                )}
                {activeFilters.map((f) => (
                  <div key={f.label} className="bmb-inv__ref-card">
                    <span className="bmb-inv__ref-label">{f.label}</span>
                    <span className="bmb-inv__ref-value">{f.value}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {summary.length > 0 && (
            <div className="bmb-inv__summary-row" role="group" aria-label="Totaux">
              {summary.map((item) => (
                <div
                  key={item.label}
                  className={`bmb-inv__summary-item${item.emphasis ? ' bmb-inv__summary-item--emphasis' : ''}`}
                >
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
          )}

          <div className="bmb-inv__table-wrap">
            <table className="bmb-inv__table bmb-inv__table--report">
              {columns.length > 0 && (
                <thead>
                  <tr>
                    {columns.map((col) => (
                      <th
                        key={col.key || col.label}
                        className={printTableCellClass(col)}
                      >
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
              )}
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={columns.length || 1} className="bmb-inv__table-empty">
                      {emptyMessage}
                    </td>
                  </tr>
                ) : rows.map((row, idx) => (
                  <tr key={row.id ?? idx}>
                    {columns.map((col) => (
                      <td
                        key={col.key || col.label}
                        className={printTableCellClass(col)}
                      >
                        {row[col.key]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {footRows.length > 0 && (
                <tfoot>
                  {footRows.map((fr, i) => (
                    <tr key={i} className="bmb-inv__table-foot">
                      {fr.cells.map((cell, j) => (
                        <td
                          key={j}
                          colSpan={cell.colSpan || 1}
                          className={cell.align === 'right' ? 'is-num' : undefined}
                        >
                          <strong>{cell.value}</strong>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tfoot>
              )}
            </table>
          </div>

          {(s.address || phones || s.email) && (
            <p className="bmb-inv__footnote bmb-inv__footnote--report">
              {[s.address, phones, s.email].filter(Boolean).join(' · ')}
            </p>
          )}
          {footerNote && (
            <p className="bmb-inv__footnote">{footerNote}</p>
          )}
        </div>
      </div>
    </article>
  );
});

export default PrintReport;
