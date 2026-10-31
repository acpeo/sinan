import { GLASS_INK_OPTIONS, GLASS_TINT_OPTIONS, PINNED_HOVER_OPTIONS, THEME_OPTIONS } from "../../lib/glass.js";
import { IS_LINUX, IS_MAC } from "../../lib/platformFlags.js";
import { SliderRow } from "../../components/SliderRow.jsx";


export function AppearanceCard({ theme, onThemeChange, glassAlpha, onGlassAlpha, glassTint, onGlassTint, glassInk, onGlassInk, mainGlass, onMainGlass, uiScale, onUiScale, stripScale, onStripScale, pinned, onPinnedChange, pinnedHoverMode, onPinnedHoverMode, pinnedHoverOpacity, onPinnedHoverOpacity }) {
  return (
    <div className="settings-card">
      <h2>外观与缩放</h2>
      <p className="settings-muted">
        主窗明暗，「自动」跟随系统。主窗选「全玻璃」时与下面的「窗口外观」联动——切亮暗会连三窗一起切，四窗保持同一档；纸感档只影响主窗。
      </p>
      <div className="theme-toggle" role="group" aria-label="完整视图主题">
        {THEME_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={theme === option.id ? "is-selected" : ""}
            aria-pressed={theme === option.id}
            onClick={() => onThemeChange(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {/* 主窗材质（Leo 2026-10-20 拍板「四窗全玻璃」）：全玻璃 = 和小组件/
          胶囊同一套材质（tint + 同一个浓度滑杆）；纸感 = 宣纸白+徽墨的久读底。
          矩阵这种高密度界面玻璃久读会更累，滑杆往右拉能补可读性。 */}
      <div className="settings-subsection">
        <h3>主窗材质</h3>
        <p className="settings-muted">
          全玻璃让主窗与小组件、胶囊、角标同一套材质，直接透出桌面；深浅跟随上面的「窗口外观」档位。纸感是宣纸白的实底，适合长时间逐字读矩阵。
        </p>
        <div className="theme-toggle" role="group" aria-label="主窗材质">
          <button
            type="button"
            className={mainGlass ? "is-selected" : ""}
            aria-pressed={mainGlass}
            onClick={() => onMainGlass(true)}
          >
            全玻璃
          </button>
          <button
            type="button"
            className={!mainGlass ? "is-selected" : ""}
            aria-pressed={!mainGlass}
            onClick={() => onMainGlass(false)}
          >
            纸感
          </button>
        </div>
      </div>
      {/* macOS 面板材质跟随系统 vibrancy，不提供窗口外观选项；
          深/浅配色用于 Windows 与 Linux 的卡片和胶囊。 */}
      {!IS_MAC && (
        <div className="settings-subsection">
          <h3>窗口外观</h3>
          <p className="settings-muted">
            四窗同一档（主窗与小组件、胶囊、角标）：深色是 HUD 玻璃；浅色是透亮白磨砂；透明直接透出桌面，并叠加轻霜和边缘高光。主窗选「纸感」时不跟本档。
          </p>
          <div className="theme-toggle" role="group" aria-label="窗口外观">
            {GLASS_TINT_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={glassTint === option.id ? "is-selected" : ""}
                aria-pressed={glassTint === option.id}
                onClick={() => onGlassTint(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {!IS_MAC && glassTint === "clear" && (
        <div className="settings-subsection">
          <h3>透明档文字</h3>
          <p className="settings-muted">
            深色字配白霜，在浅色壁纸上更清晰；白色字配一层薄暗罩，接近桌面挂件常见的风格。
          </p>
          <div className="theme-toggle" role="group" aria-label="透明档文字">
            {GLASS_INK_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={glassInk === option.id ? "is-selected" : ""}
                aria-pressed={glassInk === option.id}
                onClick={() => onGlassInk(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <SliderRow
        label="玻璃浓度"
        hint="作用于任务追踪小组件、贴边胶囊和全玻璃主窗——四窗同一档浓度。越低越通透，越高越厚实；逐字读矩阵时往右拉。"
        min={5}
        max={96}
        step={2}
        percent={Math.round(glassAlpha * 100)}
        ariaLabel="玻璃浓度百分比"
        onChange={onGlassAlpha}
      />
      {/* mac 的菜单栏面板是系统 UI 的一部分，尺寸固定不提供缩放；
          缩放只针对 Windows 的桌面小插件与胶囊条。 */}
      
      
      {IS_LINUX && (
        <div className="settings-subsection">
          <h3>置顶展示</h3>
          <p className="settings-muted">
            置顶后卡片和胶囊的全部控件、拖动与点击均不可用；只能回到此设置取消。
          </p>
          <div className="theme-toggle" role="group" aria-label="置顶展示模式">
            <button
              type="button"
              className={!pinned ? "is-selected" : ""}
              aria-pressed={!pinned}
              onClick={() => onPinnedChange(false)}
            >
              正常交互
            </button>
            <button
              type="button"
              className={pinned ? "is-selected" : ""}
              aria-pressed={pinned}
              onClick={() => onPinnedChange(true)}
            >
              置顶只读
            </button>
          </div>
        </div>
      )}
      {IS_LINUX && (
        <div className="settings-subsection">
          <h3>置顶悬停行为</h3>
          <p className="settings-muted">
            鼠标进入置顶卡片或胶囊时生效，移开后恢复。
          </p>
          <div className="theme-toggle" role="group" aria-label="置顶悬停行为">
            {PINNED_HOVER_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={pinnedHoverMode === option.id ? "is-selected" : ""}
                aria-pressed={pinnedHoverMode === option.id}
                onClick={() => onPinnedHoverMode(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {IS_LINUX && pinnedHoverMode === "fade" && (
        <SliderRow
          label="悬停不透明度"
          hint="数值越低，鼠标经过时越接近完全透明。"
          min={5}
          max={90}
          step={5}
          percent={Math.round(pinnedHoverOpacity * 100)}
          ariaLabel="置顶悬停不透明度百分比"
          onChange={onPinnedHoverOpacity}
        />
      )}
    </div>
  );
}

