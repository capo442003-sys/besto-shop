export default function HelpTip({ text, label = 'Aide' }) {
  if (!text) return null;
  return (
    <span className="bmb-help-tip" title={text} aria-label={text}>
      <button type="button" className="bmb-help-tip__btn" tabIndex={-1} aria-hidden>
        ?
      </button>
      <span className="bmb-help-tip__label visually-hidden">{label}</span>
    </span>
  );
}
