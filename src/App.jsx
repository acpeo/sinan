import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowsClockwise,
  ArrowsDownUp,
  ArrowsInSimple,
  ArrowsLeftRight,
  ArrowsOutSimple,
  Check,
  CircleHalfTilt,
  CornersOut,
  DotsThree,
  ListChecks,
  Minus,
  Moon,
  PushPinSimple,
  Sun,
  X,
  ArrowDown,
  ArrowUp,
  ArrowsInLineVertical,
  ShieldCheck,
} from "@phosphor-icons/react";
import antigravityAppIcon from "./assets/antigravity-app-icon.png";
import chatgptAppIcon from "./assets/chatgpt-app-icon.png";
import claudeAppIcon from "./assets/claude-app-icon.jpg";
import cursorAppIcon from "./assets/cursor-app-icon.png";
import deepseekAppIcon from "./assets/deepseek-app-icon.png";
import hermesAppIcon from "./assets/hermes-app-icon.png";
import kimiAppIcon from "./assets/kimi-app-icon.png";
import opencodeAppIcon from "./assets/opencode-app-icon.png";
import qoderAppIcon from "./assets/qoder-app-icon.png";
import grokAppIcon from "./assets/grok-app-icon.png";
import piAppIcon from "./assets/pi-app-icon.png";
import qwenAppIcon from "./assets/qwen-app-icon.png";
import workbuddyAppIcon from "./assets/workbuddy-app-icon.png";
import zcodeAppIcon from "./assets/zcode-app-icon.png";
import { glassShellAppearance, nextGlassTint, resolveGlassMode } from "./glassAppearance.js";
import { isTauriRuntime, loadAgentsSnapshot, loadCronJobs, loadGatewayConfig, loadGatewayTasks, loadMonitorConfig, loadSessionRuns, refreshCronJobs, refreshGatewayTasks, saveGatewayConfig, saveMonitorConfig } from "./taskClient.js";
import { activeRelayEpisodes, agentDisplayName, buildAgentRoster, buildCronNextByAgent, buildFleetModules, cleanSessionTitle, detectRoundNotifications, benignStateOf, buildAgentNameMap, buildTaskChains, chainHopsFor, cleanTaskTitle, cronNextAtOf, cronScheduleTextOf, defuseStaleSnapshotActivity, failureClassOf, groupSessionEpisodes, isSubagentTask, listIdleSessions, hopGlyphOf, hopToneOf, isActiveTask, selectUsageSessions, sessionErrorText, sessionEpisodeHops, sessionRunHop, toolProgressLabel } from "./taskChains.js";
import { desyncHealRetryDelayMs, hopCardWindowPlacement, horizontalStripTargetWidth } from "./windowGeometry";
import {
  applyStartupUiScale,
  applyWindowMode,
  broadcastMacAgentSelection,
  broadcastMacAppearance,
  checkForUpdate,
  closeWindow,
  collapseStripControlsExpand,
  collapseVerticalStripHover,
  emitGlassTint,
  emitGlassAlpha,
  emitGlassInk,
  onGlassAlphaChanged,
  onGlassInkChanged,
  expandRoundDetails,
  expandVerticalStripHover,
  getAutostart,
  hideHopCardWindow,
  hopCardReady,
  isDesktop,
  isLinuxPlatform,
  isMacPlatform,
  isWindowsPlatform,
  minimizeWindow,
  onAgentNames,
  onGlassTintChanged,
  onHopCardHeight,
  onNavTasks,
  onNotificationVisibility,
  onPanelExpand,
  onScaleFactorChanged,
  onHopCardSignal,
  reportHopCardHeight,
  onTasksWidgetVisibility,
  onTrayPinnedChange,
  onTrayShowExpanded,
  applyExpandedPanelSize,
  applyMiniCapsuleSize,
  probeHopCardWindow,
  restoreWindowPosition,
  saveTasksPanelSize,
  setAutostart,
  setNativeTheme,
  setNotificationWindow,
  setPinnedHoverTargetOpacity,
  setTasksWidgetWindow,
  setWindowGlass,
  setWindowPinned,
  setWindowUiScale,
  showHopCardWindow,
  showMainExpanded,
  startEdgeDock,
  startPositionMemory,
  startWindowDragging,
  startWindowResizing,
  syncLinuxTrayPinned,
  takeHopCardPayload,
  toggleMaximizeWindow,
} from "./windowClient";

// 预览豁免（?eager）：IAB 预览面板收起时 document.visibilityState 恒为 hidden
// 且被宿主钉死不可覆写（实例与 window.document 都 non-configurable），
// 演示数据全靠同步拍填充——带 eager 参数的预览页无视隐藏照常同步。
// 真机窗口不带此参数，行为不变。
const PREVIEW_EAGER =
  typeof window !== "undefined"
  && new URLSearchParams(window.location.search).has("eager");
const AGENT_META = {
  codex: {
    label: "ChatGPT",
    accent: "#246bdb",
    iconSrc: chatgptAppIcon,
    iconClass: "agent-icon--codex",
  },
  claude: {
    // 额度是 Claude 全产品合并的，展示名不限定 Code；数据源仍是 Claude Code 日志。
    label: "Claude",
    accent: "#e36b49",
    iconSrc: claudeAppIcon,
    iconClass: "agent-icon--claude",
  },
  zcode: {
    label: "GLM",
    accent: "#6a5ae0",
    iconSrc: zcodeAppIcon,
    iconClass: "agent-icon--zcode",
  },
  opencode: {
    label: "OpenCode",
    accent: "#1f9d8b",
    iconSrc: opencodeAppIcon,
    iconClass: "agent-icon--opencode",
  },
  kimi: {
    label: "Kimi",
    // 品红：与 codex 蓝彻底拉开（原来 #3f74f2 和 ChatGPT 的蓝在图里分不清）。
    accent: "#c6538c",
    iconSrc: kimiAppIcon,
    iconClass: "agent-icon--kimi",
  },
  antigravity: {
    label: "Antigravity",
    // 琥珀金：六个 Agent 各占一个色相，不与 Claude 的珊瑚橙混淆。
    accent: "#cf9526",
    iconSrc: antigravityAppIcon,
    iconClass: "agent-icon--antigravity",
  },
  workbuddy: {
    // 覆盖腾讯 CodeBuddy Code 与 WorkBuddy 两个同格式来源，展示名从用户口径。
    label: "WorkBuddy",
    // 与品牌同色系的绿；也正好避开 GLM 的 #6a5ae0。
    accent: "#3d9c50",
    iconSrc: workbuddyAppIcon,
    iconClass: "agent-icon--workbuddy",
  },
  qoder: {
    // 配额-only：Qoder/QoderWork/Qoder CLI 共用官网账户级 Credits。
    label: "Qoder",
    // 深青蓝：与 codex 的宝蓝、opencode 的青绿保持距离。
    accent: "#3a7ca5",
    iconSrc: qoderAppIcon,
    iconClass: "agent-icon--qoder",
  },
  deepseek: {
    // 配额-only：DeepSeek 官方 API 账户余额，balance_ 窗口装的是金额不是百分比。
    label: "DeepSeek",
    // 品牌蓝 #4d6bfe：比 codex 的 #246bdb 亮一度且偏紫，不会与 zcode 的
    // #6a5ae0（明显更紫）混淆；卡片相邻时明度差足以区分。
    accent: "#4d6bfe",
    iconSrc: deepseekAppIcon,
    iconClass: "agent-icon--deepseek",
  },
  grok: {
    // xAI Grok Build：本地单轮 usage + CLI 日志里的周 Credits 快照。
    label: "Grok",
    // 中性灰蓝：xAI 品牌本身是黑白，中性色既贴合品牌又与八家彩色拉开。
    accent: "#6e7681",
    iconSrc: grokAppIcon,
    iconClass: "agent-icon--grok",
  },
  pi: {
    // pi（badlogic/pi-mono）是 harness：本地会话用量按 provider 归属到
    // 对应计量卡片（GLM / Qwen / 其余留 Pi）；pi 自身没有独立套餐，不显示配额。
    label: "Pi",
    // 官方 logo 是黑白单色几何 π（pi.dev/logo-auto.svg），非红色；
    // 强调色取中性银灰，暗/亮主题都可见。
    accent: "#9aa0a6",
    iconSrc: piAppIcon,
    iconClass: "agent-icon--pi",
  },
  qwen: {
    // 百炼个人 Token Plan 是账户级套餐，由 pi 等客户端的 qwen-token-plan key
    // 消耗；额度没有可编程的官方接口，这张卡只记本地归属用量。
    label: "Qwen",
    // 千问 App 官方图标；紫与 GLM 的 #6a5ae0 同系不同值，亮度更高。
    accent: "#7b5cd6",
    iconSrc: qwenAppIcon,
    iconClass: "agent-icon--qwen",
  },
  hermes: {
    // Hermes（Nous Research）是 harness：与 pi 同样没有自己的套餐，走别家
    // coding plan 的用量按路由归属到对应卡片（GLM / Kimi / ChatGPT），其余
    // 直连 API 留在这张卡；不显示配额。
    label: "Hermes",
    // 官方应用图标是黑白 nous-girl 圆角瓦片（戴耳机的少女，四角透明）；
    // 强调色取与 pi 银灰相邻但更深的暖灰，两张中性卡在图里不互相混淆。
    accent: "#8a8d92",
    iconSrc: hermesAppIcon,
    iconClass: "agent-icon--hermes",
  },
  cursor: {
    // 用量取 cursor.com 仪表盘的账号级逐次事件，配额取同一仪表盘的套餐余量
    // （账单周期窗口）；两者都需在设置的数据来源页开启。
    label: "Cursor",
    // 官方图标是米白瓦片上的黑色立方体；强调色取暖灰褐，与 pi / hermes 的冷灰区分。
    accent: "#a08c6e",
    iconSrc: cursorAppIcon,
    iconClass: "agent-icon--cursor",
  },
};

const AGENT_ORDER = Object.keys(AGENT_META);

// 七星灯牌星序：北斗七星（枢璇玑权衡阳光，与星盘折线同序）；客星（openclaw
// 自带兜底，非北斗编制）排末位且空闲不占格（taskChains IDLE_EXEMPT_AGENTS）。
const ROSTER_STAR_ORDER = [
  "tianshu", "tianxuan", "tianji", "tianquan", "yuheng", "kaiyang", "yaoguang", "main",
];

// 平台旗标：Windows 是主战场，零件里的平台分支共用这三条。
const IS_MAC = isMacPlatform();
const IS_WINDOWS = isWindowsPlatform();
const IS_LINUX = isLinuxPlatform();


function visibleAgentId(agentId) {
  return agentId === "kimiwork" ? "kimi" : agentId;
}

function normalizeVisibleAgentList(agentIds) {
  return [...new Set(agentIds.map(visibleAgentId))].filter((id) =>
    AGENT_ORDER.includes(id),
  );
}

/// 用户在设置里排出的顺序优先，其余按注册表顺序垫后。设置面板、小组件、
/// 完整视图侧栏共用这一份顺序，改一处四处同步。
function agentIdsInDisplayOrder(preferred) {
  return [...preferred, ...AGENT_ORDER.filter((agentId) => !preferred.includes(agentId))];
}
// 胶囊条首帧尺寸估计：一格只有图标 + 百分比两层，横条约 54px 宽、竖条约
// 46px 高。
// 这些常量只用于进入 strip 的第一帧，之后的窗口尺寸由 StripBar 里的
// 内容测量观察器按真实渲染结果收敛——不同字体/DPI/缩放比例、有无更新点
// 都不会再裁掉内容（曾因常量与 CSS 脱钩裁掉竖条最后一个按钮）。
const STRIP_CELL_WIDTH = 54;
// 控件区只剩状态灯/菜单入口那一个 26px 槽，两个平台一样：横条是外壳
// padding 11 + 槽 26 + 格间距，竖条是外壳 padding 10 + 控件区 padding 4 + 槽 26。
const STRIP_CHROME_WIDTH = 40;
// 条高的下限是 26px 的控件槽，不是格子内容（图标 16 + 上下 padding = 24）。
const STRIP_BAR_HEIGHT = 28;
// 竖条宽度由 26px 控件槽 + 外壳 padding 定死下限（32px）；42 留 10px 呼吸，
// 再宽图标和百分比周围就空得发肥。
const STRIP_VERTICAL_WIDTH = 42;
const STRIP_DETAIL_WINDOW_WIDTH = 312;
const STRIP_DETAIL_CARD_MARGIN = 12;
const STRIP_DETAIL_LEAVE_DELAY = 180;
const STRIP_VCELL_HEIGHT = 46;
// 任务小组件竖条悬停详情卡：展开窗 = 42 胶卷 + 卡片宽 + 间隙；卡片高度为
// 估算值（布局 helper 只用它做贴边居中钳制，实际高度由内容决定）。
const TASKS_HOPCARD_WIDTH = 224;
const TASKS_HOPCARD_HEIGHT = 168;
// 6px = 卡与"条的可视表面"的日照间隙（锚面不锚格，壳内边距不再吃掉间距）。
// 横竖同一值——Leo 2026-10-04 二轮反馈：锚面修正后 12px 偏大、6px 正好。
const TASKS_HOPCARD_GAP = 6;
const TASKS_HOVER_LEAVE_DELAY = 260;
// 星卡伴随窗（tasks-hopcard）竖条承载高：固定值+内容盒垂直居中——窗口
// 尺寸与内容解耦，悬停全程零 resize。内容超过承载高时卡内自滚动兜底。
const HOP_CARD_WINDOW_HEIGHT = 460;
// 横条承载高 = 估计盒高 + 富余：盒按 side 钳到窗的贴条缘，估计偏小由
// 富余兜住，卡窗实测高回传（hopcard://height）下一拍校准。
const HOP_CARD_HEIGHT_SLACK = 72;
// 横条宽度的收缩迟滞。一格 54px，所以 6px 远低于「真的少了一个 Agent」，
// 又高于 DPI/zoom 取整带来的亚像素噪声。
const STRIP_WIDTH_SHRINK_SLACK = 6;
const STRIP_VCHROME_HEIGHT = 40;

function stripWindowSize(orientation, count) {
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
function measureStripVerticalContent(shell) {
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
function measureStripHorizontalTarget(shell) {
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

const AGENT_LABELS = Object.fromEntries(
  AGENT_ORDER.map((id) => [id, AGENT_META[id].label]),
);

/// 状态灯的含义：绿 = 数据正常，黄（呼吸）= 正在更新，红 = 读取失败。
/// 灯本身只是装饰，含义必须悬浮可见，否则用户永远猜不到。
function statusDotTitle(loading, loadError) {
  if (loadError) return "数据读取失败，仍显示上次成功的数据";
  return loading ? "正在更新数据…" : "数据正常";
}
let windowActionQueue = Promise.resolve();
let latestWindowCorrection = 0;

function runWindowAction(action) {
  // hide/move/zoom/resize/show 是一条事务；并发执行时旧屏幕 factor 算出的迟到
  // resize 会覆盖新屏幕上的修正。统一排队，失败后也让后续操作继续。
  windowActionQueue = windowActionQueue.then(action).catch((error) => {
    console.warn("Unable to update the desktop window.", error);
  });
  return windowActionQueue;
}

function runLatestWindowCorrection(action) {
  const correction = ++latestWindowCorrection;
  return runWindowAction(() => {
    if (correction !== latestWindowCorrection) return undefined;
    return action(() => correction === latestWindowCorrection);
  });
}

/// 标题栏的主题快捷键：单击在亮/暗之间切换，右键（或长按）弹出含「自动」的
/// 三选菜单——单击不进「自动」是刻意的：一次点击只该有一个确定结果，
/// 而「自动」的结果取决于系统当前是什么。
function ThemeQuickToggle({ theme, darkTheme, onThemeChange }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const dismiss = (event) => {
      if (!wrapRef.current?.contains(event.target)) setMenuOpen(false);
    };
    const onEscape = (event) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", onEscape);
    };
  }, [menuOpen]);

  const label = theme === "auto" ? "自动（跟随系统）" : theme === "dark" ? "暗色" : "亮色";
  return (
    <div className="theme-quick" ref={wrapRef}>
      <button
        type="button"
        className={`window-action ${menuOpen ? "window-action--active" : ""}`}
        onClick={() => onThemeChange(darkTheme ? "light" : "dark")}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenuOpen((open) => !open);
        }}
        aria-label={`切换明暗，当前${label}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title={`当前：${label}\n点击切换明暗 · 右键选择模式`}
      >
        {darkTheme ? (
          <Moon size={16} weight="light" aria-hidden="true" />
        ) : (
          <Sun size={16} weight="light" aria-hidden="true" />
        )}
      </button>
      {menuOpen && (
        <div className="theme-quick-menu" role="menu">
          {THEME_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="menuitemradio"
              aria-checked={theme === option.id}
              className={theme === option.id ? "is-selected" : ""}
              onClick={() => {
                onThemeChange(option.id);
                setMenuOpen(false);
              }}
            >
              {option.label}
              {theme === option.id && <Check size={13} weight="bold" aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const THEME_OPTIONS = [
  { id: "auto", label: "自动" },
  { id: "light", label: "亮色" },
  { id: "dark", label: "暗色" },
];

// 悬浮形态的窗口圆角，物理像素。10 收到 8：贴着壁纸看，10 的弧偏圆，靠近
// macOS 大部件而不是任务栏那一排小图标；8 更贴合胶囊的高度。
const GLASS_RADIUS_PX = 8;

const GLASS_TINT_OPTIONS = [
  { id: "dark", label: "深色" },
  { id: "light", label: "浅色" },
  { id: "clear", label: "透明" },
];

function normalizeGlassTint(value) {
  return GLASS_TINT_OPTIONS.some((option) => option.id === value) ? value : "dark";
}

// 透明档的文字颜色。桌面挂件常见的两种风格：深色字配白霜（Pogget 一路），
// 或白色字直接压在壁纸上（Rainmeter 一路）。两者需要的底完全相反，所以
// 选文字颜色实际上也在选罩层，见 glassAppearance.js。
const GLASS_INK_OPTIONS = [
  { id: "dark", label: "深色字" },
  { id: "light", label: "白色字" },
];

const PINNED_HOVER_OPTIONS = [
  { id: "fade", label: "降低透明度" },
  { id: "hide", label: "完全隐藏" },
];
// X11 主通道不依赖透明窗口继续接收 DOM 事件，因此隐藏可以真正降到 0；
// 无全局坐标的本地回落会在 CSS 中保留 0.1% alpha 以维持命中区域。
const PINNED_HIDDEN_OPACITY = 0;

function normalizeGlassInk(value) {
  return GLASS_INK_OPTIONS.some((option) => option.id === value) ? value : "dark";
}

function normalizePinnedHoverMode(value) {
  return PINNED_HOVER_OPTIONS.some((option) => option.id === value) ? value : "fade";
}

function SliderRow({ label, hint, min, max, step, percent, ariaLabel, onChange }) {
  return (
    <div className="settings-subsection">
      <h3>{label}</h3>
      <p className="settings-muted">{hint}</p>
      <div className="glass-slider-row">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={percent}
          aria-label={ariaLabel}
          onChange={(event) => onChange(Number(event.target.value) / 100)}
        />
        <em>{percent}%</em>
      </div>
    </div>
  );
}

function WindowActions({ mode, pinned, transparent = false, glassTint = "dark", macMinimal = false, theme, darkTheme, onThemeChange, onToggleMode, onTogglePinned, onToggleTransparent, tasksWidgetEnabled, onToggleTasksWidget }) {
  const glassName = (id) =>
    GLASS_TINT_OPTIONS.find((option) => option.id === id)?.label || "深色";
  const glassCurrent = normalizeGlassTint(glassTint);
  const glassNext = nextGlassTint(glassCurrent);
  const glassLabel = `${glassName(glassCurrent)} · 点击切为${glassName(glassNext)}`;
  return (
    <div className={`window-actions window-actions--${mode}`} aria-label="窗口操作">
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

function handleGlassPointerMove(event) {
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

function handleGlassPointerLeave(event) {
  const shell = event.currentTarget;
  const frame = shell.parentElement?.id === "root" ? shell.parentElement : shell;
  frame.style.setProperty("--glass-edge-opacity", "0");
}

function glassPointerProps(enabled) {
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
const RPC_WATCHDOG_MS = 20_000;
function withInvokeTimeout(promise, ms = RPC_WATCHDOG_MS) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("rpc watchdog timeout")), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}


function useWidgetTasksFeed(gateways, enabled) {
  const [tasks, setTasks] = useState(null);
  const [agents, setAgents] = useState(null);
  const [sessionRuns, setSessionRuns] = useState([]);
  const [live, setLive] = useState(false);
  const [lastSync, setLastSync] = useState(0);
  const [intervalSec, setIntervalSec] = useState(() => loadMonitorConfig().refreshIntervalSec);
  const [refreshTick, setRefreshTick] = useState(0);
  // 设置页改监控参数（含保存开关触发的同一事件）后立即生效。
  useEffect(() => {
    const handler = () => setIntervalSec(loadMonitorConfig().refreshIntervalSec);
    window.addEventListener("metrik-monitor-changed", handler);
    return () => window.removeEventListener("metrik-monitor-changed", handler);
  }, []);

  const gatewayKey = gateways.map((gateway) => gateway.label).join("|");
  useEffect(() => {
    // 只看 enabled，不看 gateways：任务小窗是独立 webview，主窗保存的 Gateway
    // 配置不会跨窗推事件（升级重建存储后"主窗重配、小窗先起于空配置"正是
    // 0.20.11 真机翻车现场，重试也空转）。每拍现读配置，配置晚到自动捡起。
    if (!enabled) return undefined;
    let alive = true;
    const tick = async () => {
      // 可见性闸只管浏览器（后台标签别空转）；Tauri 小组件窗绝不跳拍——
      // 跳过的每一拍都是灯牌数据冻结的一拍（Leo 实锤"胶囊比主窗慢"）。
      if (!isTauriRuntime() && !PREVIEW_EAGER && document.visibilityState === "hidden") return;
      const current = loadGatewayConfig();
      // 不因"没配网关"整体早退：浏览器演示数据与 Tauri 本地账本（首启搬迁的
      // 旧台账）都不需要网关在线就能读——主窗 tick 同款口径，早退闸曾让
      // 未配网关的 Widget 永远空转（与小组件自启拆闸同一类病）。
      // 本地读（毫秒级）全部先行，不排在网关 RPC 后面：2026-10-08 实锤 RPC
      // 排队雪崩时 lastSync/卡片数据整拍冻死；网关 RPC 各自带看门狗，
      // 单拍挂起只损失它自己，下一拍照常。
      loadGatewayTasks(null)
        .then((data) => {
          if (!alive) return;
          setTasks(data);
          setLastSync(Date.now());
        })
        .catch(() => {});
      loadSessionRuns()
        .then((data) => {
          if (alive) setSessionRuns(data.runs ?? []);
        })
        .catch(() => {});
      if (current.length) {
        withInvokeTimeout(refreshGatewayTasks(current))
          .then((result) => {
            if (alive) setLive(Boolean(result?.results?.length) && result.results.every((entry) => entry.ok));
          })
          .catch(() => {
            if (alive) setLive(false);
          });
      } else {
        setLive(false);
      }
      withInvokeTimeout(loadAgentsSnapshot(current))
        .then((snap) => {
          if (alive) setAgents(snap);
        })
        .catch(() => {});
    };
    tick();
    const timer = setInterval(tick, Math.max(1, intervalSec) * 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, gatewayKey, intervalSec, refreshTick]);

  return {
    tasks,
    agents,
    sessionRuns,
    live,
    lastSync,
    // 底栏强制刷新按钮：立即补一拍（并重启节流计时器，与改刷新间隔同一语义）。
    refresh: () => setRefreshTick((tick) => tick + 1),
  };
}

/// 任务行首的状态色竖条：与 Agent 行的彩色边条同一语言（绿=跑，红=败，灰=终态）。
function taskAccentClass(status) {
  if (status === "running") return "widget-task-accent--running";
  if (status === "queued") return "widget-task-accent--queued";
  if (status === "failed" || status === "timed_out" || status === "lost") return "widget-task-accent--failed";
  return "widget-task-accent--ended";
}

/// 任务追踪小组件：独立常驻小窗（与主窗完全分离，托盘/设置可显隐）。
/// 外壳与桌面小组件同一套玻璃 token（原项目视觉），
/// 内容 = 实时指示 + 运行中/近期任务 + 活跃 Agent 星位 + 底栏（完整视图 / 关闭）。
function TasksWidgetWindow({
  feed,
  transparent,
  glassMode,
  glassTint,
  glassInk,
  glassAlpha,
  onCycleAppearance,
  onOpenExpanded,
  onClose,
  onPinnedChange,
}) {
  const [pinned, setPinned] = useState(false);
  const pinnedRef = useRef(pinned);
  pinnedRef.current = pinned;
  // 贴边自动隐藏（Leo 2026-10-07 实锤"从未生效"）：挂靠引擎 startEdgeDock 一直在，
  // 缺的是这里——没人点火。只在小组件窗跑；设置勾选实时生效（每拍现读 monitor
  // 配置，改完即走，无需重启）；置顶时不收（引擎 poll 里 getPinned 直接 undock）。
  useEffect(() => {
    const stopPromise = startEdgeDock({
      getMode: () => "tasks-widget",
      getPinned: () => pinnedRef.current,
      canDockTasksWidget: () => loadMonitorConfig().tasksEdgeDock === true,
    });
    return () => {
      stopPromise.then((stop) => stop?.());
    };
  }, []);
  // 折叠态记进 localStorage（metrik:tasksWidgetCollapsed）：横竖形态有记忆、
  // 折叠却重启弹回展开，同一件事只记一半（审计发现 3）。
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("metrik:tasksWidgetCollapsed") === "1",
  );
  useEffect(() => {
    localStorage.setItem("metrik:tasksWidgetCollapsed", collapsed ? "1" : "0");
  }, [collapsed]);
  // 提醒卡点击的 A 案落点：Rust 仲裁广播 → 就地展开面板（窗已由 Rust show）。
  useEffect(() => {
    let unlistenPromise;
    onPanelExpand(() => {
      setCollapsed(false);
      setMiniControlsOpen(false);
    });
    return () => {
      unlistenPromise?.then((unlisten) => unlisten());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 展开面板尺寸记忆：用户拖拽调过的宽高存回来（metrik:tasksPanelSize），
  // 折叠态不记（胶囊尺寸是固定形态，不归用户管）。
  useEffect(() => {
    if (collapsed) return undefined;
    let timer = null;
    const persist = () => saveTasksPanelSize(window.innerWidth, window.innerHeight);
    const onResize = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(persist, 350);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.clearTimeout(timer);
    };
  }, [collapsed]);
  const [refreshing, setRefreshing] = useState(false);
  const [miniControlsOpen, setMiniControlsOpen] = useState(false);
  // 迷你胶囊横竖：记进 localStorage（metrik:miniOrientation），重启保持上次选择；
  // 首次/没存过 = 横条。
  const [miniOrientation, setMiniOrientation] = useState(() =>
    localStorage.getItem("metrik:miniOrientation") === "vertical" ? "vertical" : "horizontal",
  );
  const toggleMiniOrientation = () => {
    setMiniOrientation((orientation) => {
      const next = orientation === "horizontal" ? "vertical" : "horizontal";
      localStorage.setItem("metrik:miniOrientation", next);
      return next;
    });
  };
  // 链路样式：竖排链路（方案 2）/ 横排链路（方案 1）共存，标题栏一键切换。
  // 只作用于展开卡；迷你胶囊是胶囊形态，恒用横排。
  // 空闲会话明细开关（星位上下文卡头"另有 N 个空闲会话"点开/收起）：
  // 默认收起，卡面只留水位行；要盘库时点一下看全量。
  const [showIdleSessions, setShowIdleSessions] = useState(false);
  // 舰队模块板抽屉（Leo 2026-10-06 拍板）：点模块展开该星今夜明细，默认收起。
  // hook 必须在折叠早退之前声明（胶囊/面板同一组件）。
  const [fleetOpenSet, setFleetOpenSet] = useState(() => new Set());
  const toggleFleetModule = (agentId) => setFleetOpenSet((current) => {
    const next = new Set(current);
    if (next.has(agentId)) next.delete(agentId);
    else next.add(agentId);
    return next;
  });
  const miniShellRef = useRef(null);
  const miniLeaveTimerRef = useRef(null);
  // 延时关闭回调里读的是注册时刻的闭包，方向要经 ref 取最新值。
  const miniOrientationRef = useRef("horizontal");
  miniOrientationRef.current = miniOrientation;
  // 悬停详情卡：hoverCard = { hop, index, total, orientation, center?, windowY?,
  // cellRect?, *Screen }。orientation 决定锚点集：竖条锚胶卷缘+格中心，
  // 横条锚壳缘+格中心。视口坐标（center/windowY/cellRect）= 预览路径定位；
  // 屏幕逻辑坐标（railLeftScreen/railRightScreen/cellCenterYScreen/
  // shellTopScreen/shellBottomScreen/cellCenterXScreen）= 伴随窗定位，
  // 均在悬停瞬间同步定格。
  const [hoverCard, setHoverCard] = useState(null);
  const railWrapRef = useRef(null);
  const hopCardLeaveTimerRef = useRef(null);
  // 最近一次卡片实测高：横条承载窗高估计与预览钳位用（预览走
  // handleCardHeight，真机走 hopcard://height 回传，同一 ref 汇合）。
  const lastCardHRef = useRef(null);
  // 延时关闭回调里读的是注册时刻的闭包，卡片有无要经 ref 取最新值。
  const hoverCardRef = useRef(null);
  hoverCardRef.current = hoverCard;
  // 发现 6：卡片打开瞬间顺带拉一拍最新数据——开口即最新。2.5s 内重复悬停
  // 不重复打（后端 snapshot 对同网关本就有 2.5s 节流，这里是前端省一层）。
  const lastHoverRefreshAtRef = useRef(0);
  // 按下状态：内容拖拽滚动进行中——悬停卡停发（showHopCard 看
  // 它 + event.buttons），拖拽期弹卡会跟滚动拉扯。
  const pointerDownRef = useRef(false);
  // 壳层挪窗手势：按下起点 + 是否落在星格/胶卷上（内容拖拽滚动优先）。
  const shellDragRef = useRef(null);
  // 兜底：OS 拖拽的模态循环可能吞掉 pointerup，窗级捕获补一刀。
  useEffect(() => {
    const clear = () => {
      pointerDownRef.current = false;
    };
    window.addEventListener("pointerup", clear, true);
    window.addEventListener("pointercancel", clear, true);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("pointerup", clear, true);
      window.removeEventListener("pointercancel", clear, true);
      window.removeEventListener("blur", clear);
    };
  }, []);
  // 钉边样式的生效开关：真机 Tauri 会真的伸缩原生窗，钉边补偿它=条纹丝不动；
  // 预览/复现台（stub 环境）没有窗体伸缩，钉边会把条从居中位拽到窗缘=伪跳动
  // （Leo 实测"还是跳"的预览半边）。默认按真机算（探测返回前悬停不丢钉边），
  // 探测拿不到有限几何再关。探测仅启动一次，小组件窗可见后必然可读。
  // 星卡伴随窗命令面探测：真机=true（悬停走独立置顶穿透小窗，胶囊窗全程
  // 零 resize）；浏览器预览/复现台（invoke 桩）=false → 窗内 Portal 预览。
  // 首拍乐观按真机算（探测毫秒级返回，命令本就同包内建）。
  const [nativeHopCard, setNativeHopCard] = useState(() => isTauriRuntime());
  useEffect(() => {
    let alive = true;
    probeHopCardWindow().then((ok) => {
      if (alive) setNativeHopCard(Boolean(ok));
    });
    return () => {
      alive = false;
    };
  }, []);
  // 卡窗实测高回传（hopcard://height）：横条上下放卡定窗高的估计值来源。
  // 预览路径（无伴随窗）走 handleCardHeight 同一 ref。
  useEffect(() => {
    if (!isTauriRuntime()) return undefined;
    const stopPromise = onHopCardHeight((height) => {
      if (Number.isFinite(height) && height > 0) lastCardHRef.current = height;
    });
    return () => {
      stopPromise.then((stop) => stop?.());
    };
  }, []);
  // 空闲星卡「下次」行数据：cron 镜像独立 30s 轮询（下次触发是分钟级变化，
  // 30s 足够；不占任务快照对网关的 2.5s 节流额度）。浏览器 demo 也走这路。
  const [cronJobs, setCronJobs] = useState([]);
  useEffect(() => {
    let alive = true;
    const pull = () => {
      loadCronJobs()
        .then((result) => {
          if (alive) setCronJobs(result.jobs ?? []);
        })
        .catch(() => {});
    };
    pull();
    const timer = setInterval(pull, 30_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  const showHopCard = (hop, index, total, event) => {
    // 拖拽期不出卡：内容拖拽滚动进行中，弹卡没有意义（Leo 装机实锤手势拉扯）。
    if (pointerDownRef.current || (event.buttons ?? 0) !== 0) return;
    window.clearTimeout(hopCardLeaveTimerRef.current);
    if (!hoverCardRef.current && Date.now() - lastHoverRefreshAtRef.current > 2500) {
      lastHoverRefreshAtRef.current = Date.now();
      feed.refresh?.();
    }
    const cell = event.currentTarget.getBoundingClientRect();
    // 锚点在悬停瞬间同步定格（window.screen* 是同步 API）：卡窗几何全部
    // 由这些锚点在渲染期现算，胶囊本体零 resize。
    if (miniOrientationRef.current === "vertical") {
      const wrap = railWrapRef.current?.getBoundingClientRect();
      const center = wrap ? cell.top + cell.height / 2 - wrap.top : cell.top + cell.height / 2;
      setHoverCard({
        hop,
        index,
        total,
        orientation: "vertical",
        // 预览路径（窗内 Portal）用视口锚点：
        center,
        windowY: wrap ? wrap.top + center : cell.top,
        // 伴随窗用屏幕逻辑锚点：
        railLeftScreen: window.screenX + (wrap ? wrap.left : cell.left),
        railRightScreen: window.screenX + (wrap ? wrap.right : cell.right),
        cellCenterYScreen: window.screenY + cell.top + cell.height / 2,
      });
    } else {
      // 锚条面、不锚跳格：跳格深居 36px 壳内 ~12px，按格算的日照间隙到条的
      // 可视表面就剩 ~0——真机看就是"卡贴着条"（Leo 2026-10-04 截图）。
      const shell = miniShellRef.current?.getBoundingClientRect();
      setHoverCard({
        hop,
        index,
        total,
        orientation: "horizontal",
        cellRect: {
          top: shell ? shell.top : cell.top,
          bottom: shell ? shell.bottom : cell.bottom,
          centerX: cell.left + cell.width / 2,
        },
        shellTopScreen: window.screenY + (shell ? shell.top : cell.top),
        shellBottomScreen: window.screenY + (shell ? shell.bottom : cell.bottom),
        cellCenterXScreen: window.screenX + cell.left + cell.width / 2,
      });
    }
  };
  const hideHopCard = () => {
    window.clearTimeout(hopCardLeaveTimerRef.current);
    hopCardLeaveTimerRef.current = window.setTimeout(() => {
      hopCardLeaveTimerRef.current = null;
      // 指针可能只是越过 6px 间隙去邻格/控制簇：还悬着就不收。
      if (miniShellRef.current?.matches(":hover")) return;
      setHoverCard(null);
      // 伴随窗由下方布局 effect 随 hopCardOpen 翻 false 统一隐藏。
    }, TASKS_HOVER_LEAVE_DELAY);
  };
  // 卡片内容（进度原话行数 / 其他任务节）实测高度，喂给扩窗与定位——
  // 168 只是基线估计，"其他进行中"节会更高。测量回调恒定，靠比较去重。
  const handleCardHeight = (height) => {
    if (!Number.isFinite(height) || height <= 0) return;
    lastCardHRef.current = height;
    setHoverCard((current) =>
      current && current.measuredH !== height ? { ...current, measuredH: height } : current,
    );
  };
  // 胶囊形态切换/控制开合会重设原生窗几何：先收卡片再走它们的事务。
  useEffect(() => {
    if (!hoverCard) return undefined;
    setHoverCard(null);
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsed, miniControlsOpen, miniOrientation]);
  // 组件卸载（小组件被关掉）兜底藏卡窗，别让星卡孤悬屏上。
  useEffect(() => () => {
    window.clearTimeout(hopCardLeaveTimerRef.current);
    hideHopCardWindow();
  }, []);
  const tasks = feed.tasks?.tasks || [];
  const active = tasks.filter(isActiveTask);
  const now = Date.now();
  // 链路索引 + agent 显示名（北斗星名）。轮询每拍重建，任务量 ≤300 很便宜。
  const chainIndex = useMemo(() => buildTaskChains(tasks), [feed.tasks]);
  const agentNameMap = useMemo(() => buildAgentNameMap(feed.agents?.agents), [feed.agents]);
  // 快照新鲜度闸：过龄快照的活跃灯一律熄灭（灯不撒谎），用量数字照显。
  const effectiveAgents = defuseStaleSnapshotActivity(feed.agents, now);
  // 失败/完成的口径 = failedWindowH 小时内结束的任务（设置"失败记录保留"，
  // 默认 1 小时；不设窗口的话数字只涨不清，就成了历史累计而不是"当前这批
  // 工作"的状态——失败的工作尤其不该占着面板一整天）。
  const recentWindowMs = loadMonitorConfig().failedWindowH * 3_600_000;
  const taskEndedAt = (task) =>
    Number.isFinite(task.endedAtMs) ? task.endedAtMs : Number.isFinite(task.lastSeenMs) ? task.lastSeenMs : 0;
  const recentlyEnded = tasks.filter(
    (task) => task.status !== "running" && task.status !== "queued" && now - taskEndedAt(task) < recentWindowMs,
  );
  // 星位上下文（B 链路）：sessions.list 的会话级用量（选择逻辑在 taskChains.js）。
  const usageSessions = useMemo(
    () => selectUsageSessions(effectiveAgents?.sessions),
    [effectiveAgents],
  );
  // 空闲会话清单：没上卡的（无水位且未运行），供卡头计数与"看全部"展开。
  const idleSessions = useMemo(
    () => listIdleSessions(effectiveAgents?.sessions, usageSessions),
    [effectiveAgents, usageSessions],
  );
  // 会话工作台账（session_run 表）：群聊派活等会话 run。活跃 + 近 N 小时失败
  // （失败记录保留设置），与任务行同一口径；排序键 = 最近活动。
  const sessionRuns = feed.sessionRuns ?? [];
  const activeRuns = sessionRuns.filter((run) => run.status === "running");
  const failedRuns = sessionRuns.filter(
    (run) => run.status === "failed" && now - (run.endedAtMs ?? run.lastSeenMs ?? 0) < recentWindowMs,
  );
  const taskStartedAt = (task) => task.startedAtMs ?? task.firstSeenMs ?? 0;
  const sessionActivityAt = (run) => run.endedAtMs ?? run.startedAtMs ?? run.lastSeenMs ?? 0;
  const staleMs = Math.max(10, loadMonitorConfig().staleThresholdSec) * 1000;
  // 接力分段阈值（设置页"实时监控参数"可调）：每拍渲染现读配置，保存后一个
  // 轮询周期内自然生效，不需要跨窗口事件。
  const episodeGapMs = loadMonitorConfig().episodeGapMin * 60_000;
  // 进度/报错中文映射开关（设置页"实时监控参数"）：关 = 显示 openclaw 原文。
  const translateProgress = loadMonitorConfig().translateProgress;
  const shellAppearance = glassShellAppearance("widget", {
    transparent,
    glassMode,
    glassTint,
    glassInk,
    glassAlpha,
    isMac: IS_MAC,
    loading: false,
  });
  // 窗口随控制开合变尺寸时 WebView 会发瞬态 pointerleave（原竖条踩过同一坑，
  // 用"延时 + :hover 复核"跨过原生事务）：延时收控制，指针真离开才收；
  // 尺寸变化由下面的 useLayoutEffect 统一调窗，这里只改状态。
  const closeMiniControlsAfterLeave = () => {
    window.clearTimeout(miniLeaveTimerRef.current);
    miniLeaveTimerRef.current = window.setTimeout(() => {
      miniLeaveTimerRef.current = null;
      if (miniShellRef.current?.matches(":hover")) return;
      setMiniControlsOpen(false);
    }, 260);
  };
  // 折叠态 = 迷你任务列表：一行一个任务（状态点 + 标题 + 已跑时长）。
  // 折叠时要一眼看到的是"哪些活儿在跑、跑了多久、谁挂了"——42px 窄条装不下
  // 任何可读信息（字牌/计数都被用户否了），任务标题才是自解释的。
  // 两类工作同一行集：登记任务（task）+ 会话工作（session，群聊派活，见会话台账）；
  // 行序三档制（Leo 2026-10-04 "失败堆积刷屏"的解法之一 + 六案②失败分诊）：
  // 运行中的永远在前，真失败排其后，良性未跑（静默跳过/重启中止/手动取消，
  // 分诊见 failureClassOf）灰显垫底——失败再多也不把活的工作挤出前 5 行。
  const failedRunTone = (run) => (failureClassOf(run.error) === "real" ? "failed" : "skipped");
  const failedTaskTone = (task) => (failureClassOf(task.error) === "real" ? "failed" : "skipped");
  // 七星灯牌（Leo 2026-10-06 拍板）：胶囊条常态一格一星、绝不重复——
  // ●绿呼吸=正在执行（北斗群或私聊主对话都算）、✓/✕=今夜收班、○=空闲
  // （rest 灯语，新增）。链路明细收进悬停星卡（按星聚合今夜全部跳）；
  // +N 角标退役（花名册本就全量上屏，不存在"其余工作"）。
  // 实时活跃融合（Leo 2026-10-07 实锤"胶囊比星位上下文慢"）：灯牌的 running
  // 判定与主窗星位上下文同源——agents 快照里 hasActiveRun 的星立即亮 ●；
  // 快照覆盖到的星一律听快照的（台账收行能晚 18 秒+，台账优先=熄灯延迟），
  // 台账只兜快照没覆盖的星（纯 cron/快照失败）。
  const liveActiveAgentIds = useMemo(() => {
    const ids = new Set();
    for (const session of effectiveAgents?.sessions ?? []) {
      if (session?.hasActiveRun && session.agentId) ids.add(session.agentId);
    }
    return ids;
  }, [effectiveAgents]);
  const snapshotAgentIds = useMemo(() => {
    const ids = new Set();
    for (const session of effectiveAgents?.sessions ?? []) {
      if (session?.agentId) ids.add(session.agentId);
    }
    return ids;
  }, [effectiveAgents]);
  const roster = buildAgentRoster({
    agents: [...agentNameMap.keys()],
    tasks,
    runs: sessionRuns,
    now,
    // 折叠分支早于展开分支的 dayStart（1433 行），这里就地算零点
    dayStartMs: (() => {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    })(),
    order: ROSTER_STAR_ORDER,
    liveActiveAgentIds,
    snapshotAgentIds,
    staleMs,
  });
  // 灯牌单元格 = 花名册条目；运行中星的 taskId 作当前跳（呼吸居中锚点）。
  const rosterHops = roster.map((entry) => entry.hop);
  const rosterLive = roster.find((entry) => entry.running) ?? null;
  const rosterCurrentTaskId = rosterLive ? rosterLive.hop.taskId : null;
  const rosterByHopTaskId = new Map(roster.map((entry) => [entry.hop.taskId, entry]));
  // 窗口尺寸：横条=跑马灯 224×36；竖条=链路胶卷竖放 36×224——厚度跟横条
  // 统一（Leo 2026-10-06：横竖一个截面一个视觉），控制开合竖条长高到 376。
  // 窗口高度不随数据伸缩；更长/更短的链由胶卷滚动与当前跳居中承担。
  const miniSize = (vertical, controlsOpenState) =>
    vertical
      ? { width: 36, height: controlsOpenState ? 376 : 224 }
      : { width: controlsOpenState ? 308 : 224, height: 36 };
  // 尺寸变化统一走这一个副作用（折叠/开合/切向/行数），处理器只改状态。
  // 折叠态锁死原生拖拽并解除展开态的尺寸下限（细条边缘全是热区）。
  useLayoutEffect(() => {
    if (!collapsed) return;
    const dims = miniSize(miniOrientation === "vertical", miniControlsOpen);
    runWindowAction(() => applyMiniCapsuleSize(dims.width, dims.height));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsed, miniControlsOpen, miniOrientation]);
  // 展开态挂载（重启后直接回到面板）：Rust 侧按 320×384 建窗，这里把用户
  // 上次拖出的尺寸套回去并放开可拖拽调尺寸。折叠态挂载由上面的胶囊副作用管。
  // 依赖带 collapsed：任何路径切进展开态（胶囊 +N、提醒落点）都必须把窗
  // 撑回面板尺寸——曾只写 [] 只在挂载时跑，运行中展开=窗停在胶囊尺寸，
  // 内容被裁得只剩一个字还没按钮可点（Leo 装机踩中）。
  useEffect(() => {
    if (collapsed) return;
    runWindowAction(() => applyExpandedPanelSize());
  }, [collapsed]);
  // 预览路径定位（窗内 Portal+fixed；真机星卡由伴随窗承载，不走这里）。
  // 竖条：卡在胶卷富余一侧，纵向锚悬停格中心、钳在视口内。横条：贴壳缘
  // 上/下（放不下改下方）、水平钳在视口内。间距 6px："分开但不疏远"。
  const hopCardStyle = (() => {
    if (!hoverCard) return null;
    const cardH = hoverCard.measuredH ?? TASKS_HOPCARD_HEIGHT;
    if (hoverCard.orientation === "horizontal") {
      const cell = hoverCard.cellRect;
      const left = Math.min(
        Math.max(cell.centerX - TASKS_HOPCARD_WIDTH / 2, 8),
        Math.max(window.innerWidth - TASKS_HOPCARD_WIDTH - 8, 8),
      );
      const above = cell.top - TASKS_HOPCARD_GAP - cardH >= 8;
      const top = above ? cell.top - TASKS_HOPCARD_GAP - cardH : cell.bottom + TASKS_HOPCARD_GAP;
      return { top: Math.round(top), left: Math.round(left) };
    }
    const railRect = railWrapRef.current?.getBoundingClientRect();
    // ref 偶发未挂时用屏幕锚点反算视口坐标（悬停瞬间定格的同一几何）。
    const railRightView = railRect ? railRect.right : hoverCard.railRightScreen - window.screenX;
    const railLeftView = railRect ? railRect.left : hoverCard.railLeftScreen - window.screenX;
    const need = TASKS_HOPCARD_WIDTH + TASKS_HOPCARD_GAP;
    const side = railRightView + need <= window.innerWidth - 8 ? "left" : "right";
    const left = side === "left"
      ? railRightView + TASKS_HOPCARD_GAP
      : railLeftView - TASKS_HOPCARD_WIDTH - TASKS_HOPCARD_GAP;
    const half = cardH / 2 + 4;
    const top = Math.min(
      Math.max(hoverCard.windowY, half),
      Math.max(window.innerHeight - half, half),
    );
    return { top: Math.round(top), left: Math.round(left), transform: "translateY(-50%)" };
  })();
  // 悬停卡实时化（发现 6）：拉新数据落地后按 taskId 在最新灯牌里找回该跳，
  // 卡片跟着刷新，不再定格在打开瞬间的快照；跳刚好消失则退回快照兜底。
  // （顶层计算：伴随窗载荷与胶囊内预览渲染共用同一份实时卡数据。）
  let cardHop = hoverCard?.hop ?? null;
  let cardIndex = hoverCard?.index ?? 0;
  let cardTotal = hoverCard?.total ?? 0;
  if (hoverCard && cardHop) {
    const live = rosterHops.find(
      (hop) => `${hop.gateway ?? ""}:${hop.taskId}` === `${cardHop.gateway ?? ""}:${cardHop.taskId}`,
    );
    if (live) {
      cardHop = live;
      cardIndex = rosterHops.indexOf(live);
      cardTotal = rosterHops.length;
    }
  }
  // 星卡伴随窗定位（悬停锚点定格，渲染期现算；纯函数在 windowGeometry）。
  // 竖条=固定 460 承载高、内容盒垂直居中；横条=估计盒高+富余、盒按 side
  // 钳贴条缘。胶囊本体零 resize——卡窗位置纯粹是"别人家的窗"。
  const hopCardRect = (() => {
    if (!hoverCard) return null;
    const workArea = {
      x: Number.isFinite(window.screen?.availLeft) ? window.screen.availLeft : 0,
      y: Number.isFinite(window.screen?.availTop) ? window.screen.availTop : 0,
      width: Number.isFinite(window.screen?.availWidth) ? window.screen.availWidth : window.innerWidth,
      height: Number.isFinite(window.screen?.availHeight) ? window.screen.availHeight : window.innerHeight,
    };
    if (hoverCard.orientation === "horizontal") {
      return hopCardWindowPlacement({
        orientation: "horizontal",
        shellTop: hoverCard.shellTopScreen,
        shellBottom: hoverCard.shellBottomScreen,
        cellCenterX: hoverCard.cellCenterXScreen,
        cardWidth: TASKS_HOPCARD_WIDTH,
        cardHeight: Math.max(TASKS_HOPCARD_HEIGHT, lastCardHRef.current ?? 0) + HOP_CARD_HEIGHT_SLACK,
        gap: TASKS_HOPCARD_GAP,
        workArea,
      });
    }
    return hopCardWindowPlacement({
      orientation: "vertical",
      railLeft: hoverCard.railLeftScreen,
      railRight: hoverCard.railRightScreen,
      cellCenterY: hoverCard.cellCenterYScreen,
      cardWidth: TASKS_HOPCARD_WIDTH,
      cardHeight: HOP_CARD_WINDOW_HEIGHT,
      gap: TASKS_HOPCARD_GAP,
      workArea,
    });
  })();
  // 空闲星卡「下次」：该星名下最早触发的启用定时任务（网关权威 nextRunAtMs）。
  const cardNextRunView = (() => {
    if (!cardHop) return null;
    const entry = buildCronNextByAgent(cronJobs, now).get(cardHop.agentId ?? "");
    if (!entry) return null;
    return { atMs: entry.atMs, jobName: jobDisplayName(entry.job.name || entry.job.id) };
  })();
  // 伴随窗载荷（JSON 串）：与预览 Portal 同一套数据口径；deps 按值比较，
  // 数据没变的重渲染不会重发。
  const hopCardPayload = hoverCard && cardHop
    ? JSON.stringify({
        orientation: hoverCard.orientation,
        side: hopCardRect?.side ?? null,
        hop: cardHop,
        index: cardIndex,
        total: cardTotal,
        records: rosterByHopTaskId.get(cardHop.taskId)?.records ?? null,
        live: Boolean(rosterByHopTaskId.get(cardHop.taskId)?.running),
        nextRun: cardNextRunView,
        agentNames: Object.fromEntries(agentNameMap),
        currentTaskId: rosterCurrentTaskId,
        translate: translateProgress,
        light: glassTint === "light" || (glassTint === "clear" && glassInk === "dark"),
      })
    : null;
  // 星卡伴随窗布局 effect：开/换卡=定位+载荷交给 Rust（隐藏态改几何零伪影，
  // 卡窗画完一帧回 ready 才显形）；收卡=藏窗。胶囊窗本体零 resize——WebView2
  // 重排滞后一帧的伪影失去物理载体（b23d4b6 方向修正只能消位移消不掉 resize
  // 本身，Leo 装机三轮实锤的"弹卡瞬间轻微左右抖"，此为根治）。
  // deps 按值比较：载荷串与坐标没变的重渲染不重发；数据活刷新（轮询落地）
  // 会带新载荷重发，卡窗原地换内容（对已可见的窗 show 是幂等 no-op）。
  const hopCardOpen = hoverCard != null;
  useLayoutEffect(() => {
    if (!nativeHopCard) return;
    if (!hopCardOpen || !hopCardPayload || !hopCardRect) {
      runWindowAction(() => hideHopCardWindow());
      return;
    }
    const height = hoverCard.orientation === "vertical"
      ? HOP_CARD_WINDOW_HEIGHT
      : Math.max(TASKS_HOPCARD_HEIGHT, lastCardHRef.current ?? 0) + HOP_CARD_HEIGHT_SLACK;
    runWindowAction(() => showHopCardWindow({
      x: hopCardRect.x,
      y: hopCardRect.y,
      width: TASKS_HOPCARD_WIDTH,
      height,
      payload: hopCardPayload,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nativeHopCard, hopCardOpen, hopCardPayload, hopCardRect?.x, hopCardRect?.y, hoverCard?.orientation]);
  if (collapsed) {
    const miniVertical = miniOrientation === "vertical";
    const MiniOrientationIcon = miniVertical ? ArrowsLeftRight : ArrowsDownUp;
    const expand = () => {
      setCollapsed(false);
      setMiniControlsOpen(false);
      runWindowAction(() => applyExpandedPanelSize());
    };
    const miniDimensions = miniSize(miniVertical, miniControlsOpen);
    return (
      <main
        ref={miniShellRef}
        className={shellAppearance.className}
        style={{
          ...shellAppearance.style,
          width: `${miniDimensions.width}px`,
          height: `${miniDimensions.height}px`,
          // 折叠壳不受 .widget-shell 的 320×260 下限约束（那是完整卡片的下限）
          minWidth: 0,
          minHeight: 0,
        }}
        onPointerEnter={() => {
          window.clearTimeout(miniLeaveTimerRef.current);
          miniLeaveTimerRef.current = null;
        }}
        onPointerLeave={closeMiniControlsAfterLeave}
      >
        <div
          className={`tasks-mini${miniVertical ? " tasks-mini--vertical" : ""}`}
          onPointerDown={(event) => {
            if (event.button !== 0 || event.target.closest("button")) return;
            // 按下即收卡（伴随窗随 hopCardOpen 翻 false 隐藏）；拖拽期悬停卡停发。
            pointerDownRef.current = true;
            if (hoverCardRef.current) setHoverCard(null);
            // 挪窗手势回归（Leo 2026-10-07 实锤"没有一个位置可以拖动"）：
            // 壳上按下、移动超阈值才启动 OS 拖拽——b23d4b6 拆除的前提已消失
            // （悬停卡搬进伴随窗，胶囊本体零程序化挪窗，跟手模态循环没有对手）。
            // 星格/胶卷上按下优先内容拖拽滚动（4px 即认领并打 stripDragging
            // 标记，先于壳层 8px 阈值），OS 拖拽不抢；点按不超阈值=点击展开。
            shellDragRef.current = {
              x: event.clientX,
              y: event.clientY,
              onStrip: Boolean(event.target.closest(".tasks-mini-strip")),
            };
          }}
          onPointerMove={(event) => {
            // OS 拖拽的模态循环可能吞掉 pointerup——首个无按键的 move 视为已松开
            if (pointerDownRef.current && (event.buttons ?? 0) === 0) pointerDownRef.current = false;
            const drag = shellDragRef.current;
            if (!drag || (event.buttons ?? 0) !== 1) return;
            if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 8) return;
            if (drag.onStrip && event.target.closest(".tasks-mini-strip")?.dataset.stripDragging) return;
            shellDragRef.current = null;
            startWindowDragging();
          }}
          onPointerUp={() => {
            pointerDownRef.current = false;
            shellDragRef.current = null;
          }}
          onPointerCancel={() => {
            pointerDownRef.current = false;
            shellDragRef.current = null;
          }}
        >
          {miniVertical ? (
            // 竖条 = 七星灯牌竖放（Leo 2026-10-06 拍板）：一星一格绝不重复，
            // ●绿呼吸=正在执行、✓/✕=今夜收班、○=空闲（rest 灯语）；滚轮/按住
            // 拖动翻看、悬停星格出该星明细卡，点击展开小组件面板。+N 角标
            // 退役——花名册本就全量上屏，不存在"其余工作"。
            roster.length > 0 ? (
              <div
                ref={railWrapRef}
                className="tasks-mini-railwrap"
                onPointerLeave={hideHopCard}
              >
                <ChainFilmstrip
                  vertical
                  hops={rosterHops}
                  currentTaskId={rosterCurrentTaskId}
                  agentNameMap={agentNameMap}
                  onExpand={expand}
                  onHopHover={showHopCard}
                />
              </div>
            ) : (
              // 竖条空态：文字竖排，横排文本在 42px 窄条里会一字一行摞下来；
              // 花名册建不起来（agents.list 空）才是真未同步（不谎报）
              <span className="tasks-mini-empty tasks-mini-empty--vertical">
                {feed.live ? "暂无运行中任务" : "未同步"}
              </span>
            )
          ) : (
            // 横条 = 七星灯牌横排：同竖条一套内容口径（一星一格去重 + 灯语），
            // 悬停星格出该星明细卡，点击唤主窗。
            roster.length > 0 ? (
              <div className="tasks-mini-ticker" onPointerLeave={hideHopCard}>
                <ChainFilmstrip
                  hops={rosterHops}
                  currentTaskId={rosterCurrentTaskId}
                  agentNameMap={agentNameMap}
                  onExpand={expand}
                  onHopHover={showHopCard}
                />
              </div>
            ) : (
              <span className="tasks-mini-empty">{feed.live ? "暂无运行中任务" : "未同步"}</span>
            )
          )}
          {hoverCard && cardHop && !nativeHopCard &&
            // 预览路径（无伴随窗命令面）：卡片 Portal 到 body 用 fixed 定位，
            // 竖条/横条共用同一张卡（发现 1B/7：组件、样式、数据口径一处生效）。
            // 真机走 tasks-hopcard 伴随窗，胶囊内不重复渲染。
            createPortal(
              <HopHoverCard
                hop={cardHop}
                index={cardIndex}
                total={cardTotal}
                records={rosterByHopTaskId.get(cardHop.taskId)?.records ?? null}
                // live=该星自己的运行态（花名册条目的 running），不是"全舰队的
                // 第一个运行星"——多星同时跑时（真机：天玑+玉衡同跑），此前只有
                // 星序靠前的拿到富卡，后面的运行星错拿收班卡=内容"不一致"。
                live={Boolean(rosterByHopTaskId.get(cardHop.taskId)?.running)}
                nextRun={cardNextRunView}
                agentNameMap={agentNameMap}
                currentTaskId={rosterCurrentTaskId}
                translate={translateProgress}
                // 卡片跟随壳的有效墨色（与 glassShellAppearance 的 --glass-light
                // 判定同一条规则）：浅色档、透明档+深色字（白霜）→ 浅色卡；
                // 深色档、透明档+白字（深 scrim）→ 深色卡。卡片 Portal 在 body
                // 下，壳类够不到，只能显式传。
                light={glassTint === "light" || (glassTint === "clear" && glassInk === "dark")}
                onHeight={handleCardHeight}
                style={hopCardStyle}
              />,
              document.body,
            )}
          <div className={`tasks-mini-controls${miniControlsOpen ? " tasks-mini-controls--open" : ""}`}>
            <span className="strip-control-slot strip-control-slot--menu" title={feed.live ? "实时同步中" : "未同步"}>
              {/* 状态灯常亮（原版语义）：绿=实时同步中，橙=断线。悬停时让位给 •••。 */}
              <i
                className={`status-dot ${feed.live ? "" : "status-dot--error"}`}
                aria-hidden="true"
              />
              <button
                type="button"
                className={`strip-button strip-button--menu ${miniControlsOpen ? "strip-button--active" : ""}`}
                onClick={() => setMiniControlsOpen(!miniControlsOpen)}
                aria-expanded={miniControlsOpen}
                aria-label={miniControlsOpen ? "收起控制按钮" : "展开控制按钮"}
                title={miniControlsOpen ? "收起控制按钮" : "展开控制按钮"}
              >
                <DotsThree size={16} weight="regular" aria-hidden="true" />
              </button>
            </span>
            {miniControlsOpen && (
              <>
                {/* 3 秒自动轮询下强制刷新无感，这个槽位让给外观切换：
                    迷你胶囊才是常驻形态，融壁纸不该先展开再切 */}
                <button
                  type="button"
                  className={`strip-button ${transparent ? "strip-button--active" : ""}`}
                  onClick={onCycleAppearance}
                  aria-label={`切到${glassTint === "dark" ? "浅色" : glassTint === "light" ? "透明" : "深色"}`}
                  title={`切到${glassTint === "dark" ? "浅色" : glassTint === "light" ? "透明" : "深色"}`}
                >
                  <CircleHalfTilt size={15} weight={transparent ? "fill" : "light"} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={`strip-button ${pinned ? "strip-button--active" : ""}`}
                  onClick={() => {
                    const next = !pinned;
                    setPinned(next);
                    runWindowAction(() => setWindowPinned(next));
                  }}
                  aria-pressed={pinned}
                  title={pinned ? "取消固定，恢复拖动" : "固定在当前位置并置顶"}
                >
                  <PushPinSimple size={15} weight={pinned ? "fill" : "light"} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="strip-button"
                  onClick={toggleMiniOrientation}
                  aria-label={miniVertical ? "切换为横条" : "切换为竖条"}
                  title={miniVertical ? "切换为横条" : "切换为竖条"}
                >
                  <MiniOrientationIcon size={15} weight="light" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="strip-button"
                  onClick={expand}
                  aria-label="展开任务追踪"
                  title="展开任务追踪"
                >
                  <ArrowsOutSimple size={15} weight="light" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="strip-button"
                  onClick={onOpenExpanded}
                  aria-label="打开完整视图"
                  title="完整视图"
                >
                  <CornersOut size={15} weight="light" aria-hidden="true" />
                </button>
              </>
            )}
          </div>
        </div>
      </main>
    );
  }
  // 舰队模块板（Leo 2026-10-06 拍板"一个 agent 一个区域模块，实时覆盖"）：
  // 旧面板一轮一张卡（长会话时间线一晚几十跳，滚动看不到底）——改每 agent
  // 一块固定模块：跑着的星=呼吸绿框，标题+进度行原地刷新（新覆盖旧）；
  // 第三行=记事（最近一次收班的结论原话，覆盖式）；账（第 N 轮/时长）进
  // 头部右侧。窗口=今天 0 点起，今夜没活动的 agent 不占位；点模块展开该星
  // 明细抽屉（时间线/胶卷随标题栏"明细"按钮），默认收起。
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const fleetModules = buildFleetModules({ tasks, runs: sessionRuns, now, dayStartMs: dayStart.getTime() });
  const renderFleetModule = (mod) => {
    const name = agentDisplayName(agentNameMap, mod.agentId) || mod.agentId;
    const run = mod.running;
    const live = Boolean(run);
    const ended = mod.lastEnded;
    const open = fleetOpenSet.has(mod.agentId);
    const accent = live
      ? (run.status === "queued" ? "queued" : "running")
      : ended
        ? hopToneOf(ended).tone
        : "idle";
    const stale = live && run.kind === "task" && Number.isFinite(run.lastSeenMs) && now - run.lastSeenMs > staleMs;
    // 头部 meta（记账）：跑着的会话="第 N 轮 · 已跑"（首轮只写时长）、任务=已跑；
    // 收班=多久之前。
    const meta = live
      ? `${run.kind === "session" && mod.roundIndex > 1 ? `第 ${mod.roundIndex} 轮 · ` : ""}${formatTaskDuration(run.startedAtMs, now) || formatTaskAge(run.startedAtMs)}`
      : ended
        ? formatTaskAge(ended.endedAtMs ?? 0)
        : "";
    // 正在行：活模块的心跳，原地刷新不换行；排队=灰"排队中"。
    const progressLine = (() => {
      if (!live) return null;
      if (run.status === "queued") return { text: "排队中", tone: "queued", raw: null };
      const text = run.kind === "task"
        ? toolProgressLabel(run.lastToolName, translateProgress) || run.progressSummary || "执行中"
        : toolProgressLabel(run.progressSummary, translateProgress) || "会话工作中";
      const count = run.kind === "task" && run.toolUseCount > 0 ? ` · 本轮 ${run.toolUseCount} 次工具` : "";
      return { text: `${text}${count}`, tone: "run", raw: run.progressSummary ?? run.lastToolName ?? text };
    })();
    // 记事行（覆盖式）：活模块=上一次收班的 ✓/✕ + 结论原话；收班模块=自己的
    // 结果。没有历史就写"今夜首轮"，不硬凑空行。
    const note = (() => {
      if (!ended) return live ? { text: "今夜首轮", tone: "quiet", raw: null } : null;
      const { tone, state } = hopToneOf(ended);
      const dur = formatCompactDuration(ended.startedAtMs, ended.endedAtMs) || "";
      const brief = ended.terminalSummary
        || (tone === "failed" ? sessionErrorText(ended.error, translateProgress) : "")
        || state;
      return { text: `${hopGlyphOf(tone)}${dur ? ` ${dur}` : ""} — ${brief}`, tone, raw: brief };
    })();
    return (
      <div key={mod.agentId} className={`tasks-fleet-mod${live ? " is-live" : " is-dimmed"}`}>
        <button
          type="button"
          className="tasks-fleet-head"
          aria-expanded={open}
          onClick={() => toggleFleetModule(mod.agentId)}
          title={live ? `${name} · ${run.title || "执行中"}${stale ? " · 滞后?" : ""}` : ended ? `${name} · ${ended.title}` : name}
        >
          <i className={`tasks-fleet-dot is-${accent}`} aria-hidden="true" />
          <span className="tasks-fleet-name">{name}</span>
          {live?.sub ? <span className="widget-session-flag">子</span> : null}
          <span className="tasks-fleet-work">{live
            ? cleanSessionTitle(run.title ?? "") || (run.kind === "task" ? "执行中" : "执行中 · 已接收任务")
            : (ended?.title ?? "")}</span>
          {meta ? <span className="tasks-fleet-meta">{meta}</span> : null}
          {stale ? <span className="task-pill task-pill--stale" title="运行中但超过阈值没有新事件（设置页可调）">滞后?</span> : null}
        </button>
        {progressLine ? (
          <p className={`tasks-fleet-line is-${progressLine.tone}`} title={progressLine.raw ?? progressLine.text}>
            <em>正在：</em>
            {progressLine.text}
          </p>
        ) : null}
        {note ? (
          <p className={`tasks-fleet-note is-${note.tone ?? "quiet"}`} title={note.raw ?? note.text}>
            {note.text}
          </p>
        ) : null}
        {open && (
          <div className="tasks-fleet-drawer">
            {mod.records.length >= 2 ? (
              <TaskChainTimeline hops={mod.records} currentTaskId={run?.taskId ?? null} agentNameMap={agentNameMap} translate={translateProgress} />
            ) : (
              <p className="tasks-fleet-drawer-empty">
                {mod.records[0]?.terminalSummary || "今夜就这一条"}
              </p>
            )}
          </div>
        )}
      </div>
    );
  };
  // 面板八向拖拽热区（无边框窗在 Windows 没有原生 resize 边带）：5px 边 +
  // 10px 角，按下即交原生 startResizeDragging 拖尺寸，松手后既有 resize
  // 监听去抖存尺寸。
  const resizeHandles = [
    ["n", "North"], ["s", "South"], ["e", "East"], ["w", "West"],
    ["nw", "NorthWest"], ["ne", "NorthEast"], ["sw", "SouthWest"], ["se", "SouthEast"],
  ];
  return (
    // tasks-window-shell：面板跟随窗口尺寸（用户可拖拽调宽高）；.widget-shell
    // 的 320 定宽是主窗小组件的规矩，这里放开到满窗。
    <main className={`${shellAppearance.className} tasks-window-shell`}>
      <h1 className="sr-only">司南 任务追踪小组件</h1>
      {resizeHandles.map(([edge, direction]) => (
        <div
          key={edge}
          className={`rsz rsz-${edge}`}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            runWindowAction(() => startWindowResizing(direction));
          }}
          aria-hidden="true"
        />
      ))}
      <header className="widget-titlebar" onPointerDown={(event) => {
        if (event.target.closest("button")) return;
        startWindowDragging();
      }}>
        <span className="widget-brand">
          任务追踪
          <span
            className={`status-dot ${feed.live ? "" : "status-dot--error"}`}
            title={feed.live ? "实时同步中" : "未同步"}
          />
        </span>
        <div className="window-actions window-actions--compact">
          <button
            type="button"
            className="window-action"
            onClick={() => setCollapsed(true)}
            aria-label="折叠为迷你胶囊"
            title="折叠为迷你胶囊"
          >
            <ArrowsInLineVertical size={16} weight="light" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`window-action ${transparent ? "window-action--active" : ""}`}
            onClick={onCycleAppearance}
            aria-label={`切到${glassTint === "dark" ? "浅色" : glassTint === "light" ? "透明" : "深色"}`}
            title={`切到${glassTint === "dark" ? "浅色" : glassTint === "light" ? "透明" : "深色"}`}
          >
            <CircleHalfTilt size={16} weight={transparent ? "fill" : "light"} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`window-action ${pinned ? "window-action--active" : ""}`}
            onClick={() => {
              const next = !pinned;
              setPinned(next);
              onPinnedChange?.(next);
              runWindowAction(() => setWindowPinned(next));
            }}
            aria-label={pinned ? "取消置顶" : "置顶"}
            aria-pressed={pinned}
            title={pinned ? "取消置顶" : "置顶"}
          >
            <PushPinSimple size={17} weight={pinned ? "fill" : "light"} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="window-action"
            onClick={() => runWindowAction(minimizeWindow)}
            aria-label="最小化"
            title="最小化"
          >
            <Minus size={17} weight="light" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="window-action window-action--close"
            onClick={onClose}
            aria-label="关闭任务小组件"
            title="关闭"
          >
            <X size={17} weight="light" aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="tasks-window-content">
        <section className="widget-tasks tasks-window-body" aria-label="Gateway 任务">
          {fleetModules.length === 0 && usageSessions.length === 0 && (
            <p className="widget-tasks-empty">
              {tasks.length || sessionRuns.length ? "今夜还没开工" : "等待首次同步…（主窗口 设置 → 任务追踪 配置 Gateway）"}
            </p>
          )}
          {fleetModules.length > 0 && (
            <div className="tasks-fleet">
              {fleetModules.map((mod) => renderFleetModule(mod))}
            </div>
          )}
          <TasksUsageCard
            variant="panel"
            usageSessions={usageSessions}
            idleSessions={idleSessions}
            agentNameMap={agentNameMap}
          />
        </section>
      </div>
      <footer className="widget-footer tasks-window-footer">
        <span
          className="widget-source"
          title={feed.lastSync ? `更新于 ${new Date(feed.lastSync).toLocaleTimeString("zh-CN", { hour12: false })}` : "尚未同步"}
        >
          <ShieldCheck size={15} weight="fill" aria-hidden="true" />
          <span>{feed.live ? "Gateway 已连接" : "Gateway 未同步"}</span>
          <small>{feed.lastSync ? new Date(feed.lastSync).toLocaleTimeString("zh-CN", { hour12: false }) : "--:--"}</small>
        </span>
        {/* 3 秒自动轮询下手动的强制刷新无感，按钮只在断线时有活干（发现 5）：
            平时隐形，断线变橙时出现「↻ 重试」——按钮的存在理由就是它的出现时机 */}
        {!feed.live && (
          <button
            type="button"
            className="widget-refresh widget-refresh--retry"
            onClick={() => {
              if (refreshing) return;
              setRefreshing(true);
              feed.refresh?.();
              window.setTimeout(() => setRefreshing(false), 900);
            }}
            disabled={refreshing}
            aria-label="重试连接"
            title="重试连接"
          >
            <ArrowsClockwise size={13} weight="light" aria-hidden="true" />
            <span>重试</span>
          </button>
        )}
        <button type="button" className="widget-expand" onClick={onOpenExpanded}>
          <span>完整视图</span>
          <ArrowsOutSimple size={16} weight="light" aria-hidden="true" />
        </button>
      </footer>
    </main>
  );
}

function AppearanceCard({ theme, onThemeChange, glassAlpha, onGlassAlpha, glassTint, onGlassTint, glassInk, onGlassInk, uiScale, onUiScale, stripScale, onStripScale, pinned, onPinnedChange, pinnedHoverMode, onPinnedHoverMode, pinnedHoverOpacity, onPinnedHoverOpacity }) {
  return (
    <div className="settings-card">
      <h2>外观与缩放</h2>
      <p className="settings-muted">
        大窗口的明暗主题，「自动」跟随系统；小组件不受影响。
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
      {/* macOS 面板材质跟随系统 vibrancy，不提供组件外观选项；
          深/浅配色用于 Windows 与 Linux 的卡片和胶囊。 */}
      {!IS_MAC && (
        <div className="settings-subsection">
          <h3>组件外观</h3>
          <p className="settings-muted">
            深色是 HUD 玻璃；浅色是透亮白磨砂；透明会直接透出桌面与后方窗口，并叠加轻霜和边缘高光。
          </p>
          <div className="theme-toggle" role="group" aria-label="组件外观">
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
        hint="作用于任务追踪小组件和贴边胶囊的透明/玻璃档；主窗是实底控制台不受影响。越低越通透，越高越厚实。"
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

function MonitorSettingsCard({ tasksWidgetEnabled, onToggleTasksWidget }) {
  const [draft, setDraft] = useState(() => loadMonitorConfig());
  const [saved, setSaved] = useState(false);

  const current = loadMonitorConfig();
  const dirty =
    Number(draft.refreshIntervalSec) !== current.refreshIntervalSec ||
    Number(draft.staleThresholdSec) !== current.staleThresholdSec ||
    Number(draft.episodeGapMin) !== current.episodeGapMin ||
    Number(draft.failedWindowH) !== current.failedWindowH ||
    Number(draft.historyWindowMin) !== current.historyWindowMin ||
    Number(draft.ledgerRetentionDays) !== current.ledgerRetentionDays ||
    Number(draft.missedWindowHours) !== current.missedWindowHours ||
    Number(draft.watermarkWarnPct) !== current.watermarkWarnPct ||
    Boolean(draft.notifyOnFailure) !== current.notifyOnFailure ||
    Boolean(draft.notifyOnComplete) !== current.notifyOnComplete ||
    Number(draft.notifyAggregateMin) !== current.notifyAggregateMin ||
    Number(draft.notifyStaySec) !== current.notifyStaySec ||
    Boolean(draft.notifyQuietOn) !== current.notifyQuietOn ||
    String(draft.notifyQuietStart) !== current.notifyQuietStart ||
    String(draft.notifyQuietEnd) !== current.notifyQuietEnd ||
    Boolean(draft.translateProgress) !== current.translateProgress ||
    Boolean(draft.tasksEdgeDock) !== current.tasksEdgeDock;

  const apply = () => {
    saveMonitorConfig(draft);
    setDraft(loadMonitorConfig());
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const numberField = (label, aria, key, min, max) => (
    <label className="monitor-field">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={draft[key]}
        aria-label={aria}
        onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}
      />
    </label>
  );

  return (
    <div className="settings-card">
      <h2>实时监控参数</h2>
      <p className="gateway-hint">
        任务页的同步节奏、接力分段与本地台账口径。保存后立即生效，无需重启或重装。
      </p>
      <div className="monitor-groups">
        <section className="monitor-group">
          <span className="monitor-group-title">同步节奏</span>
          <div className="monitor-grid">
            {numberField("自动同步间隔（秒，1–60）", "自动同步间隔秒数", "refreshIntervalSec", 1, 60)}
            {numberField("无活动判定阈值（秒，10–3600）", "无活动判定阈值秒数", "staleThresholdSec", 10, 3600)}
          </div>
        </section>
        <section className="monitor-group">
          <span className="monitor-group-title">接力与台账</span>
          <div className="monitor-grid">
            {numberField("接力分段沉默上限（分钟，5–720）", "接力分段沉默上限分钟数", "episodeGapMin", 5, 720)}
            {numberField("失败记录保留（小时，1–168）", "失败记录保留小时数", "failedWindowH", 1, 168)}
            {numberField("历史轮次回看（分钟，0=关闭，最长 7 天）", "历史轮次回看分钟数", "historyWindowMin", 0, 10080)}
            {numberField("台账保留期（天，1–90）", "台账保留期天数", "ledgerRetentionDays", 1, 90)}
            {numberField("漏采补记窗口（小时，1–72）", "漏采补记窗口小时数", "missedWindowHours", 1, 72)}
          </div>
        </section>
        <section className="monitor-group">
          <span className="monitor-group-title">提醒与预警</span>
          <div className="monitor-grid">
          <label className="monitor-field monitor-field--check">
            <input
              type="checkbox"
              checked={draft.notifyEnabled}
              aria-label="自绘提醒角标"
              onChange={(event) => {
                const next = event.target.checked;
                // 总开关即时生效（像任务小组件一样不等"保存参数"）：
                // 窗口幂等开合 + 立刻落盘（只并入这一项，不带draft里其他未保存改动）。
                setDraft((current) => ({ ...current, notifyEnabled: next }));
                saveMonitorConfig({ ...loadMonitorConfig(), notifyEnabled: next });
                setNotificationWindow(next);
                window.dispatchEvent(new Event("metrik-monitor-changed"));
              }}
            />
            <span>自绘提醒角标（屏幕右下角弹卡）</span>
          </label>
          <label className="monitor-field monitor-field--check">
            <input
              type="checkbox"
              checked={draft.notifyOnFailure}
              aria-label="轮次失败提醒"
              onChange={(event) =>
                setDraft((current) => ({ ...current, notifyOnFailure: event.target.checked }))
              }
            />
            <span>轮次失败提醒（真失败才响）</span>
          </label>
          <label className="monitor-field monitor-field--check">
            <input
              type="checkbox"
              checked={draft.notifyOnComplete}
              aria-label="轮次完成提醒"
              onChange={(event) =>
                setDraft((current) => ({ ...current, notifyOnComplete: event.target.checked }))
              }
            />
            <span>轮次完成提醒（默认关）</span>
          </label>
          {numberField("失败聚合窗口（分钟，2–60）", "失败聚合窗口分钟数", "notifyAggregateMin", 2, 60)}
            {numberField("卡片停留（秒，4–30）", "提醒卡片停留秒数", "notifyStaySec", 4, 30)}
          {numberField("上下文水位预警（%，0=关）", "上下文水位预警阈值百分比", "watermarkWarnPct", 0, 95)}
          <label className="monitor-field monitor-field--check monitor-field--check--wide">
            <input
              type="checkbox"
              checked={draft.notifyQuietOn}
              aria-label="免打扰时段"
              onChange={(event) =>
                setDraft((current) => ({ ...current, notifyQuietOn: event.target.checked }))
              }
            />
            <span>免打扰时段</span>
          </label>
            <label className="monitor-field">
              <span>免打扰开始</span>
              <input
                type="time"
                value={draft.notifyQuietStart}
                aria-label="免打扰开始时间"
                onChange={(event) =>
                  setDraft((current) => ({ ...current, notifyQuietStart: event.target.value }))
                }
              />
            </label>
            <label className="monitor-field">
              <span>免打扰结束</span>
              <input
                type="time"
                value={draft.notifyQuietEnd}
                aria-label="免打扰结束时间"
                onChange={(event) =>
                  setDraft((current) => ({ ...current, notifyQuietEnd: event.target.value }))
                }
              />
            </label>
          </div>
        </section>
        <section className="monitor-group">
          <span className="monitor-group-title">桌面小组件</span>
          <div className="monitor-grid">
            <label className="monitor-field monitor-field--check">
              <input
                type="checkbox"
                checked={draft.translateProgress}
                aria-label="进度与报错中文显示"
                onChange={(event) =>
                  setDraft((current) => ({ ...current, translateProgress: event.target.checked }))
                }
              />
              <span>进度与报错中文显示</span>
            </label>
            <label className="monitor-field monitor-field--check">
              <input
                type="checkbox"
                checked={tasksWidgetEnabled}
                onChange={onToggleTasksWidget}
              />
              <span>显示任务小组件（独立小窗）</span>
            </label>
            <label className="monitor-field monitor-field--check">
              <input
                type="checkbox"
                checked={draft.tasksEdgeDock}
                aria-label="任务小组件贴边自动隐藏"
                onChange={(event) =>
                  setDraft((current) => ({ ...current, tasksEdgeDock: event.target.checked }))
                }
              />
              <span>贴边自动隐藏（拖边收起，碰边弹出；置顶时不隐藏）</span>
            </label>
          </div>
        </section>
        <button
          type="button"
          className="ledger-button ledger-button--primary"
          disabled={!dirty}
          onClick={apply}
        >
          {saved ? "已保存" : "保存参数"}
        </button>
      </div>
      <p className="gateway-hint">
        建议：同步 2–5 秒；无活动阈值 60–300 秒（北斗星位一轮思考加工具调用常超 30 秒，不宜过短）。
        接力分段按"交接沉默"切：星位间交接一直连续，一轮跑多久都是同一段，只有沉默超过上限
        （如中途等你确认）才切下一段；失败记录保留 = 失败的工作在面板/迷你条留多久，过期自动消失
        （成功的工作完成即走，不占位）；历史轮次回看 = 主窗任务页列出收尾的接力段多长时间内的（0 = 关闭）。
        台账保留期到期自动清理；水位预警 = 星位上下文水位超过阈值时琥珀高亮并标"建议清理"（0 = 不预警）。
        失败分诊自动进行：心跳静默跳过、重启中止、手动取消按"跳过"灰显，只有真失败才染红；
        中文显示 = 映射 openclaw 工具名与常见报错；贴边隐藏 = 置顶时不隐藏。
      </p>
    </div>
  );
}

function GatewaySettingsCard({ gateways, onGatewaysChanged }) {
  const [draft, setDraft] = useState({ label: "", url: "", token: "", identityDir: "" });
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const valid = draft.label.trim() && draft.url.trim() && draft.token.trim();

  const addGateway = async () => {
    if (!valid) return;
    setBusy(true);
    setFeedback(null);
    try {
      const entry = {
        label: draft.label.trim(),
        url: draft.url.trim(),
        token: draft.token.trim(),
      };
      // 身份目录可选：远程网关用专用设备身份（identity/device.json）。
      // 本机网关留空 → 后端用默认 state 目录的探测身份。
      if (draft.identityDir.trim()) {
        entry.identityDir = draft.identityDir.trim();
      }
      // 连通性验证：直接试拉一次。失败也允许保存（VPS 可能暂时离线），
      // 但把错误显示出来让用户知道。
      const result = await refreshCronJobs([entry]);
      const outcome = result.results?.[0];
      const next = [
        ...gateways.filter((candidate) => candidate.label !== entry.label),
        entry,
      ];
      saveGatewayConfig(next);
      onGatewaysChanged(next);
      setDraft({ label: "", url: "", token: "", identityDir: "" });
      if (outcome?.ok) {
        setFeedback({ tone: "success", message: `已添加并连通：${entry.label}` });
      } else {
        setFeedback({
          tone: "error",
          message: `已保存，但连通失败：${outcome?.error || "未知原因"}（回环/SSH 隧道自动批准；否则需在网关侧 openclaw devices approve）`,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const removeGateway = (label) => {
    const next = gateways.filter((entry) => entry.label !== label);
    saveGatewayConfig(next);
    onGatewaysChanged(next);
  };

  return (
    <div className="settings-card">
      <h2>被追踪的 Gateway</h2>
      {gateways.length === 0 ? (
        <p className="gateway-hint">尚未配置。本机 Gateway（ws://127.0.0.1:18789）可直接添加。</p>
      ) : (
        <ul className="gateway-list">
          {gateways.map((entry) => (
            <li key={entry.label}>
              <span className="gateway-label">{entry.label}</span>
              <span className="gateway-url">{entry.url}</span>
              <button type="button" className="ledger-button ledger-button--secondary" onClick={() => removeGateway(entry.label)}>
                移除
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="gateway-form">
        <input
          type="text"
          value={draft.label}
          placeholder="名称（如：本机 / VPS）"
          aria-label="Gateway 名称"
          onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))}
        />
        <input
          type="text"
          value={draft.url}
          placeholder="ws://127.0.0.1:18789"
          aria-label="Gateway 地址"
          spellCheck={false}
          onChange={(event) => setDraft((current) => ({ ...current, url: event.target.value }))}
        />
        <input
          type="password"
          value={draft.token}
          placeholder="Gateway token"
          aria-label="Gateway token"
          onChange={(event) => setDraft((current) => ({ ...current, token: event.target.value }))}
        />
        <input
          type="text"
          value={draft.identityDir}
          placeholder="身份目录（可选，远程网关用，如 C:\\Users\\me\\.openclaw-vps-metrik）"
          aria-label="Gateway 身份目录"
          spellCheck={false}
          onChange={(event) => setDraft((current) => ({ ...current, identityDir: event.target.value }))}
        />
        <button type="button" className="ledger-button ledger-button--primary" disabled={busy || !valid} onClick={addGateway}>
          {busy ? "验证中…" : "添加并验证"}
        </button>
      </div>
      {feedback && (
        <p className={feedback.tone === "error" ? "tasks-feedback tasks-feedback--error" : "tasks-feedback tasks-feedback--success"}>
          {feedback.message}
        </p>
      )}
      <p className="gateway-hint">
        远程 Gateway：推荐 SSH 隧道（ssh -N -L 127.0.0.1:18790:127.0.0.1:18789 user@vps），
        地址填 ws://127.0.0.1:18790，回环自动批准；公网直连则需在网关侧
        openclaw devices approve。远程网关请填专用身份目录（内含 identity/device.json，
        由 metrik-gateway-setup.sh 生成）；本机网关留空。token 与任务元数据不出本机。
      </p>
    </div>
  );
}

function formatTaskAge(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return "刚刚";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

/// 紧凑 token 数：154174 → "154k"、525000 → "525k"、2.4M → "2.40M"。
function formatCompactTokens(n) {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function formatTaskDuration(startedMs, endedMs) {
  if (!Number.isFinite(startedMs) || startedMs <= 0) return null;
  const endMs = Number.isFinite(endedMs) && endedMs > 0 ? endedMs : Date.now();
  const seconds = Math.max(0, Math.floor((endMs - startedMs) / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分 ${seconds % 60} 秒`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}

/// 链路里的紧凑时长："4 分 0 秒"→"4分"；胶片条和时间线共用，别再复制 replace 链。
function formatCompactDuration(startedMs, endedMs) {
  return (formatTaskDuration(startedMs, endedMs) || "")
    .replace(/ /g, "")
    .replace(/0秒$/, "")
    .replace(/0分$/, "");
}

const TASK_STATUS_META = {
  queued: { label: "排队中", className: "task-pill--queued" },
  running: { label: "运行中", className: "task-pill--running" },
  succeeded: { label: "已完成", className: "task-pill--succeeded" },
  failed: { label: "失败", className: "task-pill--failed" },
  timed_out: { label: "超时", className: "task-pill--failed" },
  cancelled: { label: "已取消", className: "task-pill--neutral" },
  lost: { label: "失联", className: "task-pill--failed" },
  // 失败分诊（六案②）：failed 行里分诊出的良性未跑，灰显不染红
  skipped: { label: "跳过", className: "task-pill--neutral" },
};

function TaskStatusPill({ status }) {
  const meta = TASK_STATUS_META[status] || { label: status || "未知", className: "task-pill--neutral" };
  return <span className={`task-pill ${meta.className}`}>{meta.label}</span>;
}

/// 任务链路 stepper：链上每跳 = agent 名 + 状态符（✓ 完成 / ● 进行中 / ○ 待跑），
/// 完成跳带耗时。单跳不成链不渲染——没有链路信息的行保持干净。
/// 链从 runId 分组与 childSessionKey→sessionKey 父子边拼出（见 taskChains.js）。
/// 跑马灯链路胶卷：当前执行 agent 恒定居中，链条两侧延伸出屏，
/// 滚轮左右滑看前后跳（用户点名交互）。数据变化时重新居中，手动滚后尊重用户
/// 位置直到下一次数据变化。边缘渐隐提示还有内容。
function ChainFilmstrip({ hops, currentTaskId, agentNameMap, vertical = false, onExpand, onHopHover }) {  const stripRef = useRef(null);
  const currentRef = useRef(null);
  const currentKey = `${currentTaskId ?? ""}:${hops.length}`;
  useLayoutEffect(() => {
    const strip = stripRef.current;
    const current = currentRef.current;
    if (!strip || !current) return;
    if (vertical) {
      strip.scrollTop = current.offsetTop + current.offsetHeight / 2 - strip.clientHeight / 2;
    } else {
      strip.scrollLeft = current.offsetLeft + current.offsetWidth / 2 - strip.clientWidth / 2;
    }
  }, [currentKey, vertical]);
  // 按住拖拽滚动（鼠标左键 / 触屏）：按下记录起点，移动 4px 起算拖动，
  // 松开时若拖动过则吞掉紧随的 click——迷你条上点击=展开，拖完不该展开。
  const dragRef = useRef(null);
  const onStripPointerDown = (event) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    const target = event.currentTarget;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: target.scrollLeft,
      scrollTop: target.scrollTop,
      moved: false,
    };
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      /* 旧运行时无 capture 也能靠后续 pointermove 工作 */
    }
  };
  const onStripPointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    drag.moved = true;
    // 手势标记：壳层据此判"这条拖拽已被内容滚动认领"，不再启动 OS 挪窗。
    event.currentTarget.dataset.stripDragging = "1";
    const target = event.currentTarget;
    if (vertical) target.scrollTop = drag.scrollTop - dy;
    else target.scrollLeft = drag.scrollLeft - dx;
  };
  const onStripPointerEnd = (event) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    dragRef.current = null;
    delete event.currentTarget.dataset.stripDragging;
    if (!drag.moved) return;
    const target = event.currentTarget;
    const swallow = (e) => {
      e.stopPropagation();
      e.preventDefault();
    };
    target.addEventListener("click", swallow, { capture: true, once: true });
    window.setTimeout(() => target.removeEventListener("click", swallow, { capture: true }), 120);
  };
  return (
    <span
      role={onExpand ? "button" : undefined}
      tabIndex={onExpand ? 0 : undefined}
      aria-label={onExpand ? "任务链路，点击展开任务追踪" : undefined}
      className={`tasks-mini-strip${vertical ? " tasks-mini-strip--vertical" : ""}`}
      ref={stripRef}
      onClick={onExpand}
      onPointerDown={onStripPointerDown}
      onPointerMove={onStripPointerMove}
      onPointerUp={onStripPointerEnd}
      onPointerCancel={onStripPointerEnd}
      onKeyDown={
        onExpand
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onExpand();
              }
            }
          : undefined
      }
      title={
        onHopHover
          ? undefined
          : "点击展开任务追踪 · 滚轮或按住拖动查看链路"
      }
      onWheel={(event) => {
        const target = event.currentTarget;
        // 行模式滚轮（deltaMode 1，deltaY≈3）按行高归一，否则一格只挪 3px；
        // 像素模式一格 ~100px ≈ 2 跳，钳到 60px = 正好一个跳位
        const unit = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? target.clientHeight : 1;
        const delta = (event.deltaY + event.deltaX) * unit;
        const step = Math.sign(delta) * Math.min(Math.abs(delta), 60);
        if (vertical) target.scrollTop += step;
        else target.scrollLeft += step;
      }}
    >
      {hops.map((hop, index) => {
        const { tone, state } = hopToneOf(hop, currentTaskId);
        const name = agentDisplayName(agentNameMap, hop.agentId) || hop.agentId || "?";
        const duration = formatCompactDuration(hop.startedAtMs, hop.endedAtMs);
        return (
          <Fragment key={`${hop.gateway ?? ""}:${hop.taskId}`}>
            {index > 0 && <i className="task-chain-link" aria-hidden="true" />}
            <span
              ref={tone === "current" ? currentRef : undefined}
              className={`task-chain-hop task-chain-hop--${tone}`}
              // 悬停详情卡接管提示时撤掉原生 title，避免两层气泡叠出
              title={
                onHopHover
                  ? undefined
                  : `${name} · ${state}${duration ? ` · ${duration}` : ""}`
              }
              onPointerEnter={onHopHover ? (event) => onHopHover(hop, index, hops.length, event) : undefined}
            >
              <span className="task-chain-glyph" aria-hidden="true">{hopGlyphOf(tone)}</span>
              <span className="task-chain-agent">{name}</span>
              {duration && !vertical && <small>{duration}</small>}
            </span>
          </Fragment>
        );
      })}
    </span>
  );
}

/// 星卡伴随窗（?view=hopcard）：载荷驱动渲染悬停星卡本体。收到载荷 →
/// 渲染 → 双 rAF（保证画完一帧）→ 回 ready，Rust 才显形——窗在隐藏态下
/// 完成定位与首绘，显形即成品，无中间帧。载荷 take 即清空；挂载兜底取
/// 一次（首建竞态时 poll 信号可能早于监听建立）。窗固定 224×460、内容盒
/// 垂直居中（竖条）；横条按 side 钳到贴条缘（above=底对齐/below=顶对齐）。
function HopCardWindow() {
  const [cardProps, setCardProps] = useState(null);
  const lastPayloadRef = useRef("");
  const lastHeightRef = useRef(0);
  useEffect(() => {
    let alive = true;
    let unlisten = null;
    const apply = (raw) => {
      if (!alive || typeof raw !== "string" || !raw) return;
      if (raw !== lastPayloadRef.current) {
        lastPayloadRef.current = raw;
        try {
          const data = JSON.parse(raw);
          setCardProps(
            data
              ? { ...data, agentNameMap: new Map(Object.entries(data.agentNames ?? {})) }
              : null,
          );
        } catch {
          setCardProps(null);
        }
      }
      // 内容同帧也回执：宿主可能正等 ready 显形（同载荷重开悬停）。
      requestAnimationFrame(() => requestAnimationFrame(() => hopCardReady()));
    };
    onHopCardSignal(() => {
      takeHopCardPayload().then(apply);
    }).then((stop) => {
      if (!alive) stop?.();
      else unlisten = stop;
    });
    takeHopCardPayload().then(apply);
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);
  // 实测高回传：横条上下放卡按它定窗高（值不变不回传，省 IPC）。
  const handleHeight = (height) => {
    if (!Number.isFinite(height) || height <= 0 || lastHeightRef.current === height) return;
    lastHeightRef.current = height;
    reportHopCardHeight(height);
  };
  const stageAlign = !cardProps?.orientation || cardProps.orientation === "vertical"
    ? "center"
    : cardProps.side === "above"
      ? "flex-end"
      : "flex-start";
  return (
    <div className="hopcard-stage" style={{ alignItems: stageAlign }}>
      {cardProps && (
        <HopHoverCard
          hop={cardProps.hop}
          index={cardProps.index}
          total={cardProps.total}
          records={cardProps.records ?? null}
          live={Boolean(cardProps.live)}
          nextRun={cardProps.nextRun ?? null}
          agentNameMap={cardProps.agentNameMap}
          currentTaskId={cardProps.currentTaskId}
          translate={cardProps.translate}
          light={Boolean(cardProps.light)}
          onHeight={handleHeight}
        />
      )}
    </div>
  );
}

/// 任务小组件悬停详情卡：跳名 + 状态徽标 + 进度摘要原话 + 星名/链路位置/耗时，
/// 底部可带"其他任务"节（首行链路之外的任务，竖条角标同一份数据）。
/// 竖条/横条两个迷你形态共用（onHopHover opt-in）。真机由独立星卡伴随窗
/// （tasks-hopcard）承载同一组件；浏览器预览走窗内 Portal（fixed 定位）。
/// pointer-events:none 纯展示，不截断胶卷的指针进出。light = 跟随胶囊浅色
/// 外观（卡片 Portal 在 body 下，壳的 glass-light 类够不到，得显式传）。
function HopHoverCard({ hop, index, total, others, records, live, nextRun, agentNameMap, currentTaskId, light, translate = true, onHeight, style }) {
  const { tone, state } = hopToneOf(hop, currentTaskId);
  const name = agentDisplayName(agentNameMap, hop.agentId) || hop.agentId || "?";
  const duration = formatCompactDuration(hop.startedAtMs, hop.endedAtMs);
  const rootRef = useRef(null);
  // 卡高实测（扩窗与钳位用）：内容行数随进度原话/其他任务节变，168 只是基线。
  useLayoutEffect(() => {
    if (rootRef.current && onHeight) onHeight(rootRef.current.offsetHeight);
  });
  // ── 星卡模式（七星灯牌 2026-10-06）：records = 该星今夜全部跳，按星聚合。
  // 运行中=实时 kv（任务/已跑/最近动作/今夜第几跳），收班=跳列表（时刻/时长/
  // 结论），空闲=一句"今夜无活动"。records 为 null 时走旧单跳卡（防御兜底）。──
  if (records != null) {
    const runningLive = live && (hop.status === "running" || hop.status === "queued");
    // 收班跳列表按开始时间新→旧（Leo 2026-10-07 截图：按结束时间排会出现
    // 20:16→20:17→20:17→20:15 的乱序观感）。
    const endedRecords = records
      .filter((r) => r.status !== "running" && r.status !== "queued")
      .sort((a, b) => (b.startedAtMs ?? 0) - (a.startedAtMs ?? 0));
    const clockOf = (ms) =>
      Number.isFinite(ms) && ms
        ? new Date(ms).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" })
        : "—";
    // 行文本：cron 回执的 summary 里混着纯空白字符（"\n"，truthy）——直接 ||
    // 会被选中渲染成空白列（Leo 真机"内容列全空"），必须 trim 判空再回落。
    const recordText = (r) => {
      const found = [
        r.terminalSummary,
        r.status === "failed" && r.error ? sessionErrorText(r.error, translate) : "",
        r.progressSummary,
        r.title,
      ].find((text) => typeof text === "string" && text.trim());
      return (found ?? "—").trim().slice(0, 46);
    };
    return (
      <div
        ref={rootRef}
        className={`tasks-hopcard${light ? " tasks-hopcard--light" : ""}`}
        style={style}
        role="tooltip"
      >
        <header className="tasks-hopcard-head">
          <strong className="tasks-hopcard-title">
            {runningLive ? `${name} · 执行中` : tone === "rest" ? `${name} · 空闲` : `${name} · ${state}`}
          </strong>
          {runningLive ? <TaskStatusPill status="running" /> : tone === "rest" ? null : <TaskStatusPill status={hop.status} />}
        </header>
        {runningLive ? (
          <>
            <p className="tasks-hopcard-summary">{hop.title || "执行中 · 已接收任务"}</p>
            {hop.progressSummary || hop.lastToolName ? (
              <p className="tasks-hopcard-progress" title={hop.lastToolName ?? hop.progressSummary}>
                <em>正在：</em>
                {toolProgressLabel(hop.lastToolName, translate) || toolProgressLabel(hop.progressSummary, translate)}
              </p>
            ) : null}
            <div className="tasks-hopcard-kv"><b>已跑</b><span>{formatTaskDuration(hop.startedAtMs, Date.now()) || "刚刚"}</span></div>
            <div className="tasks-hopcard-kv"><b>今夜</b><span>{total > 0 ? `第 ${total - index} 跳` : "首轮"}</span></div>
          </>
        ) : endedRecords.length ? (
          <div className="tasks-hopcard-extra">
            {endedRecords.slice(0, 4).map((r) => (
              <div className="tasks-hopcard-kv" key={r.taskId}>
                <b>{clockOf(r.startedAtMs)}</b>
                <span>{formatCompactDuration(r.startedAtMs, r.endedAtMs) || "—"}</span>
                <span className="tasks-hopcard-kv-txt" title={recordText(r)}>
                  {recordText(r)}
                </span>
              </div>
            ))}
            {endedRecords.length > 4 ? (
              <div className="tasks-hopcard-kv"><span>… 今夜共 {records.length} 跳，展开任务追踪看全</span></div>
            ) : null}
          </div>
        ) : (
          nextRun && Number.isFinite(nextRun.atMs) ? (
            // 空闲但有定时任务：回答"这颗星是闲着还是死了"（网关权威下次触发）。
            // 没有定时任务的星整行不渲染——没话说的卡不硬凑。
            <>
              <p className="tasks-hopcard-skipped">今夜无活动</p>
              <div className="tasks-hopcard-kv">
                <b>下次</b>
                <span title={`定时「${nextRun.jobName}」`}>
                  {new Date(nextRun.atMs).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" })}
                  {" · "}
                  {formatCronNext(nextRun.atMs)}
                  {" · 定时「"}
                  {nextRun.jobName}
                  {"」"}
                </span>
              </div>
            </>
          ) : (
            <p className="tasks-hopcard-skipped">今夜无活动</p>
          )
        )}
      </div>
    );
  }
  const othersFailed = (others ?? []).filter((row) => row.tone === "failed").length;
  const othersSkipped = (others ?? []).filter((row) => row.tone === "skipped").length;
  const visibleOthers = (others ?? []).slice(0, 3);
  return (
    <div
      ref={rootRef}
      className={`tasks-hopcard${light ? " tasks-hopcard--light" : ""}`}
      style={style}
      role="tooltip"
    >
      <header className="tasks-hopcard-head">
        <strong className="tasks-hopcard-title">{hop.title || hop.taskId}</strong>
        <TaskStatusPill status={hop.status} />
      </header>
      {/* 成果速览（六案①）：收工跳带北斗的中文结论（最后一跳 assistant 原话） */}
      {hop.terminalSummary ? (
        <p className="tasks-hopcard-summary" title={hop.terminalSummary}>
          {hop.terminalSummary}
        </p>
      ) : null}
      {hop.status === "running" && (hop.progressSummary || hop.lastToolName) ? (
        <p className="tasks-hopcard-progress" title={hop.lastToolName ?? hop.progressSummary}>
          <em>正在：</em>
          {toolProgressLabel(hop.lastToolName, translate) || toolProgressLabel(hop.progressSummary, translate)}
          {Number.isFinite(hop.toolUseCount) && hop.toolUseCount > 0 ? ` · 已 ${hop.toolUseCount} 次工具` : ""}
        </p>
      ) : null}
      {tone === "failed" && hop.error ? (
        <p className="tasks-hopcard-error" title={hop.error}>
          {sessionErrorText(hop.error, translate)}
        </p>
      ) : null}
      {/* 良性未跑（六案②失败分诊）：灰显说明，不染红不占失败区 */}
      {tone === "skipped" ? (
        <p className="tasks-hopcard-skipped" title={hop.error || undefined}>
          {benignStateOf(hop.error, hop.status)}
          {hop.error && hop.status !== "cancelled" ? `（${hop.error}）` : ""}
        </p>
      ) : null}
      {visibleOthers.length > 0 && (
        <div className="tasks-hopcard-extra">
          <span className="tasks-hopcard-extra-head">
            {!othersFailed && !othersSkipped
              ? `其他进行中 · ${(others ?? []).length}`
              : `其他任务 · ${(others ?? []).length}${othersFailed ? `（${othersFailed} 失败）` : ""}${othersSkipped ? `（${othersSkipped} 跳过）` : ""}`}
          </span>
          {visibleOthers.map((row) => {
            // 两类行统一口径：登记任务取 task 字段，会话工作取 run 字段
            const isSession = row.kind === "session";
            const agentId = isSession ? row.run.agentId : row.task.agentId;
            const rowKey = isSession
              ? `session-run:${row.run.id ?? row.run.sessionKey}`
              : `${row.task.gateway ?? ""}:${row.task.taskId}`;
            const text = isSession
              ? row.run.title || row.run.fallbackTitle || "会话工作"
              : row.task.title || row.task.taskId;
            const rowName = agentDisplayName(agentNameMap, agentId) || agentId || "?";
            const failed = row.tone === "failed";
            const skipped = row.tone === "skipped";
            const pending = !failed && !skipped && (isSession ? false : row.task.status === "queued");
            return (
              <span key={rowKey} className="tasks-hopcard-extra-row">
                <i
                  className={`tasks-hopcard-extra-dot${failed ? " tasks-hopcard-extra-dot--failed" : pending ? " tasks-hopcard-extra-dot--pending" : skipped ? " tasks-hopcard-extra-dot--skipped" : ""}`}
                  aria-hidden="true"
                />
                <span className={`tasks-hopcard-extra-title${failed ? " tasks-hopcard-extra-title--failed" : ""}${skipped ? " tasks-hopcard-extra-title--skipped" : ""}`}>
                  {text}
                </span>
                <span className="tasks-hopcard-extra-agent">{rowName}</span>
              </span>
            );
          })}
          {(others ?? []).length > visibleOthers.length && (
            <span className="tasks-hopcard-extra-head">…还有 {(others ?? []).length - visibleOthers.length} 个</span>
          )}
        </div>
      )}
      <footer className="tasks-hopcard-meta">
        <span>{name} · {state}</span>
        {/* 单跳卡（横条会话行）没有"第几跳"语义，只留耗时 */}
        {(total > 1 || duration) && (
          <span>{total > 1 ? `第 ${index + 1}/${total} 跳` : ""}{total > 1 && duration ? " · " : ""}{duration}</span>
        )}
      </footer>
    </div>
  );
}

/// 竖直链路时间线（展开卡）：一跳一行 = 状态符 + 星名 + 该跳任务 + 耗时，
/// 当前跳行下挂任务进度原话。排队跳天然在列，任务列表里不再重复占行。
function TaskChainTimeline({ hops, currentTaskId, agentNameMap, translate = true }) {
  if (!hops || hops.length < 2) return null;
  return (
    <ol className="task-timeline">
      {hops.map((hop) => {
        const { tone, current, state } = hopToneOf(hop, currentTaskId);
        const name = agentDisplayName(agentNameMap, hop.agentId) || hop.agentId || "?";
        const duration = formatCompactDuration(hop.startedAtMs, hop.endedAtMs);
        return (
          <li
            key={`${hop.gateway ?? ""}:${hop.taskId}`}
            className={`task-timeline-hop task-timeline-hop--${tone}`}
            title={`${name} · ${state}${duration ? ` · ${duration}` : ""}`}
          >
            <span className="task-timeline-glyph" aria-hidden="true">
              {hopGlyphOf(tone)}
            </span>
            <span className="task-timeline-name">{name}</span>
            {/* 当前跳的标题/时长就是组头那份，不重复；其余跳是各自的任务名 */}
            {!current && <span className="task-timeline-title">{hop.title || hop.taskId}</span>}
            {!current && duration ? <small>{duration}</small> : null}
            {/* 成果速览（六案①）：收工跳附该轮中文结论，两行截断，悬浮看全文 */}
            {!current && hop.terminalSummary ? (
              <p className="task-timeline-summary" title={hop.terminalSummary}>
                {hop.terminalSummary}
              </p>
            ) : null}
            {current && hop.progressSummary ? (
              <p className="task-timeline-progress" title={hop.progressSummary}>
                <em>正在：</em>
                {toolProgressLabel(hop.progressSummary, translate)}
              </p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/// 自绘提醒角标窗（六案 B·自绘壳，Leo 拍板）：屏幕右下角玻璃小卡堆。
/// 触发层 = detectRoundNotifications 纯函数（本窗每拍跑台账 diff），壳只管
/// 倒计时/悬停暂停/点击跳转（A 案：点卡展开任务面板，Rust 仲裁兜底主窗）。
/// 窗口显隐自管（卡堆空自藏、来卡自弹），总开关在设置（notifyEnabled）。
function NotificationWindow({ transparent, glassMode, glassTint, glassInk, glassAlpha, onClose }) {
  const shellAppearance = glassShellAppearance("widget", {
    transparent,
    glassMode,
    glassTint,
    glassInk,
    isMac: IS_MAC,
    loading: false,
  });
  // 星名映射：真机走主窗的定期广播（各窗口 localStorage 不共享）；浏览器
  // 预览没有事件总线，用 localStorage 种子兜底。
  const [agentNames, setAgentNames] = useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem("metrik:agentNames") || "{}");
      return raw && typeof raw === "object" ? raw : {};
    } catch {
      return {};
    }
  });
  useEffect(() => {
    let unlistenPromise;
    onAgentNames((map) => setAgentNames(map));
    return () => {
      unlistenPromise?.then((unlisten) => unlisten());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const snapshotRef = useRef({ failedSeen: {}, rounds: {} });
  const rootRef = useRef(null);
  const [toasts, setToasts] = useState([]);

  // 同步拍：台账 diff → 纯函数出提醒 → 按开关过滤入栈（最多 3 张，新的顶上）。
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (!alive) return;
      if (!PREVIEW_EAGER && document.visibilityState === "hidden") return;
      const monitor = loadMonitorConfig();
      if (!monitor.notifyEnabled) return;
      const data = await loadSessionRuns().catch(() => null);
      if (!alive || !data) return;
      const { toasts: fresh, next } = detectRoundNotifications(
        data.runs ?? [],
        snapshotRef.current,
        {
          episodeGapMin: monitor.episodeGapMin,
          quietOn: monitor.notifyQuietOn,
          quietStart: monitor.notifyQuietStart,
          quietEnd: monitor.notifyQuietEnd,
          aggregateMin: monitor.notifyAggregateMin,
          agentNames,
        },
        Date.now(),
      );
      snapshotRef.current = next;
      const allowed = fresh.filter((toast) =>
        toast.kind === "ok" ? monitor.notifyOnComplete : monitor.notifyOnFailure,
      );
      if (!allowed.length) return;
      const stayMs = monitor.notifyStaySec * 1000;
      setToasts((current) => {
        const known = new Set(current.map((toast) => toast.id));
        const added = allowed
          .filter((toast) => !known.has(toast.id))
          .map((toast) => ({ ...toast, totalMs: stayMs, leftMs: stayMs, paused: false }));
        return [...current, ...added].slice(-3);
      });
    };
    tick();
    const timer = window.setInterval(tick, Math.max(1, loadMonitorConfig().refreshIntervalSec) * 1000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 倒计时节拍：未暂停的卡每 250ms 掉一格，走完即出栈。
  useEffect(() => {
    if (!toasts.length) return undefined;
    const timer = window.setInterval(() => {
      setToasts((current) => current
        .map((toast) => (toast.paused ? toast : { ...toast, leftMs: toast.leftMs - 250 }))
        .filter((toast) => toast.leftMs > 0));
    }, 250);
    return () => window.clearInterval(timer);
  }, [toasts.length]);

  // 窗口自管显隐 + 底边锚定改高（setSize 默认向下长，必须重钉底边）。
  useLayoutEffect(() => {
    if (!isTauriRuntime()) return;
    const height = rootRef.current?.offsetHeight ?? 1;
    runWindowAction(() => repinNotificationWindow(height));
    runWindowAction(() => setSelfWindowVisible(toasts.length > 0));
  }, [toasts]);

  const dismiss = (id) => setToasts((current) => current.filter((toast) => toast.id !== id));
  const setPaused = (id, paused) =>
    setToasts((current) => current.map((toast) => (toast.id === id ? { ...toast, paused } : toast)));

  return (
    <main
      ref={rootRef}
      className={`${shellAppearance.className} badge-window`}
      style={{ ...shellAppearance.style, width: "344px" }}
    >
      <h1 className="sr-only">司南 提醒</h1>
      {toasts.length === 0 ? (
        <p className="badge-empty">提醒角标待命…（真失败/完成的轮次会在这里弹出，总开关在 任务台 → 提醒与预警）</p>
      ) : (
        <div className="badge-stack">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`badge-toast badge-toast--${toast.kind}`}
              role="button"
              tabIndex={0}
              onClick={() => {
                expandRoundDetails();
                dismiss(toast.id);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  expandRoundDetails();
                  dismiss(toast.id);
                }
              }}
              onMouseEnter={() => setPaused(toast.id, true)}
              onMouseLeave={() => setPaused(toast.id, false)}
            >
              <span className="badge-glyph" aria-hidden="true">
                {toast.kind === "ok" ? "✓" : toast.kind === "merge" ? "!" : "✕"}
              </span>
              <span className="badge-main">
                <span className="badge-title">{toast.title}</span>
                <span className="badge-body">{toast.body}</span>
                {toast.meta ? <span className="badge-meta">{toast.meta}</span> : null}
              </span>
              <button
                type="button"
                className="badge-x"
                aria-label="清除这条提醒"
                onClick={(event) => {
                  event.stopPropagation();
                  dismiss(toast.id);
                }}
              >
                ✕
              </button>
              <i
                className="badge-countdown"
                style={{ width: `${Math.max(0, Math.min(100, (toast.leftMs / toast.totalMs) * 100))}%` }}
                aria-hidden="true"
              />
            </div>
          ))}
        </div>
      )}
      <footer className="badge-footer">
        <button type="button" className="badge-close" onClick={onClose} aria-label="关闭提醒角标">
          关闭提醒
        </button>
      </footer>
    </main>
  );
}

/// 历史轮次的时间标签：今天/昨天带时刻，更早带日期。
function formatHistoryTime(ms, now = Date.now()) {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const date = new Date(ms);
  const time = date.toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" });
  if (new Date(now).toDateString() === date.toDateString()) return `今天 ${time}`;
  if (new Date(now - 86_400_000).toDateString() === date.toDateString()) return `昨天 ${time}`;
  return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
}

/// 历史轮次窗口的人话单位（分钟 → 分钟/小时/天）。
function formatHistoryWindow(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return "已关闭";
  if (minutes < 60) return `${minutes} 分钟`;
  if (minutes < 1440) return `${Math.round((minutes / 60) * 10) / 10} 小时`;
  return `${Math.round((minutes / 1440) * 10) / 10} 天`;
}

/// 定时任务看板的下次运行倒计时（六案③）。
function formatCronNext(nextMs, now = Date.now()) {
  if (!Number.isFinite(nextMs)) return null;
  const diff = nextMs - now;
  if (diff <= 0) return "即将运行";
  const min = Math.round(diff / 60_000);
  if (min < 1) return "1 分钟内";
  if (min < 60) return `${min} 分钟后`;
  const hours = Math.round((min / 60) * 10) / 10;
  if (hours < 24) return `${hours} 小时后`;
  return `${Math.round((hours / 24) * 10) / 10} 天后`;
}

// ============ 任务台 v5：斗形星盘 + 值班区 + 动态流（2026-10-05 设计评审定稿） ============
// 设计契约：北斗=连续折线（枢→璇→玑→权→衡→阳→光，魁口不封，摇光坠向右下
// 指向"下一次·定时"读数块）；实心金只允许读数块时间一处；状态四色+卡左缘
// 色条；看门狗简报金边置顶；统计口径=每个数字必须指到屏上可见对象。

// 斗形坐标（552×146 视口，窗口缩放由 SVG viewBox 等比承担）。
const DIAL_CHAIN = [
  ["tianshu", 58, 30], ["tianxuan", 54, 92], ["tianji", 140, 104],
  ["tianquan", 166, 62], ["yuheng", 232, 50], ["kaiyang", 286, 42], ["yaoguang", 352, 90],
];
const DIAL_HUB = { x: 104, y: 70 };
const DIAL_TONE = { live: "#3DD68C", fail: "#F26D6D", done: "#4E9DB8", cancel: "#4A5568", idle: "#4A5568" };
const TONE_LABEL = { live: "运行中", fail: "有失败", done: "已完成", cancel: "已取消", idle: "空闲" };
const STAR_NAME_FALLBACK = {
  tianshu: "天枢", tianxuan: "天璇", tianji: "天玑", tianquan: "天权",
  yuheng: "玉衡", kaiyang: "开阳", yaoguang: "摇光", main: "客星",
};
function starNameOf(agentId) {
  const key = String(agentId || "main");
  return STAR_NAME_FALLBACK[key] ?? key;
}
// 用户语言的类型词：巡检简报 / 巡检 / Memory / 定时 / 任务 / 接力。
function cjkRatioOf(text) {
  const t = String(text ?? "").replace(/\s/g, "");
  if (!t) return 0;
  let han = 0;
  for (const ch of t) if (/\p{Script=Han}/u.test(ch)) han += 1;
  return han / [...t].length;
}
function taskKindOf(row) {
  const title = row.label || row.title || "";
  if (/巡检/.test(title) && cjkRatioOf(row.terminalSummary) > 0.3) return "巡检简报";
  if (/skill-collection-review/i.test(title)) return "巡检";
  if (/Memory/i.test(title)) return "Memory";
  return row.kind === "automation_run" ? "定时" : "任务";
}
function isBriefingRow(row) {
  return taskKindOf(row) === "巡检简报";
}
// 定时任务显示名：网关 job 名是英文标识符，显示层换人话；未知名字原样透传
//（Leo：定时任务不能只能英文显示）。词表=openclaw 生态高频任务词（官方内置
// 只有 heartbeat，其余是社区常见 automation：digest/briefing/cleanup 等）。
function jobDisplayName(name) {
  const t = String(name ?? "").trim();
  let m = /^skill-collection-review-(\w+)$/.exec(t);
  if (m) return `skill 检查 · ${starNameOf(m[1])}`;
  m = /^heartbeat-(\w+)$/.exec(t);
  if (m) return `心跳保活 · ${starNameOf(m[1])}`;
  if (/^heartbeat$/i.test(t)) return "心跳保活";
  if (/^memory dreaming promotion$/i.test(t)) return "记忆整理晋升";
  if (!/[\u4e00-\u9fff]/.test(t)) {
    if (/consolidat|flush|dream/i.test(t)) return "记忆整理";
    if (/digest/i.test(t)) return "每日摘要";
    if (/briefing/i.test(t)) return "简报汇总";
    if (/(daily|morning).?(report|update)/i.test(t)) return "每日报告";
    if (/cleanup|prune|sweep/i.test(t)) return "清理维护";
    if (/backup/i.test(t)) return "备份";
    if (/inbox/i.test(t)) return "收件箱巡检";
    if (/compact/i.test(t)) return "上下文压缩";
  }
  return t;
}
function taskTitleOf(row) {
  const id = row.taskId ?? "";
  const degenerate = !cleanTaskTitle(row) && !row.label && !row.title
    && (/^cronrun:/.test(id) || /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(id));
  if (degenerate) {
    return row.kind === "automation_run" ? "定时运行" : `${row.runtime ?? "任务"} 运行`;
  }
  return jobDisplayName(cleanTaskTitle(row) || row.label || row.title || row.taskId || "未命名任务");
}
function isSlugTitle(row) {
  return /skill-collection-review/i.test(row.label || row.title || "");
}
function feedToneOf(row) {
  if (row.status === "running") return "live";
  if (row.status === "failed" || row.status === "timed_out") return "fail";
  if (row.status === "cancelled" || row.status === "skipped") return "cancel";
  return "done";
}
const atMsOf = (row) => row.startedAtMs ?? row.createdAtMs ?? row.lastSeenMs ?? 0;
const hhMmOf = (ms) => new Date(ms).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" });

// 动态流视图模型：exec 聚合 / NO_REPLY 跳过 / 简报置顶去重 / 同日巡检批次聚合。
function buildTasksFeedModel({ rows, episodes, now }) {
  const atOf = (row) => atMsOf(row);
  const items = [];
  const execAgg = new Map();
  let skippedNoReply = 0;
  for (const row of rows) {
    const kind = row.kind ?? "";
    // exec 聚合口径：kind 明确是 exec/cli 的命令行；runtime=cli 但 kind 缺失的
    // 是被重启中止的 agent run（取消卡），不进聚合。
    if (kind === "exec" || (kind === "cli" && row.runtime === "cli")) {
      const agent = row.agentId || "main";
      const agg = execAgg.get(agent) ?? { total: 0, ok: 0, bad: 0, cancel: 0 };
      agg.total += 1;
      if (row.status === "succeeded") agg.ok += 1;
      else if (row.status === "cancelled") agg.cancel += 1;
      else if (row.status && row.status !== "running") agg.bad += 1;
      execAgg.set(agent, agg);
      continue;
    }
    const summary = String(row.terminalSummary ?? "").trim();
    if (summary === "NO_REPLY" || (!summary && row.status === "succeeded" && !row.label && !row.title)) {
      skippedNoReply += 1;
      continue;
    }
    items.push(row);
  }
  const makeTaskVm = (row) => {
    const tone = feedToneOf(row);
    const summary = String(row.terminalSummary ?? "").trim();
    return {
      key: `row:${row.gateway}:${row.taskId}`,
      type: "task", agentId: row.agentId || "main",
      agent: starNameOf(row.agentId), kind: taskKindOf(row),
      at: atOf(row), tone,
      color: DIAL_TONE[tone],
      title: taskTitleOf(row), slug: isSlugTitle(row),
      summary, cjk: cjkRatioOf(summary) > 0.3,
      status: row.status, error: row.error,
      startedAtMs: row.startedAtMs, endedAtMs: row.endedAtMs,
      toolUseCount: row.toolUseCount,
      progress: String(row.progressSummary ?? "").trim(),
      decayed: tone === "done" && now - atOf(row) > 86_400_000,
    };
  };
  // 双写去重：tasks.list 时代的旧账行与 cron.runs 新行同源（同 jobId+同时刻），
  // 相邻 120 秒内视为同一次运行只留一条；旧行缺结论而新行有时把结论搬过去。
  const deduped = [];
  const twinsBySource = new Map();
  for (const row of items) {
    if (row.kind !== "automation_run" || !row.sourceId) { deduped.push(row); continue; }
    let peers = twinsBySource.get(row.sourceId);
    if (!peers) { peers = []; twinsBySource.set(row.sourceId, peers); }
    const at = atOf(row);
    const twin = peers.find((other) => Math.abs(atOf(other) - at) <= 120_000);
    if (twin) {
      if (!String(twin.terminalSummary ?? "").trim() && String(row.terminalSummary ?? "").trim()) {
        twin.terminalSummary = row.terminalSummary;
      }
      continue;
    }
    peers.push(row);
    deduped.push(row);
  }
  const briefings = deduped
    .filter((row) => isBriefingRow(row) && now - atOf(row) <= 48 * 3_600_000)
    .sort((a, b) => atOf(b) - atOf(a));
  const briefing = briefings.length ? makeTaskVm(briefings[0]) : null;
  const rest = briefing ? deduped.filter((row) => row !== briefings[0]) : deduped;
  // 同 job 折叠：同一 sourceId 同一天 ≥2 次运行收成一张卡（心跳 30 分钟一次，
  // 不折就是刷屏，Leo 2026-10-05 点名）。巡检简报不折（最值钱的中文产出）。
  const foldedLevels = [];
  const foldBySourceDay = new Map();
  for (const row of rest) {
    if (row.kind !== "automation_run" || isBriefingRow(row)) { foldedLevels.push(row); continue; }
    const day = new Date(atOf(row)).toDateString();
    const key = `${row.sourceId}:${day}`;
    const fold = foldBySourceDay.get(key);
    if (fold) { fold.rows.push(row); continue; }
    const fresh = { foldKey: key, rows: [row] };
    foldBySourceDay.set(key, fresh);
    foldedLevels.push(fresh);
  }
  const restFolded = foldedLevels.map((entry) => (
    Array.isArray(entry?.rows) && entry.rows.length < 2 ? entry.rows[0] : entry
  ));
  // 同日多星巡检批次（≥2 星才聚，单卡还原）；同 job 折叠卡直接过不参与
  const batched = [];
  const batchByDay = new Map();
  for (const entry of restFolded) {
    if (!Array.isArray(entry?.rows) && taskKindOf(entry) === "巡检") {
      const day = new Date(atOf(entry)).toDateString();
      const batch = batchByDay.get(day);
      if (batch) { batch.rows.push(entry); continue; }
      const fresh = { batchDay: day, rows: [entry] };
      batchByDay.set(day, fresh);
      batched.push(fresh);
      continue;
    }
    batched.push(entry);
  }
  const flattened = batched.map((entry) => (
    Array.isArray(entry?.rows) && entry.rows.length < 2 ? entry.rows[0] : entry
  ));
  const cards = [];
  for (const entry of flattened) {
    if (Array.isArray(entry?.rows) && entry.foldKey) {
      // 同 job 折叠卡：N 次运行一张卡，展开逐条；连续失败 ≥3 显著标注
      const group = [...entry.rows].sort((a, b) => atOf(a) - atOf(b));
      const okN = group.filter((r) => r.status === "succeeded").length;
      const skipN = group.filter((r) => r.status === "skipped").length;
      const badN = group.length - okN - skipN;
      let streak = 0;
      for (let i = group.length - 1; i >= 0; i -= 1) {
        if (group[i].status === "failed" || group[i].status === "timed_out") streak += 1;
        else break;
      }
      const last = group[group.length - 1];
      const tone = feedToneOf(last) === "fail" ? "fail" : "done";
      cards.push({
        key: `fold:${entry.foldKey}`,
        type: "fold", agentId: last.agentId || "main",
        agent: starNameOf(last.agentId), kind: taskKindOf(last),
        at: atOf(last), tone, color: DIAL_TONE[tone],
        title: `${taskTitleOf(last)} · ${group.length} 次`,
        detail: `✓ ${okN} · ✕ ${badN}${skipN ? ` · 跳过 ${skipN}` : ""}（${hhMmOf(atOf(group[0]))}–${hhMmOf(atOf(last))}）${streak >= 3 ? ` · 连续失败 ${streak} 次` : ""}`,
        rows: group, decayed: false,
      });
      continue;
    }
    if (Array.isArray(entry?.rows)) {
      const group = entry.rows;
      const okN = group.filter((r) => r.status === "succeeded").length;
      const badN = group.length - okN;
      cards.push({
        key: `batch:${entry.batchDay}:${group[0].taskId}`,
        type: "batch", agentId: null, agent: "多星", kind: "巡检",
        at: Math.max(...group.map(atOf)), tone: badN ? "fail" : "done",
        color: DIAL_TONE[badN ? "fail" : "done"],
        title: `巡检批次 · ${group.length} 星 · ${badN ? `${okN} 成 ${badN} 异常` : "全部正常"}`,
        detail: group.map((r) => `${starNameOf(r.agentId)} ${hhMmOf(atOf(r))} ${r.status === "succeeded" ? "✓" : "✕"}`).join(" · "),
      });
      continue;
    }
    cards.push(makeTaskVm(entry));
  }
  // 收工接力轮 → 一条接力卡（实时跳转归小组件，主窗管案的结论与状态）。
  // 案的锚 = 星位 run（v7.1 Leo 拍板"怎么可能这么多"的修正）：星位自己的
  // 会话才是派活干活；主 Agent 的纯对话轮（群聊/私聊，账本里一晚几十条）
  // 不成案，降级为 mainChat 卡走事件流水——主窗案卡不再被聊天记录淹没。
  for (const ep of episodes) {
    const latest = ep.runs[ep.runs.length - 1];
    if (!latest) continue;
    const epAgent = latest.agentId || "main";
    const { tone } = hopToneOf({ status: latest.status, taskId: latest.taskId ?? latest.id, error: latest.error });
    const summary = String(latest.terminalSummary ?? latest.progressSummary ?? "").trim();
    const key = `ep:${ep.startedAtMs}:${latest.id ?? latest.sessionKey ?? "ep"}`;
    const at = ep.lastActivityMs ?? ep.startedAtMs ?? 0;
    if (epAgent === "main") {
      cards.push({
        key, type: "mainchat", episode: ep, agentId: "main", agent: "客星",
        kind: "对话", at,
        tone: tone === "failed" ? "fail" : "done",
        color: DIAL_TONE[tone === "failed" ? "fail" : "done"],
        title: cleanSessionTitle(latest.title) || cleanSessionTitle(latest.fallbackTitle)
          || (summary ? summary.slice(0, 24) : "客星 会话"),
        slug: false, summary: "", cjk: false,
        status: latest.status, error: latest.error, decayed: false,
        mainChat: true,
      });
      continue;
    }
    cards.push({
      key, type: "episode", episode: ep, agentId: epAgent,
      agent: starNameOf(epAgent), kind: "接力",
      at,
      tone: tone === "failed" ? "fail" : "done",
      color: tone === "failed" ? DIAL_TONE.fail : DIAL_TONE.done,
      title: cleanSessionTitle(latest.title) || cleanSessionTitle(latest.fallbackTitle)
        || (summary ? summary.slice(0, 24) : `${starNameOf(epAgent)} 的派活`),
      slug: false,
      summary, cjk: cjkRatioOf(summary) > 0.3,
      status: latest.status, error: latest.error, decayed: false,
      progress: String(latest.progressSummary ?? "").trim(),
    });
  }
  cards.sort((a, b) => b.at - a.at);
  return { briefing, cards, execAgg, skippedNoReply };
}

// 星盘态：每颗星最近一条非取消卡；取消/跳过不进盘（保留"收班"语义）。
// 星盘副行的短标签：舰队例行任务换中文短词，其余 CJK 切 8 字（拉丁词硬切难读）。
function shortStarLabel(text) {
  const t = String(text ?? "").trim();
  if (!t) return "";
  if (/^skill-collection-review/i.test(t)) return "skill 检查";
  if (/^heartbeat/i.test(t)) return "心跳";
  if (/^Memory/i.test(t)) return "Memory";
  return t.length > 8 ? `${t.slice(0, 8)}…` : t;
}

function buildStarState(cards, now) {
  const latest = new Map();
  for (const card of cards) {
    if (card.type === "batch" || card.tone === "cancel") continue;
    const id = card.agentId || "main";
    if (!latest.has(id)) latest.set(id, card);
  }
  return DIAL_CHAIN.map(([id]) => {
    const card = latest.get(id);
    if (!card) return { id, tone: "idle", stale: true, label: "" };
    // 副行=这颗星当前/最近在干嘛：运行中优先进度行，否则最近卡标题切片
    const raw = card.tone === "live"
      ? (card.progress ? String(card.progress).split("\n")[0] : "执行中")
      : String(card.title ?? "");
    return { id, tone: card.tone, stale: card.tone === "done" && now - card.at > 86_400_000, label: shortStarLabel(raw) };
  });
}

// 案卡链路行（v7.2 折叠芯片，Leo 2026-10-06 拍板）：连续同星同果的跳折叠成
// 一枚芯片（✓×N），星序一眼可读；悬停芯片弹该星跳列表（时刻/时长/结论），
// 运行中芯片弹实时卡（任务/已跑/最近动作）。主 Agent 对话不进案卡。
function foldCaseChain(episode) {
  const hops = (episode?.hops ?? []).filter((hop) => hop.agentId && hop.agentId !== "main");
  const segments = [];
  hops.forEach((hop, i) => {
    const { tone } = hopToneOf({ status: hop.status, taskId: hop.taskId ?? hop.id, error: hop.error });
    const toneKey = hop.status === "running" ? "running" : tone;
    const last = segments[segments.length - 1];
    if (last && last.agentId === hop.agentId && last.toneKey === toneKey && toneKey !== "running") {
      last.count += 1;
      last.hops.push({ ...hop, seq: i + 1 });
    } else {
      segments.push({
        agentId: hop.agentId,
        toneKey,
        count: 1,
        running: hop.status === "running",
        hops: [{ ...hop, seq: i + 1 }],
      });
    }
  });
  return segments;
}

function dayLabelOf(ms, now) {  const d = new Date(ms);
  if (d.toDateString() === new Date(now).toDateString()) return "今天";
  if (d.toDateString() === new Date(now - 86_400_000).toDateString()) return "昨天";
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// 任务台主内容（v5）：星盘仪 → 统计行 → 值班区（在办案件/最新简报）→ 动态流。
/// 星位上下文卡（B 链路会话级用量）：小组件面板与主窗任务台共用。
/// variant = panel（小组件内的 tasks-card 皮）| board（主窗 v7card 皮）。
/// 行渲染从小组件原样搬入（水位/预算/条数/群主角标/预警一个口径）。
function TasksUsageCard({ usageSessions, idleSessions, agentNameMap, variant = "panel" }) {
  const [showIdleSessions, setShowIdleSessions] = useState(false);
  const usageModelSet = new Set(
    usageSessions.map((session) => session.model).filter(Boolean),
  );
  const usageModelUniform = usageModelSet.size === 1 ? [...usageModelSet][0] : null;
  const watermarkWarnPct = loadMonitorConfig().watermarkWarnPct;
  const renderUsageRow = (session, dimmed) => {
    const name = agentDisplayName(agentNameMap, session.agentId) || session.agentId || session.key;
    const running = Boolean(session.hasActiveRun);
    const model = session.model || null;
    const estimate = Number.isFinite(session.estimatedPromptTokens) ? session.estimatedPromptTokens : null;
    const budget = Number.isFinite(session.contextTokenBudget) ? session.contextTokenBudget : null;
    const fillPct = estimate != null && budget > 0 ? Math.min(100, Math.round((estimate / budget) * 100)) : null;
    const hot = session.shouldCompact || (fillPct != null && watermarkWarnPct > 0 && fillPct >= watermarkWarnPct);
    const tone = hot ? "warn" : "";
    const starting = running && estimate == null;
    const nums = starting
      ? "启动中"
      : estimate != null && budget != null
        ? `${formatCompactTokens(estimate)} / ${formatCompactTokens(budget)}`
        : budget != null
          ? `预算 ${formatCompactTokens(budget)}`
          : "—";
    const msgs = Number.isFinite(session.promptMessageCount) ? session.promptMessageCount : null;
    const lastSeen = Number.isFinite(session.updatedAt) ? session.updatedAt : 0;
    const badge = session.isGroup ? "群" : (session.key ?? "").endsWith(":main") ? "主" : null;
    return (
      <div
        key={session.key}
        className={`tasks-usage-row${dimmed ? " tasks-usage-row--idle" : ""}`}
        title={`${session.key}${model ? `
模型 ${model}` : ""}
${estimate != null ? `上下文 ${estimate.toLocaleString()} tok` : starting ? "运行中，上下文尚未产出" : "空闲会话，无上下文估算"}${budget != null ? ` · 预算 ${budget.toLocaleString()} tok` : ""}${msgs != null ? ` · ${msgs} 条消息` : ""}${lastSeen ? `
最近活动 ${formatTaskAge(lastSeen)}` : ""}`}
      >
        <i className={`agent-status-dot tasks-usage-dot ${running ? "" : "tasks-usage-dot--idle"}`} aria-hidden="true" />
        <span className="tasks-usage-name">
          {name}
          {badge ? <em>{badge}</em> : null}
          {!usageModelUniform && model ? (
            <small className="tasks-usage-model">{model}</small>
          ) : null}
        </span>
        <span className={`task-context-bar ${fillPct == null ? "task-context-bar--empty" : ""}`}>
          <i className={tone ? `task-context-fill--${tone}` : undefined} style={fillPct != null ? { width: `${fillPct}%` } : undefined} />
        </span>
        <span className="tasks-usage-nums">
          {nums}
          {hot ? <small className="tasks-usage-hot">建议清理</small> : null}
          {msgs != null ? <small>{msgs}条</small> : null}
        </span>
      </div>
    );
  };
  if (!usageSessions.length) return null;
  if (variant === "board") {
    return (
      <div className="v7card tasks-usage-card--board">
        <p className="v7-mhead">
          <span>星位上下文{usageModelUniform ? ` · ${usageModelUniform}` : ""}</span>
          {idleSessions.length > 0 ? (
            <button
              type="button"
              className="tasks-usage-idle"
              aria-expanded={showIdleSessions}
              title="点开看全部空闲会话（从未对话或未产生用量）；再点收起"
              onClick={() => setShowIdleSessions((open) => !open)}
            >
              {" · 另有 "}{idleSessions.length}{" 个空闲会话"}
            </button>
          ) : null}
        </p>
        <div className="tasks-usage-list">
          {usageSessions.map((session) => renderUsageRow(session, false))}
          {showIdleSessions &&
            idleSessions.map((session) => renderUsageRow(session, true))}
        </div>
      </div>
    );
  }
  return (
    <div className="tasks-card tasks-usage-card">
      <p className="tasks-card-head">
        星位上下文
        {usageModelUniform ? ` · ${usageModelUniform}` : ""}
        {idleSessions.length > 0 ? (
          <button
            type="button"
            className="tasks-usage-idle"
            aria-expanded={showIdleSessions}
            title="点开看全部空闲会话（从未对话或未产生用量）；再点收起"
            onClick={() => setShowIdleSessions((open) => !open)}
          >
            {" · 另有 "}{idleSessions.length}{" 个空闲会话"}
          </button>
        ) : null}
      </p>
      <div className="tasks-usage-list">
        {usageSessions.map((session) => renderUsageRow(session, false))}
        {showIdleSessions &&
          idleSessions.map((session) => renderUsageRow(session, true))}
      </div>
    </div>
  );
}

/// 案卡折叠芯片的悬停明细（v7.2）：运行中=实时卡（任务/已跑/最近动作/本轮），
/// 收班=该星那几跳的列表（时刻/时长/结论首行）。绝对定位挂在案卡左上，
/// 不挤压芯片行。
function CaseChipPop({ seg, now }) {
  if (seg.running) {
    const hop = seg.hops[seg.hops.length - 1];
    return (
      <div className="v5-chain-pop" role="tooltip">
        <div className="v5-chain-pop-h"><i />{starNameOf(seg.agentId)} · 执行中</div>
        <div className="v5-chain-pop-kv"><b>任务</b><span>{hop.title || "执行中 · 已接收任务"}</span></div>
        <div className="v5-chain-pop-kv"><b>已跑</b><span>{formatTaskDuration(hop.startedAtMs, now) || "刚刚"}</span></div>
        <div className="v5-chain-pop-kv"><b>最近动作</b><span>{toolProgressLabel(hop.progressSummary) || hop.progressSummary || "—"}</span></div>
        <div className="v5-chain-pop-kv"><b>本轮</b><span>第 {hop.seq} 跳</span></div>
      </div>
    );
  }
  return (
    <div className="v5-chain-pop" role="tooltip">
      <div className="v5-chain-pop-h">{starNameOf(seg.agentId)} · {seg.count > 1 ? `${seg.count} 跳明细` : "跳明细"}</div>
      {seg.hops.map((hop) => (
        <div className="v5-chain-pop-kv" key={hop.taskId ?? hop.seq}>
          <b>{formatHistoryTime(hop.startedAtMs, now)}</b>
          <span>{formatCompactDuration(hop.startedAtMs, hop.endedAtMs) || "—"}</span>
          <span className="txt">
            {(hop.terminalSummary
              || (seg.toneKey === "failed" && hop.error ? sessionErrorText(hop.error) : "")
              || hop.progressSummary
              || "—").slice(0, 44)}
          </span>
        </div>
      ))}
    </div>
  );
}

function TasksBoard({ rows, episodes, activeEpisodes, cronJobs, lastRunByJob, now, agentNameMap, usageSessions, idleSessions, live }) {
  const [selectedStar, setSelectedStar] = useState(null);
  // 案卡折叠芯片的悬停态：null=无悬停，数字=悬停中的芯片序号
  const [hoverChip, setHoverChip] = useState(null);
  const [feedFilter, setFeedFilter] = useState("all"); // all | failed | cron
  // 动态流视图（Leo 2026-10-06 拍板 B）：速览=按星分组（默认），明细=跨星时间线。
  // 「速览/明细」按钮从小组件标题栏换岗到这里（那边只剩抽屉一个用途=删除）。
  const [feedView, setFeedView] = useState(() =>
    localStorage.getItem("metrik:feedView") === "timeline" ? "timeline" : "stars",
  );
  const toggleFeedView = (next) => {
    setFeedView(next);
    localStorage.setItem("metrik:feedView", next);
  };
  const [expandedSet, setExpandedSet] = useState(() => new Set());
  const toggleExpanded = (key) => setExpandedSet((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  const feed = useMemo(
    () => buildTasksFeedModel({ rows, episodes, now }),
    [rows, episodes, now],
  );
  const starState = useMemo(() => buildStarState(feed.cards, now), [feed, now]);

  const isCronKind = (card) => card.kind === "定时" || card.kind === "巡检简报" || card.kind === "巡检" || card.kind === "Memory";
  const filteredCards = feed.cards.filter((card) => {
    if (feedFilter === "failed" && card.tone !== "fail") return false;
    if (feedFilter === "cron" && !isCronKind(card)) return false;
    if (selectedStar && card.agentId !== selectedStar) return false;
    return true;
  });
  // v7 分栏：中文结论卡/接力/巡检批次走左栏"案与结论"，其余（心跳折叠、
  // 取消、英文检查卡、主 Agent 对话卡）进右栏"事件流水"紧凑日志——日志行永不留空腔。
  const isConclusionCard = (card) =>
    !card.mainChat && ((card.summary && card.cjk) || card.type === "episode" || card.type === "batch");
  const conclusionCards = filteredCards.filter(isConclusionCard);
  // 统计口径（v7.1）：案 = 星位案 + 定时/任务结论卡；主 Agent 聊天不算案。
  const todayKey = new Date(now).toDateString();
  const isToday = (card) => new Date(card.at).toDateString() === todayKey;
  const visibleToday = conclusionCards.filter(isToday).length;
  const failedToday = conclusionCards.filter((card) => card.tone === "fail" && isToday(card)).length;
  // 值班案卡只装星位案：主 Agent 的纯对话轮不成案
  const starEpisodes = activeEpisodes.filter((ep) => ep.hops?.some((hop) => hop.agentId && hop.agentId !== "main"));
  const runningCount = starEpisodes.length + rows.filter((row) => row.status === "running").length;

  const statBits = [`今日 <b>${visibleToday} 案</b>`];
  if (failedToday) statBits.push(`失败 ${failedToday}`);
  if (runningCount) statBits.push(`进行中 ${runningCount}`);

  // 定时队列（v7）：网关权威 nextRunAtMs 优先（Rust 镜像列），表达式推算只作回落；
  // 之前只认两族表达式，10 个任务里 8 个 every 型全隐形。
  const enabledJobs = cronJobs.filter((job) => job.enabled);
  const runQueue = enabledJobs
    .map((job) => ({ job, at: cronNextAtOf(job, now) }))
    .filter((entry) => Number.isFinite(entry.at))
    .sort((a, b) => a.at - b.at);
  const queueRows = runQueue.slice(0, 4);
  const nextEntry = queueRows[0] ?? null;
  // 归星优先级：cron.list job 自带 agentId（网关权威）> 上次运行账本归属
  // （runs 无 agentId 字段，由 sessionKey 解析兜底）。都缺时 starNameOf 回落 main。
  const nextStar = nextEntry
    ? starNameOf(nextEntry.job.agentId ?? lastRunByJob.get(nextEntry.job.id)?.agentId)
    : "";

  const execTotal = [...feed.execAgg.values()].reduce((sum, agg) => sum + agg.total, 0);
  const execDetail = [...feed.execAgg.entries()].map(([agent, agg]) => `${starNameOf(agent)} ${agg.total}`).join(" · ");

  // 近 7 天节奏：账本非 exec 行按天计数（与 realdays 同口径），今日柱高亮
  const sparkSeries = (() => {
    const counts = new Map();
    for (const card of feed.cards) {
      const key = new Date(card.at).toDateString();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from({ length: 7 }, (_, i) => {
      const day = new Date(now - (6 - i) * 86_400_000);
      return { label: `${day.getMonth() + 1}/${day.getDate()}`, count: counts.get(day.toDateString()) ?? 0 };
    });
  })();
  const sparkPeak = Math.max(...sparkSeries.map((x) => x.count), 1);

  const LOG_GLYPH = { live: ["●", DIAL_TONE.live], fail: ["✕", DIAL_TONE.fail], done: ["✓", DIAL_TONE.done], cancel: ["○", DIAL_TONE.idle] };
  const logRows = filteredCards.filter((card) => !isConclusionCard(card)).map((card) => {
    const [glyph, glyphColor] = LOG_GLYPH[card.tone] ?? ["○", DIAL_TONE.idle];
    // 折叠卡标题自带「· N 次」，时长列不再重复计数（Leo：事件流水排版错位）
    const dur = card.type === "fold"
      ? ""
      : Number.isFinite(card.endedAtMs) && Number.isFinite(card.startedAtMs) && card.endedAtMs > card.startedAtMs
        ? formatCompactDuration(card.startedAtMs, card.endedAtMs)
        : "";
    return { key: card.key, at: card.at, star: card.agent, event: card.title, glyph, glyphColor, dur, day: dayLabelOf(card.at, now) };
  });
  const isEmpty = !feed.cards.length && !feed.execAgg.size && !activeEpisodes.length;
  // 值班案卡只装星位案（v7.1）：主 Agent 的纯对话轮不成案
  const dutyCase = starEpisodes[0] ?? null;
  // 接力链折叠芯片（v7.2）：连续同星同果的跳并成一枚，悬停弹该星明细
  const dutyChain = useMemo(() => foldCaseChain(dutyCase), [dutyCase]);
  const dutyProgress = (() => {
    const hop = dutyCase?.hops?.find((h) => h.status === "running");
    const text = String(hop?.progressSummary ?? "").split("\n")[0].trim();
    if (!text) return "";
    // 裸工具名（exec/message/…）过一遍人话映射，不是工具名则原样透传
    const label = toolProgressLabel(text);
    return (label.length > 30 ? `${label.slice(0, 30)}…` : label);
  })();

  const renderCard = (card) => {
    if (card.type === "batch") {
      return (
        <article key={card.key} className="v5card v5card--dump spine" style={{ "--spine": card.color }}>
          <div className="v5-l1"><i className="v5-dot" style={{ background: card.color }} /><b style={{ color: card.color }}>{card.agent}</b><span className="v5-kind">巡检</span><span className="v5-when">{formatHistoryTime(card.at, now)}</span></div>
          <div className="v5-l2">{card.title}</div>
          <div className="v5-batchdetail">{card.detail}</div>
        </article>
      );
    }
    if (card.type === "episode") {
      const expanded = expandedSet.has(card.key);
      return (
        <article key={card.key} className={`v5card spine${card.summary && card.cjk ? "" : " v5card--dump"}`} style={{ "--spine": card.color }}>
          <div className="v5-l1"><i className="v5-dot" style={{ background: card.color }} /><b style={{ color: card.color }}>{card.agent}</b><span className="v5-kind">接力</span><span className="v5-when">{formatHistoryTime(card.at, now)}</span></div>
          <div className="v5-l2">{card.title}</div>
          {card.summary ? <div className="v5-concl">{card.summary}</div> : null}
          <div className="v5-morerow">
            <button type="button" className="v5-more" onClick={() => toggleExpanded(card.key)}>
              {expanded ? "收起链路" : "展开链路"}
            </button>
          </div>
          {expanded && (
            <div className="v5-hops">
              <TaskChainTimeline
                hops={card.episode.runs.map(sessionRunHop)}
                currentTaskId={card.episode.runs[card.episode.runs.length - 1]?.taskId}
                agentNameMap={agentNameMap}
              />
            </div>
          )}
        </article>
      );
    }
    const row = card;
    if (card.tone === "cancel") {
      const skipped = card.status === "skipped";
      const err = card.error ?? (skipped ? "免打扰/未满足条件" : "操作者取消");
      const pipeAt = err.lastIndexOf(" | ");
      const code = pipeAt > 0 ? err.slice(pipeAt + 3) : null;
      const msg = pipeAt > 0 ? err.slice(0, pipeAt) : err;
      return (
        <article key={card.key} className="v5card v5card--dump spine" style={{ "--spine": DIAL_TONE.cancel }}>
          <div className="v5-l1"><i className="v5-dot v5-dot--hollow" /><b style={{ color: DIAL_TONE.cancel }}>{card.agent}</b><span className="v5-kind">{card.kind}</span><span className="v5-when">{formatHistoryTime(card.at, now)}</span></div>
          <div className="v5-l2 v5-l2--soft">{card.title}</div>
          <div className="v5-cancelwhy">{skipped ? "静默跳过" : "已取消"} · {msg}</div>
          {code ? <div className="v5-errraw">{code} · {msg}</div> : null}
        </article>
      );
    }
    const isBriefing = card.kind === "巡检简报";
    const clamped = card.summary && card.summary.length > 96;
    const expanded = expandedSet.has(card.key);
    if (card.summary && !card.cjk) {
      return (
        <article key={card.key} className="v5card v5card--dump spine" style={{ "--spine": card.color }}>
          <div className="v5-l1"><i className="v5-dot" style={{ background: card.color, opacity: card.decayed ? 0.55 : 1 }} /><b style={{ color: card.color }}>{card.agent}</b><span className="v5-kind">{card.kind}</span><span className="v5-when">{formatHistoryTime(card.at, now)}</span></div>
          <div className={`v5-l2${card.slug ? " is-slug" : ""}`}>{card.title}</div>
          <div className="v5-concl-en">{card.summary}</div>
        </article>
      );
    }
    return (
      <article key={card.key} className={`v5card spine${isBriefing ? " v5card--brief" : ""}`} style={{ "--spine": card.color }}>
        <div className="v5-l1"><i className="v5-dot" style={{ background: card.color, opacity: card.decayed ? 0.55 : 1 }} /><b style={{ color: card.color }}>{card.agent}</b><span className={`v5-kind${isBriefing ? " v5-kind--gold" : ""}`}>{card.kind}</span><span className="v5-when">{formatHistoryTime(card.at, now)}</span></div>
        <div className={`v5-l2${card.slug ? " is-slug" : ""}`}>{card.title}</div>
        {card.summary ? <div className={`v5-concl${expanded ? " is-open" : ""}`}>{card.summary}</div> : null}
        {card.error && card.tone === "fail" ? <div className="v5-err">{card.error}</div> : null}
        {clamped ? (
          <div className="v5-morerow">
            <button type="button" className="v5-more" onClick={() => toggleExpanded(card.key)}>
              {expanded ? "收起" : "展开全文"}
            </button>
          </div>
        ) : null}
      </article>
    );
  };

  const feedNodes = [];
  if (feedView === "stars") {
    // 速览 = 按星分组：星按最近活跃排前，节内案按时间新→旧；一节 = 谁干了几案
    const groups = new Map();
    for (const card of conclusionCards) {
      if (!groups.has(card.agentId)) groups.set(card.agentId, []);
      groups.get(card.agentId).push(card);
    }
    const ordered = [...groups.entries()].sort(
      (a, b) => Math.max(...b[1].map((c) => c.at)) - Math.max(...a[1].map((c) => c.at)),
    );
    for (const [agentId, cards] of ordered) {
      const running = cards.filter((c) => c.tone === "live").length;
      const name = agentDisplayName(agentNameMap, agentId) || agentId;
      feedNodes.push(
        <section key={`g:${agentId}`} className="v7-gsec">
          <div className="v7-ghead">
            <i className="v5-dot" style={{ background: cards[0]?.color }} />
            <b>{name}</b>
            <small>{cards.length} 案{running ? ` · 进行中 ${running}` : ""}</small>
          </div>
          {cards.map(renderCard)}
        </section>,
      );
    }
  } else {
    // 明细 = 跨星时间线（原顺序：按天分组的案流）
    let lastDay = null;
    for (const card of conclusionCards) {
      const label = dayLabelOf(card.at, now);
      if (label !== lastDay) {
        feedNodes.push(<div className="v5-daybar" key={`day:${label}:${card.key}`}><span>{label}</span></div>);
        lastDay = label;
      }
      feedNodes.push(renderCard(card));
    }
  }

  return (
    <div className="tasksboard">
      <div className="v7row">
        <section className="v7card v7-dialcard">
          <div className="dial" role="img" aria-label="北斗七星状态盘">
            <svg viewBox="0 0 552 146" preserveAspectRatio="xMinYMid meet">
              <polyline
                className="dial-chain"
                points={DIAL_CHAIN.map(([, x, y]) => `${x},${y}`).join(" ")}
                fill="none" strokeWidth="1.6"
              />
          <line className="dial-leader" x1={DIAL_CHAIN[6][1] + 8} y1="88" x2="424" y2="85" stroke="rgba(217,168,96,.45)" strokeWidth="1" strokeDasharray="2 3" />
          <text x="428" y="89" fill="#D9A860" fontSize="12">›</text>
          <path d="M 24 143 Q 276 137 496 143" fill="none" stroke="#1E2735" strokeWidth="1" />
              {starState.map((star) => {
                const [, x, y] = DIAL_CHAIN.find(([id]) => id === star.id);
                const color = DIAL_TONE[star.tone];
                const above = star.id === "tianquan";
                const staleNote = star.stale ? (star.tone === "idle" ? " · 暂无记录" : " · 已超 24 小时") : "";
                return (
                  <g
                    key={star.id}
                    className={`dial-node${star.tone === "idle" ? " is-idle" : ""}${star.stale ? " is-stale" : ""}${selectedStar === star.id ? " is-selected" : ""}`}
                    transform={`translate(${x},${y})`}
                    onClick={() => setSelectedStar(selectedStar === star.id ? null : star.id)}
                  >
                    <title>{`${STAR_NAME_FALLBACK[star.id]} · ${TONE_LABEL[star.tone]}${staleNote}`}</title>
                    {selectedStar === star.id && <circle r="10" fill="none" stroke="#D9A860" strokeWidth="1.3" />}
                    {star.tone === "live" && <circle className="dial-halo" r="9.5" fill="none" stroke={color} strokeOpacity=".4" />}
                    <circle
                      className="dial-dot" r="5.5"
                      fill={star.tone === "idle" ? "none" : color}
                      stroke={star.tone === "idle" ? "#4A5568" : "none"}
                      strokeWidth={star.tone === "idle" ? 1.3 : 0}
                    />
                    <text x="0" y={above ? -11 : 19} textAnchor="middle" fontSize="9.5">{STAR_NAME_FALLBACK[star.id]}</text>
                    {star.label ? (
                      <text className={`dial-sub${star.tone === "live" ? " is-live" : ""}`} x="0" y={above ? -22 : 31} textAnchor="middle" fontSize="8.5">{star.label}</text>
                    ) : null}
                  </g>
                );
              })}
              <g className="dial-hub" transform={`translate(${DIAL_HUB.x},${DIAL_HUB.y})`}>
                <title>星君 · 北斗最高层（hermes，与网关同机）{live ? " · 在线" : " · 网关未连接"}</title>
                <circle r="5.5" fill="none" stroke={live ? "#D9A860" : "#6b6e78"} strokeWidth="1.4" />
                <text x="11" y="4" textAnchor="start" fontSize="9">星君</text>
                {!live && <text x="11" y="15" textAnchor="start" fontSize="8" fill="#F26D6D">未连接</text>}
              </g>
            </svg>
            <div className="dial-next">
              <div className="lb">下一次 · 定时</div>
              <div className="tm">{nextEntry ? hhMmOf(nextEntry.at) : "待排"}</div>
              <div className="sub">{nextEntry ? formatCronNext(nextEntry.at, now) : ""}{nextStar ? ` · ${nextStar}` : ""}</div>
            </div>
          </div>
        </section>
        <section className="v7card v7-croncard">
          <div className="v7-mhead">定时队列<span className="v7-mcount">{enabledJobs.length} 启用</span></div>
          {queueRows.map(({ job, at }) => (
            <div key={job.id} className="v7-qrow">
              <span className="v7-qname" title={job.description || job.name || job.id}>{jobDisplayName(job.name || job.id)}</span>
              <span className="v7-qnext">{formatCronNext(at, now)}<em> · {starNameOf(job.agentId ?? lastRunByJob.get(job.id)?.agentId)}</em></span>
            </div>
          ))}
          {!queueRows.length && <div className="v7-qempty">没有启用的定时任务</div>}
          <div className="v7-execblock">
            <div className="v7-exectop"><span className="v7-mhead" style={{ margin: 0 }}>命令执行</span><span className="v7-execnum">{execTotal} 条</span></div>
            <div className="v7-execdetail">{execDetail || "—"}</div>
          </div>
        </section>
      </div>

      <div className="v5-statrow">
        <span className="v5-stat" dangerouslySetInnerHTML={{ __html: statBits.join(" · ") }} />
        <span className="v7-spark">
          <em>近 7 天</em>
          <span className="v7-sbs">
            {sparkSeries.map((x, i) => (
              <i
                key={x.label}
                className={`v7-sb${i === sparkSeries.length - 1 ? " is-now" : ""}`}
                style={{ height: `${Math.max(2, Math.round((x.count / sparkPeak) * 20))}px` }}
                title={`${x.label} · ${x.count} 次`}
              />
            ))}
          </span>
          <em className="v7-peak">峰 {sparkPeak}</em>
        </span>
      </div>

      <div className="v7row v7-dutyrow">
        {dutyCase && (
          <article className="v5card v5case">
            <div className="v5-l1"><i className="v5-dot" style={{ background: DIAL_TONE.live }} /><b style={{ color: DIAL_TONE.live }}>案 · 接力</b><span className="v5-kind v5-kind--run">进行中</span><span className="v5-when">已跑 {formatCompactDuration(dutyCase.startedAtMs, now) || "1 分内"}</span></div>
            <div className="v5-l2">{dutyCase.hops?.[0]?.title || "接力进行中"}</div>
            <div className="v5-chain">
              {dutyChain.map((seg, i) => (
                <Fragment key={`${seg.agentId}:${i}`}>
                  {i > 0 ? <span className="v5-chain-sep">→</span> : null}
                  <span
                    className={`v5-chain-chip v5-chain-chip--${seg.toneKey}${seg.running ? " v5-chain-chip--live" : ""}${hoverChip === i ? " is-hover" : ""}`}
                    onMouseEnter={() => setHoverChip(i)}
                    onMouseLeave={() => setHoverChip((cur) => (cur === i ? null : cur))}
                  >
                    <i aria-hidden="true" />
                    {starNameOf(seg.agentId)}{" "}
                    {seg.running ? "● 执行中" : seg.toneKey === "done" ? "✓" : seg.toneKey === "failed" ? "✕" : "○"}
                    {seg.count > 1 ? `×${seg.count}` : ""}
                  </span>
                </Fragment>
              ))}
            </div>
            {hoverChip != null && dutyChain[hoverChip] ? <CaseChipPop seg={dutyChain[hoverChip]} now={now} /> : null}
            {dutyProgress ? <div className="v7-progress"><i />{dutyProgress}</div> : null}
          </article>
        )}
        {feed.briefing && (!selectedStar || feed.briefing.agentId === selectedStar) && (
          <div className={dutyCase ? "v7-dutybrief" : "v7-dutybrief v7-solo"}>
            {renderCard({ ...feed.briefing })}
          </div>
        )}
      </div>

      {/* 动态流与事件流水 = 对称双卡（Leo 2026-10-06 复报"框边没对齐"）：
          左卡也装框，卡内头=标题+筛选 chips，与右侧事件流水卡同框同顶同底；
          此前的"对齐"只对齐了看不见的容器，卡框仍然一头高一头低 */}
      <div className="v7-feedrow">
        <div className="v7card v7-feedmain">
          <div className="v7-mhead">
            <span>动态流</span>
            <div className="v5-filters" style={{ marginLeft: "auto", marginRight: "10px" }}>
              {[["stars", "速览"], ["timeline", "明细"]].map(([id, label]) => (
                <button key={id} type="button" className={`v5-chip${feedView === id ? " is-on" : ""}`} onClick={() => toggleFeedView(id)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="v5-filters">
              {[["all", "全部"], ["failed", "失败"], ["cron", "定时"]].map(([id, label]) => (
                <button key={id} type="button" className={`v5-chip${feedFilter === id ? " is-on" : ""}`} onClick={() => setFeedFilter(id)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {isEmpty && (
            <p className="v5-empty">舰队还没有活动记录 · 连上网关派一轮活，这里会长出动态</p>
          )}
          {feedNodes}
          {feed.skippedNoReply > 0 && <div className="v5-foot">已跳过 {feed.skippedNoReply} 条空定时 · 不占位</div>}
        </div>
        <aside className="v7card v7-logcard">
          <div className="v7-mhead">事件流水</div>
          {(() => {
            const nodes = [];
            let lastDay = null;
            for (const row of logRows) {
              if (row.day !== lastDay) {
                nodes.push(<div key={`ld:${row.day}:${row.key}`} className="v7-lday">{row.day}</div>);
                lastDay = row.day;
              }
              nodes.push(
                <div key={row.key} className="v7-lrow">
                  <span className="v7-lt">{hhMmOf(row.at)}</span>
                  <span className="v7-ls">{row.star}</span>
                  <span className="v7-le" title={row.event}>{row.event}</span>
                  <span className="v7-lg" style={{ color: row.glyphColor }}>{row.glyph}{row.dur ? ` ${row.dur}` : ""}</span>
                </div>
              );
            }
            if (!nodes.length) nodes.push(<div key="logempty" className="v7-qempty">没有事件</div>);
            return nodes;
          })()}
        </aside>
      </div>
      <TasksUsageCard
        variant="board"
        usageSessions={usageSessions}
        idleSessions={idleSessions}
        agentNameMap={agentNameMap}
      />
    </div>
  );
}

function TasksSection({ gateways, onGatewaysChanged, tab = "tasks", onStatus }) {  const [state, setState] = useState({ status: "loading", filter: "all", data: null });
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [lastSync, setLastSync] = useState(null);
  const [live, setLive] = useState(false);
  const [agentsSnap, setAgentsSnap] = useState(null);
  const [monitor, setMonitor] = useState(() => loadMonitorConfig());
  // 历史轮次（主窗"任务"页）：台账里的会话 run 按 gap 链分段回看；
  // expandedEpisode = 展开跳序回放的轮次下标（null = 全部收起）。
  const [sessionRuns, setSessionRuns] = useState([]);
  // 定时任务看板（六案③）：cron.list 本地镜像 + 任务账本对账"上次结果"。
  // cronTasks = 无状态过滤的全量任务行（sourceId join 用），与看板同拍刷新。
  const [cronJobs, setCronJobs] = useState([]);
  const [cronTasks, setCronTasks] = useState([]);
  const [expandedEpisode, setExpandedEpisode] = useState(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  // 状态头上报（App 头部渲染）：同步灯/最近同步/忙碌/手动刷新入口。
  const statusSig = `${live}|${lastSync ?? 0}|${busy}|${state.status}|${state.filter}`;
  const reportedStatusRef = useRef("");
  useEffect(() => {
    if (reportedStatusRef.current === statusSig) return;
    reportedStatusRef.current = statusSig;
    onStatus?.({ live, lastSync, busy, refresh: handleRefresh });
  });
  // 钩子必须全在条件 return 之前（loading 早退时少跑钩子 = React 崩）。
  const agentNameMap = useMemo(() => buildAgentNameMap(agentsSnap?.agents), [agentsSnap]);
  // 星位上下文（B 链路）：主窗任务台与小组件同一份口径（agents snapshot 会话级用量）。
  // 必须挂早退返回之前——hooks 数量在 loading/loaded 两次渲染要一致（React #310）。
  // 快照新鲜度闸：过龄快照的活跃灯按熄灭渲染（灯不撒谎），用量数字照显。
  // 渲染期直算（不 memo）——闸门语义随时间走，tick 每拍 setState 必触发重渲染。
  const boardAgentsFresh = defuseStaleSnapshotActivity(agentsSnap, Date.now());
  const boardUsageSessions = useMemo(
    () => selectUsageSessions(boardAgentsFresh?.sessions),
    [boardAgentsFresh],
  );
  const boardIdleSessions = useMemo(
    () => listIdleSessions(boardAgentsFresh?.sessions, boardUsageSessions),
    [boardAgentsFresh, boardUsageSessions],
  );
  const historyEpisodes = useMemo(() => {
    const windowMs = (monitor.historyWindowMin ?? 0) * 60_000;
    if (!windowMs || !sessionRuns.length) return [];
    const now = Date.now();
    return groupSessionEpisodes(sessionRuns, Math.max(5, monitor.episodeGapMin) * 60_000).filter(
      (episode) => {
        if (now - episode.lastActivityMs >= windowMs) return false;
        const latest = episode.runs[episode.runs.length - 1];
        return latest.status !== "running";
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionRuns, monitor.historyWindowMin, monitor.episodeGapMin]);

  // 定时任务看板"上次结果"对账（六案③）：任务账本 automation_run 行按
  // sourceId（= cron job UUID）归到各 job，取开始时间最新一条。演示数据
  // 不走这里（job 自带 lastRunStatus 演示字段）。钩子必须全在条件 return 前。
  const lastRunByJob = useMemo(() => {
    const map = new Map();
    for (const task of cronTasks) {
      if (task?.kind !== "automation_run" || !task.sourceId) continue;
      const started = task.startedAtMs ?? 0;
      const current = map.get(task.sourceId);
      if (!current || started > (current.startedAtMs ?? 0)) map.set(task.sourceId, task);
    }
    return map;
  }, [cronTasks]);

  const load = useCallback((filter) => {
    loadGatewayTasks(filter === "all" ? null : filter)
      .then((data) => {
        setState((current) => ({ ...current, status: "ready", data }));
        setLastSync(Date.now());
      })
      .catch(() => setState((current) => ({ ...current, status: "error", data: null })));
  }, []);

  // 设置页保存监控参数后立即生效（刷新间隔变化会重建定时器）
  useEffect(() => {
    const handler = () => setMonitor(loadMonitorConfig());
    window.addEventListener("metrik-monitor-changed", handler);
    return () => window.removeEventListener("metrik-monitor-changed", handler);
  }, []);

  // 实时监控循环：默认 3 秒一拍（间隔可在设置 → 任务追踪里调整）。Tauri 下每拍先触发后端快照（拉网关写账本），
  // 再读账本刷新视图；浏览器演示模式只读演示数据。页面隐藏时暂停。
  useEffect(() => {
    let alive = true;
    load(stateRef.current.filter);
    const tick = async () => {
      if (!alive || (!PREVIEW_EAGER && document.visibilityState === "hidden")) return;
      const filter = stateRef.current.filter;
      if (isTauriRuntime() && gateways.length) {
        try {
          const result = await refreshGatewayTasks(gateways);
          const failures = result.results.filter((entry) => !entry.ok);
          setLive(failures.length === 0);
          setFeedback(
            failures.length
              ? { tone: "error", message: failures.map((entry) => `${entry.gateway}：${entry.error}`).join("；") }
              : null,
          );
        } catch {
          setLive(false);
        }
      } else if (!gateways.length) {
        setLive(false);
      }
      if (gateways.length) {
        loadAgentsSnapshot(gateways)
          .then((snap) => alive && setAgentsSnap(snap))
          .catch(() => {});
      }
      load(filter);
      // 历史轮次同拍刷新：台账只读（不触发网关轮询），与任务列表同一节奏。
      loadSessionRuns()
        .then((data) => alive && setSessionRuns(data.runs ?? []))
        .catch(() => {});
      // 定时任务看板同拍刷新：读回走本地镜像（不联网）；触发拉取由 Rust
      // 60 秒节流兜住，每拍调用也只真连一次每分钟。
      loadCronJobs()
        .then((data) => alive && setCronJobs(data.jobs ?? []))
        .catch(() => {});
      loadGatewayTasks(null)
        .then((data) => alive && setCronTasks(data.tasks ?? []))
        .catch(() => {});
      if (gateways.length) {
        refreshCronJobs(gateways).catch(() => {});
      }
    };
    tick();
    const timer = setInterval(tick, Math.max(1, monitor.refreshIntervalSec) * 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateways.map((gateway) => gateway.label).join("|"), monitor.refreshIntervalSec, load]);

  const handleRefresh = async () => {
    if (!gateways.length) {
      setFeedback({ tone: "error", message: "尚未配置被追踪的 Gateway：在设置 → 任务追踪里添加。" });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const result = await refreshGatewayTasks(gateways);
      const failures = result.results.filter((entry) => !entry.ok);
      if (failures.length) {
        setFeedback({
          tone: "error",
          message: failures.map((entry) => `${entry.gateway}：${entry.error}`).join("；"),
        });
      } else {
        setFeedback({ tone: "success", message: `已从 ${result.results.length} 个 Gateway 拉取任务台账。` });
      }
      load(state.filter);
      onGatewaysChanged?.();
    } finally {
      setBusy(false);
    }
  };

  if (state.status === "loading" && !state.data) {
    return (
      <main className="tasks-section tasks-section--flush" aria-busy="true">
        <p className="tasks-standby">正在连接 Gateway 并建立实时监控…</p>
      </main>
    );
  }
  if (state.status === "error") {
    return (
      <main className="tasks-section tasks-section--flush">
        <p className="tasks-standby">任务账本读取失败，稍后自动重试。</p>
      </main>
    );
  }

  const data = state.data;
  const tasks = data?.tasks || [];
  const activeCount = tasks.filter(isActiveTask).length;
  const filters = [
    { id: "active", label: `进行中 (${activeCount})` },
    { id: "all", label: `全部 (${tasks.length})` },
    { id: "succeeded", label: "已完成" },
    { id: "failed", label: "失败/中断" },
  ];
  const now = Date.now();
  const STALE_MS = Math.max(10, monitor.staleThresholdSec) * 1000; // 无活动判定阈值（设置页可调）
  const cronEnabled = cronJobs.filter((job) => job.enabled).length;
  const cronNextHint = (() => {
    const nextList = cronJobs
      .filter((job) => job.enabled)
      .map((job) => cronNextAtOf(job, now))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    return nextList.length ? formatCronNext(nextList[0], now) : "待排";
  })();

  // 定时任务看板行（六案③）：镜像 job + 上次结果（分诊口径着色，completed
  // 是网关侧对 automation_run 的叫法，归一成 succeeded）+ 下次运行（网关权威优先）。
  const cronBoard = cronJobs.map((job) => {
    const ledgerLast = lastRunByJob.get(job.id);
    const raw = ledgerLast
      ? {
          status: ledgerLast.status === "completed" ? "succeeded" : ledgerLast.status,
          error: ledgerLast.error,
          at: ledgerLast.endedAtMs ?? ledgerLast.startedAtMs,
        }
      : job.lastStatus
        ? {
            status: job.lastStatus === "completed" ? "succeeded" : job.lastStatus,
            error: null,
            at: job.lastRunAtMs,
          }
        : null;
    const tone = raw ? hopToneOf({ status: raw.status, taskId: job.id, error: raw.error }) : null;
    return {
      id: job.id,
      name: jobDisplayName(job.name),
      description: job.description,
      enabled: job.enabled,
      scheduleText: cronScheduleTextOf(job),
      last: tone && raw ? { tone: tone.tone, text: `${tone.state} · ${formatHistoryTime(raw.at, now)}` } : null,
      // 停用的任务没有"下次"可言
      next: job.enabled ? formatCronNext(cronNextAtOf(job, now), now) : null,
    };
  });

  // 链路全景（六案④）：进行中的接力轮（同群聊一串，逐跳带原话/结论）+
  // 登记任务链（父子/runId 边，≥2 跳才算链）。
  const relayEpisodes = activeRelayEpisodes(
    sessionRuns,
    sessionRuns.filter((run) => run.status === "running"),
    Math.max(5, monitor.episodeGapMin) * 60_000,
  );

  const showTasks = tab === "tasks";
  const showCron = tab === "cron";
  return (
    <main className="tasks-section tasks-section--flush">
      {showTasks && feedback && (
        <p className={feedback.tone === "error" ? "tasks-feedback tasks-feedback--error" : "tasks-feedback tasks-feedback--success"}>
          {feedback.message}
        </p>
      )}
      {showTasks && data?.demo && (
        <p className="tasks-feedback">浏览器预览：展示演示数据；Tauri 桌面端读取真实任务账本。</p>
      )}
      {showTasks && data?.loadError && <p className="tasks-feedback tasks-feedback--error">{data.loadError}</p>}

      {showTasks && (
        <TasksBoard
          rows={cronTasks}
          episodes={historyEpisodes}
          activeEpisodes={relayEpisodes}
          cronJobs={cronJobs}
          lastRunByJob={lastRunByJob}
          agentNameMap={agentNameMap}
          usageSessions={boardUsageSessions}
          idleSessions={boardIdleSessions}
          now={now}
          live={live}
        />
      )}
      {showCron && (cronBoard.length > 0 ? (
        <section className="cron-board" aria-label="定时任务">
          <h2 className="history-episodes-head">
            定时任务
            <small>北斗挂的自动化（巡检/心跳/记忆整理），排程与上次结果一览；镜像 ≤1 分钟延迟</small>
          </h2>
          <div className="cron-board-list">
            {cronBoard.map((row) => (
              <div className="cron-board-row" key={row.id} title={row.description || row.name || row.id}>
                <span className={`cron-pill ${row.enabled ? "cron-pill--on" : "cron-pill--off"}`}>
                  {row.enabled ? "启用" : "停用"}
                </span>
                <div className="cron-board-main">
                  <span className="cron-board-name">{row.name || row.id}</span>
                  <span className="cron-board-sched">{row.scheduleText || "—"}</span>
                </div>
                <span className="cron-board-last">
                  {row.last ? (
                    <>
                      <i className={`cron-dot cron-dot--${row.last.tone}`} aria-hidden="true" />
                      {row.last.text}
                    </>
                  ) : (
                    <span className="cron-board-last--none">暂无运行记录</span>
                  )}
                </span>
                <span className="cron-board-next">{row.next ?? "—"}</span>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <p className="tasks-standby">还没有定时任务的本地镜像；配好网关后第一拍就会同步进来。</p>
      ))}
    </main>
  );
}

const CONSOLE_TABS = [
  { id: "tasks", label: "任务" },
  { id: "cron", label: "定时" },
  { id: "settings", label: "设置" },
];

function initialWindowMode() {
  if (typeof window === "undefined") return "main";
  const urlView = new URLSearchParams(window.location.search).get("view");
  if (urlView === "tasks") return "tasks-widget";
  if (urlView === "notifications") return "notifications";
  if (urlView === "hopcard") return "hopcard";
  return "main";
}

export function App() {
  const [viewMode] = useState(initialWindowMode);
  const [gateways, setGateways] = useState(() => loadGatewayConfig());
  const reloadGateways = useCallback(() => setGateways(loadGatewayConfig()), []);
  const [consoleTab, setConsoleTab] = useState("tasks");
  const [consoleStatus, setConsoleStatus] = useState(null);
  const [tasksWidgetEnabled, setTasksWidgetEnabled] = useState(
    () => localStorage.getItem("metrik:tasksWidget") !== "off",
  );
  useEffect(() => {
    const handler = () => setTasksWidgetEnabled(localStorage.getItem("metrik:tasksWidget") !== "off");
    window.addEventListener("metrik-monitor-changed", handler);
    return () => window.removeEventListener("metrik-monitor-changed", handler);
  }, []);
  // 任务小组件显隐以 Rust 侧为准（托盘切换/自身关闭/设置勾选三条路都广播）；
  // 这里同步勾选态（emit 会回到发送方，监听须幂等）。
  useEffect(() => {
    const stopPromise = onTasksWidgetVisibility((visible) => {
      setTasksWidgetEnabled(visible);
      localStorage.setItem("metrik:tasksWidget", visible ? "on" : "off");
    });
    return () => {
      stopPromise.then((stop) => stop?.());
    };
  }, []);
  // 任务台一键显示/隐藏任务小组件：只发 Rust 命令，状态 = 广播回声
  // （v2 Leo 拍板：此前"先翻状态再调命令"在建窗失败时按钮与实际脱钩，
  // 按了没反应要按两下；现在按钮态永远等于窗的实际可见性）。
  // localStorage 由可见性监听统一写——它就是"上次关闭时的状态"，启动照着恢复。
  const handleToggleTasksWidget = useCallback(() => {
    setTasksWidgetWindow(!tasksWidgetEnabled);
  }, [tasksWidgetEnabled]);
  // 独立常驻：设置开着且已配网关 → 启动时把任务小窗带起来（set 幂等，绝不重建）。
  // 星卡伴随窗自己不做这个引导（它是小组件的附属窗，不反哺生死）。
  useEffect(() => {
    if (viewMode === "tasks-widget" || viewMode === "hopcard") return undefined;
    if (localStorage.getItem("metrik:tasksWidget") === "off") return undefined;
        setTasksWidgetWindow(true);
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 自绘提醒角标窗：总开关开着且已配网关 → 启动同样带起（创建后隐藏待命，有卡才自弹）。
  useEffect(() => {
    if (viewMode === "notifications" || viewMode === "hopcard") return undefined;
    if (!loadMonitorConfig().notifyEnabled) return undefined;
        setNotificationWindow(true);
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 任务小组件窗自己轮询（useWidgetTasksFeed）；任务台的数据由 TasksSection 自拉。
  const widgetTasksFeed = useWidgetTasksFeed(gateways, viewMode === "tasks-widget");

  const [pinned, setPinned] = useState(() => localStorage.getItem("metrik:pinned") === "true");
  const handleTogglePinned = useCallback(() => {
    setPinned((current) => {
      const next = !current;
      localStorage.setItem("metrik:pinned", String(next));
      setWindowPinned(next);
      return next;
    });
  }, []);

  // 玻璃外观三态：任务台与两个玻璃窗共用一档，改动即广播。
  const [glassAlpha, setGlassAlpha] = useState(() => {
    const stored = Number(localStorage.getItem("metrik:glassAlpha"));
    return Number.isFinite(stored) && stored >= 0.05 && stored <= 0.96 ? stored : 0.82;
  });
  const handleGlassAlpha = useCallback((next) => {
    setGlassAlpha(next);
    localStorage.setItem("metrik:glassAlpha", String(next));
    // 玻璃窗是独立 webview：浓度改动要广播（此前漏广播，玻璃窗纹丝不动）
    emitGlassAlpha(next);
  }, []);
  const [glassTint, setGlassTint] = useState(() =>
    normalizeGlassTint(localStorage.getItem("metrik:glassTint")),
  );
  const handleGlassTint = useCallback((next) => {
    const value = normalizeGlassTint(next);
    setGlassTint(value);
    localStorage.setItem("metrik:glassTint", value);
    // 任务小组件/提醒窗是独立窗口：换挡要广播，玻璃保持同一档。
    emitGlassTint(value);
  }, []);
  useEffect(() => {
    const stopPromise = onGlassTintChanged(() => {
      setGlassTint(normalizeGlassTint(localStorage.getItem("metrik:glassTint")));
    });
    return () => {
      stopPromise.then((stop) => stop?.());
    };
  }, []);
  useEffect(() => {
    const stopPromise = onGlassAlphaChanged(() => {
      const stored = Number(localStorage.getItem("metrik:glassAlpha"));
      setGlassAlpha(Number.isFinite(stored) && stored >= 0.05 && stored <= 0.96 ? stored : 0.82);
    });
    return () => {
      stopPromise.then((stop) => stop?.());
    };
  }, []);
  useEffect(() => {
    const stopPromise = onGlassInkChanged(() => {
      setGlassInk(normalizeGlassInk(localStorage.getItem("metrik:glassInk")));
    });
    return () => {
      stopPromise.then((stop) => stop?.());
    };
  }, []);
  const [glassInk, setGlassInk] = useState(() =>
    normalizeGlassInk(localStorage.getItem("metrik:glassInk")),
  );
  const handleGlassInk = useCallback((next) => {
    const value = normalizeGlassInk(next);
    setGlassInk(value);
    localStorage.setItem("metrik:glassInk", value);
    emitGlassInk(value);
  }, []);
  // 任务台的明暗主题：自动/亮/暗。默认深色（与小组件的深色 HUD 同一气质；
  // 跟随系统会在浅色系统上亮成一页纸，Leo 2026-10-05 点名）。设置过就以设置为准。
  const [theme, setTheme] = useState(() => {
    const stored = localStorage.getItem("metrik:theme");
    return stored === "light" || stored === "dark" || stored === "auto" ? stored : "dark";
  });
  const handleThemeChange = useCallback((next) => {
    setTheme(next);
    localStorage.setItem("metrik:theme", next);
  }, []);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false,
  );
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return undefined;
    const update = () => setSystemDark(media.matches);
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
  const darkTheme = theme === "auto" ? systemDark : theme === "dark";
  // data-theme 只挂任务台窗（明暗主题）；玻璃窗不带该属性（玻璃 CSS 独立）。
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (viewMode === "main") {
      root.dataset.theme = darkTheme ? "dark" : "light";
    } else {
      delete root.dataset.theme;
    }
  }, [viewMode, darkTheme]);
  // Windows 桌面端初始直接选 alpha，避免 WebView 背景确认前闪一帧 CSS fallback。
  const [glassMode, setGlassMode] = useState(() =>
    resolveGlassMode({
      enabled: viewMode !== "main",
      tintStyle: glassTint,
      nativeAvailable: false,
      trueAlphaAvailable: isDesktop() && IS_WINDOWS,
    }),
  );
  useEffect(() => {
    let cancelled = false;
    const apply = () => {
      setWindowGlass(viewMode !== "main", 14, glassTint)
        .then((mode) => {
          if (!cancelled) setGlassMode(mode);
        })
        .catch((error) => {
          console.warn("Unable to update the desktop window.", error);
        });
    };
    apply();
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    media?.addEventListener?.("change", apply);
    return () => {
      cancelled = true;
      media?.removeEventListener?.("change", apply);
    };
  }, [viewMode, glassTint]);
  // 深色档的 0.55 下限是白字可读下限（fork 同一条曲线）。
  const shellGlassAlpha = useMemo(() => {
    if (glassTint === "clear") return glassAlpha;
    const t = (glassAlpha - 0.05) / (0.96 - 0.05);
    return 0.55 + Math.min(1, Math.max(0, t)) * (0.96 - 0.55);
  }, [glassAlpha, glassTint]);
  useLayoutEffect(() => {
    document.documentElement.style.setProperty("--shell-glass-alpha", String(shellGlassAlpha));
  }, [shellGlassAlpha]);
  // 任务小组件的标题栏外观轮转按钮：深色 → 浅色 → 透明 → 深色。
  const glassTintRef = useRef(glassTint);
  glassTintRef.current = glassTint;
  const handleCycleAppearance = useCallback(() => {
    handleGlassTint(nextGlassTint(glassTintRef.current));
  }, [handleGlassTint]);

  // 星卡伴随窗：独立置顶穿透小窗，只渲染悬停星卡本体（载荷由胶囊窗经
  // Rust static 下发，take 即清空；画完一帧回 ready 才显形）。
  if (viewMode === "hopcard") {
    return <HopCardWindow />;
  }

  if (viewMode === "notifications") {
    return (
      <NotificationWindow
        transparent
        glassMode={glassMode}
        glassTint={glassTint}
        glassInk={glassInk}
        glassAlpha={shellGlassAlpha}
        onClose={() => runWindowAction(() => setNotificationWindow(false))}
      />
    );
  }

  if (viewMode === "tasks-widget") {
    return (
      <TasksWidgetWindow
        feed={widgetTasksFeed}
        transparent
        glassMode={glassMode}
        glassTint={glassTint}
        glassInk={glassInk}
        glassAlpha={shellGlassAlpha}
        onCycleAppearance={handleCycleAppearance}
        onOpenExpanded={() => runWindowAction(() => showMainExpanded())}
        onClose={() => runWindowAction(() => setTasksWidgetWindow(false))}
        onPinnedChange={() => {}}
      />
    );
  }

  return (
    <div className="console-root">
      <div className="expanded-drag-region" data-tauri-drag-region aria-hidden="true" />
      <WindowActions
        mode="expanded"
        pinned={pinned}
        theme={theme}
        darkTheme={darkTheme}
        onThemeChange={handleThemeChange}
        onTogglePinned={handleTogglePinned}
        tasksWidgetEnabled={tasksWidgetEnabled}
        onToggleTasksWidget={handleToggleTasksWidget}
      />
      <header className="console-head">
        <span className="console-brand">司南<small>任务台</small></span>
        {consoleStatus && (
          <span
            className={consoleStatus.live ? "console-live console-live--on" : "console-live"}
            title={consoleStatus.live ? "自动同步 Gateway 中" : "未在同步：检查网关配置或网络"}
          >
            <span className="live-dot" />
            {consoleStatus.live ? "同步中" : "未同步"}
          </span>
        )}
        {consoleStatus?.lastSync ? (
          <span className="console-sync-at">
            更新于 {new Date(consoleStatus.lastSync).toLocaleTimeString("zh-CN", { hour12: false })}
          </span>
        ) : null}
        <button
          type="button"
          className="console-refresh"
          disabled={!!consoleStatus?.busy}
          onClick={() => consoleStatus?.refresh?.()}
          title="立即拉取网关任务台账"
        >
          <ArrowsClockwise size={13} /> {consoleStatus?.busy ? "拉取中…" : "同步"}
        </button>
      </header>
      <nav className="console-tabs" role="tablist" aria-label="任务台分区">
        {CONSOLE_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={consoleTab === item.id}
            className={consoleTab === item.id ? "is-selected" : ""}
            onClick={() => setConsoleTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="console-scroll">
        <div className={consoleTab === "settings" ? "console-hidden" : ""}>
          <TasksSection
            gateways={gateways}
            onGatewaysChanged={reloadGateways}
            tab={consoleTab}
            onStatus={setConsoleStatus}
          />
        </div>
        <div className={consoleTab === "settings" ? "console-settings" : "console-settings console-hidden"}>
          <MonitorSettingsCard tasksWidgetEnabled={tasksWidgetEnabled} onToggleTasksWidget={handleToggleTasksWidget} />
          <GatewaySettingsCard gateways={gateways} onGatewaysChanged={reloadGateways} />
          <AppearanceCard
            theme={theme}
            onThemeChange={handleThemeChange}
            glassAlpha={glassAlpha}
            onGlassAlpha={handleGlassAlpha}
            glassTint={glassTint}
            onGlassTint={handleGlassTint}
            glassInk={glassInk}
            onGlassInk={handleGlassInk}
          />
        </div>
      </div>
    </div>
  );
}
