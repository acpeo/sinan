import { agentDisplayName, benignStateOf, hopToneOf, sessionErrorText, toolProgressLabel } from "../lib/taskChains.js";
import { useLayoutEffect, useRef } from "react";
import { formatCompactDuration, formatCronNext, formatTaskDuration } from "../lib/format.js";
import { TaskStatusPill } from "./TaskStatusPill.jsx";


/// 任务小组件悬停详情卡：跳名 + 状态徽标 + 进度摘要原话 + 星名/链路位置/耗时，
/// 底部可带"其他任务"节（首行链路之外的任务，竖条角标同一份数据）。
/// 竖条/横条两个迷你形态共用（onHopHover opt-in）。真机由独立星卡伴随窗
/// （tasks-hopcard）承载同一组件；浏览器预览走窗内 Portal（fixed 定位）。
/// pointer-events:none 纯展示，不截断胶卷的指针进出。light = 跟随胶囊浅色
/// 外观（卡片 Portal 在 body 下，壳的 glass-light 类够不到，得显式传）。
export function HopHoverCard({ hop, index, total, others, records, live, nextRun, agentNameMap, currentTaskId, light, translate = true, onHeight, style }) {
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
        r.displayTitle || r.title,
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
