import { useMemo } from "react";
import { canonicalAgentId } from "../lib/taskChains.js";
import { buildLiveActionMap } from "../lib/cockpit.js";
import { PipelineView } from "./PipelineView.jsx";


/// 指挥舱（星位流水线）的遥测适配：把 TasksSection 的同一份快照折成
/// PipelineView 要的四样东西——每颗星的模型/上下文/最近一次 run 用时、
/// 此刻哪些星在跑、连接灯三态、定时镜像。
///
/// 单独一个组件而不是塞进 TasksSection 的返回里：TasksSection 的钩子顺序
/// 是硬约束（loading 早退时少跑钩子 React 就崩），往里塞条件渲染容易踩雷；
/// 而且指挥舱与任务页是互斥的两个 tab，拆开各自读同一份 props 更清楚。
export function PipelineTelemetry({
  agentsSnap,
  sessionRuns,
  workboardCards,
  liveActiveIds,
  live,
  onRefresh,
  busy,
  onLaunch,
  onAppendVideo,
  onAutoHeal,
  launchBusy,
  toast,
  cases,
  tabs,
  activeTab,
  onTab,
  focusCaseId,
  starsOpen,
  onToggleStars,
}) {
  // 每颗星的遥测：model 与上下文窗口取快照会话行；"最近一次 run 用时"
  // 取本地 session_run 账本里这颗星最新一条的起止差。两条线互补——
  // 快照是"现在什么型号、窗口多大"，账本是"上一回干了多久"。
  const telemetry = useMemo(() => {
    const out = {};
    const sessions = agentsSnap?.sessions ?? [];
    for (const session of sessions) {
      const id = canonicalAgentId(session.agentId ?? "");
      if (!id) continue;
      const budget = Number(session.contextTokenBudget ?? 0);
      // 上下文水位（已用）。网关只对跑过 run 的会话给 estimatedPromptTokens，
      // 空闲会话缺省 —— null 是"不知道"，不是 0，别画成"用了零"。
      const estimate =
        typeof session.estimatedPromptTokens === "number" &&
        Number.isFinite(session.estimatedPromptTokens)
          ? session.estimatedPromptTokens
          : null;
      // 同一颗星可能有多条会话（main / group / cron）。挑水位最大那条当代表
      // （同水位再取窗口更大）；全都没水位时退到窗口最大的那条，至少让用户
      // 看到这颗星的模型窗口——以前按字符串比 "525k" > "128k"，撞上
      // "1000k" 会选错，顺手改成数值比。
      const current = out[id];
      const better =
        !current ||
        (estimate ?? -1) > (current.estimate ?? -1) ||
        ((estimate ?? -1) === (current.estimate ?? -1) && budget > (current.budget ?? 0));
      if (better) {
        out[id] = {
          ...(current ?? {}),
          model: session.model ?? current?.model ?? "—",
          estimate,
          budget: budget > 0 ? budget : null,
          // 代表会话是群还是主：SOP 关单后清的是**群**上下文，main 会话
          // （agent 间派发通道）没人清——天权 207k 就在 main 上。浮层不标
          // 群/主，这个数会被读成"流水线群"的水位（Leo 2026-10-20 审计）。
          sessionKey: session.key,
          sessionIsGroup: Boolean(session.isGroup),
          estimatedAtMs:
            typeof session.estimatedAtMs === "number" ? session.estimatedAtMs : null,
        };
      } else if (current && !current.model && session.model) {
        current.model = session.model;
      }
    }
    // 最近一次 run 用时：账本里这颗星最新一条非空起止。
    for (const run of sessionRuns) {
      const id = canonicalAgentId(run.agentId ?? "");
      if (!id) continue;
      const start = Number(run.startedAtMs ?? 0);
      const end = Number(run.endedAtMs ?? run.lastSeenMs ?? 0);
      if (!(start > 0) || !(end > start)) continue;
      const secs = Math.round((end - start) / 1000);
      const text = secs >= 60 ? `${Math.round(secs / 60)}m` : `${secs}s`;
      const at = run.lastSeenMs ?? end;
      const current = out[id];
      if (!current || !current.lastAt || at > current.lastAt) {
        out[id] = { ...(current ?? {}), lastRun: text, lastAt: at };
      }
    }
    return out;
  }, [agentsSnap, sessionRuns]);

  // 深潜舱状态条的文案（P-3：此前 App.jsx 根本不传 liveAction，strip 恒显示
  // 「执行中」；老 CockpitView 还在用账本 live_action，新 PipelineView 把线丢了）。
  // 源 = 账本 live_action 列，按属主星归并（同星多条案留最新更新的那条）；
  // 取不到就空着，strip 有「执行中」兜底，不编一句漂亮话。
  const liveAction = useMemo(() => buildLiveActionMap(cases), [cases]);

  // 连接灯三态：live = 这一拍快照真下来了；busy = 正在拉；
  // 都不是 = 断了。title 里给一句能照着做的话，别只写"未连接"。
  const conn = useMemo(() => {
    if (busy) return { state: "retry", text: "同步中…", title: "正在拉网关快照" };
    if (live && agentsSnap) {
      const n = liveActiveIds?.size ?? 0;
      return {
        state: "ok",
        text: n > 0 ? `已连接 · ${n} 星在跑` : "已连接",
        title: `网关快照正常${n > 0 ? `，${n} 颗星有活跃 run` : "，舰队当前空闲"}`,
      };
    }
    return { state: "error", text: "未连接", title: "快照没下来：检查网关配置、token 与 Tailscale 连通性，或点此重试" };
  }, [busy, live, agentsSnap, liveActiveIds]);

  return (
    <>
      {toast ? (
        <p className={`console-beidou-toast console-beidou-toast--${toast.tone}`} role="status">
          {toast.text}
        </p>
      ) : null}
      <PipelineView
        cases={cases}
        starTelemetry={telemetry}
        liveStars={liveActiveIds ?? new Set()}
        liveAction={liveAction}
        workboardCards={workboardCards}
        conn={conn}
        onRetryConn={onRefresh}
        onLaunch={onLaunch}
        onAppendVideo={onAppendVideo}
        onAutoHeal={onAutoHeal}
        busy={launchBusy}
        tabs={tabs}
        activeTab={activeTab}
        onTab={onTab}
        focusCaseId={focusCaseId}
        starsOpen={starsOpen}
        onToggleStars={onToggleStars}
      />
    </>
  );
}

