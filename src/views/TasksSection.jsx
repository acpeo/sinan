import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isTauriRuntime, loadAgentsSnapshot, loadCronJobs, loadGatewayTasks, loadMonitorConfig, loadSessionRuns, loadWorkboardCards, refreshCronJobs, syncWorkboardCards } from "../lib/taskClient.js";
import { activeRelayEpisodes, buildAgentNameMap, canonicalAgentId, cronNextAtOf, cronScheduleTextOf, defuseStaleSnapshotActivity, gatewayFailureText, gatewayResultsAllOk, groupSessionEpisodes, hopToneOf, isActiveTask, listIdleSessions, listOrphanRuns, selectUsageSessions } from "../lib/taskChains.js";
import { CaseArchive } from "./CaseArchive.jsx";
import { PREVIEW_EAGER } from "../lib/preview.js";
import { withInvokeTimeout } from "../lib/rpc.js";
import { formatCronNext, formatHistoryTime } from "../lib/format.js";
import { jobDisplayName } from "../lib/taskFeed.js";
import { PipelineTelemetry } from "./PipelineTelemetry.jsx";
import { TasksBoard } from "./TasksBoard.jsx";
import { starNameOf } from "../lib/agents.js";


export function TasksSection({
  gateways,
  onGatewaysChanged,
  tab = "tasks",
  onStatus,
  onLaunch,
  onAppendVideo,
  onAutoHeal,
  launchBusy,
  toast,
  cases,
  tabs,
  onTab,
  onOpenCase,
  focusCaseId,
  starsOpen,
  onToggleStars,
}) {
  const [state, setState] = useState({ status: "loading", filter: "all", data: null });
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [lastSync, setLastSync] = useState(null);
  const [live, setLive] = useState(false);
  const [agentsSnap, setAgentsSnap] = useState(null);
  const [monitor, setMonitor] = useState(() => loadMonitorConfig());
  // 历史轮次（主窗"任务"页）：台账里的会话 run 按 gap 链分段回看；
  // expandedEpisode = 展开跳序回放的轮次下标（null = 全部收起）。
  const [sessionRuns, setSessionRuns] = useState([]);
  // Workboard 卡片镜像（Phase 2）：北斗父卡/段卡本地镜像，随任务页同拍刷新。
  const [workboardCards, setWorkboardCards] = useState([]);
  // 轻量工单同步（2026-10-22 Leo 拍板）：只拉 workboard.cards.list，20 秒一拍，
  // 不再等重快照。此前工单镜像夹在审计/聊天那条重循环里，实测 185 秒才更新一次，
  // 主窗比小组件慢半拍（小组件读会话实时，主窗读镜像）。
  useEffect(() => {
    if (!isTauriRuntime()) return undefined;
    const list = typeof gateways === "undefined" ? [] : gateways;
    if (!list.length) return undefined;
    let alive = true;
    const pull = async () => {
      try {
        await syncWorkboardCards(list);
        const data = await loadWorkboardCards();
        if (alive) setWorkboardCards(data.cards ?? []);
      } catch {
        /* 轻同步失败不打扰用户，下一拍再试 */
      }
    };
    pull();
    const timer = window.setInterval(pull, 20_000);
    // 窗口回前台立刻补一拍（后台定时器会被降频，2026-10-22 实拍）。
    const onFocus = () => pull();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Array.isArray(gateways) ? gateways.map((g) => g.label).join("|") : ""]);
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
  // 星盘活跃星集：与胶囊灯牌、星位上下文同源同拍（都读快照 hasActiveRun，
  // 且都先过新鲜度闸）。快照里这颗星有活跃会话就点亮——账本 running 行
  // 要等会话收行才写，短活儿整段抓不到，只认账本盘面永远不亮。
  const boardLiveActiveIds = useMemo(() => {
    const ids = new Set();
    // 第一路：快照（与胶囊灯牌、星位上下文同源同拍，都过新鲜度闸）。
    for (const session of boardAgentsFresh?.sessions ?? []) {
      // 巡检（cron/isolated）不算星位在跑：watchdog 每 5 分钟一轮、每轮小几分钟，
      // 算进去天枢就永久呼吸（Leo 2026-10-21 指着列头问"天枢怎么一直在执行中"）。
      // 天枢真正的接单/关单跑在群会话上，不受此影响。
      if (String(session?.key ?? "").includes(":cron:")) continue;
      if (session?.hasActiveRun && session.agentId) ids.add(canonicalAgentId(session.agentId));
    }
    // 第二路：账本兜底（Leo 2026-10-11 实锤"有星在活跃，星位却没动作"）。
    // 快照的 hasActiveRun 对群聊 run 大部分时间为 false，审计补的活跃还要
    // sessionKey 在 sessions.list 里对得上才认——两条路都可能缺证据，于是
    // 盘面把正在干活的星按收班渲染（静默的蓝点、没有呼吸、没有任何动作）。
    // 账本里"还在跑且近期露过面"的 run 行是第三路证据，取并集：任何一路
    // 说在跑，星位就动。僵尸行（久无动静已判死）不算活跃。
    const zombieMs = Math.max(60, monitor.zombieThresholdSec) * 1000;
    const seen = Date.now();
    for (const run of sessionRuns) {
      if (!run || (run.status !== "running" && run.status !== "queued")) continue;
      // 同上：cron 巡检 run 不是星位在干活。
      if (String(run.sessionKey ?? "").includes(":cron:")) continue;
      const at = Number.isFinite(run.lastSeenMs) ? run.lastSeenMs : 0;
      if (at > 0 && seen - at > zombieMs) continue;
      const id = canonicalAgentId(run.agentId);
      if (id) ids.add(id);
    }
    return ids;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardAgentsFresh, sessionRuns, monitor.zombieThresholdSec]);
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

  // 星盘专用轮次：historyEpisodes 是"历史回看"，明确排除了还在跑的轮次
  // （latest.status !== "running"）——那份口径留给回看是对的，但星盘拿它
  // 就会"有星在干活、盘面却是上一次收班"。这里另起一份放行运行中轮次，
  // 只喂 buildStarState（副行/点亮），不进动态流卡片。
  const dialEpisodes = useMemo(() => {
    if (!sessionRuns.length) return [];
    // 不跟"历史回看窗口"绑定：那个开关是给动态流回看用的，设 0（关闭）不该
    // 让星盘连正在跑的轮次都拿不到。星盘只按 gap 分段，一律放行运行中轮次。
    return groupSessionEpisodes(sessionRuns, Math.max(5, monitor.episodeGapMin) * 60_000);
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

  // 幽灵运行（Leo 2026-10-20 实况实锤）：automation_run 行的 sourceId 是
  // cron job UUID。有运行记录但 job 不在 cron 列表里 = 任务被删了、记录还
  // 在。真机今晨三个天枢巡检 job（976b3a7a/bb855423/f6bfc785）被删后，
  // BM-2603/BM-2604 静默停滞 11 小时——没有任何东西巡拉它们关单，
  // 而「定时任务」页一片安静，看着像"没有待办"。钩子在早退返回之前。
  const orphanRuns = useMemo(
    () => listOrphanRuns(cronTasks, cronJobs),
    [cronJobs, cronTasks],
  );
  // Leo 2026-10-20 17:20：这个告警块默认折叠。真机上 11 条里有 9 条是
  // 10-13/10-18 的历史删除——每次都摊满半屏，看久了就变成"墙纸"，
  // 真出事那天反而没人看。折叠成一行，点开才看清单。
  const [orphanOpen, setOrphanOpen] = useState(false);

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

  // 实时监控循环：默认 3 秒一拍（间隔可在设置 → 任务追踪里调整）。Tauri 下
  // 每拍拉星位快照（真正连网关、写账本的链路），再读账本刷新视图；浏览器
  // 演示模式只读演示数据。页面隐藏时暂停。
  useEffect(() => {
    let alive = true;
    load(stateRef.current.filter);
    const tick = async () => {
      if (!alive || (!PREVIEW_EAGER && document.visibilityState === "hidden")) return;
      const filter = stateRef.current.filter;
      // 连接灯与胶囊同源：星位快照的分网关成败（空壳任务快照已摘）。
      if (gateways.length) {
        loadAgentsSnapshot(gateways)
          .then((snap) => {
            if (!alive) return;
            setAgentsSnap(snap);
            const failures = (snap?.results ?? []).filter((entry) => !entry.ok);
            setLive(gatewayResultsAllOk(snap?.results));
            setFeedback(
              failures.length
                ? { tone: "error", message: gatewayFailureText(snap?.results) }
                : null,
            );
          })
          .catch(() => {
            if (alive) setLive(false);
          });
      } else {
        setLive(false);
      }
      load(filter);
      // 历史轮次同拍刷新：台账只读（不触发网关轮询），与任务列表同一节奏。
      loadSessionRuns()
        .then((data) => alive && setSessionRuns(data.runs ?? []))
        .catch(() => {});
      // Workboard 卡片同拍刷新：只读本地镜像（联网同步在 Rust 侧节流）。
      loadWorkboardCards()
        .then((data) => alive && setWorkboardCards(data.cards ?? []))
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
      // 手动同步 = 真动作：星位快照（force 绕过两窗合并缓存）+ 定时镜像
      // 各真连一次，然后读回本地账本——不再说"已拉取任务台账"空话。
      const [agentsSnap, cronResult] = await Promise.all([
        withInvokeTimeout(loadAgentsSnapshot(gateways, { force: true })),
        withInvokeTimeout(refreshCronJobs(gateways, { force: true })),
      ]);
      setAgentsSnap(agentsSnap);
      const failures = [
        ...(agentsSnap?.results ?? []),
        ...(cronResult?.results ?? []),
      ].filter((entry) => !entry.ok);
      if (failures.length) {
        setFeedback({
          tone: "error",
          message: gatewayFailureText([
            ...(agentsSnap?.results ?? []),
            ...(cronResult?.results ?? []),
          ]),
        });
      } else {
        setFeedback({ tone: "success", message: `已从 ${gateways.length} 个 Gateway 拉取星位快照与定时任务。` });
      }
      load(state.filter);
      loadCronJobs()
        .then((data) => setCronJobs(data.jobs ?? []))
        .catch(() => {});
      onGatewaysChanged?.();
    } catch {
      setFeedback({ tone: "error", message: "网关响应超时，稍后自动重试。" });
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
  // activeRuns 先过僵尸阈值，与星位灯（boardLiveActiveIds）同口径：久无
  // 动静的 running 行两处都不认。真机 BM-2601 实锤：watchdog 的 cron 会话
  // job 已删、57 分钟无动静却让「进行中 1」常亮——同一份数据两套结论，
  // 统计必须跟灯牌走。queued 也算在跑（与灯牌同口径），lastSeenMs 缺失
  // 或为 0 时放行（没观测到的不冤枉）。
  const relayZombieMs = Math.max(60, monitor.zombieThresholdSec) * 1000;
  const liveRunningRuns = sessionRuns.filter((run) => {
    if (!run || (run.status !== "running" && run.status !== "queued")) return false;
    const at = Number.isFinite(run.lastSeenMs) ? run.lastSeenMs : 0;
    if (at > 0 && now - at > relayZombieMs) return false;
    return true;
  });
  const relayEpisodes = activeRelayEpisodes(
    sessionRuns,
    liveRunningRuns,
    Math.max(5, monitor.episodeGapMin) * 60_000,
  );

  const showTasks = tab === "tasks";
  const showCron = tab === "cron";
  // 指挥舱（星位流水线）与任务/定时两页共用 TasksSection 的轮询产物——
  // 遥测、定时镜像、活跃星集都是同一份快照，各页各渲染，不重复握手。
  const showPipeline = tab === "cockpit";
  const showCases = tab === "cases";
  return (
    <main className="tasks-section tasks-section--flush">
      {showCases ? <CaseArchive cases={cases ?? []} onOpenCase={onOpenCase} /> : null}
      {showTasks && feedback && (
        <p className={feedback.tone === "error" ? "tasks-feedback tasks-feedback--error" : "tasks-feedback tasks-feedback--success"}>
          {feedback.message}
        </p>
      )}
      {showTasks && data?.demo && (
        <p className="tasks-feedback">浏览器预览：展示演示数据；Tauri 桌面端读取真实任务账本。</p>
      )}
      {showTasks && data?.loadError && <p className="tasks-feedback tasks-feedback--error">{data.loadError}</p>}

      {/* 指挥舱的星位遥测源：与任务页同一份快照（不另起轮询）。 */}
      {showPipeline ? (
        <PipelineTelemetry
          agentsSnap={boardAgentsFresh}
          sessionRuns={sessionRuns}
          workboardCards={workboardCards}
          liveActiveIds={boardLiveActiveIds}
          live={live}
          onRefresh={handleRefresh}
          busy={busy}
          onLaunch={onLaunch}
          onAppendVideo={onAppendVideo}
          onAutoHeal={onAutoHeal}
          launchBusy={launchBusy}
          toast={toast}
          cases={cases}
          tabs={tabs}
          activeTab={tab}
          onTab={onTab}
          focusCaseId={focusCaseId}
          starsOpen={starsOpen}
          onToggleStars={onToggleStars}
        />
      ) : null}

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
          liveActiveIds={boardLiveActiveIds}
          dialEpisodes={dialEpisodes}
        />
      )}
      {showCron && orphanRuns.length > 0 && (
        <div className={`cron-orphans${orphanOpen ? "" : " cron-orphans--collapsed"}`} role="note">
          <button
            type="button"
            className="cron-orphans-toggle"
            aria-expanded={orphanOpen}
            onClick={() => setOrphanOpen((open) => !open)}
          >
            <b>{orphanRuns.length} 个任务已从定时列表删除，账本里还留着运行记录</b>
            <span className="cron-orphans-hint">
              最新一次 {formatHistoryTime(orphanRuns[0]?.at, now)} · {orphanOpen ? "收起" : "展开看清单"}
            </span>
          </button>
          {orphanOpen && (
            <>
              <span>
                被删的任务不会再生效；若其中是巡检/看门狗，流水线停滞时没有任何东西会推它——需要回网关恢复。
              </span>
              <ul>
                {orphanRuns.slice(0, 5).map((orphan) => (
                  <li key={orphan.sourceId}>
                    <em>{starNameOf(orphan.agentId) || orphan.agentId || "未知星位"}</em>
                    <span>
                      {orphan.runs} 次运行 · 最新 {formatHistoryTime(orphan.at, now)}
                    </span>
                  </li>
                ))}
                {orphanRuns.length > 5 && <li className="cron-orphans-more">另有 {orphanRuns.length - 5} 个</li>}
              </ul>
            </>
          )}
        </div>
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

/// 指挥舱（星位流水线）的遥测适配：把 TasksSection 的同一份快照折成
/// PipelineView 要的四样东西——每颗星的模型/上下文/最近一次 run 用时、
/// 此刻哪些星在跑、连接灯三态、定时镜像。
///
/// 单独一个组件而不是塞进 TasksSection 的返回里：TasksSection 的钩子顺序
/// 是硬约束（loading 早退时少跑钩子 React 就崩），往里塞条件渲染容易踩雷；
/// 而且指挥舱与任务页是互斥的两个 tab，拆开各自读同一份 props 更清楚。
