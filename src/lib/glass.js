


export const THEME_OPTIONS = [
  { id: "auto", label: "自动" },
  { id: "light", label: "亮色" },
  { id: "dark", label: "暗色" },
];

// 悬浮形态的窗口圆角，物理像素。10 收到 8：贴着壁纸看，10 的弧偏圆，靠近
// macOS 大部件而不是任务栏那一排小图标；8 更贴合胶囊的高度。
export const GLASS_RADIUS_PX = 8;

export const GLASS_TINT_OPTIONS = [
  { id: "dark", label: "深色" },
  { id: "light", label: "浅色" },
  { id: "clear", label: "透明" },
];



export function normalizeGlassTint(value) {
  return GLASS_TINT_OPTIONS.some((option) => option.id === value) ? value : "dark";
}

// 透明档的文字颜色。桌面挂件常见的两种风格：深色字配白霜（Pogget 一路），
// 或白色字直接压在壁纸上（Rainmeter 一路）。两者需要的底完全相反，所以
// 选文字颜色实际上也在选罩层，见 glassAppearance.js。
export const GLASS_INK_OPTIONS = [
  { id: "dark", label: "深色字" },
  { id: "light", label: "白色字" },
];

export const PINNED_HOVER_OPTIONS = [
  { id: "fade", label: "降低透明度" },
  { id: "hide", label: "完全隐藏" },
];
// X11 主通道不依赖透明窗口继续接收 DOM 事件，因此隐藏可以真正降到 0；
// 无全局坐标的本地回落会在 CSS 中保留 0.1% alpha 以维持命中区域。
export const PINNED_HIDDEN_OPACITY = 0;

export function normalizeGlassInk(value) {
  return GLASS_INK_OPTIONS.some((option) => option.id === value) ? value : "dark";
}

export function normalizePinnedHoverMode(value) {
  return PINNED_HOVER_OPTIONS.some((option) => option.id === value) ? value : "fade";
}



export function handleGlassPointerMove(event) {
  const shell = event.currentTarget;
  const bounds = shell.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  const frame = shell.parentElement?.id === "root" ? shell.parentElement : shell;
  const x = Math.max(0, Math.min(100, ((event.clientX - bounds.left) / bounds.width) * 100));
  const y = Math.max(0, Math.min(100, ((event.clientY - bounds.top) / bounds.height) * 100));
  frame.style.setProperty("--glass-pointer-x", `${x}%`);
  frame.style.setProperty("--glass-pointer-y", `${y}%`);
  frame.style.setProperty("--glass-edge-opacity", "1");
}

export function handleGlassPointerLeave(event) {
  const shell = event.currentTarget;
  const frame = shell.parentElement?.id === "root" ? shell.parentElement : shell;
  frame.style.setProperty("--glass-edge-opacity", "0");
}

export function glassPointerProps(enabled) {
  return enabled
    ? {
        onPointerMove: handleGlassPointerMove,
        onPointerLeave: handleGlassPointerLeave,
      }
    : {};
}
// invoke 看门狗：Tauri invoke 没有客户端超时，Rust 侧 scan_gate 排队/网络
// 慢时 Promise 可能长期不归——2026-10-08 实锤：小组件 tick 第一 await 挂起，
// 后面三个本地读一个都不发，页脚 lastSync 冻在几分钟前而 live 还挂着上一拍
// 的 true（撒谎"已连接"）。超时按失败处理，下一拍重试：宁可短暂"未同步"，
// 不许静默冻结。
