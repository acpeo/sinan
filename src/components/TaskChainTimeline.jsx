import { agentDisplayName, hopGlyphOf, hopToneOf, toolProgressLabel } from "../lib/taskChains.js";
import { formatCompactDuration } from "../lib/format.js";


/// 竖直链路时间线（展开卡）：一跳一行 = 状态符 + 星名 + 该跳任务 + 耗时，
/// 当前跳行下挂任务进度原话。排队跳天然在列，任务列表里不再重复占行。
export function TaskChainTimeline({ hops, currentTaskId, agentNameMap, translate = true }) {
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
            {!current && <span className="task-timeline-title">{hop.displayTitle || hop.title || hop.taskId}</span>}
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
