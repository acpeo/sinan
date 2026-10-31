import { horizontalStripTargetWidth } from "./windowGeometry";

// 胶囊条首帧尺寸估计：一格只有图标 + 百分比两层，横条约 54px 宽、竖条约
// 46px 高。
// 这些常量只用于进入 strip 的第一帧，之后的窗口尺寸由 StripBar 里的
// 内容测量观察器按真实渲染结果收敛——不同字体/DPI/缩放比例、有无更新点
// 都不会再裁掉内容（曾因常量与 CSS 脱钩裁掉竖条最后一个按钮）。
export const STRIP_CELL_WIDTH = 54;
// 控件区只剩状态灯/菜单入口那一个 26px 槽，两个平台一样：横条是外壳
// padding 11 + 槽 26 + 格间距，竖条是外壳 padding 10 + 控件区 padding 4 + 槽 26。
export const STRIP_CHROME_WIDTH = 40;
// 条高的下限是 26px 的控件槽，不是格子内容（图标 16 + 上下 padding = 24）。
export const STRIP_BAR_HEIGHT = 28;
// 竖条宽度由 26px 控件槽 + 外壳 padding 定死下限（32px）；42 留 10px 呼吸，
// 再宽图标和百分比周围就空得发肥。
export const STRIP_VERTICAL_WIDTH = 42;
export const STRIP_DETAIL_WINDOW_WIDTH = 312;
export const STRIP_DETAIL_CARD_MARGIN = 12;
export const STRIP_DETAIL_LEAVE_DELAY = 180;
export const STRIP_VCELL_HEIGHT = 46;

// 横条宽度的收缩迟滞。一格 54px，所以 6px 远低于「真的少了一个 Agent」，
// 又高于 DPI/zoom 取整带来的亚像素噪声。
export const STRIP_WIDTH_SHRINK_SLACK = 6;
export const STRIP_VCHROME_HEIGHT = 40;


export function stripWindowSize(orientation, count) {
  const cells = Math.max(1, count);
  if (orientation === "vertical") {
    return {
      width: STRIP_VERTICAL_WIDTH,
      height: STRIP_VCHROME_HEIGHT + STRIP_VCELL_HEIGHT * cells,
    };
  }
  return { width: STRIP_CHROME_WIDTH + STRIP_CELL_WIDTH * cells, height: STRIP_BAR_HEIGHT };
}

/// 竖条内容高度：第一格到控件区 + 外壳 padding（CSS px）。竖条的格子是
/// flex:none，高度由真实内容决定，测量值双向可信（过裁则长、过高则收）。
export function measureStripVerticalContent(shell) {
  const first = shell.querySelector(".strip-cell, .strip-empty");
  const controls = shell.querySelector(".strip-controls");
  if (!first || !controls) return null;
  const style = window.getComputedStyle(shell);
  const firstRect = first.getBoundingClientRect();
  const controlsRect = controls.getBoundingClientRect();
  // 1px 余量：分数 DPI 下物理像素取整最多吃掉不到 1 个 CSS px。
  return (
    controlsRect.bottom - firstRect.top +
    parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + 1
  );
}

/// 横条目标宽度：格子按设计宽 54/格（图标 + 三位百分比是字体无关的有界
/// 内容），控件区取实测自然宽（flex:none 永不被压缩；有无更新点、macOS
/// 有无固定键都会变）。横条格子 flex:1 会拉伸填满窗口，布局测量推不出
/// "窗口过宽"，所以格数部分必须用设计宽计算，窗口才能随格数增减伸缩。
export function measureStripHorizontalTarget(shell) {
  const rail = shell.querySelector(".strip-rail");
  const controls = shell.querySelector(".strip-controls");
  if (!rail || !controls) return null;
  // 量真实内容（与竖条同一哲学）：格子是 flex:none 内容宽，"--" 格比百分比格
  // 窄 ~10px——旧的 N×54 公式量不出这个差，窗口恒比内容宽出一截堆在右边，
  // 且观察器量公式对窗口永远相等、从不修正（实机横条右侧空块根因）。
  const children = [...rail.children];
  const measured = children.reduce((sum, el) => sum + el.getBoundingClientRect().width, 0);
  if (measured > 0) {
    const style = window.getComputedStyle(shell);
    const railGap = parseFloat(window.getComputedStyle(rail).columnGap) || 0;
    return (
      measured
      + Math.max(0, children.length - 1) * railGap
      + (parseFloat(style.paddingLeft) || 0)
      + (parseFloat(style.paddingRight) || 0)
      + 1
    );
  }
  // 兜底：rail 尚未布局（首帧极端情况）时退回公式估计。
  const style = window.getComputedStyle(shell);
  const cellCount = Math.max(1, shell.querySelectorAll(".strip-cell").length);
  return horizontalStripTargetWidth({
    cellCount,
    cellWidth: STRIP_CELL_WIDTH,
    controlsWidth: controls.getBoundingClientRect().width,
    paddingLeft: parseFloat(style.paddingLeft),
    paddingRight: parseFloat(style.paddingRight),
    gap: parseFloat(style.columnGap || style.gap) || 0,
  });
}

