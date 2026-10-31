


/// 任务行首的状态色竖条：与 Agent 行的彩色边条同一语言（绿=跑，红=败，灰=终态）。
export function taskAccentClass(status) {
  if (status === "running") return "widget-task-accent--running";
  if (status === "queued") return "widget-task-accent--queued";
  if (status === "failed" || status === "timed_out" || status === "lost") return "widget-task-accent--failed";
  return "widget-task-accent--ended";
}

/// 把快照里的活跃标记整体拆掉（2026-10-23）。
/// 用于「这一拍没连上网关」的情形：断连时的 hasActiveRun 只是历史残留，
/// 拿它点灯会让顶栏写「未连接」而星位写「正在执行」，自相矛盾。
export function defuseSnapshotActivity(snap) {
  if (!snap || !Array.isArray(snap.sessions)) return snap;
  return {
    ...snap,
    sessions: snap.sessions.map((s) => (s?.hasActiveRun ? { ...s, hasActiveRun: false } : s)),
  };
}

/// 任务追踪小组件：独立常驻小窗（与主窗完全分离，托盘/设置可显隐）。
/// 外壳与桌面小组件同一套玻璃 token（原项目视觉），
/// 内容 = 实时指示 + 运行中/近期任务 + 活跃 Agent 星位 + 底栏（完整视图 / 关闭）。


// ============ 任务台 v5：斗形星盘 + 值班区 + 动态流（2026-10-05 设计评审定稿） ============
// 设计契约：北斗=连续折线（枢→璇→玑→权→衡→阳→光，魁口不封，摇光坠向右下
// 指向"下一次·定时"读数块）；实心金只允许读数块时间一处；状态四色+卡左缘
// 色条；看门狗简报金边置顶；统计口径=每个数字必须指到屏上可见对象。

// 斗形坐标（552×146 视口，窗口缩放由 SVG viewBox 等比承担）。
export const DIAL_CHAIN = [
  ["tianshu", 58, 30], ["tianxuan", 54, 92], ["tianji", 140, 104],
  ["tianquan", 166, 62], ["yuheng", 232, 50], ["kaiyang", 286, 42], ["yaoguang", 352, 90],
];
export const DIAL_HUB = { x: 104, y: 70 };
export const DIAL_TONE = { live: "#3DD68C", fail: "#F26D6D", done: "#4E9DB8", cancel: "#4A5568", idle: "#4A5568" };
export const TONE_LABEL = { live: "运行中", fail: "有失败", done: "已完成", cancel: "已取消", idle: "空闲" };
// 事件流水的"已完成"墨色：中性灰（不抢眼）。星盘/卡片上的收班色 DIAL_TONE.done
// 是青蓝、语义不变，只有流水这一行换灰——两处语义不同，别混。
export const LOG_DONE_INK = "#4A5568";
// 事件流水默认上屏行数（Leo 2026-10-13："这太长太多了"）。一段接力只出一行
// 之后，行数从一夜几十降到"一段一行"，24 行约覆盖两天的活跃密度；更早的收进
// "展开全部"——要看史册时点一下，平时流水只管当下出了什么事。
export const LOG_ROW_BUDGET = 24;
