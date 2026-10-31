// 统一页头：图标 + 标题 + 副标题在左，操作区（计数徽标 / 按钮）在右。
// 各视图此前各写一套 header（ca-head / ifv-head / 设置页裸标题），结构对齐到这一种。
export function PageHeader({ icon = null, title, subtitle = null, children = null, className = "" }) {
  return (
    <header className={`ui-page-head${className ? ` ${className}` : ""}`}>
      <div className="ui-page-head-text">
        <h2 className="ui-page-title">
          {icon ? <span className="ui-page-icon" aria-hidden="true">{icon}</span> : null}
          {title}
        </h2>
        {subtitle ? <span className="ui-page-sub">{subtitle}</span> : null}
      </div>
      {children ? <div className="ui-page-actions">{children}</div> : null}
    </header>
  );
}
