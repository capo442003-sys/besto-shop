import { useState, useEffect, useRef, forwardRef, useLayoutEffect, useCallback } from 'react';

function getDropdownMode(wrapEl) {
  if (!wrapEl) return { useFixed: false, forceBelow: false };
  const inOverlay = Boolean(wrapEl.closest('.bmb-form-overlay'));
  const inPosField = Boolean(wrapEl.closest('.search-select--pos-product, .search-select--pos-client'));
  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 960;
  const useFixed = inOverlay || isMobile || inPosField;
  const forceBelow = inOverlay || inPosField;
  return { useFixed, forceBelow };
}

/**
 * Liste déroulante avec saisie / recherche (async ou locale).
 */
const SearchSelect = forwardRef(function SearchSelect({
  label,
  value,
  onChange,
  loadOptions,
  getLabel = (o) => o.label ?? '',
  getValue = (o) => String(o.value ?? ''),
  placeholder = 'Rechercher…',
  required = false,
  disabled = false,
  allowClear = false,
  clearLabel = '— Aucun —',
  minSearch = 0,
  debounceMs = 280,
  selectedOption = null,
  hint,
  allowCreate = false,
  createMinLength = 2,
  getCreateLabel = (q) => `Créer « ${q.trim()} »`,
  onCreateOption,
  className = '',
  listClassName = '',
  listMaxHeight = 260,
}, ref) {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const timerRef = useRef(null);
  const [listPos, setListPos] = useState(null);
  const dropdownMode = open ? getDropdownMode(wrapRef.current) : { useFixed: false, forceBelow: false };
  const fixedDropdown = dropdownMode.useFixed;
  const forceBelow = dropdownMode.forceBelow;

  const updateListPos = useCallback(() => {
    const el = inputRef.current;
    const mode = getDropdownMode(wrapRef.current);
    if (!el || !open || !mode.useFixed) {
      setListPos(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    const vw = window.visualViewport?.width ?? window.innerWidth;
    const vh = window.visualViewport?.height ?? window.innerHeight;
    const margin = 10;
    const width = Math.min(rect.width, vw - margin * 2);
    const left = Math.max(margin, Math.min(rect.left, vw - width - margin));
    const spaceBelow = vh - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    const preferBelow = mode.forceBelow || spaceBelow >= 100 || spaceBelow >= spaceAbove;
    const maxHeight = Math.max(96, Math.min(listMaxHeight, preferBelow ? spaceBelow - 6 : spaceAbove - 6));

    setListPos({
      position: 'fixed',
      left: `${left}px`,
      width: `${width}px`,
      top: preferBelow ? `${rect.bottom + 4}px` : undefined,
      bottom: preferBelow ? undefined : `${vh - rect.top + 4}px`,
      maxHeight: `${maxHeight}px`,
      zIndex: 10060,
    });
  }, [open, listMaxHeight]);

  useLayoutEffect(() => {
    updateListPos();
    if (!open || !fixedDropdown) return undefined;
    const vv = window.visualViewport;
    window.addEventListener('resize', updateListPos);
    window.addEventListener('scroll', updateListPos, true);
    vv?.addEventListener('resize', updateListPos);
    vv?.addEventListener('scroll', updateListPos);
    return () => {
      window.removeEventListener('resize', updateListPos);
      window.removeEventListener('scroll', updateListPos, true);
      vv?.removeEventListener('resize', updateListPos);
      vv?.removeEventListener('scroll', updateListPos);
    };
  }, [open, fixedDropdown, updateListPos, query, options.length, loading]);

  const setRefs = (node) => {
    inputRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  };

  const displayLabel = selectedOption ? getLabel(selectedOption) : '';

  useEffect(() => {
    if (!open) return undefined;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      if (query.length < minSearch && query.length > 0) {
        setOptions([]);
        return;
      }
      setLoading(true);
      setLoadError('');
      try {
        const items = await loadOptions(query);
        setOptions(Array.isArray(items) ? items : []);
      } catch {
        setOptions([]);
        setLoadError('Recherche indisponible — vérifiez la connexion');
      } finally {
        setLoading(false);
      }
    }, debounceMs);
    return () => clearTimeout(timerRef.current);
  }, [query, open, loadOptions, minSearch, debounceMs]);

  useEffect(() => {
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const pick = (opt) => {
    const v = getValue(opt);
    onChange(v, opt);
    setQuery('');
    setOpen(false);
  };

  const createNew = async () => {
    const trimmed = query.trim();
    if (!trimmed || !onCreateOption) return;
    setLoading(true);
    setLoadError('');
    try {
      const opt = await onCreateOption(trimmed);
      if (opt) pick(opt);
    } catch {
      setLoadError('Impossible de créer cet élément');
    } finally {
      setLoading(false);
    }
  };

  const trimmedQuery = query.trim();
  const showCreate = allowCreate && onCreateOption && !loading
    && trimmedQuery.length >= createMinLength
    && !options.some((o) => getLabel(o).toLowerCase() === trimmedQuery.toLowerCase());

  const inputValue = open ? query : displayLabel;

  return (
    <div className={`form-group search-select${disabled ? ' search-select--disabled' : ''}${className ? ` ${className}` : ''}`} ref={wrapRef}>
      {label && (
        <label>
          {label}
          {required ? ' *' : ''}
        </label>
      )}
      <div className="search-select__control">
        <input
          ref={setRefs}
          className="search-input search-select__input"
          value={inputValue}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          onFocus={() => {
            setOpen(true);
            setQuery('');
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            if (!e.target.value && allowClear) onChange('', null);
          }}
        />
        {allowClear && value && !open && (
          <button
            type="button"
            className="search-select__clear"
            onClick={() => onChange('', null)}
            aria-label="Effacer"
          >
            ×
          </button>
        )}
      </div>
      {hint && !open && <p className="search-select__hint">{hint}</p>}
      {open && (
        <ul
          className={`search-select__list${fixedDropdown ? ' search-select__list--fixed' : ''}${listClassName ? ` ${listClassName}` : ''}`}
          role="listbox"
          style={listPos || undefined}
        >
          {loading && <li className="search-select__empty">Recherche…</li>}
          {!loading && allowClear && (
            <li>
              <button type="button" className="search-select__option" onClick={() => pick({ value: '', label: clearLabel })}>
                {clearLabel}
              </button>
            </li>
          )}
          {!loading && options.map((opt) => {
            const v = getValue(opt);
            return (
              <li key={v || getLabel(opt)}>
                <button
                  type="button"
                  className={`search-select__option${String(value) === v ? ' search-select__option--active' : ''}`}
                  onClick={() => pick(opt)}
                >
                  {getLabel(opt)}
                </button>
              </li>
            );
          })}
          {!loading && showCreate && (
            <li>
              <button type="button" className="search-select__option search-select__option--create" onClick={createNew}>
                {getCreateLabel(trimmedQuery)}
              </button>
            </li>
          )}
          {!loading && !options.length && !showCreate && (
            <li className="search-select__empty">
              {loadError || (query ? 'Aucun résultat' : 'Saisissez pour rechercher')}
            </li>
          )}
        </ul>
      )}
    </div>
  );
});

export default SearchSelect;
