


export const TASK_STATUS_META = {
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



export function TaskStatusPill({ status }) {
  const meta = TASK_STATUS_META[status] || { label: status || "未知", className: "task-pill--neutral" };
  return <span className={`task-pill ${meta.className}`}>{meta.label}</span>;
}

/// 任务链路 stepper：链上每跳 = agent 名 + 状态符（✓ 完成 / ● 进行中 / ○ 待跑），
/// 完成跳带耗时。单跳不成链不渲染——没有链路信息的行保持干净。
/// 链从 runId 分组与 childSessionKey→sessionKey 父子边拼出（见 taskChains.js）。
/// 跑马灯链路胶卷：当前执行 agent 恒定居中，链条两侧延伸出屏，
/// 滚轮左右滑看前后跳（用户点名交互）。数据变化时重新居中，手动滚后尊重用户
/// 位置直到下一次数据变化。边缘渐隐提示还有内容。
