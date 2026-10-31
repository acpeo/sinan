import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import * as geometry from "./windowGeometry.js";

// Execute the window controller against a simulated native boundary. No real
// desktop window, persisted settings, or WebView zoom is changed by these tests.
const source = readFileSync(new URL("./windowClient.js", import.meta.url), "utf8")
  .replace(/^import[\s\S]*?;\r?\n/gm, "")
  .replace(/export \{[\s\S]*?\};\s*$/, "");

function controller(stored = {}) {
  const context = vm.createContext({
    ...geometry,
    console: { warn() {} },
    window: { innerWidth: 320, innerHeight: 320 },
    localStorage: { getItem: (key) => stored[key] ?? null, setItem() {} },
  });
  vm.runInContext(source, context);
  return context;
}

test("startup does not apply compact zoom to a strip or expanded window", async () => {
  const context = controller();
  let zoomCalls = 0;
  Object.assign(context, {
    isMacPlatform: () => false,
    windowApi: async () => ({}),
    applyWebviewZoom: async () => { zoomCalls += 1; },
  });
  await context.applyStartupUiScale("strip");
  await context.applyStartupUiScale("expanded");
  assert.equal(zoomCalls, 0);
});

test("cached 28px horizontal strip and short compact heights survive startup", () => {
  const context = controller({
    "metrik:stripContentSize": JSON.stringify({ horizontal: { width: 366, height: 28 } }),
    "metrik:compactContentHeight": JSON.stringify({ height: 280 }),
  });
  assert.equal(context.stripContentSize("horizontal", {}).height, 28);
  assert.equal(context.compactContentHeight(320), 280);
});

test("an oversized window cannot be clamped above the work-area origin", async () => {
  const context = controller();
  let position = { x: 0, y: 0 };
  context.isLinuxPlatform = () => false;
  await context.clampIntoWorkArea({
    availableMonitors: async () => [{
      position: { x: 0, y: 0 }, size: { width: 1280, height: 720 },
    }],
    PhysicalPosition: class { constructor(x, y) { this.x = x; this.y = y; } },
  }, {
    outerPosition: async () => position,
    setPosition: async (value) => { position = value; },
  }, { width: 1600, height: 1000 });
  assert.equal(position.x, 0);
  assert.equal(position.y, 0);
});

test("a stale resize viewport cannot change the user's chosen zoom", async () => {
  const context = controller();
  let physical = { width: 320, height: 320 };
  const zooms = [];
  Object.assign(context, {
    window: { innerWidth: 640, innerHeight: 640 },
    settleWebviewLayout: async () => {},
    scaledPhysicalSize: async () => ({ width: 320, height: 320 }),
    clampIntoWorkArea: async () => {},
    applyWebviewZoom: async (zoom) => {
      zooms.push(zoom);
      context.window.innerWidth = 320;
      context.window.innerHeight = 320;
    },
  });
  const appWindow = {
    scaleFactor: async () => 1,
    innerSize: async () => physical,
    setSize: async (size) => { physical = size; },
  };
  await context.reconcileFloatingSizeAfterShow({ currentMonitor: async () => null }, appWindow, 320, 320, 1, physical);
  assert.deepEqual(zooms, [1]);
});

test("hover expansion preserves zoom and collapse restores the chosen strip scale", async () => {
  const context = controller();
  let physical = { width: 42, height: 300 };
  let position = { x: 1878, y: 500 };
  let reconciliations = 0;
  const zooms = [];
  const appWindow = {
    outerPosition: async () => position,
    outerSize: async () => physical,
    innerSize: async () => physical,
    scaleFactor: async () => 1,
    setSize: async (size) => { physical = size; },
    setPosition: async (value) => { position = value; },
  };
  const api = {
    getCurrentWindow: () => appWindow,
    currentMonitor: async () => ({ workArea: {
      position: { x: 0, y: 0 }, size: { width: 1920, height: 1040 },
    } }),
    PhysicalPosition: class { constructor(x, y) { this.x = x; this.y = y; } },
  };
  Object.assign(context, {
    isWindowsPlatform: () => true,
    isLinuxPlatform: () => false,
    windowApi: async () => api,
    scaledPhysicalSize: async (_api, _win, width, height) => ({ width, height }),
    settleWebviewLayout: async () => {},
    reconcileFloatingSizeAfterShow: async () => { reconciliations += 1; return physical; },
    applyWebviewZoom: async (zoom) => { zooms.push(zoom); },
  });
  await context.expandVerticalStripHover({
    width: 312, height: 300, railWidth: 42, railHeight: 300,
    anchorY: 260, cardHeight: 180,
  });
  assert.equal(reconciliations, 0);
  assert.deepEqual(zooms, []);
  await context.collapseVerticalStripHover();
  assert.equal(physical.width, 42);
  assert.equal(physical.height, 300);
  assert.equal(position.x, 1878);
  assert.equal(position.y, 500);
  assert.deepEqual(zooms, [1]);
});

test("reassertCompactSize keeps retrying on the escalating cadence while the viewport stays desynced", async () => {
  const context = controller();
  const sizes = [];
  const waits = [];
  const appWindow = {
    scaleFactor: async () => 1,
    setSize: async (physical) => { sizes.push(physical); },
  };
  Object.assign(context, {
    isMacPlatform: () => false,
    isWindowsPlatform: () => true,
    isLinuxPlatform: () => false,
    windowApi: async () => ({
      getCurrentWindow: () => appWindow,
      currentMonitor: async () => null,
    }),
    applyWebviewZoom: async () => {},
    scaledPhysicalSize: async (_api, _win, width, height) => ({ width, height }),
    reconcileFloatingSizeAfterShow: async () => ({}),
    desyncHealRetryDelayMs: (attempt) => geometry.desyncHealRetryDelayMs(attempt),
    setTimeout: (fn, ms) => { waits.push(ms); fn(); },
  });
  // 视口宽 256：320 的设计宽被裁，三次收敛后仍未落位。
  context.window.innerWidth = 256;
  context.window.innerHeight = 320;
  await context.reassertCompactSize();
  assert.equal(sizes.length, 4);
  assert.deepEqual(waits, [250, 600, 1200]);
});

test("reassertCompactSize stops as soon as the viewport settles", async () => {
  const context = controller();
  const sizes = [];
  const appWindow = {
    scaleFactor: async () => 1,
    setSize: async (physical) => {
      sizes.push(physical);
      context.window.innerWidth = 320;
    },
  };
  Object.assign(context, {
    isMacPlatform: () => false,
    isWindowsPlatform: () => true,
    isLinuxPlatform: () => false,
    windowApi: async () => ({
      getCurrentWindow: () => appWindow,
      currentMonitor: async () => null,
    }),
    applyWebviewZoom: async () => {},
    scaledPhysicalSize: async (_api, _win, width, height) => ({ width, height }),
    reconcileFloatingSizeAfterShow: async () => ({}),
    setTimeout: () => { throw new Error("must not wait once settled"); },
  });
  context.window.innerWidth = 256;
  context.window.innerHeight = 320;
  await context.reassertCompactSize();
  assert.equal(sizes.length, 1);
});

test("reassertCompactSize yields immediately when a newer window correction supersedes it", async () => {
  const context = controller();
  const appWindow = {
    scaleFactor: async () => 1,
    setSize: async () => { throw new Error("superseded pass must not touch the window"); },
  };
  Object.assign(context, {
    isMacPlatform: () => false,
    isWindowsPlatform: () => true,
    isLinuxPlatform: () => false,
    windowApi: async () => ({
      getCurrentWindow: () => appWindow,
      currentMonitor: async () => null,
    }),
    applyWebviewZoom: async () => {},
    scaledPhysicalSize: async (_api, _win, width, height) => ({ width, height }),
    reconcileFloatingSizeAfterShow: async () => ({}),
  });
  context.window.innerWidth = 256;
  context.window.innerHeight = 320;
  await context.reassertCompactSize(null, () => false);
});
test("strip controls collapse restores the pre-open geometry in one batched transaction", async () => {
  const context = controller();
  const calls = [];
  let reconciles = 0;
  let current = {
    position: { x: 900, y: 300 },
    size: { width: 42, height: 96 },
  };
  const appWindow = {
    outerPosition: async () => current.position,
    outerSize: async () => current.size,
    scaleFactor: async () => 1.25,
    setSize: async (size) => { calls.push(["setSize", size]); current = { ...current, size }; },
    setPosition: async (position) => { calls.push(["setPosition", position]); current = { ...current, position }; },
  };
  Object.assign(context, {
    isMacPlatform: () => false,
    isWindowsPlatform: () => true,
    isLinuxPlatform: () => false,
    windowApi: async () => ({ getCurrentWindow: () => appWindow }),
    reconcileFloatingSizeAfterShow: async () => { reconciles += 1; throw new Error("collapse must not reconcile"); },
  });
  await context.beginStripControlsExpand();
  // fit 观察器把窗口临时加高（模拟展开态）。
  current = { position: { x: 900, y: 160 }, size: { width: 42, height: 226 } };
  await context.collapseStripControlsExpand();
  assert.deepEqual(calls, [
    ["setSize", { width: 42, height: 96 }],
    ["setPosition", { x: 900, y: 300 }],
  ]);
  assert.equal(reconciles, 0);
  // CSS 尺寸按 stripScale×DPI 反记进缓存：96/1.25 = 76.8 → 77。
  const cached = context.stripContentSize("vertical", {});
  assert.equal(cached.width, 34);
  assert.equal(cached.height, 77);
  // 收起后还原值已消费，再次收起是无害的空操作。
  await context.collapseStripControlsExpand();
  assert.equal(calls.length, 2);
});

test("beginStripControlsExpand keeps an existing restore instead of overwriting it", async () => {
  const context = controller();
  let size = { width: 42, height: 96 };
  const appWindow = {
    outerPosition: async () => ({ x: 900, y: 300 }),
    outerSize: async () => size,
    scaleFactor: async () => 1,
    setSize: async (value) => { size = value; },
    setPosition: async () => {},
  };
  Object.assign(context, {
    isMacPlatform: () => false,
    isWindowsPlatform: () => true,
    isLinuxPlatform: () => false,
    windowApi: async () => ({ getCurrentWindow: () => appWindow }),
  });
  await context.beginStripControlsExpand();
  size = { width: 42, height: 226 };
  await context.beginStripControlsExpand();
  await context.collapseStripControlsExpand();
  assert.deepEqual(size, { width: 42, height: 96 });
});

test("opening strip controls over a hover card restores the rail, not the hover canvas", async () => {
  const context = controller();
  let physical = { width: 42, height: 300 };
  let position = { x: 1600, y: 500 };
  const appWindow = {
    outerPosition: async () => position,
    outerSize: async () => physical,
    innerSize: async () => physical,
    scaleFactor: async () => 1,
    setSize: async (size) => { physical = size; },
    setPosition: async (value) => { position = value; },
  };
  const api = {
    getCurrentWindow: () => appWindow,
    currentMonitor: async () => ({ workArea: {
      position: { x: 0, y: 0 }, size: { width: 1920, height: 1040 },
    } }),
    PhysicalPosition: class { constructor(x, y) { this.x = x; this.y = y; } },
  };
  Object.assign(context, {
    isMacPlatform: () => false,
    isWindowsPlatform: () => true,
    isLinuxPlatform: () => false,
    windowApi: async () => api,
    scaledPhysicalSize: async (_api, _win, width, height) => ({ width, height }),
    settleWebviewLayout: async () => {},
    applyWebviewZoom: async () => {},
  });
  await context.expandVerticalStripHover({
    width: 312, height: 300, railWidth: 42, railHeight: 300,
    anchorY: 150, cardHeight: 120,
  });
  // 卡优先朝条右侧（side=left）：窗口 x 完全不动（零闪动方向）。
  assert.equal(position.x, 1600);
  // 点 … 时详情卡还开着：还原几何捕获排在悬停收回之前。
  await context.beginStripControlsExpand();
  await context.collapseVerticalStripHover();
  physical = { width: 42, height: 430 };
  await context.collapseStripControlsExpand();
  assert.deepEqual(physical, { width: 42, height: 300 });
  assert.deepEqual(position, { x: 1600, y: 500 });
});

test("collapseStripControlsExpand without a pending restore is a no-op", async () => {
  const context = controller();
  let resized = 0;
  const appWindow = {
    outerPosition: async () => null,
    outerSize: async () => null,
    scaleFactor: async () => 1,
    setSize: async () => { resized += 1; },
    setPosition: async () => {},
  };
  Object.assign(context, {
    isMacPlatform: () => false,
    isWindowsPlatform: () => true,
    isLinuxPlatform: () => false,
    windowApi: async () => ({ getCurrentWindow: () => appWindow }),
  });
  await context.collapseStripControlsExpand();
  assert.equal(resized, 0);
});

test("hop card companion show/hide go straight to invoke and never touch the capsule window", async () => {
  const context = controller();
  context.window.__TAURI_INTERNALS__ = {};
  const calls = [];
  context.invoke = async (command, args) => {
    calls.push([command, args ?? null]);
    return command === "hop_card_ping" ? true : null;
  };
  assert.equal(await context.probeHopCardWindow(), true);
  await context.showHopCardWindow({
    x: 1614, y: 70, width: 224, height: 460, payload: '{"hop":1}',
  });
  await context.hideHopCardWindow();
  assert.deepEqual(
    calls.map(([command]) => command),
    ["hop_card_ping", "show_hop_card", "hide_hop_card"],
  );
  assert.equal(calls[1][1].payload, '{"hop":1}');
  assert.equal(calls[1][1].width, 224);
});

test("hop card probe falls back to the in-window preview path when commands are missing", async () => {
  const context = controller();
  context.invoke = async (command) => {
    if (command === "hop_card_ping") throw new Error("command hop_card_ping not found");
    return null;
  };
  assert.equal(await context.probeHopCardWindow(), false);
});

// 位置记忆整套函数从 metrik 整搬过来时只搬了函数、没人点火（2026-10-12 审计
// 发现）：司南里 startPositionMemory/restoreWindowPosition 曾经只有 App.jsx 的
// import、没有一个调用。函数本身一直是好的——坏在接线。这两条测锁住函数行为，
// 免得下次有人动它们时静默走样；接线缺失只有 App.jsx 那边看得出。
test("position memory round-trips the capsule position through storage", async () => {
  const stored = {};
  const context = controller(stored);
  let position = { x: 900, y: 400 };
  const appWindow = {
    outerPosition: async () => position,
    outerSize: async () => ({ width: 224, height: 36 }),
  };
  const written = {};
  Object.assign(context, {
    isLinuxPlatform: () => false,
    isMacPlatform: () => false,
    windowApi: async () => ({
      getCurrentWindow: () => appWindow,
      currentMonitor: async () => ({ workArea: {
        position: { x: 0, y: 0 }, size: { width: 1920, height: 1040 },
      } }),
      availableMonitors: async () => [{ position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 } }],
    }),
    localStorage: {
      getItem: (key) => stored[key] ?? null,
      setItem: (key, value) => { written[key] = value; stored[key] = value; },
    },
  });
  await context.rememberWindowPosition(
    await context.windowApi(), appWindow, "strip-horizontal",
  );
  // 命中的键按形态分开；挂靠收起/屏外坐标不会漏进 storage（在同一函数里拦）
  assert.ok(written["metrik:stripHorizontalPosition"], "横条位置应落到横条自己的键");
  assert.equal(JSON.parse(written["metrik:stripHorizontalPosition"]).x, 900);
});

test("position memory refuses coordinates parked off-screen by edge docking", async () => {
  const written = {};
  const context = controller();
  // 收起态：只剩一条细边在工作区内（贴右缘 1914）
  const position = { x: 1914, y: 400 };
  const appWindow = {
    outerPosition: async () => position,
    outerSize: async () => ({ width: 224, height: 36 }),
  };
  Object.assign(context, {
    isLinuxPlatform: () => false,
    isMacPlatform: () => false,
    windowApi: async () => ({
      getCurrentWindow: () => appWindow,
      currentMonitor: async () => ({ workArea: {
        position: { x: 0, y: 0 }, size: { width: 1920, height: 1040 },
      } }),
      availableMonitors: async () => [{ position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 } }],
    }),
    localStorage: { getItem: () => null, setItem: (key, value) => { written[key] = value; } },
  });
  await context.rememberWindowPosition(
    await context.windowApi(), appWindow, "strip-horizontal",
  );
  // 贴边收起坐标绝不能覆盖用户正常摆放的位置，否则下次开机窗口停在屏边缘
  assert.deepEqual(written, {});
});


/// 竖条↔横条互切时，接上原来那条边继续收起（Leo 2026-10-13："只要有一个
/// 已经贴边隐藏了，切到竖条还是横条都还会再贴边隐藏；唯独竖条贴边隐藏时切
/// 横条不行，得手动挪一下"）。
///
/// 真凶在 poll 的锚点自校验：尺寸变了就一律滑回"旧外形的显形位"再释放挂靠。
/// 竖条 36×224 贴右的显形位 x=1884，套到 224×36 的横条上右缘冲到 2108 飞出
/// 屏幕；随后 onMove 拿新坐标比对旧锚点，判成"用户拖走"把挂靠拆掉，横条既
/// 不贴边也点不着。为什么只有竖→横犯：竖条沿边跨度小（36）、横条沿边跨度大
/// （224），换成竖条时新坐标落在旧锚点 2px 容差里逃过一劫；上下缘互换时长宽
/// 比不翻转，同理幸免——尺寸翻转 + 侧边，两个条件凑齐才炸。
function edgeSwitchScenario(startWidth, startHeight, startEdge, targetWidth, targetHeight) {
  const context = controller();
  // isDesktop() 认 window.__TAURI_INTERNALS__，台架补上
  context.window.__TAURI_INTERNALS__ = { invoke: async () => ({}) };
  // vm 里没有 window 定时器家族；900ms 收起判定要能真的走过去，用真实时延
  context.window.setTimeout = ((fn, ms) => setTimeout(fn, ms));
  context.window.setInterval = ((fn, ms) => setInterval(fn, ms));
  context.window.clearInterval = ((id) => clearInterval(id));
  context.window.clearTimeout = ((id) => clearTimeout(id));
  const area = { left: 0, top: 0, right: 1920, bottom: 1040 };
  let size = { width: startWidth, height: startHeight };
  let position = startEdge === "left" ? { x: area.left, y: 400 }
    : startEdge === "right" ? { x: area.right - startWidth, y: 400 }
    : startEdge === "top" ? { x: 700, y: area.top }
    : { x: 700, y: area.bottom - startHeight };
  // 光标先落在窗内（挂靠才成立），随后移开触发收起
  let cursor = { x: position.x + Math.floor(startWidth / 2), y: position.y + Math.floor(startHeight / 2) };
  // 真实 Tauri 语义：位置没变不派发 onMoved。乱派发会让 scheduleCheck 反复
  // 重跑 check()，把 outsideSinceMs 清零——收起永远走不到（台架自己造鬼）。
  const listeners = [];
  // 换外形过程中的每一次位置变动都记账。Leo 2026-10-13 第四轮实锤"切横竖条会
  // 先闪到旁边一段距离，再闪回贴边隐藏位"：那时 setSize 固定顶左角不改坐标，
  // 横条右缘冲出屏幕 272px，250ms 后 poll 才搬回来——一冲一搬就是两次可见闪动。
  const slides = [];
  const appWindow = {
    outerPosition: async () => ({ ...position }),
    outerSize: async () => ({ ...size }),
    setPosition: async (next) => {
      const moved = next.x !== position.x || next.y !== position.y;
      const from = { ...position };
      position = { x: next.x, y: next.y };
      slides.push({ from, to: { ...position }, size: { ...size }, moved });
      if (moved) listeners.forEach((fn) => fn({ payload: { ...position } }));
    },
    setSize: async (next) => { size = { width: next.width, height: next.height }; },
    // set_window_bounds（Windows SetWindowPos）：位置+尺寸一次原子落，中间态不存在
    setBounds: async (x, y, w, h) => {
      const moved = x !== position.x || y !== position.y;
      const from = { ...position };
      position = { x, y };
      size = { width: w, height: h };
      slides.push({ from, to: { ...position }, size: { ...size }, moved });
      if (moved) listeners.forEach((fn) => fn({ payload: { ...position } }));
    },
    setMinSize: async () => {},
    setResizable: async () => {},
    setAlwaysOnTop: async () => {},
    onMoved: async (fn) => { listeners.push(fn); return () => {}; },
    scaleFactor: async () => 1,
  };
  Object.assign(context, {
    isLinuxPlatform: () => false,
    isMacPlatform: () => false,
    isWindowsPlatform: () => true,
    windowApi: async () => ({
      getCurrentWindow: () => appWindow,
      currentMonitor: async () => ({ workArea: {
        position: { x: 0, y: 0 }, size: { width: 1920, height: 1040 },
      } }),
      cursorPosition: async () => ({ ...cursor }),
      LogicalSize: class { constructor(width, height) { this.width = width; this.height = height; } },
      PhysicalPosition: class { constructor(x, y) { this.x = x; this.y = y; } },
    }),
    // invoke 是模块级 import 绑定，vm 里挂在 context 上供 set_window_bounds 用
    invoke: async (command, args) => {
      if (command !== "set_window_bounds") return;
      await appWindow.setBounds(args.x, args.y, args.width, args.height);
    },
    loadMonitorConfig: () => ({ tasksEdgeDock: true }),
  });
  // 屏内可见像素：按所在边算，"右缘-左缘"在左边收起时会把负半轴算成可见。
  const visiblePx = () => {
    const left = Math.max(0, position.x);
    const right = Math.min(1920, position.x + size.width);
    const top = Math.max(0, position.y);
    const bottom = Math.min(1040, position.y + size.height);
    return startEdge === "left" || startEdge === "right"
      ? Math.max(0, right - left)
      : Math.max(0, bottom - top);
  };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  return {
    context,
    async run() {
      // startEdgeDock 返回 stop()；不调用它会留下一直跑的 setInterval 轮询，
      // node --test 等不到事件循环清空，整个 npm test 步骤挂住（真机上过）。
      const stopPromise = context.startEdgeDock({
        getMode: () => "tasks-widget",
        getPinned: () => false,
        canDockTasksWidget: () => true,
      });
      await wait(300);                 // 挂靠成立
      cursor = { x: 900, y: 900 };     // 光标离开
      await wait(1400);                // 900ms 后收起
      const before = visiblePx();
      const slidesBefore = slides.length;
      await context.applyMiniCapsuleSize(targetWidth, targetHeight);
      await wait(1600);                // 轮询重估 + 900ms 收起
      const stop = await stopPromise;
      stop?.();
      // 换外形过程中窗口被搬动过几次。1 次 = 直接从旧停泊位滑到新停泊位（原子
      // 落位，视觉上是一次整体平移）；≥2 次 = 先冲到半路再被拉回，即 Leo 说的
      // "先闪到旁边一段距离，再闪回贴边隐藏位"。
      const switches = slides.slice(slidesBefore).filter((slide) => slide.moved);
      return {
        before,
        after: visiblePx(),
        switchMoves: switches.length,
        position: { ...position },
        size: { ...size },
      };
    },
  };
}

/// Leo 2026-10-13 第四轮实锤："在侧边切换横条或者竖条的时候，都是会先闪动
/// 到旁边一段距离，然后再闪到原先的贴边隐藏的位置"。
///
/// 真凶是 setSize 的顶左角语义：竖条贴右显形位 x=1740 宽 36（右缘正好 2048），
/// 只发 setSize(224,36) 不动坐标，右缘冲到 1964 看着还行；可贴左收起位
/// x=-30 宽 36 换成 224 宽时右缘冲到 194——整条横条横在屏幕中间 250ms，随后
/// poll 才按同一条边把它搬回停泊位。这一露一收就是"闪到旁边再闪回"。
/// 修法：换外形走 set_window_bounds（Windows SetWindowPos），位置+尺寸一次
/// 原子落，中间态不存在。这三个测试把"只搬一次"锁进回归。
test("竖条贴边隐藏时切横条，横条接上同一条边继续收起（Leo 2026-10-13）", async () => {
  const scenario = edgeSwitchScenario(36, 224, "right", 224, 36);
  const { before, after, switchMoves } = await scenario.run();
  // 前置条件：竖条确实收起了，屏内只剩约 6px 细边
  assert.ok(before <= 8, `前置：竖条应收起（实际可见 ${before}px）`);
  // 修好后横条必须接上同一条边继续收起，而不是停在显形位等用户推
  assert.ok(after <= 8, `切横条后应接上贴边隐藏（实际可见 ${after}px）`);
  // 且过程只能搬一次（原子落位）：≥2 次就是"先闪到旁边再闪回"
  assert.ok(switchMoves <= 1, `换外形只应搬一次（实际 ${switchMoves} 次）`);
});

test("反向：横条贴边隐藏时切竖条，同样接上原边继续收起", async () => {
  const scenario = edgeSwitchScenario(224, 36, "right", 36, 224);
  const { before, after, switchMoves } = await scenario.run();
  assert.ok(before <= 8, `前置：横条应收起（实际可见 ${before}px）`);
  assert.ok(after <= 8, `切竖条后应接上贴边隐藏（实际可见 ${after}px）`);
  assert.ok(switchMoves <= 1, `换外形只应搬一次（实际 ${switchMoves} 次）`);
});

test("其余三边互切也接上原边收起，且不闪到旁边再闪回（ Leo 的口径：有一个藏着就该都藏着 ）", async () => {
  const combos = [
    [36, 224, "left", 224, 36],
    [224, 36, "left", 36, 224],
    [36, 224, "top", 224, 36],
    [224, 36, "bottom", 36, 224],
  ];
  for (const [sw, sh, edge, tw, th] of combos) {
    const scenario = edgeSwitchScenario(sw, sh, edge, tw, th);
    const { before, after, switchMoves } = await scenario.run();
    assert.ok(before <= 8, `${edge} 边前置应收起（实际 ${before}px）`);
    assert.ok(after <= 8, `${edge} 边 ${sw}x${sh}→${tw}x${th} 切换后应收起（实际可见 ${after}px）`);
    assert.ok(switchMoves <= 1, `${edge} 边换外形只应搬一次（实际 ${switchMoves} 次）`);
  }
});

/// Leo 2026-10-13 第二轮实锤："竖条贴边隐藏时切横条，还得重新挪一下才隐藏"。
/// 上一批（b56771e）只测了"收起态直接 applyMiniCapsuleSize"，绿了；真机仍犯，
/// 因为真人不是那么切的——横竖切换钮藏在控制簇里，手序是：
///   竖条贴着边藏着 → 碰边弹出 → 点 ••• 开控制簇（尺寸先变一次）→
///   手按在横竖切换钮上点它（尺寸再变一次，且指针始终在窗内）
/// 这条路径上有三个上一批没覆盖的坑：
///   ① poll 的锚点自校验只改记录不搬窗口。WebView2 的 setSize 晚于 setPosition
///     落地时窗口仍停在旧坐标，新外形套上去右缘冲出屏幕 272px，而
///     stillOnDockEdge 看"右缘是否够得着屏幕边"照样判仍在边上，于是每拍重算、
///     每拍都不搬，横条挂在屏外点不着——用户只能手动拖回来。
///   ② 引擎自己发的滑动被 onMove 判成"用户拖走"。poll 刚把换外形后的窗口摆到
///     新停泊位，onMove 因对不上旧锚点就 releaseDockForDrag，随后 check() 按
///     显形位重建挂靠，横条从此摊在屏内不再收起。
///   ③ check() 无条件 hidden=false，会把刚建立的收起态抹掉（滑停泊位触发 onMove
///     → scheduleCheck → check 走到这里）。
function edgeSwitchWithControlsScenario(edge, fromWidth, fromHeight, toWidth, toHeight) {
  const context = controller();
  context.window.__TAURI_INTERNALS__ = { invoke: async () => ({}) };
  context.window.setTimeout = ((fn, ms) => setTimeout(fn, ms));
  context.window.setInterval = ((fn, ms) => setInterval(fn, ms));
  context.window.clearInterval = ((id) => clearInterval(id));
  context.window.clearTimeout = ((id) => clearTimeout(id));
  const area = { left: 0, top: 0, right: 2048, bottom: 1104 };
  let size = { width: fromWidth, height: fromHeight };
  let position = edge === "left" ? { x: area.left, y: 400 }
    : edge === "right" ? { x: area.right - fromWidth, y: 400 }
      : edge === "top" ? { x: 700, y: area.top }
        : { x: 700, y: area.bottom - fromHeight };
  let cursor = { x: position.x + fromWidth / 2, y: position.y + fromHeight / 2 };
  const listeners = [];
  const slides = [];
  const appWindow = {
    outerPosition: async () => ({ ...position }),
    outerSize: async () => ({ ...size }),
    setPosition: async (next) => {
      const moved = next.x !== position.x || next.y !== position.y;
      const from = { ...position };
      position = { x: next.x, y: next.y };
      slides.push({ from, to: { ...position }, size: { ...size }, moved });
      if (moved) listeners.forEach((fn) => fn({ payload: { ...position } }));
    },
    setSize: async (next) => { size = { width: next.width, height: next.height }; },
    // set_window_bounds（Windows SetWindowPos）：位置+尺寸一次原子落
    setBounds: async (x, y, w, h) => {
      const moved = x !== position.x || y !== position.y;
      const from = { ...position };
      position = { x, y };
      size = { width: w, height: h };
      slides.push({ from, to: { ...position }, size: { ...size }, moved });
      if (moved) listeners.forEach((fn) => fn({ payload: { ...position } }));
    },
    setMinSize: async () => {},
    setResizable: async () => {},
    setAlwaysOnTop: async () => {},
    onMoved: async (fn) => { listeners.push(fn); return () => {}; },
    scaleFactor: async () => 1,
  };
  Object.assign(context, {
    isLinuxPlatform: () => false,
    isMacPlatform: () => false,
    isWindowsPlatform: () => true,
    windowApi: async () => ({
      getCurrentWindow: () => appWindow,
      currentMonitor: async () => ({ workArea: {
        position: { x: 0, y: 0 }, size: { width: 2048, height: 1104 },
      } }),
      cursorPosition: async () => ({ ...cursor }),
      LogicalSize: class { constructor(width, height) { this.width = width; this.height = height; } },
      PhysicalPosition: class { constructor(x, y) { this.x = x; this.y = y; } },
    }),
    // invoke 是模块级 import 绑定，vm 里挂在 context 上供 set_window_bounds 用
    invoke: async (command, args) => {
      if (command !== "set_window_bounds") return;
      await appWindow.setBounds(args.x, args.y, args.width, args.height);
    },
    loadMonitorConfig: () => ({ tasksEdgeDock: true }),
  });
  const visiblePx = () => {
    const left = Math.max(0, position.x);
    const right = Math.min(2048, position.x + size.width);
    const top = Math.max(0, position.y);
    const bottom = Math.min(1104, position.y + size.height);
    return edge === "left" || edge === "right"
      ? Math.max(0, right - left)
      : Math.max(0, bottom - top);
  };
  // 越界量 = 可见跨度超出细边（8px）的部分。收起态本来就该大部分在屏外
  // （贴右缘只剩 6px），所以不能拿"标称矩形超出屏幕多少"算——那会把正常的
  // 收起判成越界。真正的故障形态是窗口没贴上该贴的那条边：被推到屏幕中间
  // （可见整个 308/376）或整扇飞出对侧，量级在百 px，与正常收起差两个数量级。
  const offScreenPx = () => {
    const left = Math.max(0, position.x);
    const right = Math.min(2048, position.x + size.width);
    const top = Math.max(0, position.y);
    const bottom = Math.min(1104, position.y + size.height);
    const visibleSpan = edge === "left" || edge === "right" ? right - left : bottom - top;
    return Math.max(0, visibleSpan - 8);
  };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  return {
    async run() {
      const stopPromise = context.startEdgeDock({
        getMode: () => "tasks-widget",
        getPinned: () => false,
        canDockTasksWidget: () => true,
      });
      await wait(300);
      cursor = { x: 900, y: 900 };      // 光标离开 → 900ms 后收起
      await wait(1400);
      const before = visiblePx();
      // 碰边弹出：光标必须落在窗口自己那一段边缘内（isCursorOnDockPeek 口径）
      cursor = edge === "right" ? { x: 2045, y: position.y + fromHeight / 2 }
        : edge === "left" ? { x: 3, y: position.y + fromHeight / 2 }
          : edge === "top" ? { x: position.x + fromWidth / 2, y: 3 }
            : { x: position.x + fromWidth / 2, y: 1101 };
      await wait(500);
      // 点 ••• 开控制簇：方向还没切，只是当前方向撑开
      const [openWidth, openHeight] = fromWidth > fromHeight ? [308, 36] : [36, 376];
      cursor = { x: position.x + openWidth / 2, y: position.y + openHeight / 2 };
      await context.applyMiniCapsuleSize(openWidth, openHeight);
      await wait(1500);
      // ★ Leo 2026-10-13 第三轮实锤："点 ••• 打开选择按钮时，在贴边隐藏的前提
      // 下，一闪就没了，没有给停留选择时间"。上一轮为修竖横互切，把"边收起过"
      // 当成"换完外形立刻回到收起态"——于是手按在 ••• 上、指针还在窗内时，poll
      // 一见尺寸变了就把窗滑回停泊位，控制簇跟着窗口一起被推出屏幕。改完后
      // 这段窗口必须稳稳停在显形位等人选，不能一闪就没。
      // 判据用"几乎整个外形都看得见"：显形位 = 整条贴着工作区边。沿屏幕边的
      // 那一维因边而异——贴左右边看宽、贴上下边看高。竖条 36×376 贴右边时
      // 沿边跨度是 36（宽），不是 376；横条 308×36 贴右边才是 308。
      const alongOpen = edge === "left" || edge === "right" ? openWidth : openHeight;
      const whileChoosing = visiblePx();
      // 手按在横竖切换钮上点它：尺寸再变，指针仍在窗内
      cursor = { x: position.x + toWidth / 2, y: position.y + toHeight / 2 };
      const slidesBeforeSwitch = slides.length;
      await context.applyMiniCapsuleSize(toWidth, toHeight);
      await wait(1500);
      // 换外形那一刻窗口被搬动过几次。这里必须在前一次 applyMiniCapsuleSize
      // 之后、手离开之前取样：手离开后的那次收起是正常行为，不算闪动。
      // ≥2 次 = 先冲到半路再被 poll 拉回，即 Leo 2026-10-13 第四轮实锤的
      // "先闪动到旁边一段距离，然后再闪到原先的贴边隐藏的位置"。
      const switchMoves = slides.slice(slidesBeforeSwitch).filter((slide) => slide.moved).length;
      // 选完了，手离开窗口 → 900ms 后接上原边继续收起
      cursor = { x: 900, y: 900 };
      await wait(1500);
      const after = visiblePx();
      const stop = await stopPromise;
      stop?.();
      return {
        before, after, whileChoosing, alongOpen, switchMoves, offScreen: offScreenPx(), position: { ...position }, size: { ...size },
      };
    },
  };
}

test("竖条贴边隐藏→碰边弹出→开控制簇→切横条：选的时候别一闪就没，手走了才接上原边收起（Leo 2026-10-13 第三轮实锤）", async () => {
  const scenario = edgeSwitchWithControlsScenario("right", 36, 224, 308, 36);
  const { before, whileChoosing, alongOpen, after, switchMoves, offScreen } = await scenario.run();
  assert.ok(before <= 8, `前置：竖条应收起（实际可见 ${before}px）`);
  // ★ 核心断言：控制簇开着的那 1.5 秒里，窗口必须停在显形位。此前被
  //   edgeHiddenRecently 一拍收回停泊位，Leo 根本来不及点后面的按钮。
  assert.ok(whileChoosing >= alongOpen - 2, `开控制簇后应停在显形位等人选（实际可见 ${whileChoosing}px，外形沿边 ${alongOpen}px）`);
  // 横条不能摊在显形位等用户推，更不能飞出屏幕（挂靠死掉的标志）
  assert.ok(after <= 8, `手离开后应接上贴边隐藏（实际可见 ${after}px）`);
  assert.ok(offScreen <= 8, `窗口不应冲出屏幕（实际越界 ${offScreen}px）`);
  // 切横条那一刻只搬一次（原子落位）：≥2 次就是"先闪到旁边再闪回"
  assert.ok(switchMoves <= 1, `切横条只应搬一次（实际 ${switchMoves} 次）`);
});

test("四边两向互切：选的时候都停在显形位，手走了都接上原边收起，且不闪到旁边再闪回（ Leo 的口径：有一个藏着就该都藏着 ）", async () => {
  const combos = [
    [36, 224, "right", 308, 36],
    [308, 36, "right", 36, 376],
    [36, 224, "left", 308, 36],
    [308, 36, "left", 36, 376],
    [308, 36, "top", 36, 376],
    [36, 224, "top", 308, 36],
    [36, 224, "bottom", 308, 36],
    [308, 36, "bottom", 36, 376],
  ];
  for (const [fw, fh, edge, tw, th] of combos) {
    const scenario = edgeSwitchWithControlsScenario(edge, fw, fh, tw, th);
    const { before, whileChoosing, alongOpen, after, switchMoves, offScreen } = await scenario.run();
    assert.ok(before <= 8, `${edge} 边前置应收起（实际 ${before}px）`);
    assert.ok(whileChoosing >= alongOpen - 2, `${edge} 边开控制簇后应停在显形位（实际可见 ${whileChoosing}px，外形沿边 ${alongOpen}px）`);
    assert.ok(after <= 8, `${edge} 边 ${fw}x${fh}→${tw}x${th} 手离开后应收起（实际可见 ${after}px）`);
    assert.ok(offScreen <= 8, `${edge} 边切换后不应冲出屏幕（实际越界 ${offScreen}px）`);
    assert.ok(switchMoves <= 1, `${edge} 边切横竖只应搬一次（实际 ${switchMoves} 次）`);
  }
});
