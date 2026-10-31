import { useState } from "react";
import { loadMonitorConfig } from "../lib/taskClient.js";
import { ESTIMATE_STALE_MS, agentDisplayName, contextEstimateAge } from "../lib/taskChains.js";
import { formatCompactTokens, formatTaskAge } from "../lib/format.js";


// 任务台主内容（v5）：星盘仪 → 统计行 → 值班区（在办案件/最新简报）→ 动态流。
/// 星位上下文卡（B 链路会话级用量）：小组件面板与主窗任务台共用。
/// variant = panel（小组件内的 tasks-card 皮）| board（主窗 v7card 皮）。
/// 行渲染从小组件原样搬入（水位/预算/条数/群主角标/预警一个口径）。
export function TasksUsageCard({ usageSessions, idleSessions, agentNameMap, variant = "panel" }) {
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
    // 水位估算的年龄：数字是上一次 run 的快照，不标时间就会把陈条当实时
    // （Leo 2026-10-20 审计：客星 23k 十一天没动、天权 207k 来自 10 小时前）。
    const estimateAt = Number.isFinite(session.estimatedAtMs) ? session.estimatedAtMs : null;
    const estimateAge = estimateAt != null ? contextEstimateAge(estimateAt) : "";
    const estimateStale = estimateAt != null && Date.now() - estimateAt >= ESTIMATE_STALE_MS;
    const badge = session.isGroup ? "群" : (session.key ?? "").endsWith(":main") ? "主" : null;
    return (
      <div
        key={session.key}
        className={`tasks-usage-row${dimmed ? " tasks-usage-row--idle" : ""}`}
        title={`${session.key}${model ? `
模型 ${model}` : ""}
${estimate != null ? `上下文 ${estimate.toLocaleString()} tok` : starting ? "运行中，上下文尚未产出" : "空闲会话，无上下文估算"}${budget != null ? ` · 预算 ${budget.toLocaleString()} tok` : ""}${msgs != null ? ` · ${msgs} 条消息` : ""}${estimateAge ? ` · 水位估算于 ${estimateAge}` : ""}${lastSeen ? `
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
          {estimateStale ? (
            <small className="tasks-usage-age" title={`水位估算取样于 ${estimateAge}，此后该会话没有新 run；若期间被 reset，实际已重置`}>
              估算 {estimateAge}
            </small>
          ) : null}
        </span>
      </div>
    );
  };
  // 一个会话都没有才整块不出。只剩空闲会话时也要出卡——否则看到的是
  // 「星位上下文整个消失」，分不清是没数据还是没渲染（2026-10-19 实测：
  // 全部会话空闲时这张卡直接不显示）。
  if (!usageSessions.length && !idleSessions.length) return null;
  const onlyIdle = usageSessions.length === 0;
  // 只有空闲会话时直接摊开：卡里总得有东西看，否则等于空壳。
  const showIdleRows = showIdleSessions || onlyIdle;
  if (variant === "board") {
    return (
      <div className="v7card tasks-usage-card--board">
        <p className="v7-mhead">
          <span>星位上下文{usageModelUniform ? ` · ${usageModelUniform}` : ""}</span>
          {idleSessions.length > 0 ? (
            onlyIdle ? (
              // 全是空闲会话时行已经摊开了，再给个"点开/收起"的按钮点了没反应——
              // 这种假开关比没有更糟，写成纯文本。
              <span className="tasks-usage-idle"> · 全部 {idleSessions.length} 个会话空闲</span>
            ) : (
              <button
                type="button"
                className="tasks-usage-idle"
                aria-expanded={showIdleSessions}
                title="点开看全部空闲会话（从未对话或未产生用量）；再点收起"
                onClick={() => setShowIdleSessions((open) => !open)}
              >
                {" · 另有 "}{idleSessions.length}{" 个空闲会话"}
              </button>
            )
          ) : null}
        </p>
        <div className="tasks-usage-list">
          {usageSessions.map((session) => renderUsageRow(session, false))}
          {showIdleRows &&
            idleSessions.map((session) => renderUsageRow(session, true))}
        </div>
        {/* 口径声明（Leo 2026-10-20 审计）：cron 会话被 selectUsageSessions
            排除，但排除不是随意滤——网关的 contextBudgetStatus 根本不为
            cron 会话上报估算（实测 sessions.list 里 cron 行恒缺）。写出来，
            免得「上下文前两名（开阳/玉衡定时会话）不在卡上」被读成卡漏了。 */}
        <p className="tasks-usage-note">
          不含定时任务会话（cron）：网关不上报它们的水位估算
        </p>
      </div>
    );
  }
  return (
    <div className="tasks-card tasks-usage-card">
      <p className="tasks-card-head">
        星位上下文
        {usageModelUniform ? ` · ${usageModelUniform}` : ""}
        {idleSessions.length > 0 ? (
          onlyIdle ? (
            <span className="tasks-usage-idle"> · 全部 {idleSessions.length} 个会话空闲</span>
          ) : (
            <button
              type="button"
              className="tasks-usage-idle"
              aria-expanded={showIdleSessions}
              title="点开看全部空闲会话（从未对话或未产生用量）；再点收起"
              onClick={() => setShowIdleSessions((open) => !open)}
            >
              {" · 另有 "}{idleSessions.length}{" 个空闲会话"}
            </button>
          )
        ) : null}
      </p>
      <div className="tasks-usage-list">
        {usageSessions.map((session) => renderUsageRow(session, false))}
        {showIdleRows &&
          idleSessions.map((session) => renderUsageRow(session, true))}
      </div>
      <p className="tasks-usage-note">
        不含定时任务会话（cron）：网关不上报它们的水位估算
      </p>
    </div>
  );
}

/// 案卡折叠芯片的悬停明细（v7.2）：运行中=实时卡（任务/已跑/最近动作/本轮），
/// 收班=该星那几跳的列表（时刻/时长/结论首行）。绝对定位挂在案卡左上，
/// 不挤压芯片行。
