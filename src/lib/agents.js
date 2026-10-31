import { AGENT_ORDER } from "./agentMeta.js";



export function visibleAgentId(agentId) {
  return agentId === "kimiwork" ? "kimi" : agentId;
}

export function normalizeVisibleAgentList(agentIds) {
  return [...new Set(agentIds.map(visibleAgentId))].filter((id) =>
    AGENT_ORDER.includes(id),
  );
}

/// 用户在设置里排出的顺序优先，其余按注册表顺序垫后。设置面板、小组件、
/// 完整视图侧栏共用这一份顺序，改一处四处同步。
export function agentIdsInDisplayOrder(preferred) {
  return [...preferred, ...AGENT_ORDER.filter((agentId) => !preferred.includes(agentId))];
}
// 胶囊条首帧尺寸估计：一格只有图标 + 百分比两层，横条约 54px 宽、竖条约
// 46px 高。
// 这些常量只用于进入 strip 的第一帧，之后的窗口尺寸由 StripBar 里的
// 内容测量观察器按真实渲染结果收敛——不同字体/DPI/缩放比例、有无更新点
// 都不会再裁掉内容（曾因常量与 CSS 脱钩裁掉竖条最后一个按钮）。

export const STAR_NAME_FALLBACK = {
  tianshu: "天枢", tianxuan: "天璇", tianji: "天玑", tianquan: "天权",
  yuheng: "玉衡", kaiyang: "开阳", yaoguang: "摇光", main: "客星",
};
export function starNameOf(agentId) {
  const key = String(agentId || "main");
  return STAR_NAME_FALLBACK[key] ?? key;
}
// 用户语言的类型词：巡检简报 / 巡检 / Memory / 定时 / 任务 / 接力。
