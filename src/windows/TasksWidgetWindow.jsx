import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { applyExpandedPanelSize, applyMiniCapsuleSize, hideHopCardWindow, onHopCardHeight, onPanelExpand, probeHopCardWindow, restoreWindowPosition, saveTasksPanelSize, setWindowPinned, showHopCardWindow, startEdgeDock, startPositionMemory, startWindowDragging, startWindowResizing } from "../lib/windowClient";
import { isTauriRuntime, loadCronJobs, loadMonitorConfig } from "../lib/taskClient.js";
import { agentDisplayName, buildAgentNameMap, buildAgentRoster, buildCronNextByAgent, buildFleetModules, buildTaskChains, cleanSessionTitle, defuseStaleSnapshotActivity, failureClassOf, hopGlyphOf, hopToneOf, isActiveTask, listIdleSessions, selectUsageSessions, sessionErrorText, toolProgressLabel } from "../lib/taskChains.js";
import { glassShellAppearance } from "../lib/glassAppearance.js";
import { hopCardWindowPlacement, stripGestureOwner } from "../lib/windowGeometry";
import { ArrowsClockwise, ArrowsDownUp, ArrowsInLineVertical, ArrowsLeftRight, ArrowsOutSimple, CircleHalfTilt, CornersOut, DotsThree, PushPinSimple, ShieldCheck, X } from "@phosphor-icons/react";
import { createPortal } from "react-dom";
import { runWindowAction } from "../lib/windowStatus.js";
import { HOP_CARD_HEIGHT_SLACK, HOP_CARD_WINDOW_HEIGHT, TASKS_HOPCARD_GAP, TASKS_HOPCARD_HEIGHT, TASKS_HOPCARD_WIDTH, TASKS_HOVER_LEAVE_DELAY } from "../lib/hopGeometry.js";
import { IS_MAC } from "../lib/platformFlags.js";
import { ROSTER_STAR_ORDER } from "../lib/agentMeta.js";
import { jobDisplayName } from "../lib/taskFeed.js";
import { ChainFilmstrip } from "../components/ChainFilmstrip.jsx";
import { HopHoverCard } from "../components/HopHoverCard.jsx";
import { formatCompactDuration, formatTaskAge, formatTaskDuration } from "../lib/format.js";
import { TaskChainTimeline } from "../components/TaskChainTimeline.jsx";
import { TasksUsageCard } from "../components/TasksUsageCard.jsx";


/// 任务追踪小组件：独立常驻小窗（与主窗完全分离，托盘/设置可显隐）。
/// 外壳与桌面小组件同一套玻璃 token（原项目视觉），
/// 内容 = 实时指示 + 运行中/近期任务 + 活跃 Agent 星位 + 底栏（完整视图 / 关闭）。
export function TasksWidgetWindow({
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
  // 延时回调、挂靠引擎与位置记忆都要读最新折叠态，统一经 ref 取。
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;
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
  // 位置记忆接线（Leo 2026-10-12）：这一整套（startPositionMemory /
  // restoreWindowPosition / POSITION_KEYS）从 metrik 整搬过来时只搬了函数、
  // 没人点火——用户把窗拖到哪都不会被记住，重启回原位。接线照源项目的原始
  // 写法（metrik-clean App.jsx:8096/8103/8137）搬回来，不凭空发明。
  //
  // 形态拆分比源项目多一层：司南的小组件窗 = 折叠胶囊 / 展开面板共用同一个
  // tasks-widget 模式，而 POSITION_KEYS 给胶囊横竖各留了键。于是——
  //   折叠 = strip-horizontal / strip-vertical（横竖各记各的，互不覆盖）
  //   展开 = tasks-widget（面板位置单独一份）
  // 用 useLayoutEffect 且声明在尺寸副作用之前：布局副作用按声明顺序跑，这样
  // 恢复坐标排队在应用尺寸之前——源项目的注释交代得很清楚，先到位才能按最终
  // 所在显示器的 DPI 算物理尺寸，反过来 Content 会被裁。
  const positionModeOf = () => {
    if (!collapsedRef.current) return "tasks-widget";
    return miniOrientationRef.current === "vertical"
      ? "strip-vertical"
      : "strip-horizontal";
  };
  useLayoutEffect(() => {
    runWindowAction(() => restoreWindowPosition(positionModeOf()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 拖动结束后按形态记住位置（有 400ms 去抖，松手才记）。
  useEffect(() => {
    const stopPromise = startPositionMemory(positionModeOf);
    return () => {
      stopPromise.then((stop) => stop?.());
    };
  }, []);
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
            // 胶卷按方向分家（Leo 2026-10-11"细竖条就是一个显示"+
            // "上下拖动星位还可以吗"+"横条都改错了，很不容易拖动"）：竖条窄，
            // 纵向拖 = 翻看更多星位（滚内容），横向拖 = 拖窗；横条矮（36px），
            // 横向拖 = 翻链，纵向拖 = 拖窗——纵向挥一下是横条唯一顺手的起拖
            // 动作，此前却被胶卷一并认领。两个动作靠方向区分互不打架。
            // 按在胶卷之外（空白/两侧留白边）不归胶卷，任意方向都拖窗。
            const strip = event.target.closest(".tasks-mini-strip");
            const verticalStrip = Boolean(strip && strip.classList.contains("tasks-mini-strip--vertical"));
            shellDragRef.current = {
              x: event.clientX,
              y: event.clientY,
              onStrip: Boolean(strip),
              vertical: verticalStrip,
            };
          }}
          onPointerMove={(event) => {
            // OS 拖拽的模态循环可能吞掉 pointerup——首个无按键的 move 视为已松开
            if (pointerDownRef.current && (event.buttons ?? 0) === 0) pointerDownRef.current = false;
            const drag = shellDragRef.current;
            if (!drag || (event.buttons ?? 0) !== 1) return;
            const dx = Math.abs(event.clientX - drag.x);
            const dy = Math.abs(event.clientY - drag.y);
            if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 8) return;
            // 手势归属统一问 stripGestureOwner（Leo 2026-10-11）。此前横竖各写
            // 一套方向判定，5586945 只改了竖条，横条就落下了——分家必漏。现在
            // 一个判定源，横竖对称：沿条方向为主 = 胶卷翻内容（横条横向翻星位、
            // 竖条纵向翻星位），跨条方向为主 = 拖窗。
            // 按在胶卷之外（上下留白/左右留白边）不进这个分支：任意方向都拖窗。
            if (drag.onStrip) {
              const owner = stripGestureOwner({
                vertical: drag.vertical,
                dx: event.clientX - drag.x,
                dy: event.clientY - drag.y,
              });
              if (owner !== "window") return;
              if (event.target.closest(".tasks-mini-strip")?.dataset.stripDragging) return;
            }
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
  // 僵尸判死用独立的长阈值（不是星位活跃灯的 2 分钟短阈值）：北斗长跑几十分钟
// 到一小时没动静是常态，短阈值会误杀正在跑的活儿。
const zombieMs = Math.max(60, loadMonitorConfig().zombieThresholdSec) * 1000;
const fleetModules = buildFleetModules({ tasks, runs: sessionRuns, now, dayStartMs: dayStart.getTime(), staleMs: zombieMs });
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
        || (ended.zombie ? "久无动静，按收班处理" : state);
      return { text: `${hopGlyphOf(tone)}${dur ? ` ${dur}` : ""} — ${brief}`, tone, raw: brief };
    })();
    return (
      <div key={mod.agentId} className={`tasks-fleet-mod${live ? " is-live" : " is-dimmed"}`}>
        <button
          type="button"
          className="tasks-fleet-head"
          aria-expanded={open}
          onClick={() => toggleFleetModule(mod.agentId)}
          title={live ? `${name} · ${run.title || "执行中"}${stale ? " · 滞后?" : ""}` : ended ? `${name} · ${ended.title}${ended.zombie ? " · 久无动静" : ""}` : name}
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
          {/* 最小化按钮已删（Leo 2026-10-08 拍板）：常驻小窗不占任务栏，
              "最小化"没有意义——收小有折叠胶囊、离开有关闭/隐藏。 */}
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

