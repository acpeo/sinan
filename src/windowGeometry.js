function normalizedScale(value) {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

/// 只有稳定的悬浮形态才能参与位置记忆与边缘挂靠。竖条详情会临时移动、
/// 放大同一个原生窗口；那段几何不能被当成用户摆放结果。
function isStableFloatingMode(mode, transient = false) {
  if (transient) return false;
  return mode === "compact" || mode === "strip" || mode === "strip-horizontal" || mode === "strip-vertical";
}

/// 原生窗口移动事件是物理坐标。挂靠窗口只要离开当前锚点，就说明用户正在
/// 把它拖往别处；旧挂靠轮询必须立即失效，不能在拖动途中按旧边缘把窗口拉回。
function isDockAnchorPosition(position, anchor, tolerance = 2) {
  if (
    !position
    || !anchor
    || !Number.isFinite(position.x)
    || !Number.isFinite(position.y)
    || !Number.isFinite(anchor.x)
    || !Number.isFinite(anchor.y)
  ) {
    return false;
  }
  return (
    Math.abs(position.x - anchor.x) <= tolerance
    && Math.abs(position.y - anchor.y) <= tolerance
  );
}

/// 挂靠收起后窗口的停泊位：只留 peekPx（物理像素，按显示器缩放折算）一条
/// 细边在屏幕内，其余滑出工作区。
function edgeDockHiddenPosition(dock, peekPx = 6) {
  if (!dock?.edge) return null;
  const visible = Math.round(peekPx * (dock.scale || 1));
  switch (dock.edge) {
    case "bottom": return { x: dock.x, y: dock.bottom - visible };
    case "left": return { x: dock.left - dock.width + visible, y: dock.y };
    case "right": return { x: dock.right - visible, y: dock.y };
    default: return { x: dock.x, y: dock.top - dock.height + visible };
  }
}

/// 挂靠锚点自校验：窗口仍停在记录的几何上（显形用挂靠原位、收起用停泊位）
/// 且尺寸未变，才算"仍在锚点上"。展开/折叠面板这类程序化改尺寸、外力位移
/// 都会让锚点过期，调用方按"用户拖动"同一语义释放并重估。
function isDockGeometryCurrent(position, size, dock, hidden = false) {
  if (!position || !size || !dock) return false;
  const anchor = hidden ? edgeDockHiddenPosition(dock) : { x: dock.x, y: dock.y };
  if (!isDockAnchorPosition(position, anchor)) return false;
  return size.width === dock.width && size.height === dock.height;
}

function monitorArea(monitor) {
  if (!monitor?.position || !monitor?.size) return null;
  return {
    x: monitor.workArea?.position?.x ?? monitor.position.x,
    y: monitor.workArea?.position?.y ?? monitor.position.y,
    width: monitor.workArea?.size?.width ?? monitor.size.width,
    height: monitor.workArea?.size?.height ?? monitor.size.height,
  };
}

function overlapArea(rect, area) {
  const overlapX =
    Math.min(rect.x + rect.width, area.x + area.width) - Math.max(rect.x, area.x);
  const overlapY =
    Math.min(rect.y + rect.height, area.y + area.height) - Math.max(rect.y, area.y);
  return Math.max(0, overlapX) * Math.max(0, overlapY);
}

/// 把 CSS 设计尺寸按应用缩放与目标显示器 DPI 换成整数物理像素。
function physicalWindowSize(width, height, contentScale = 1, monitorScale = 1) {
  const scale = normalizedScale(contentScale) * normalizedScale(monitorScale);
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

function floatingViewportSize(width, height, contentScale, monitorScale, workArea) {
  const scale = normalizedScale(contentScale) * normalizedScale(monitorScale);
  return {
    width: workArea?.width > 0 ? Math.min(width, Math.floor(workArea.width / scale)) : width,
    height: workArea?.height > 0 ? Math.min(height, Math.floor(workArea.height / scale)) : height,
  };
}

/// WebView2 偶尔在混合 DPI 环境保留一层额外 zoom，导致原生窗口物理尺寸正确，
/// 但 CSS 视口仍偏小。以当前“物理像素 / CSS 视口”的实测比例反算目标尺寸，
/// 不再假设系统 DPI 与 setZoom 就是完整缩放链。
function viewportCorrectedPhysicalSize({
  currentPhysicalWidth,
  currentPhysicalHeight,
  viewportWidth,
  viewportHeight,
  expectedWidth,
  expectedHeight,
}) {
  const values = [
    currentPhysicalWidth,
    currentPhysicalHeight,
    viewportWidth,
    viewportHeight,
    expectedWidth,
    expectedHeight,
  ];
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) return null;

  const widthRatio = expectedWidth / viewportWidth;
  const heightRatio = expectedHeight / viewportHeight;
  // 防止隐藏/切形态的瞬时 0 尺寸把窗口放大到不可恢复；正常 DPI/zoom
  // 残差都落在 0.5–2 之间（应用自身允许的缩放范围也是 0.75–2）。
  if (
    widthRatio < 0.5 ||
    widthRatio > 2 ||
    heightRatio < 0.5 ||
    heightRatio > 2
  ) {
    return null;
  }
  return {
    width: Math.max(1, Math.round(currentPhysicalWidth * widthRatio)),
    height: Math.max(1, Math.round(currentPhysicalHeight * heightRatio)),
  };
}

function horizontalStripTargetWidth({
  cellCount,
  cellWidth,
  controlsWidth,
  paddingLeft,
  paddingRight,
  gap,
  roundingAllowance = 1,
}) {
  const cells = Math.max(1, Math.round(cellCount || 0));
  return (
    cells * cellWidth +
    controlsWidth +
    paddingLeft +
    paddingRight +
    cells * gap +
    roundingAllowance
  );
}

/// 宽度失配自愈的重试间隔（ms）。attempt 是本轮失配内已做过的自愈次数：
/// 首次立即，其后 250/600/1200ms 快速追试，4 次后回到固定 2s 的旧节奏。
/// WebView2 的合成/zoom 迁就经常晚于 setSize 返回，一次事务后视口仍可能
/// 差上几个像素；可见的失配（右列被裁、滚动条）不能让观众等满一个 2s
/// 节流周期，也不能退化成每 120ms 一次的无限重断言，所以按轮次升级。
function desyncHealRetryDelayMs(attempt) {
  const normalized = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
  if (normalized === 0) return 0;
  if (normalized === 1) return 250;
  if (normalized === 2) return 600;
  if (normalized === 3) return 1200;
  return 2000;
}

/// 竖向胶囊的悬停卡片需要临时放大透明窗口。窗口扩展方向取胶囊所在的
/// 半屏，原胶囊的屏幕坐标保持不动；纵向只移动到足够容纳卡片的位置。
function verticalStripHoverLocalLayout({ targetHeight, anchorY, cardHeight, margin = 8, pointerMargin = 22 }) {
  if ([targetHeight, anchorY, cardHeight, margin, pointerMargin].some((value) => !Number.isFinite(value))) {
    return null;
  }
  const halfCard = cardHeight / 2;
  const cardCenter = Math.min(
    Math.max(anchorY, halfCard + margin),
    Math.max(targetHeight - halfCard - margin, halfCard + margin),
  );
  const pointerY = Math.min(
    Math.max(anchorY - cardCenter + halfCard, pointerMargin),
    Math.max(cardHeight - pointerMargin, pointerMargin),
  );
  return { cardCenter, pointerY };
}

function verticalStripHoverLayout({ railPosition, railSize, workArea, targetSize, anchorY, cardHeight, margin = 8, anchorMotion = "shift" }) {
  const values = [
    railPosition?.x,
    railPosition?.y,
    railSize?.width,
    railSize?.height,
    workArea?.x,
    workArea?.y,
    workArea?.width,
    workArea?.height,
    targetSize?.width,
    targetSize?.height,
    anchorY,
    cardHeight,
  ];
  if (values.some((value) => !Number.isFinite(value))) return null;

  const workRight = workArea.x + workArea.width;
  const workBottom = workArea.y + workArea.height;
  // 卡片优先朝胶卷右侧弹（side=left，2026-10-07 改）：窗口 x 完全不动、只向右
  // 长宽，胶卷钉窗口左上角——原生帧与 WebView 重排帧里条的位置完全一致，
  // 悬停/移开零闪动（旧"朝左弹"要朝左挪窗 230px，WebView 滞后一帧=条闪；
  // 原子 SetWindowPos 也救不了内容重排那一帧）。右侧放不下才退朝左兜底。
  const side = railPosition.x + targetSize.width + margin <= workRight
    ? "left"
    : "right";
  const local = verticalStripHoverLocalLayout({
    targetHeight: targetSize.height,
    anchorY,
    cardHeight,
    margin,
  });
  if (!local) return null;
  const { cardCenter } = local;
  const desiredX = side === "left"
    ? railPosition.x
    : railPosition.x + railSize.width - targetSize.width;
  // anchorMotion "static"（任务小组件专用）：窗口纵向尽量不动——顶=胶卷顶，
  // 仅当下缘要出工作区才上收。胶卷钉在窗顶，窗不动=胶卷纵向零位移；
  // 卡片纵向可见性由 cardCenter 钳制独立保证，不依赖挪窗。
  const desiredY = anchorMotion === "static"
    ? Math.min(railPosition.y, workBottom - targetSize.height)
    : railPosition.y - (cardCenter - anchorY);
  const x = Math.min(Math.max(desiredX, workArea.x), Math.max(workRight - targetSize.width, workArea.x));
  // 窗口不仅要留在工作区，也必须完整包住原胶囊。只按卡片锚点移动时，
  // 悬停下方条目会让 railOffsetY 变成负数，把胶囊上半段推出透明窗口。
  const railBottom = railPosition.y + railSize.height;
  const minY = Math.max(workArea.y, railBottom - targetSize.height);
  const maxY = Math.min(workBottom - targetSize.height, railPosition.y);
  const y = Math.min(Math.max(desiredY, minY), Math.max(maxY, minY));

  return {
    side,
    x,
    y,
    cardCenter,
    railOffsetY: railPosition.y - y,
  };
}

/// 悬停星卡伴随窗几何（纯函数，JS 算位、Rust 只执行）：胶囊窗悬停期间
/// 零 resize，星卡活在独立置顶穿透小窗里——卡朝哪弹、怎么钳都只是挪
/// "别人家的窗"，胶囊本体纹丝不动，抖动失去物理载体。
/// 输入为逻辑像素屏幕坐标（window.screen* 口径，悬停瞬间定格在 hoverCard
/// 锚点上）；输出窗左上角 x/y 与定侧。side 缺省时按工作区富余现定：
/// 竖条优先卡在条右（窗口概念里的 left 侧），横条优先卡在条下。
function hopCardWindowPlacement({
  orientation,
  side,
  railLeft,
  railRight,
  shellTop,
  shellBottom,
  cellCenterX,
  cellCenterY,
  cardWidth,
  cardHeight,
  gap = 6,
  workArea,
}) {
  const common = [cardWidth, cardHeight, gap];
  if (common.some((value) => !Number.isFinite(value)) || !workArea) return null;
  const area = {
    x: Number.isFinite(workArea.x) ? workArea.x : 0,
    y: Number.isFinite(workArea.y) ? workArea.y : 0,
    width: Number.isFinite(workArea.width) ? workArea.width : 0,
    height: Number.isFinite(workArea.height) ? workArea.height : 0,
  };
  const workRight = area.x + area.width;
  const workBottom = area.y + area.height;
  if (orientation === "horizontal") {
    if ([shellTop, shellBottom, cellCenterX].some((value) => !Number.isFinite(value))) return null;
    const resolved = side ?? (shellBottom + gap + cardHeight <= workBottom ? "below" : "above");
    const x = Math.min(
      Math.max(cellCenterX - cardWidth / 2, area.x + 8),
      Math.max(workRight - cardWidth - 8, area.x + 8),
    );
    const y = resolved === "below" ? shellBottom + gap : shellTop - gap - cardHeight;
    return { side: resolved, x, y };
  }
  if ([railLeft, railRight, cellCenterY].some((value) => !Number.isFinite(value))) return null;
  const resolved = side ?? (railRight + gap + cardWidth <= workRight - 8 ? "left" : "right");
  const x = resolved === "left" ? railRight + gap : railLeft - gap - cardWidth;
  // 窗高等于固定承载高（内容盒在其中垂直居中），纵向钳进工作区即可。
  const half = cardHeight / 2;
  const y = Math.min(
    Math.max(cellCenterY - half, area.y + 8),
    Math.max(workBottom - cardHeight - 8, area.y + 8),
  );
  return { side: resolved, x, y };
}

/// 记忆坐标是物理像素；用每台显示器自己的 DPI 推导候选窗口大小，再选与工作区
/// 重叠最多的显示器。不能先读当前窗口 DPI——窗口随后可能恢复到另一台屏幕。
function monitorForWindowPosition(
  monitors,
  position,
  logicalSize,
  contentScale = 1,
) {
  if (
    !position ||
    !Number.isFinite(position.x) ||
    !Number.isFinite(position.y) ||
    !logicalSize ||
    !Number.isFinite(logicalSize.width) ||
    !Number.isFinite(logicalSize.height)
  ) {
    return null;
  }

  let best = null;
  let bestOverlap = 0;
  (monitors || []).forEach((monitor) => {
    const area = monitorArea(monitor);
    if (!area) return;
    const physical = physicalWindowSize(
      logicalSize.width,
      logicalSize.height,
      contentScale,
      monitor.scaleFactor,
    );
    const overlap = overlapArea(
      { x: position.x, y: position.y, ...physical },
      area,
    );
    if (overlap > bestOverlap) {
      best = monitor;
      bestOverlap = overlap;
    }
  });
  return best;
}

export {
  desyncHealRetryDelayMs,
  edgeDockHiddenPosition,
  floatingViewportSize,
  horizontalStripTargetWidth,
  hopCardWindowPlacement,
  isDockAnchorPosition,
  isDockGeometryCurrent,
  isStableFloatingMode,
  monitorForWindowPosition,
  physicalWindowSize,
  verticalStripHoverLocalLayout,
  verticalStripHoverLayout,
  viewportCorrectedPhysicalSize,
};
