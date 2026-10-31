import { nextGlassTint } from "../lib/glassAppearance.js";
import { ArrowsInLineVertical, ArrowsInSimple, CircleHalfTilt, CornersOut, ListChecks, Minus, PushPinSimple, X } from "@phosphor-icons/react";
import { closeWindow, minimizeWindow, toggleMaximizeWindow } from "../lib/windowClient";
import { GLASS_TINT_OPTIONS, normalizeGlassTint } from "../lib/glass.js";
import { ThemeQuickToggle } from "./ThemeQuickToggle.jsx";
import { runWindowAction } from "../lib/windowStatus.js";


export function WindowActions({ mode, pinned, transparent = false, glassTint = "dark", macMinimal = false, strip = false, theme, darkTheme, onThemeChange, onToggleMode, onTogglePinned, onToggleTransparent, tasksWidgetEnabled, onToggleTasksWidget }) {
  const glassName = (id) =>
    GLASS_TINT_OPTIONS.find((option) => option.id === id)?.label || "深色";
  const glassCurrent = normalizeGlassTint(glassTint);
  const glassNext = nextGlassTint(glassCurrent);
  const glassLabel = `${glassName(glassCurrent)} · 点击切为${glassName(glassNext)}`;
  return (
    <div className={`window-actions window-actions--${mode}${strip ? " window-actions--strip" : ""}`} aria-label="窗口操作">
      {mode === "expanded" && (
        <>
          {onToggleMode && (
            <button
              type="button"
              className="window-action"
              onClick={() => onToggleMode("compact")}
              aria-label="收起为桌面小组件"
              title="收起为桌面小组件"
            >
              <ArrowsInSimple size={17} weight="light" aria-hidden="true" />
            </button>
          )}
          <ThemeQuickToggle theme={theme} darkTheme={darkTheme} onThemeChange={onThemeChange} />
        </>
      )}
      {mode === "compact" && !macMinimal && (
        <button
          type="button"
          className="window-action"
          onClick={() => onToggleMode("strip")}
          aria-label="折叠为胶囊条"
          title="折叠为胶囊条"
        >
          <ArrowsInLineVertical size={16} weight="light" aria-hidden="true" />
        </button>
      )}
      {mode === "compact" && !macMinimal && (
        <button
          type="button"
          className={`window-action ${transparent ? "window-action--active" : ""}`}
          onClick={onToggleTransparent}
          aria-label={`外观：${glassLabel}`}
          title={`外观：${glassLabel}`}
        >
          <CircleHalfTilt size={16} weight={transparent ? "fill" : "light"} aria-hidden="true" />
        </button>
      )}
      {/* 任务追踪小组件一键开关（此前只能托盘右键/设置勾选，可达性缺口）：
          开=实心高亮，关=描边；状态由 Rust 广播驱动，托盘/自身关闭都同步 */}
      {onToggleTasksWidget && !macMinimal && (
        <button
          type="button"
          className={`window-action ${tasksWidgetEnabled ? "window-action--active" : ""}`}
          onClick={onToggleTasksWidget}
          aria-label="显示 / 隐藏 任务小组件"
          aria-pressed={tasksWidgetEnabled}
          title="显示 / 隐藏 任务小组件" 
        >
          <ListChecks size={16} weight={tasksWidgetEnabled ? "fill" : "light"} aria-hidden="true" />
        </button>
      )}
      {!macMinimal && (
        <button
          type="button"
          className={`window-action ${pinned ? "window-action--active" : ""}`}
          onClick={onTogglePinned}
          aria-label={pinned ? "取消固定，恢复拖动" : "固定在当前位置并置顶"}
          aria-pressed={pinned}
          title={pinned ? "取消固定，恢复拖动" : "固定在当前位置并置顶"}
        >
          <PushPinSimple size={17} weight={pinned ? "fill" : "light"} aria-hidden="true" />
        </button>
      )}
      {!macMinimal && (
        <>
          <button
            type="button"
            className="window-action"
            onClick={() => runWindowAction(minimizeWindow)}
            aria-label="最小化"
            title="最小化"
          >
            <Minus size={17} weight="light" aria-hidden="true" />
          </button>
          {mode === "expanded" && (
            <button
              type="button"
              className="window-action"
              onClick={() => runWindowAction(toggleMaximizeWindow)}
              aria-label="最大化或还原"
              title="最大化 / 还原"
            >
              <CornersOut size={16} weight="light" aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            className="window-action window-action--close"
            onClick={() => runWindowAction(closeWindow)}
            aria-label="隐藏到托盘"
            title="隐藏到托盘"
          >
            <X size={17} weight="light" aria-hidden="true" />
          </button>
        </>
      )}
    </div>
  );
}

