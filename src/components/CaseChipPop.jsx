import { sessionErrorText, toolProgressLabel } from "../lib/taskChains.js";
import { starNameOf } from "../lib/agents.js";
import { formatCompactDuration, formatHistoryTime, formatTaskDuration } from "../lib/format.js";


/// 案卡折叠芯片的悬停明细（v7.2）：运行中=实时卡（任务/已跑/最近动作/本轮），
/// 收班=该星那几跳的列表（时刻/时长/结论首行）。绝对定位挂在案卡左上，
/// 不挤压芯片行。
export function CaseChipPop({ seg, now }) {
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

