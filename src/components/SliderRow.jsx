


export function SliderRow({ label, hint, min, max, step, percent, ariaLabel, onChange }) {
  return (
    <div className="settings-subsection">
      <h3>{label}</h3>
      <p className="settings-muted">{hint}</p>
      <div className="glass-slider-row">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={percent}
          aria-label={ariaLabel}
          onChange={(event) => onChange(Number(event.target.value) / 100)}
        />
        <em>{percent}%</em>
      </div>
    </div>
  );
}

