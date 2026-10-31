

// 任务小组件竖条悬停详情卡：展开窗 = 42 胶卷 + 卡片宽 + 间隙；卡片高度为
// 估算值（布局 helper 只用它做贴边居中钳制，实际高度由内容决定）。
export const TASKS_HOPCARD_WIDTH = 224;
export const TASKS_HOPCARD_HEIGHT = 168;
// 6px = 卡与"条的可视表面"的日照间隙（锚面不锚格，壳内边距不再吃掉间距）。
// 横竖同一值——Leo 2026-10-04 二轮反馈：锚面修正后 12px 偏大、6px 正好。
export const TASKS_HOPCARD_GAP = 6;
export const TASKS_HOVER_LEAVE_DELAY = 260;
// 星卡伴随窗（tasks-hopcard）竖条承载高：固定值+内容盒垂直居中——窗口
// 尺寸与内容解耦，悬停全程零 resize。内容超过承载高时卡内自滚动兜底。
export const HOP_CARD_WINDOW_HEIGHT = 460;
// 横条承载高 = 估计盒高 + 富余：盒按 side 钳到窗的贴条缘，估计偏小由
// 富余兜住，卡窗实测高回传（hopcard://height）下一拍校准。
export const HOP_CARD_HEIGHT_SLACK = 72;
