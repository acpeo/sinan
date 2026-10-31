


export function formatTaskAge(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return "刚刚";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

/// 紧凑 token 数：154174 → "154k"、525000 → "525k"、2.4M → "2.40M"。
export function formatCompactTokens(n) {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

export function formatTaskDuration(startedMs, endedMs) {
  if (!Number.isFinite(startedMs) || startedMs <= 0) return null;
  const endMs = Number.isFinite(endedMs) && endedMs > 0 ? endedMs : Date.now();
  const seconds = Math.max(0, Math.floor((endMs - startedMs) / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分 ${seconds % 60} 秒`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}

/// 链路里的紧凑时长："4 分 0 秒"→"4分"；胶片条和时间线共用，别再复制 replace 链。
export function formatCompactDuration(startedMs, endedMs) {
  return (formatTaskDuration(startedMs, endedMs) || "")
    .replace(/ /g, "")
    .replace(/0秒$/, "")
    .replace(/0分$/, "");
}



/// 历史轮次的时间标签：今天/昨天带时刻，更早带日期。
export function formatHistoryTime(ms, now = Date.now()) {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const date = new Date(ms);
  const time = date.toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" });
  if (new Date(now).toDateString() === date.toDateString()) return `今天 ${time}`;
  if (new Date(now - 86_400_000).toDateString() === date.toDateString()) return `昨天 ${time}`;
  return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
}

/// 历史轮次窗口的人话单位（分钟 → 分钟/小时/天）。
export function formatHistoryWindow(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return "已关闭";
  if (minutes < 60) return `${minutes} 分钟`;
  if (minutes < 1440) return `${Math.round((minutes / 60) * 10) / 10} 小时`;
  return `${Math.round((minutes / 1440) * 10) / 10} 天`;
}

/// 定时任务看板的下次运行倒计时（六案③）。
export function formatCronNext(nextMs, now = Date.now()) {
  if (!Number.isFinite(nextMs)) return null;
  const diff = nextMs - now;
  if (diff <= 0) return "即将运行";
  const min = Math.round(diff / 60_000);
  if (min < 1) return "1 分钟内";
  if (min < 60) return `${min} 分钟后`;
  const hours = Math.round((min / 60) * 10) / 10;
  if (hours < 24) return `${hours} 小时后`;
  return `${Math.round((hours / 24) * 10) / 10} 天后`;
}

// ============ 任务台 v5：斗形星盘 + 值班区 + 动态流（2026-10-05 设计评审定稿） ============
// 设计契约：北斗=连续折线（枢→璇→玑→权→衡→阳→光，魁口不封，摇光坠向右下
// 指向"下一次·定时"读数块）；实心金只允许读数块时间一处；状态四色+卡左缘
// 色条；看门狗简报金边置顶；统计口径=每个数字必须指到屏上可见对象。

// 斗形坐标（552×146 视口，窗口缩放由 SVG viewBox 等比承担）。


export function dayLabelOf(ms, now) {  const d = new Date(ms);
  if (d.toDateString() === new Date(now).toDateString()) return "今天";
  if (d.toDateString() === new Date(now - 86_400_000).toDateString()) return "昨天";
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// 任务台主内容（v5）：星盘仪 → 统计行 → 值班区（在办案件/最新简报）→ 动态流。
/// 星位上下文卡（B 链路会话级用量）：小组件面板与主窗任务台共用。
/// variant = panel（小组件内的 tasks-card 皮）| board（主窗 v7card 皮）。
/// 行渲染从小组件原样搬入（水位/预算/条数/群主角标/预警一个口径）。
