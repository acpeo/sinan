// 统一空态：图标 + 标题 + 描述 + 可选补充区。
// 颜色一律走 --ink / --muted 变量，深浅主题自适应。此前各视图空态硬编码浅色
// （如 InflightView 的 .ifv-empty b{color:#181d19}），深色玻璃下标题直接隐身。
export function EmptyState({ icon = null, title, description = null, children = null, className = "", compact = false }) {
  return (
    <div className={`ui-empty${compact ? " ui-empty--compact" : ""}${className ? ` ${className}` : ""}`} role="status">
      {icon ? <div className="ui-empty-icon" aria-hidden="true">{icon}</div> : null}
      <div className="ui-empty-title">{title}</div>
      {description ? <div className="ui-empty-desc">{description}</div> : null}
      {children ? <div className="ui-empty-extra">{children}</div> : null}
    </div>
  );
}
