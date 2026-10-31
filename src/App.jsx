import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { beidouAppendVideo, beidouAutoHeal, beidouDirectLaunch, loadBeidouCases, loadGatewayConfig, loadMonitorConfig, saveMonitorConfig } from "./lib/taskClient.js";
import { emitGlassAlpha, emitGlassInk, emitGlassTint, isDesktop, onGlassAlphaChanged, onGlassInkChanged, onGlassTintChanged, onTasksWidgetVisibility, setNotificationWindow, setTasksWidgetWindow, setWindowGlass, setWindowPinned, showMainExpanded } from "./lib/windowClient";
import { GLASS_MODES, glassShellAppearance, nextGlassTint, resolveGlassMode } from "./lib/glassAppearance.js";
import { ledgerRowsToCases, wakeupFailureText } from "./lib/cockpit.js";
import { BrandLogo } from "./views/PipelineView.jsx";
import { ArrowsClockwise } from "@phosphor-icons/react";
import ViewBoundary from "./views/ViewBoundary.jsx";
import InflightView from "./views/InflightView.jsx";
import { useWidgetTasksFeed } from "./hooks/useWidgetTasksFeed.js";
import { normalizeGlassInk, normalizeGlassTint } from "./lib/glass.js";
import { IS_MAC, IS_WINDOWS } from "./lib/platformFlags.js";
import { HopCardWindow } from "./windows/HopCardWindow.jsx";
import { NotificationWindow } from "./windows/NotificationWindow.jsx";
import { runWindowAction } from "./lib/windowStatus.js";
import { TasksWidgetWindow } from "./windows/TasksWidgetWindow.jsx";
import { WindowActions } from "./components/WindowActions.jsx";
import { TasksSection } from "./views/TasksSection.jsx";
import { MonitorSettingsCard } from "./views/settings/MonitorSettingsCard.jsx";
import { GatewaySettingsCard } from "./views/settings/GatewaySettingsCard.jsx";
import { AppearanceCard } from "./views/settings/AppearanceCard.jsx";


const CONSOLE_TABS = [
  { id: "inflight", label: "在途" },
  { id: "cockpit", label: "指挥舱" },
  // 案件卷宗：查历史案件用（泳道只看当前在办，翻旧账得靠这张表）
  { id: "cases", label: "案件卷宗" },
  { id: "tasks", label: "任务" },
  { id: "cron", label: "定时任务" },
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
  const [consoleTab, setConsoleTab] = useState("inflight");
  // 卷宗里点一行 → 回指挥舱并选中那一案（不然点了没反应，"查看过往案件"就断在这）。
  const [focusCaseId, setFocusCaseId] = useState(null);
  const [starsOpen, setStarsOpen] = useState(false);
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
  // 主窗材质（Leo 2026-10-20 拍板四窗全玻璃）：true=玻璃皮，false=纸感实底。
  // 存 monitor 配置而不是 localStorage 散键——它和「界面长什么样」的其他开关
  // 住一起（外观卡就在同一个设置页）；默认 true 见 loadMonitorConfig。
  const [mainGlass, setMainGlass] = useState(() => loadMonitorConfig().mainGlass);
  const handleMainGlass = useCallback((next) => {
    const value = next === true;
    setMainGlass(value);
    saveMonitorConfig({ ...loadMonitorConfig(), mainGlass: value });
  }, []);
  const [glassTint, setGlassTint] = useState(() =>
    normalizeGlassTint(localStorage.getItem("metrik:glassTint")),
  );  const handleGlassTint = useCallback((next) => {
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
  const handleThemeChange = useCallback((next) => {
    setTheme(next);
    localStorage.setItem("metrik:theme", next);
    // 玻璃档时"明暗"就是"玻璃档位"（四窗同一块玻璃）：顶栏切亮暗必须连三窗
    // 一起切，否则主窗变浅、小组件还是深色，"四窗统一"当场破功。纸感档不动三窗。
    if (mainGlass) {
      handleGlassTint(next === "auto" ? (systemDark ? "dark" : "light") : next);
    }
  }, [mainGlass, systemDark, handleGlassTint]);
  // 「自动」在玻璃档下的含义 = 档位跟随系统明暗。只在系统**真的**换主题时
  // 同步一次：若按 systemDark 无条件跑，用户在玻璃档里手选「透明」会被立刻
  // 拉回深/浅档（effect 依赖里 systemDark 没变，但下一轮渲染又命中）。
  const lastSystemDarkRef = useRef(systemDark);
  useEffect(() => {
    const changed = lastSystemDarkRef.current !== systemDark;
    lastSystemDarkRef.current = systemDark;
    if (!changed || !mainGlass || theme !== "auto") return;
    handleGlassTint(systemDark ? "dark" : "light");
  }, [systemDark, mainGlass, theme, handleGlassTint]);
  // 主窗内容层的明暗：玻璃档跟**玻璃档位**走，纸感档仍听明暗主题。
  // 深色档 → 深色 HUD token；浅色档 → 沿用纸感浅色 token（白霜玻璃上的现行
  // 浅色界面，等于纸感没被消灭，只是多了"可透明"形态）；透明档看字色。
  const consoleDark = mainGlass
    ? glassTint === "dark" || (glassTint === "clear" && glassInk === "light")
    : darkTheme;
  // data-theme 只挂任务台窗；玻璃窗/预览窗不带该属性（玻璃 CSS 独立）。
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (viewMode === "main") {
      root.dataset.theme = consoleDark ? "dark" : "light";
    } else {
      delete root.dataset.theme;
    }
  }, [viewMode, consoleDark]);
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

  // 主窗玻璃壳：与小组件/胶囊走同一个 glassShellAppearance（同一套 tint 档、
  // 同一个浓度、同一组前景规则），差异只有圆角与"透明档不做边缘穿透"。
  // Windows 桌面窗口本身 transparent: true，CSS 半透直接透出壁纸；浏览器预览
  // 没有窗口层，走 --glass-css 近实心回落（否则一处 rgba 会露出预览页白底）。
  const consoleShell = useMemo(
    () =>
      glassShellAppearance("console", {
        transparent: mainGlass,
        glassMode: isDesktop() && IS_WINDOWS ? GLASS_MODES.alpha : GLASS_MODES.css,
        glassTint,
        glassInk,
        glassAlpha: shellGlassAlpha,
        isMac: IS_MAC,
      }),
    [mainGlass, glassTint, glassInk, shellGlassAlpha],
  );

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

  // 北斗派发三令：真发到网关（Rust 侧 sessions.send），失败如实回传。
  // 此前这三个回调是空函数——指挥舱看着能点，点完什么都没发生。
  const [beidouBusy, setBeidouBusy] = useState(false);
  const [beidouToast, setBeidouToast] = useState(null);
  const handleBeidouLaunch = useCallback(
    async ({ title, deliverableMode }) => {
      setBeidouBusy(true);
      try {
        const result = await beidouDirectLaunch({ title, deliverableMode }, gateways);
        setBeidouToast(
          result?.sent
            ? { tone: "ok", text: `${result.caseId} 已发车：${result.title}` }
            : { tone: "warn", text: `${result?.caseId ?? "新案"} 只落了本地流水——${wakeupFailureText(result?.sendError)}` },
        );
        setBeidouCasesVersion((v) => v + 1);
      } finally {
        setBeidouBusy(false);
      }
    },
    [gateways],
  );
  const handleBeidouAppendVideo = useCallback(
    async ({ caseId }) => {
      setBeidouBusy(true);
      try {
        const result = await beidouAppendVideo(caseId, gateways);
        setBeidouToast(
          result?.sent
            ? { tone: "ok", text: `${caseId} 追投视频包已派给开阳` }
            : { tone: "warn", text: `${caseId} 追投没发出去——${wakeupFailureText(result?.sendError)}` },
        );
      } finally {
        setBeidouBusy(false);
      }
    },
    [gateways],
  );
  const handleBeidouAutoHeal = useCallback(
    async ({ caseId }) => {
      setBeidouBusy(true);
      try {
        // 不传 session_key：3/3 自愈从来不 reset（清时机归 watchdog），
        // 后端按 agent_id=tianji 自己解析群会话键去发。
        const result = await beidouAutoHeal(caseId, "", gateways);
        setBeidouToast(
          result?.sent
            ? { tone: "ok", text: `${caseId} 已派局部重修给天玑` }
            : { tone: "warn", text: `${caseId} 自愈没发出去——${wakeupFailureText(result?.sendError)}` },
        );
      } finally {
        setBeidouBusy(false);
      }
    },
    [gateways],
  );
  // 指挥舱卷宗：本地账本真读（此前没人调过，看板永远兜底演示数据）。
  // version 只作"刚发过车，重读一遍"的信号。
  const [beidouCasesVersion, setBeidouCasesVersion] = useState(0);
  const [beidouCases, setBeidouCases] = useState([]);
  useEffect(() => {
    let cancelled = false;
    loadBeidouCases().then((result) => {
      if (!cancelled) setBeidouCases(ledgerRowsToCases(result.cases));
    });
    return () => {
      cancelled = true;
    };
  }, [beidouCasesVersion]);
  // 案账本定时重读：此前它只在挂载和「发车/追投」后读一次，而读取顺带跑的
  // 收割线（harvest_links_from_sessions/tasks）是**飞书里跑出来的案唯一入口**——
  // 不重读就永远捞不到。2026-10-20 00:05 Leo 在群里派活，BM-2602 在会话里真的
  // 跑起来了（session_run 里 10 跳、交接卡写着 BM-2602），app 里却一点动静没有，
  // 就是因为账本那次读取停在 00:02。15 秒一拍，成本是两条几十行级的 SQL 扫描，
  // 没变化时不写库（收割线自带"内容没变不 UPDATE"）。
  useEffect(() => {
    const bump = () => setBeidouCasesVersion((v) => v + 1);
    const timer = window.setInterval(bump, 15_000);
    // 2026-10-22 Leo 实拍：窗口在后台时 webview 定时器被降频/暂停，账本已关单
    // 但泳道还显示「运营关单」，切一次视图才刷新。回到前台立刻重读一次。
    window.addEventListener("focus", bump);
    const onVisible = () => {
      if (!document.hidden) bump();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", bump);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  // 顶栏右侧两枚 chip 的数（外壳统一后从 PipelineTopBar 挪上来）。账本只写真数据：
  // 在途 = 没关单的案；待你裁决 = 打回满 3 次的案。
  const cockpitPending = beidouCases.filter((item) => (item.secondStrikes ?? 0) >= 3).length;
  const cockpitInFlight = beidouCases.filter((item) => !(item.closed ?? false)).length;
  // 提示条 6 秒自消：不自动消就要手动关，多一步操作。
  useEffect(() => {
    if (!beidouToast) return undefined;
    const timer = window.setTimeout(() => setBeidouToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [beidouToast]);

  return (
    <div
      className={`console-root${mainGlass ? ` ${consoleShell.className}` : ""}`}
      style={mainGlass ? consoleShell.style : undefined}
    >
      <div className="expanded-drag-region" data-tauri-drag-region aria-hidden="true" />

      {/* 独立窗口条（方案 B 定稿，Leo 2026-10-18）：30px 专用条，整条可拖，
           主题/小窗/钉住/窗口控制在右。不加提示文字——正常软件不用说。 */}
      <div className="window-strip" data-tauri-drag-region>
        <WindowActions
          mode="expanded"
          strip
          pinned={pinned}
          theme={theme}
          darkTheme={darkTheme}
          onThemeChange={handleThemeChange}
          onTogglePinned={handleTogglePinned}
          tasksWidgetEnabled={tasksWidgetEnabled}
          onToggleTasksWidget={handleToggleTasksWidget}
        />
      </div>
            {/* 统一外壳：五个页签共用同一条顶栏——品牌在左、胶囊页签居中、状态在右。
          之前只有指挥舱是设计稿外壳，另外四页还是「司南任务台+同步」两排老壳，
          切个页签像换了个 app（Leo 2026-10-18 五图对照）。 */}
      <header className="console-topbar" data-tauri-drag-region>
        <div className="pl-brand">
          <BrandLogo />
          <div>
            <div className="pl-brand-name">司南 · 北斗矩阵</div>
            <div className="pl-brand-sub">Sinan · Zero-Touch</div>
          </div>
        </div>
        <nav className="pl-tabs" role="tablist" aria-label="任务台分区">
          {CONSOLE_TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={consoleTab === item.id}
              className={consoleTab === item.id ? "is-on" : ""}
              onClick={() => setConsoleTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="console-topright">
          {consoleTab === "cockpit" ? (
            <>
              {cockpitPending > 0 ? (
                <span className="pl-chip pl-chip--alert" title="打回满 3 次，停着等你改判">
                  <span className="pl-dot pl-dot--cinnabar" />待你裁决 {cockpitPending}
                </span>
              ) : null}
              <span className="pl-chip" title="账本里还没关单的案">{cockpitInFlight} 在途</span>
              <span
                className={`pl-badge pl-badge--${
                  consoleStatus?.busy ? "amber" : consoleStatus?.live ? "jade" : "cinnabar"
                }`}
                title={consoleStatus?.live ? "网关快照正常" : "快照没下来：检查网关配置或点任务页「同步」重试"}
              >
                <span
                  className={`pl-dot pl-dot--${
                    consoleStatus?.busy ? "amber" : consoleStatus?.live ? "jade" : "cinnabar"
                  } pl-breathe`}
                />
                <span className="pl-hide-narrow">{consoleStatus?.busy ? "同步中…" : consoleStatus?.live ? "已连接" : "未连接"}</span>
              </span>
              <button type="button" className="pl-btn pl-btn--sm" onClick={() => setStarsOpen((v) => !v)} title="星位明细">
                <span aria-hidden="true">⭐</span><span className="pl-hide-narrow">星位明细</span>
              </button>
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
      </header>
      <div className="console-scroll">
        <div className={consoleTab === "settings" ? "console-hidden" : ""}>
          {consoleTab === "inflight" ? (
            <ViewBoundary key="inflight">
              <InflightView />
            </ViewBoundary>
          ) : null}
          <div className={consoleTab === "inflight" ? "console-hidden" : ""}>
          <TasksSection
            gateways={gateways}
            onGatewaysChanged={reloadGateways}
            tab={consoleTab}
            onStatus={setConsoleStatus}
            onLaunch={handleBeidouLaunch}
            onAppendVideo={handleBeidouAppendVideo}
            onAutoHeal={handleBeidouAutoHeal}
            launchBusy={beidouBusy}
            toast={beidouToast}
            cases={beidouCases}
            tabs={CONSOLE_TABS}
            onTab={setConsoleTab}
            focusCaseId={focusCaseId}
            starsOpen={starsOpen}
            onToggleStars={() => setStarsOpen((v) => !v)}
            onOpenCase={(id) => {
              setFocusCaseId(id);
              setConsoleTab("cockpit");
            }}
          />
          </div>
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
            mainGlass={mainGlass}
            onMainGlass={handleMainGlass}
          />
        </div>
      </div>
    </div>
  );
}
