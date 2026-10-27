import { forwardRef, useEffect, useState } from 'react';
import BrandLogo from './BrandLogo';
import { formatStoreActivityLine, formatStorePhonesSlash } from '../utils/storeFormat';
import { clientTypeLabel } from '../utils/format';
import { generateQrDataUrl } from '../utils/qrCode';
import { printTableCellClass } from '../utils/printTableColumns';

const PrintDocument = forwardRef(function PrintDocument({
  docTitle = 'Facture Client',
  docDateTime,
  store,
  invoiceNumber,
  invoiceDate,
  sellerName,
  clientName,
  clientCode,
  clientAddress,
  clientPhone,
  clientType,
  qrValue,
  columns = [],
  lines = [],
  totals = [],
  highlight,
  listTitle,
  listItems = [],
  footerNotes = [],
  signatures = { left: 'Le Client', right: 'Le Vendeur / La Direction' },
  children,
}, ref) {
  const s = store || {};
  const [qrSrc, setQrSrc] = useState(null);
  const printedAt = docDateTime || new Date().toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
  const footerLine = footerNotes.filter(Boolean).join(' — ');
  const storeName = s.store_name || 'BESTO SHOP';
  const tagline = formatStoreActivityLine(s);
  const phones = formatStorePhonesSlash(s);

  useEffect(() => {
    let active = true;
    generateQrDataUrl(qrValue || invoiceNumber).then((url) => {
      if (active) setQrSrc(url);
    }).catch(() => {
      if (active) setQrSrc(null);
    });
    return () => { active = false; };
  }, [qrValue, invoiceNumber]);

  return (
    <article ref={ref} className="bmb-print-doc bmb-print-doc--invoice">
      <div className="bmb-inv">
        <header className="bmb-inv__header">
          <div className="bmb-inv__header-brand">
            <BrandLogo variant="icon" className="bmb-inv__logo" />
            <div className="bmb-inv__header-text">
              <h1 className="bmb-inv__store-name">{storeName}</h1>
              {tagline ? <p className="bmb-inv__tagline">{tagline}</p> : null}
            </div>
          </div>
          <div className="bmb-inv__header-doc">
            <div className="bmb-inv__doc-badge">{docTitle}</div>
            <time className="bmb-inv__doc-date">{printedAt}</time>
          </div>
        </header>

        <div className="bmb-inv__body">
          <section className="bmb-inv__refs">
            <div className="bmb-inv__refs-grid">
              {invoiceNumber && (
                <div className="bmb-inv__ref-card">
                  <span className="bmb-inv__ref-label">N° Facture</span>
                  <span className="bmb-inv__ref-value">{invoiceNumber}</span>
                </div>
              )}
              {invoiceDate && (
                <div className="bmb-inv__ref-card">
                  <span className="bmb-inv__ref-label">Date de facturation</span>
                  <span className="bmb-inv__ref-value">{invoiceDate}</span>
                </div>
              )}
              {sellerName && (
                <div className="bmb-inv__ref-card">
                  <span className="bmb-inv__ref-label">Vendeur</span>
                  <span className="bmb-inv__ref-value">{sellerName}</span>
                </div>
              )}
            </div>
            {qrSrc && (
              <div className="bmb-inv__qr" aria-hidden="true">
                <img src={qrSrc} alt="" width={72} height={72} />
              </div>
            )}
          </section>

          <section className="bmb-inv__parties">
            <div className="bmb-inv__party">
              <h3 className="bmb-inv__party-title">Émetteur</h3>
              <p className="bmb-inv__party-name">{storeName}</p>
              <ul className="bmb-inv__party-details">
                {s.address && <li>{s.address}</li>}
                {phones && <li>{phones}</li>}
                {s.email && <li>{s.email}</li>}
              </ul>
            </div>
            <div className="bmb-inv__party bmb-inv__party--client">
              <h3 className="bmb-inv__party-title">Facturé à</h3>
              {clientName ? (
                <>
                  <p className="bmb-inv__party-name">{clientName}</p>
                  <dl className="bmb-inv__party-dl">
                    <div>
                      <dt>Code client</dt>
                      <dd>{clientCode || '—'}</dd>
                    </div>
                    {clientType && (
                      <div>
                        <dt>Type</dt>
                        <dd>{clientTypeLabel(clientType)}</dd>
                      </div>
                    )}
                    <div>
                      <dt>Téléphone</dt>
                      <dd>{clientPhone?.trim() || 'Non renseigné'}</dd>
                    </div>
                    <div>
                      <dt>Adresse</dt>
                      <dd>{clientAddress?.trim() || 'Non renseigné'}</dd>
                    </div>
                  </dl>
                </>
              ) : (
                <p className="bmb-inv__party-empty">Client non renseigné</p>
              )}
            </div>
          </section>

          {highlight && (
            <div className="bmb-inv__highlight">
              <div className="bmb-inv__highlight-main">
                <span className="bmb-inv__highlight-label">{highlight.label}</span>
                <strong className="bmb-inv__highlight-value">{highlight.value}</strong>
              </div>
              {highlight.detail && (
                <span className="bmb-inv__highlight-detail">{highlight.detail}</span>
              )}
            </div>
          )}

          {children}

          {columns.length > 0 && (
            <div className="bmb-inv__table-wrap">
              <table className="bmb-inv__table">
                <thead>
                  <tr>
                    {columns.map((col) => (
                      <th
                        key={col.key}
                        className={printTableCellClass(col)}
                      >
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lines.length === 0 ? (
                    <tr>
                      <td colSpan={columns.length} className="bmb-inv__table-empty">
                        Aucune ligne
                      </td>
                    </tr>
                  ) : lines.map((line, idx) => (
                    <tr key={line.id ?? idx}>
                      {columns.map((col) => (
                        <td
                          key={col.key}
                          className={printTableCellClass(col)}
                        >
                          {line[col.key]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(totals.length > 0 || listItems.length > 0) && (
            <div className={`bmb-inv__summary${!columns.length && !listItems.length ? ' bmb-inv__summary--solo' : ''}`}>
              {listItems.length > 0 && (
                <div className="bmb-inv__payments">
                  <h4 className="bmb-inv__payments-title">{listTitle || 'Versements enregistrés'}</h4>
                  <ul className="bmb-inv__payments-list">
                    {listItems.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
              {totals.length > 0 && (
                <div className="bmb-inv__totals">
                  {totals.map((row, i) => (
                    <div
                      key={row.label}
                      className={`bmb-inv__total-row${i === totals.length - 1 ? ' is-due' : ''}`}
                    >
                      <span>{row.label}</span>
                      <strong>{row.value}</strong>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {(signatures?.left || signatures?.right) && (
            <footer className="bmb-inv__signatures">
              <div className="bmb-inv__sign-block">
                <div className="bmb-inv__sign-line" />
                <span>{signatures.left}</span>
              </div>
              <div className="bmb-inv__sign-block">
                <div className="bmb-inv__sign-line" />
                <span>{signatures.right}</span>
              </div>
            </footer>
          )}

          {footerLine && (
            <p className="bmb-inv__footnote">{footerLine}</p>
          )}
        </div>
      </div>
    </article>
  );
});

export default PrintDocument;
