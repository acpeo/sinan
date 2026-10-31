// 页面内部的二级视图切换：只负责展示与选择，不持有业务状态。
export function ViewSwitch({ value, onChange, options, ariaLabel, className = "" }) {
  return (
    <div className={`ui-view-switch${className ? ` ${className}` : ""}`} role="tablist" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          className={value === option.value ? "is-on" : ""}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {option.count != null ? <span className="ui-view-switch-count">{option.count}</span> : null}
        </button>
      ))}
    </div>
  );
}
