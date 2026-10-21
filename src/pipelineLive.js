// 流水线的纯逻辑（无 JSX，供 node 测试直接 import）。
//
// 两个约定集中在这里，改动只改一处：
//   ① STAGE_COLS —— 七列的定义与顺序（天权在链上占两列：审题 / 审稿）；
//   ② liveColumnsOf —— 「哪一列此刻在跑」的判据。
//
// 为什么单拎出来：判据曾经按**星**算（liveStars.has(star)），天权一跑
// 审题、审稿两块列头一起呼吸，看上去像两处在同时交接（Leo 2026-10-21）。
// 真判据是「案子此刻停在哪一列」——按列算，两案分别停在天权两列时，
// 两列各亮各的才对。

/// 下标推导（index < step 即该步已交付），不新造状态、不猜时间。
export const STAGE_COLS = [
  { key: "tianshu", star: "tianshu", label: "建档", done: "已建档", role: "建档 · 巡检" },
  { key: "tianxuan", star: "tianxuan", label: "研究中", done: "已定题", role: "趋势 · 选题" },
  { key: "tianquan", star: "tianquan", label: "审题中", done: "已过审", role: "审题门禁" },
  { key: "tianji", star: "tianji", label: "创作中", done: "母稿已交", role: "母稿创作" },
  { key: "tianquan2", star: "tianquan", label: "审稿中", done: "已过稿", role: "审稿门禁", gate: true },
  { key: "par", star: "par", label: "视觉/视频", done: "已交付", role: "图文 // 视频", parallel: true },
  { key: "yaoguang", star: "yaoguang", label: "运营关单", done: "已关单", role: "分发 · 关单" },
];

/// 这一列的星是否在跑（并行列入线看玉衡/开阳任意一股）。
export function starLiveOf(col, liveStars) {
  if (!col) return false;
  return col.parallel
    ? liveStars.has("yuheng") || liveStars.has("kaiyang")
    : liveStars.has(col.star);
}

/// 按列判活：返回在跑的列下标集合。
/// 只有「某案停在某列」且「该列的星在跑」才算——按星判会让天权两列一起亮。
export function liveColumnsOf(cases = [], liveStars = new Set(), cols = STAGE_COLS) {
  const out = new Set();
  for (const item of cases) {
    const idx = Number(item?.step);
    if (!Number.isInteger(idx)) continue;
    const col = cols[idx];
    if (!col) continue;
    if (starLiveOf(col, liveStars)) out.add(idx);
  }
  return out;
}

/// 列头轴线（两粒星之间那一段）用的「最靠前的在跑列」。多案并行时取最小，
/// 与「全线只亮一处跑马灯」的约定一致；全线空闲是 -1（不是 Infinity——
/// `index < Infinity` 恒真，会把 7 段全画成"已完成"）。
export function liveIndex(liveCols) {
  return liveCols && liveCols.size ? Math.min(...liveCols) : -1;
}

/// 段卡名 → 列（与 SOP 11.1 的段名枚举一字不差，别造短别名）。
/// 天枢没有段卡（接单/巡检不算段），返回空数组。
/// 放纯模块里，测试能盯住"列头徽标别把天权的两列混在一起"。
export const WB_SEG_OF_COL = {
  tianxuan: ["02-选题"],
  tianquan: ["03-初审"],
  tianji: ["04-母稿"],
  tianquan2: ["05-二审"],
  par: ["06-出图", "06-视频"],
  yaoguang: ["07-运营"],
};

export function wbSegsOfCol(col) {
  return WB_SEG_OF_COL[col?.key] ?? [];
}

/// 列头徽标文案（null = 不挂）。
/// Leo 2026-10-21 17:01 的两问都在这条规则里：
///   ①「为什么案子都到后面了，前面还显示在跑」→ 只有这一列真有人做（live）才挂；
///   ②「为什么是 1 卡，难不成一个 agent 有很多卡」→ 单位改成"案"；一个星位名下
///     确实可能压多张卡（天权审题/审稿各一张，不同案停同一步也会有多张），
///     但界面上报的是"有 n 个案子的卡停在这一站"，不是"这个 agent 有 n 张卡"。
export function wbBadgeText(n, live) {
  if (!live || !n) return null;
  return `${n} 案在跑`;
}

/// 段卡名 → 列下标（"03-初审" → 2）。不认识的段返回 -1。
export function segIndexOf(seg) {
  const key = String(seg ?? "").trim();
  if (!key) return -1;
  for (let i = 0; i < STAGE_COLS.length; i += 1) {
    if (wbSegsOfCol(STAGE_COLS[i]).includes(key)) return i;
  }
  return -1;
}

/// 工单（workboard 段卡）反推「每案推进到哪一列」，返回 caseId → 列下标。
/// 为什么需要它：本地账本（beidou_cases）的阶段是**会话收尾时 harvest** 的，
/// 案子还在跑的时候账本停在上一站 —— 2026-10-21 BM-2607 就是这样：
/// 工单已经 07-运营 在跑，账本还写着 06_出图，深潜舱里玉衡那格就一直是
/// 「出图中」、天权那格一直是「审稿中」（Leo 17:28 截图直问「玉衡开阳都
/// 没活跃了，底下还有审稿中、出图中」）。工单是 60 秒一拍的实时状态，
/// 拿它给账本的 step 兜底：只往上抬（done / running 的段），不往回压。
export function wbStepByCase(cards = []) {
  const out = new Map();
  for (const card of cards) {
    if (!card || card.role !== "segment") continue;
    if (card.status !== "done" && card.status !== "running") continue;
    const caseId = card.caseId;
    if (!caseId) continue;
    const idx = segIndexOf(card.seg);
    if (idx < 0) continue;
    if (idx > (out.get(caseId) ?? -1)) out.set(caseId, idx);
  }
  return out;
}

/// 案号里的序号（BM-2609 → 2609），用于「新案在上」排序；认不出返回 -1。
export function caseSeqOf(caseId) {
  const m = String(caseId ?? "").match(/(\d{3,6})/);
  return m ? Number(m[1]) : -1;
}

/// 泳道排序：新案在上、旧案依次往下（Leo 2026-10-21 23:36 定的口径）。
/// 不用 updatedAt 排——旧案被 watchdog 纠偏一次就会跳到最上面，看着像新案。
export function sortCasesNewest(cases = []) {
  return [...cases].sort((a, b) => {
    const d = caseSeqOf(b?.caseId) - caseSeqOf(a?.caseId);
    if (d !== 0) return d;
    return String(b?.caseId ?? "").localeCompare(String(a?.caseId ?? ""));
  });
}

/// 任务名回退：账本 title 只落了案号时（harvest 只认 [CASE_ID] 标签，读不到
/// 飞书里的任务名），用工单父卡标题补——父卡标题形如「BM-2609 衣柜换季收纳」。
export function nameOfCase(item, wbTitle) {
  const name = String(item?.name ?? "").trim();
  const caseId = String(item?.caseId ?? "").trim();
  if (name && name !== caseId) return name;
  const fromCard = String(wbTitle ?? "").replace(/^BM-\d{3,6}\s*/i, "").trim();
  return fromCard || name || "未命名案件";
}
