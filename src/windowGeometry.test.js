import assert from "node:assert/strict";
import test from "node:test";

import {
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
  isCursorOnDockPeek,
  stripGestureOwner,
  verticalStripHoverLocalLayout,
  verticalStripHoverLayout,
  viewportCorrectedPhysicalSize,
} from "./windowGeometry.js";

test("floating content fits the physical work area at combined app and monitor scale", () => {
  assert.deepEqual(floatingViewportSize(42, 900, 2, 1.5, { width: 1920, height: 1040 }), {
    width: 42, height: 346,
  });
  assert.deepEqual(floatingViewportSize(1200, 28, 1.25, 1.5, { width: 1366, height: 728 }), {
    width: 728, height: 28,
  });
  assert.deepEqual(floatingViewportSize(320, 900, 1, 1, null), { width: 320, height: 900 });
});

test("moving a docked window away from its anchor is treated as a user drag", () => {
  const anchor = { x: 1878, y: 300 };
  assert.equal(isDockAnchorPosition({ x: 1878, y: 300 }, anchor), true);
  assert.equal(isDockAnchorPosition({ x: 1880, y: 299 }, anchor), true);
  assert.equal(isDockAnchorPosition({ x: 1600, y: 300 }, anchor), false);
});

test("transient strip geometry never participates in persistent floating state", () => {
  assert.equal(isStableFloatingMode("compact"), true);
  assert.equal(isStableFloatingMode("strip-vertical"), true);
  assert.equal(isStableFloatingMode("strip-vertical", true), false);
  assert.equal(isStableFloatingMode("expanded"), false);
});

test("docked window parks with only a thin sliver inside the work area", () => {
  const scale = 1.25;
  const peek = Math.round(6 * scale);
  const rightDock = { edge: "right", x: 1500, y: 100, width: 400, height: 500, left: 0, top: 0, right: 1920, bottom: 1080, scale };
  assert.deepEqual(edgeDockHiddenPosition(rightDock), { x: 1920 - peek, y: 100 });
  const leftDock = { edge: "left", x: 0, y: 100, width: 400, height: 500, left: 0, top: 0, right: 1920, bottom: 1080, scale };
  assert.deepEqual(edgeDockHiddenPosition(leftDock), { x: 0 - 400 + peek, y: 100 });
  const topDock = { edge: "top", x: 100, y: 0, width: 400, height: 500, left: 0, top: 0, right: 1920, bottom: 1080, scale };
  assert.deepEqual(edgeDockHiddenPosition(topDock), { x: 100, y: 0 - 500 + peek });
  const bottomDock = { edge: "bottom", x: 100, y: 580, width: 400, height: 500, left: 0, top: 0, right: 1920, bottom: 1080, scale };
  assert.deepEqual(edgeDockHiddenPosition(bottomDock), { x: 100, y: 1080 - peek });
  assert.equal(edgeDockHiddenPosition(null), null);
});

test("dock geometry check fails when the window moved or was resized off its anchor", () => {
  const scale = 1;
  const dock = { edge: "right", x: 1600, y: 100, width: 320, height: 384, left: 0, top: 0, right: 1920, bottom: 1080, scale };
  // 显形停在与锚点一致的位置、尺寸没变 → 仍在锚点上。
  assert.equal(isDockGeometryCurrent({ x: 1600, y: 100 }, { width: 320, height: 384 }, dock), true);
  // 折叠面板改了尺寸（顶左不动）→ 锚点过期，挂靠要释放重估。
  assert.equal(isDockGeometryCurrent({ x: 1600, y: 100 }, { width: 42, height: 224 }, dock), false);
  // 外力位移（拖动中）→ 锚点过期。
  assert.equal(isDockGeometryCurrent({ x: 1500, y: 100 }, { width: 320, height: 384 }, dock), false);
  // 收起态用停泊位对账，不能拿显形锚点误判。
  const parked = edgeDockHiddenPosition(dock);
  assert.equal(isDockGeometryCurrent(parked, { width: 320, height: 384 }, dock, true), true);
  assert.equal(isDockGeometryCurrent({ x: 1600, y: 100 }, { width: 320, height: 384 }, dock, true), false);
  assert.equal(isDockGeometryCurrent(null, { width: 320, height: 384 }, dock), false);
});

function monitor(x, width, scaleFactor, workHeight = 1080) {
  return {
    position: { x, y: 0 },
    size: { width, height: workHeight },
    workArea: {
      position: { x, y: 0 },
      size: { width, height: workHeight - 40 },
    },
    scaleFactor,
  };
}

test("physical size combines app scale with destination monitor DPI", () => {
  assert.deepEqual(physicalWindowSize(320, 440, 1.25, 1.5), {
    width: 600,
    height: 825,
  });
  assert.deepEqual(physicalWindowSize(52, 272, 1, 1.75), {
    width: 91,
    height: 476,
  });
});

test("remembered position selects the destination monitor instead of the current one", () => {
  const primary = monitor(0, 1920, 1.25);
  const secondary = monitor(1920, 3840, 2);
  const selected = monitorForWindowPosition(
    [primary, secondary],
    { x: 2400, y: 120 },
    { width: 320, height: 440 },
    1,
  );
  assert.equal(selected, secondary);
  assert.deepEqual(physicalWindowSize(52, 272, 1, selected.scaleFactor), {
    width: 104,
    height: 544,
  });
});

test("overlap chooses the monitor that will contain most of the restored window", () => {
  const left = monitor(-1920, 1920, 1.5);
  const right = monitor(0, 1920, 2);
  const selected = monitorForWindowPosition(
    [left, right],
    { x: -120, y: 80 },
    { width: 320, height: 320 },
    1,
  );
  assert.equal(selected, right);
});

test("fully off-screen remembered positions do not select a monitor", () => {
  const selected = monitorForWindowPosition(
    [monitor(0, 1920, 1.5)],
    { x: 9000, y: 9000 },
    { width: 320, height: 440 },
    1,
  );
  assert.equal(selected, null);
});

test("horizontal strip width includes every outer flex gap", () => {
  assert.equal(
    horizontalStripTargetWidth({
      cellCount: 2,
      cellWidth: 68,
      controlsWidth: 146,
      paddingLeft: 6,
      paddingRight: 5,
      gap: 4,
    }),
    302,
  );
  assert.equal(
    horizontalStripTargetWidth({
      cellCount: 0,
      cellWidth: 68,
      controlsWidth: 146,
      paddingLeft: 6,
      paddingRight: 5,
      gap: 4,
    }),
    230,
  );
});

test("vertical strip hover expands away from the nearest screen edge", () => {
  assert.deepEqual(
    verticalStripHoverLayout({
      railPosition: { x: 1878, y: 300 },
      railSize: { width: 42, height: 260 },
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
      targetSize: { width: 392, height: 320 },
      anchorY: 69,
      cardHeight: 280,
    }),
    { side: "right", x: 1528, y: 240, cardCenter: 148, railOffsetY: 60 },
  );
});

test("vertical strip hover keeps the whole rail visible for a lower cell", () => {
  const layout = verticalStripHoverLayout({
    railPosition: { x: 1878, y: 300 },
    railSize: { width: 42, height: 360 },
    workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    targetSize: { width: 312, height: 360 },
    anchorY: 299,
    cardHeight: 180,
  });

  assert.deepEqual(layout, {
    side: "right",
    x: 1608,
    y: 300,
    cardCenter: 262,
    railOffsetY: 0,
  });
  assert.ok(layout.railOffsetY >= 0);
  assert.ok(layout.railOffsetY + 360 <= 360);
});

test("vertical strip hover keeps the rail bottom visible for the first cell", () => {
  const layout = verticalStripHoverLayout({
    railPosition: { x: 2464, y: 357 },
    railSize: { width: 54, height: 314 },
    workArea: { x: 0, y: 0, width: 2560, height: 1400 },
    targetSize: { width: 510, height: 314 },
    anchorY: 23,
    cardHeight: 270,
  });

  assert.deepEqual(layout, {
    side: "right",
    x: 2008,
    y: 357,
    cardCenter: 143,
    railOffsetY: 0,
  });
});

test("vertical strip hover stays inside the work area near the top-left", () => {
  assert.deepEqual(
    verticalStripHoverLayout({
      railPosition: { x: 0, y: 0 },
      railSize: { width: 42, height: 90 },
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
      targetSize: { width: 392, height: 300 },
      anchorY: 23,
      cardHeight: 270,
    }),
    { side: "left", x: 0, y: 0, cardCenter: 143, railOffsetY: 0 },
  );
});

test("vertical strip hover prefers the card on the rail's right (window TL fixed)", () => {
  // 2026-10-07 改：卡优先朝条右侧（side=left）——窗口 x 完全不动、只向右长宽，
  // 胶卷钉窗口左上角，原生帧与 WebView 重排帧条位置一致=零闪动。
  assert.deepEqual(
    verticalStripHoverLayout({
      railPosition: { x: 400, y: 300 },
      railSize: { width: 42, height: 260 },
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
      targetSize: { width: 392, height: 320 },
      anchorY: 69,
      cardHeight: 280,
    }),
    { side: "left", x: 400, y: 240, cardCenter: 148, railOffsetY: 60 },
  );
});

test("vertical strip hover falls back to the rail's left side near the right edge", () => {
  // 条贴工作区右缘（右侧放不下整卡）：退回朝左兜底——此时窗口必须左挪，
  // 闪动仅存于这一兜底形态。
  assert.deepEqual(
    verticalStripHoverLayout({
      railPosition: { x: 1878, y: 300 },
      railSize: { width: 42, height: 260 },
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
      targetSize: { width: 392, height: 320 },
      anchorY: 69,
      cardHeight: 280,
    }),
    { side: "right", x: 1528, y: 240, cardCenter: 148, railOffsetY: 60 },
  );
});

test("vertical strip hover static anchor keeps the window vertically still mid-screen", () => {
  // 同一组输入：shift 模式为对中锚点上移 60（railOffsetY=60，胶卷必须补偿）；
  // static 模式窗口顶=胶卷顶，纵向零位移——胶卷钉窗顶，零位移=零跨跳。
  const shared = {
    railPosition: { x: 1878, y: 300 },
    railSize: { width: 42, height: 260 },
    workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    targetSize: { width: 392, height: 320 },
    anchorY: 69,
    cardHeight: 280,
  };
  assert.deepEqual(verticalStripHoverLayout({ ...shared, anchorMotion: "static" }), {
    side: "right",
    x: 1528,
    y: 300,
    cardCenter: 148,
    railOffsetY: 0,
  });
});

test("vertical strip hover static anchor still dodges the work-area bottom edge", () => {
  // 胶卷贴工作区底（y=780+260=1040=workBottom）：目标高 320 下缘会出界 60，
  // static 模式此时才上收 60——唯一允许的纵向位移。
  assert.deepEqual(
    verticalStripHoverLayout({
      railPosition: { x: 1878, y: 780 },
      railSize: { width: 42, height: 260 },
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
      targetSize: { width: 392, height: 320 },
      anchorY: 69,
      cardHeight: 280,
      anchorMotion: "static",
    }),
    { side: "right", x: 1528, y: 720, cardCenter: 148, railOffsetY: 60 },
  );
});

test("Wayland-local strip hover clamps the card and pointer without global coordinates", () => {
  assert.deepEqual(
    verticalStripHoverLocalLayout({
      targetHeight: 300,
      anchorY: 23,
      cardHeight: 270,
    }),
    { cardCenter: 143, pointerY: 22 },
  );
  assert.deepEqual(
    verticalStripHoverLocalLayout({
      targetHeight: 300,
      anchorY: 277,
      cardHeight: 270,
    }),
    { cardCenter: 157, pointerY: 248 },
  );
});

test("runtime viewport corrects a hidden WebView zoom layer", () => {
  assert.deepEqual(
    viewportCorrectedPhysicalSize({
      currentPhysicalWidth: 560,
      currentPhysicalHeight: 560,
      viewportWidth: 256,
      viewportHeight: 256,
      expectedWidth: 320,
      expectedHeight: 320,
    }),
    { width: 700, height: 700 },
  );
});

test("runtime viewport correction rejects transient invalid measurements", () => {
  assert.equal(
    viewportCorrectedPhysicalSize({
      currentPhysicalWidth: 560,
      currentPhysicalHeight: 560,
      viewportWidth: 0,
      viewportHeight: 0,
      expectedWidth: 320,
      expectedHeight: 320,
    }),
    null,
  );
});

test("desync heal retries escalate fast then settle at the 2s cadence", () => {
  assert.equal(desyncHealRetryDelayMs(0), 0);
  assert.equal(desyncHealRetryDelayMs(1), 250);
  assert.equal(desyncHealRetryDelayMs(2), 600);
  assert.equal(desyncHealRetryDelayMs(3), 1200);
  assert.equal(desyncHealRetryDelayMs(4), 2000);
  assert.equal(desyncHealRetryDelayMs(9), 2000);
});

test("desync heal retry cadence tolerates invalid attempt counters", () => {
  assert.equal(desyncHealRetryDelayMs(undefined), 0);
  assert.equal(desyncHealRetryDelayMs(Number.NaN), 0);
  assert.equal(desyncHealRetryDelayMs(-3), 0);
  assert.equal(desyncHealRetryDelayMs(2.8), 600);
});

test("hop card companion window pops right of the rail, centered on the hovered cell", () => {
  // 竖条右缘 1608，右侧富余 → 卡窗贴条右缘 + gap，纵向对格中心（承载窗
  // 460 高垂直居中内容盒）。胶囊窗本体零 resize——这只是"别人家的窗"。
  assert.deepEqual(
    hopCardWindowPlacement({
      orientation: "vertical",
      railLeft: 1572,
      railRight: 1608,
      cellCenterY: 300,
      cardWidth: 224,
      cardHeight: 460,
      gap: 6,
      workArea: { x: 0, y: 0, width: 2048, height: 1104 },
    }),
    { side: "left", x: 1614, y: 70 },
  );
});

test("hop card companion window falls back to the rail's left when the right edge is tight", () => {
  // 条右缘距工作区右缘不足（2048-1600=448 < 224+6+8=238? 富余够——这里给
  // 右缘 2000 只剩 48）：退朝左弹，x = 条左缘 - gap - 卡宽。
  assert.deepEqual(
    hopCardWindowPlacement({
      orientation: "vertical",
      railLeft: 1572,
      railRight: 2000,
      cellCenterY: 300,
      cardWidth: 224,
      cardHeight: 460,
      gap: 6,
      workArea: { x: 0, y: 0, width: 2048, height: 1104 },
    }),
    { side: "right", x: 1342, y: 70 },
  );
});

test("hop card companion window clamps vertically inside the work area", () => {
  // 格中心距顶 100 → 窗上缘钳到 workTop+8；距底同理钳下缘。
  assert.deepEqual(
    hopCardWindowPlacement({
      orientation: "vertical",
      railLeft: 100,
      railRight: 136,
      cellCenterY: 100,
      cardWidth: 224,
      cardHeight: 460,
      gap: 6,
      workArea: { x: 0, y: 0, width: 2048, height: 1104 },
    }).y,
    8,
  );
  assert.equal(
    hopCardWindowPlacement({
      orientation: "vertical",
      railLeft: 100,
      railRight: 136,
      cellCenterY: 1050,
      cardWidth: 224,
      cardHeight: 460,
      gap: 6,
      workArea: { x: 0, y: 0, width: 2048, height: 1104 },
    }).y,
    1104 - 460 - 8,
  );
});

test("hop card companion window sits below the horizontal strip at exact gap", () => {
  // 横条壳底 536 → 窗顶=壳底+6（盒顶对齐贴条缘，估计偏小由富余兜住）。
  assert.deepEqual(
    hopCardWindowPlacement({
      orientation: "horizontal",
      shellTop: 500,
      shellBottom: 536,
      cellCenterX: 600,
      cardWidth: 224,
      cardHeight: 240,
      gap: 6,
      workArea: { x: 0, y: 0, width: 2048, height: 1104 },
    }),
    { side: "below", x: 488, y: 542 },
  );
});

test("hop card companion window flips above the horizontal strip when the bottom is tight", () => {
  // 壳底距工作区底不足 → 朝上，窗底=壳顶-gap（盒底对齐贴条缘）。
  const placement = hopCardWindowPlacement({
    orientation: "horizontal",
    shellTop: 1060,
    shellBottom: 1096,
    cellCenterX: 600,
    cardWidth: 224,
    cardHeight: 240,
    gap: 6,
    workArea: { x: 0, y: 0, width: 2048, height: 1104 },
  });
  assert.equal(placement.side, "above");
  assert.equal(placement.y, 1060 - 6 - 240);
});

test("横条胶囊：横向=翻星位，纵向=拖窗（Leo 2026-10-11 拍板原手感）", () => {
  // 横条矮（实测 180×17.5），横向挥是翻星位的自然动作，纵向挥才是唯一顺手的
  // 起拖动作——按主轴大者判：横向为主归胶卷翻内容，纵向为主让给壳层拖窗。
  assert.equal(stripGestureOwner({ vertical: false, dx: 60, dy: 0 }), "scroll");
  assert.equal(stripGestureOwner({ vertical: false, dx: -60, dy: 0 }), "scroll");
  assert.equal(stripGestureOwner({ vertical: false, dx: 0, dy: -14 }), "window");
  assert.equal(stripGestureOwner({ vertical: false, dx: 0, dy: 14 }), "window");
  // 斜向按主轴大者判，与"横向=翻星位"一致
  assert.equal(stripGestureOwner({ vertical: false, dx: 40, dy: -14 }), "scroll");
  assert.equal(stripGestureOwner({ vertical: false, dx: 14, dy: -40 }), "window");
});

test("竖条胶囊：沿条滚内容、跨条拖窗（原手感不动）", () => {
  assert.equal(stripGestureOwner({ vertical: true, dx: 0, dy: 50 }), "scroll");
  assert.equal(stripGestureOwner({ vertical: true, dx: 0, dy: -50 }), "scroll");
  assert.equal(stripGestureOwner({ vertical: true, dx: 40, dy: 0 }), "window");
  // 斜向按主轴大者判，与"沿条=翻星位"一致
  assert.equal(stripGestureOwner({ vertical: true, dx: 20, dy: 40 }), "scroll");
  assert.equal(stripGestureOwner({ vertical: true, dx: 40, dy: 20 }), "window");
});

test("手势死区内谁都别动（手抖不该吃掉点击）", () => {
  assert.equal(stripGestureOwner({ vertical: false, dx: 2, dy: 2 }), "none");
  assert.equal(stripGestureOwner({ vertical: true, dx: 3, dy: 3 }), "none");
  assert.equal(stripGestureOwner({ vertical: true, dx: NaN, dy: 50 }), "none");
});

test("碰边命中区是沿边整条，纵向不受窗口区间限制（Leo 2026-10-11 实锤碰边弹不出）", () => {
  // 窗贴右缘收起，屏幕 1040 高而窗只占 y=400..624；用户随手碰最右那条 6px
  // 窄边，纵向位置是随意的——原来要求 cursor.y 落在窗口区间内，绝大多数
  // 位置都不成立，于是"碰边弹出"等于没有。
  const dock = { edge: "right", x: 1884, y: 400, width: 36, height: 224,
    left: 0, top: 0, right: 1919, bottom: 1040, scale: 1 };
  // 窗纵向范围内：碰得到（原行为也对）
  assert.equal(isCursorOnDockPeek({ x: 1916, y: 500 }, dock, 6), true);
  // 窗纵向范围外（屏幕顶部/底部）：原来弹不出，现在要能弹出
  assert.equal(isCursorOnDockPeek({ x: 1916, y: 40 }, dock, 6), true);
  assert.equal(isCursorOnDockPeek({ x: 1916, y: 1000 }, dock, 6), true);
  // 离边太远：不算碰边
  assert.equal(isCursorOnDockPeek({ x: 1800, y: 500 }, dock, 6), false);
  // 贴左/上/下缘同样按各自的轴判定
  assert.equal(isCursorOnDockPeek({ x: 3, y: 900 }, { ...dock, edge: "left", left: 0 }, 6), true);
  assert.equal(isCursorOnDockPeek({ x: 900, y: 2 }, { ...dock, edge: "top", top: 0 }, 6), true);
  assert.equal(isCursorOnDockPeek({ x: 900, y: 1038 }, { ...dock, edge: "bottom", bottom: 1040 }, 6), true);
  // 脏数据不炸
  assert.equal(isCursorOnDockPeek(null, dock, 6), false);
  assert.equal(isCursorOnDockPeek({ x: NaN, y: 5 }, dock, 6), false);
  assert.equal(isCursorOnDockPeek({ x: 5, y: 5 }, null, 6), false);
});
