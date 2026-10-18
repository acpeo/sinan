// 北斗七星指挥舱纯逻辑层（Leo 2026-10-14 全自动无人值守改造）。
//
// 这一层只放"能被 node --test 盯住"的推导：交付模式三态、标题尾缀剥离、
// DAG 七步拓扑的节点派生、门禁结论归一、熔断自愈判定、Watchdog 五分支。
// 组件与样式都不进这里——本地没有 cargo，Rust 侧只能靠 CI 兜，能测的逻辑
// 一律放 JS 侧钉死。

// ---------------------------------------------------------------------------
// 交付模式三态
// ---------------------------------------------------------------------------

export const DELIVERABLE_MODES = ["IMAGE_ONLY", "DUAL", "VIDEO_ONLY"];

export const DELIVERABLE_MODE_LABEL = {
  IMAGE_ONLY: { short: "图文", badge: "🖼️ 仅图文模式", icon: "🖼️", full: "仅产出图文" },
  DUAL: { short: "双出", badge: "🎬 图文+视频双出模式", icon: "🎬", full: "图文 + 视频双出" },
  VIDEO_ONLY: { short: "视频", badge: "📹 仅视频模式", icon: "📹", full: "仅产出视频" },
};

/// 归一化外部传入的模式串：大小写/别名都吃，不认识的回落仅图文（默认态）。
export function normalizeDeliverableMode(raw) {
  const t = String(raw ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (t === "DUAL" || t === "BOTH" || t === "IMAGE_VIDEO" || t === "图文+视频双出".toUpperCase()) return "DUAL";
  if (t === "VIDEO_ONLY" || t === "VIDEO" || t === "仅视频") return "VIDEO_ONLY";
  return "IMAGE_ONLY";
}

/// 入口模式：直接给标题发车 / 自主寻题巡航。
export const ENTRY_MODES = ["DIRECT_TITLE", "AUTO_DISCOVERY"];

export function normalizeEntryMode(raw) {
  const t = String(raw ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  return t === "DIRECT_TITLE" || t === "DIRECT" ? "DIRECT_TITLE" : "AUTO_DISCOVERY";
}

// ---------------------------------------------------------------------------
// 智能输入联动：标题末尾的 +视频 / 双出 / 含视频 标记词
// ---------------------------------------------------------------------------

/// 命中这些尾缀就自动切双出。要求出现在标题里（任意位置），因为人是顺手
/// 打在下半句的，不强制句尾；但正式写表时必须整段剥掉。
const DUAL_HINT = /(\+视频|双出|含视频|视频版|也要视频|加视频)/;

/// 尾缀标记词本体（含前置的连接号/空格/加号），剥的时候连符号一起吃干净，
/// 免得表里留下「标题 +」这种残渣。
const DUAL_TAIL = /[\s,，、/|+]*(\+视频|双出|含视频|视频版|也要视频|加视频)\s*$/;

/// 输入框里是否含视频诉求（驱动胶囊自动切换）。
export function textWantsDual(raw) {
  return DUAL_HINT.test(String(raw ?? ""));
}

/// 剥掉标题末尾的视频标记词，返回干净标题。
/// 空标题原样回空串——调用方据此禁用发车按钮。
export function stripDualMarker(raw) {
  let t = String(raw ?? "").trim();
  // 循环剥：人可能打「标题 +视频 双出」两连。
  let prev;
  do {
    prev = t;
    t = t.replace(DUAL_TAIL, "").trim();
  } while (t !== prev);
  // 收尾再吃一次孤立连接符，避免「标题 -」这种半截符号。
  t = t.replace(/[\s,，、/|+-]+$/, "").trim();
  return t;
}

/// 一次算清「发车参数」：正式标题 + 最终交付模式 + 是否因标记词改过模式。
/// 显式选的模式优先；输入框带标记词则强制升 DUAL（Leo 规格：末尾输入
/// +视频 自动切换双出，提交时自动剥离）。
export function parseLaunchInput(raw, pickedMode) {
  const explicit = normalizeDeliverableMode(pickedMode);
  const wantsDual = textWantsDual(raw);
  const title = stripDualMarker(raw);
  return {
    title,
    deliverableMode: wantsDual ? "DUAL" : explicit,
    /// 标记词把模式顶掉了（ picked 的是仅图文，输入里写了 +视频）
    modeOverridden: wantsDual && explicit !== "DUAL",
    /// 有没有可发车的内容
    ready: title.length > 0,
  };
}

// ---------------------------------------------------------------------------
// 七星全自动 DAG 拓扑（Leo 2026-10-14：移除 Leo 定题阻塞节点，严格 7 步）
// ---------------------------------------------------------------------------

export const DAG_STEPS = [
  { no: "01", star: "tianshu", title: "建档 · 路由", sub: "建文件夹 · 派单" },
  { no: "02", star: "tianxuan", title: "取证 · 呈题", sub: "背调 · 候选标题" },
  { no: "03", star: "tianquan", title: "初审 · 五轴定题", sub: "红线自查" },
  { no: "04", star: "tianji", title: "母稿 · 配图锚点", sub: "正文 · docx" },
  { no: "05", star: "tianquan", title: "二审 · 七轴门禁", sub: "判词 · 冻结", gate: "second" },
  { no: "06", star: "par", title: "并行生产", sub: "玉衡 // 开阳", parallel: true },
  { no: "07", star: "yaoguang", title: "多端分发 · 关单", sub: "发布 · 复盘" },
];

/// 并行位拆成的两颗星（DAG 的第 6 步）。
export const PARALLEL_BRANCHES = [
  { key: "06A", star: "yuheng", title: "视觉 · 插图 · 封面", sub: "配图锚点出图" },
  { key: "06B", star: "kaiyang", title: "脚本 · 分镜 · 视频", sub: "视频包" },
];

/// 一个案件在星轨上的位置。step 是 DAG_STEPS 下标（0..6）。
export function dagStepOfCase(step) {
  const i = Number(step);
  if (!Number.isInteger(i) || i < 0) return 0;
  if (i > DAG_STEPS.length - 1) return DAG_STEPS.length - 1;
  return i;
}

/// 分支激活态：一眼看清这一案产不产视频。
/// IMAGE_ONLY → 开阳 STANDBY（未启用虚线置灰）；DUAL → 双分支都激活。
/// 返回每颗星的状态：active | standby | done | idle。
export function branchStatesOf(caseLike) {
  const step = dagStepOfCase(caseLike?.step);
  const mode = normalizeDeliverableMode(caseLike?.deliverableMode);
  const frozen = Boolean(caseLike?.masterFrozen);
  const pastGate = step > 5; // 已过第 6 步（并行位）才算双分支跑完
  const atParallel = step === 5;
  const make = (star) => {
    if (pastGate) return "done";
    if (!atParallel) return "idle";
    return "active";
  };
  const yuheng = make("yuheng");
  let kaiyang = make("kaiyang");
  if (mode === "IMAGE_ONLY" && (atParallel || pastGate)) kaiyang = "standby";
  // 仅视频模式下玉衡反过来待命
  if (mode === "VIDEO_ONLY" && (atParallel || pastGate)) {
    kaiyang = atParallel ? "active" : "done";
    return { yuheng: atParallel ? "standby" : "done", kaiyang };
  }
  return { yuheng, kaiyang, frozen };
}

/// 双轨合流锁进度（DUAL 才有意义）：玉衡/开阳各自 doc_id 落盘几比几。
/// 返回 null = 本案不渲染合流锁（非双出或还没到并行位）。
export function mergeLockOf(caseLike) {
  if (normalizeDeliverableMode(caseLike?.deliverableMode) !== "DUAL") return null;
  const step = dagStepOfCase(caseLike?.step);
  if (step < 5) return null;
  const visual = Math.max(0, Math.min(1, Number(caseLike?.visualProgress ?? 0)));
  const video = Math.max(0, Math.min(1, Number(caseLike?.videoProgress ?? 0)));
  const done = [visual, video].filter((v) => v >= 1).length;
  return { visual, video, done, total: 2, ready: done === 2 };
}

// ---------------------------------------------------------------------------
// 门禁结论与母稿冻结（SOP 4.4：二审 PASS 后才冻结）
// ---------------------------------------------------------------------------

export const GATE_VERDICTS = ["PASS", "FAIL_MINOR", "FAIL_MAJOR", "FAIL_REWRITE", "FATAL"];

export const GATE_VERDICT_LABEL = {
  PASS: { text: "PASS", tone: "jade" },
  FAIL_MINOR: { text: "FAIL · 小改", tone: "bronze" },
  FAIL_MAJOR: { text: "FAIL · 中改", tone: "amber" },
  FAIL_REWRITE: { text: "FAIL · 重写", tone: "cinnabar" },
  FATAL: { text: "FATAL · 直接毙", tone: "cinnabar" },
};

/// 门禁结论归一。网关回什么怪形都吃，认不出的按小改处理（最安全的中间态）。
export function normalizeGateVerdict(raw) {
  const t = String(raw ?? "").trim().toUpperCase().replace(/[\s·・]+/g, "_");
  if (!t) return "FAIL_MINOR";
  if (t === "PASS" || t === "PASSED" || t === "OK" || t === "通过") return "PASS";
  if (t === "FATAL" || t === "FATAL_直接毙") return "FATAL";
  if (t.includes("REWRITE") || t.includes("重写")) return "FAIL_REWRITE";
  if (t.includes("MAJOR") || t.includes("中改")) return "FAIL_MAJOR";
  return "FAIL_MINOR";
}

export const STRIKE_LIMIT = 3;

/// 母稿只读保护徽章：只有二审 PASS 之后才允许渲染「母稿已冻结」。
/// Leo 明确返工的点——FAIL / 自愈重修期间显示"已冻结"是术语误用。
export function masterDocBadge(caseLike) {
  const verdict = normalizeGateVerdict(caseLike?.secondVerdict);
  const strikes = Math.max(0, Number(caseLike?.secondStrikes ?? 0));
  const frozen = Boolean(caseLike?.masterFrozen) && verdict === "PASS";
  if (frozen) return { kind: "frozen", icon: "🔒", text: "母稿已冻结（只读保护）", tone: "indigo" };
  if (strikes >= STRIKE_LIMIT) {
    return { kind: "autoheal", icon: "♻️", text: "天枢自愈重修中（Session已重置 · 局部重修）", tone: "amber" };
  }
  if (verdict === "PASS") return { kind: "frozen", icon: "🔒", text: "母稿已冻结（只读保护）", tone: "indigo" };
  if (verdict === "FATAL") return { kind: "rejected", icon: "⛔", text: "母稿被毙 · 待重派", tone: "cinnabar" };
  if (strikes > 0) return { kind: "strike", icon: "🔁", text: `打回重审 ${strikes}/${STRIKE_LIMIT}`, tone: "amber" };
  return { kind: "pending", icon: "⏳", text: "二审门禁进行中", tone: "slate" };
}

/// 是否触发天枢自动自愈（3/3 熔断）。全自动架构下不弹人工裁决，直接自愈。
export function isAutoHealing(caseLike) {
  return Math.max(0, Number(caseLike?.secondStrikes ?? 0)) >= STRIKE_LIMIT;
}

// ---------------------------------------------------------------------------
// 天权七轴门禁（SOP 4.3 二审标准七轴）+ 去 AI 味探针细项
// ---------------------------------------------------------------------------

export const SEVEN_AXES = [
  { key: "accuracy", label: "准确性" },
  { key: "compliance", label: "合规性" },
  { key: "humanity", label: "人味" },
  { key: "persona", label: "人设一致性" },
  { key: "spread", label: "传播性" },
  { key: "logic", label: "逻辑性" },
  { key: "readability", label: "可读性" },
];

/// 天权五轴（初审选标题与二审门禁同一套，Leo 2026-10-15 按 SOP 校准）：
/// 准确性 / 可读性 / 逻辑性 / 合规性 / 传播性。
///
/// 这里纠正过一次错：旧代码的五轴是 准确性/合规性/人味/人设一致性/传播性
/// ——「人味」「人设一致性」不是 SOP 的门禁轴，是去 AI 味探针的细项（见
/// HUMANITY_PROBES）。按旧的渲染，SOP 的真五轴里可读性与逻辑性永远显示 0，
/// 而人味/人设一致性又拿不到门禁分——Leo 一眼看出"这两行为什么是 0"。
export const FIVE_AXES = [
  { key: "accuracy", label: "准确性" },
  { key: "readability", label: "可读性" },
  { key: "logic", label: "逻辑性" },
  { key: "compliance", label: "合规性" },
  { key: "spread", label: "传播性" },
];

/// 去 AI 味探针细项：人味这一轴下面的拆解（原看板误当七轴用的那批）。
export const HUMANITY_PROBES = [
  { key: "concrete", label: "具体度" },
  { key: "rhythm", label: "节奏" },
  { key: "banned", label: "禁用词" },
  { key: "stance", label: "立场安全" },
  { key: "structure", label: "结构" },
  { key: "titleFit", label: "标题契合" },
];

/// 七轴分数归一：0..100 的整数，缺的按 0（缺轴不该显示成绿）。
export function axisScores(raw, axes = SEVEN_AXES) {
  const src = raw && typeof raw === "object" ? raw : {};
  const out = {};
  for (const axis of axes) {
    const v = Number(src[axis.key]);
    out[axis.key] = Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : 0;
  }
  return out;
}

/// 单轴色阶：>=80 青瓷绿，>=60 鎏金，<60 朱砂（门禁轴不过线要刺眼）。
export function axisTone(score) {
  if (score >= 80) return "jade";
  if (score >= 60) return "bronze";
  return "cinnabar";
}

/// 五轴总分（候选标题排名用）。
export function fiveAxisTotal(raw) {
  const s = axisScores(raw, FIVE_AXES);
  return FIVE_AXES.reduce((sum, axis) => sum + s[axis.key], 0);
}

/// 候选标题排名：总分最高的是「天权五轴钦定」。
/// 输入 [{ title, scores }]，返回带 rank/champion 的新数组（不改原对象）。
export function rankCandidateTitles(rawList) {
  const list = Array.isArray(rawList) ? rawList : [];
  const scored = list.map((item, index) => ({
    ...item,
    index,
    total: fiveAxisTotal(item?.scores),
  }));
  const best = scored.reduce((max, item) => (item.total > max ? item.total : max), -1);
  return scored
    .map((item) => ({ ...item, champion: best >= 0 && item.total === best }))
    .sort((a, b) => b.total - a.total || a.index - b.index);
}

// ---------------------------------------------------------------------------
// Watchdog 巡检：SOP 第八节五分支 + 20 分钟周期
// ---------------------------------------------------------------------------

export const WATCHDOG_BRANCHES = [
  { key: "silent", icon: "🟢", label: "无事静默", desc: "一切正常，不发一声" },
  { key: "redispatch", icon: "⚡", label: "漏派自动补发", desc: "该动的星没动，自动补派" },
  { key: "rewake", icon: "⏱️", label: "超时重唤醒", desc: "驻留超时，重发 sessions_send" },
  { key: "heal", icon: "♻️", label: "熔断自愈中", desc: "3/3 触发，重置会话局部重修" },
  { key: "closed", icon: "✅", label: "今日自动关单", desc: "跑完自删，不留僵尸任务" },
];

/// SOP 第八节：一任务一 Watchdog，每 20 分钟一轮，跑完自删。
export const WATCHDOG_PERIOD_MS = 20 * 60 * 1000;

/// 一条巡检事件 → 归到哪个分支 + 自动处置回执文案。
/// 处置回执是给人看的证据链，没有它巡检等于黑盒。
export function watchdogEventBranch(event) {
  const kind = String(event?.kind ?? "").toUpperCase();
  const map = {
    SILENT: "silent",
    REDISPATCH: "redispatch",
    MISSING_DISPATCH: "redispatch",
    REWAKE: "rewake",
    TIMEOUT: "rewake",
    STALE: "rewake",
    HEAL: "heal",
    AUTO_HEAL: "heal",
    MELTDOWN: "heal",
    CLOSED: "closed",
    AUTO_CLOSE: "closed",
  };
  const key = map[kind] ?? "silent";
  const branch = WATCHDOG_BRANCHES.find((b) => b.key === key) ?? WATCHDOG_BRANCHES[0];
  const receipt = String(event?.receipt ?? "").trim();
  return { ...branch, receipt, at: Number(event?.at) || 0 };
}

/// 巡检矩阵：把最近一批事件按五分支归拢，每分支取最近一条。
/// 空分支不进结果——没发生过的分支摆出来只会稀释注意力。
export function watchdogMatrix(events) {
  const list = Array.isArray(events) ? events : [];
  const byKey = new Map();
  for (const event of list) {
    const branch = watchdogEventBranch(event);
    const current = byKey.get(branch.key);
    if (!current || branch.at > current.at) byKey.set(branch.key, branch);
  }
  return WATCHDOG_BRANCHES.filter((b) => byKey.has(b.key)).map((b) => byKey.get(b.key));
}

// ---------------------------------------------------------------------------
// 左侧卷宗列表：串台防护（Bug 6）
// ---------------------------------------------------------------------------

/// 卷宗行的展示名：任务名/正式标题优先，严禁把阶段状态名当主标题。
/// 阶段描述只配第二行——Leo 抓到的串台就是左侧显示阶段名、中间显示案名。
export function archiveRowTitle(caseLike) {
  const title = String(caseLike?.title ?? "").trim();
  const name = String(caseLike?.name ?? "").trim();
  const fallback = String(caseLike?.fallbackName ?? "").trim();
  return title || name || fallback || "未命名案件";
}

/// 第二行的驻留描述：单一节点 + 模式，不写「初审/二审」这种含糊双挂。
export function archiveResidencyText(caseLike) {
  const step = dagStepOfCase(caseLike?.step);
  const node = DAG_STEPS[step];
  const star = String(caseLike?.ownerStar ?? node?.star ?? "");
  const badge = String(caseLike?.residencyNote ?? "").trim();
  const mode = DELIVERABLE_MODE_LABEL[normalizeDeliverableMode(caseLike?.deliverableMode)];
  const base = `${node?.no ?? ""} ${node?.title ?? ""}`;
  const parts = [star ? `${starNameOf(star)} · ${base}` : base];
  if (badge) parts.push(badge);
  return { text: parts.join(" · "), mode: mode.short };
}

/// 星位 id → 中文名。与 taskChains 的兜底表同源，但这里不引它——
/// 纯逻辑模块要能独立被 node 拉起来跑。
const STAR_NAMES = {
  main: "客星", tianshu: "天枢", tianxuan: "天璇", tianji: "天玑",
  tianquan: "天权", yuheng: "玉衡", kaiyang: "开阳", yaoguang: "摇光",
};

export function starNameOf(agentId) {
  const id = String(agentId ?? "");
  const suffix = id.includes(":") ? id.slice(id.lastIndexOf(":") + 1) : id;
  return STAR_NAMES[suffix] || STAR_NAMES[id] || suffix || id;
}

// ---------------------------------------------------------------------------
// 星位在线灯（Bug：4/7 严禁渲染绿灯）
// ---------------------------------------------------------------------------

/// 在线数灯色：满 7/7 才绿，缺一颗就琥珀，缺一半以上朱砂。
/// Leo 抓过的坑——4/7 还亮绿灯等于监控撒谎。
export function starOnlineTone(online, total = 7) {
  const on = Math.max(0, Number(online) || 0);
  const all = Math.max(1, Number(total) || 0);
  if (on >= all) return "jade";
  if (on >= Math.ceil(all / 2)) return "bronze";
  return "cinnabar";
}

// ---------------------------------------------------------------------------
// 双通道发布包
// ---------------------------------------------------------------------------

/// 视频包追投入口的可见性：仅图文 + 母稿已冻结（二审 PASS）才给按钮。
/// 没冻结就追投 = 让开阳基于一份还会改的母稿干活，白做。
export function canAppendVideo(caseLike) {
  if (normalizeDeliverableMode(caseLike?.deliverableMode) !== "IMAGE_ONLY") return false;
  return masterDocBadge(caseLike).kind === "frozen";
}

/// 发布包槽位状态：active（在产）/ ready（已就绪）/ standby（未启用）/ empty。
export function assetSlotState(caseLike, slot) {
  const step = dagStepOfCase(caseLike?.step);
  const mode = normalizeDeliverableMode(caseLike?.deliverableMode);
  const branch = branchStatesOf(caseLike);
  if (slot === "video") {
    if (mode === "IMAGE_ONLY") return canAppendVideo(caseLike) ? "appendable" : "standby";
    if (branch.kaiyang === "standby") return "standby";
    if (step > 5) return "ready";
    return step === 5 ? "active" : "empty";
  }
  if (mode === "VIDEO_ONLY") return branch.yuheng === "standby" ? "standby" : step > 5 ? "ready" : step === 5 ? "active" : "empty";
  if (step > 5) return "ready";
  return step === 5 ? "active" : "empty";
}

// ---------------------------------------------------------------------------
// 跨星位唤醒：sessions.send 的参数形态（Rust 侧 beidou_dispatch.rs 同口径）
//
// 真形是 2026-10-15 在 Leo 的 VPS 实测出来的，试过六种参数名只有这一组成：
//   `{ key: <会话键>, message: <文本> }` → `{"runId":"…","status":"started"}`
// 两个坑（Rust 侧注释里有第三条授权坑）：
//   1) 会话键传 `key`，不是 `sessionKey`/`to`/`agent`——传错网关回的是
//      "session mutation target is unavailable"，一句看不出是参数名错。
//   2) 消息字段是 `message`，不是 `text`/`content`——那两个会拿到
//      "must have required property 'message'" 的参数校验错。
// 前端这两份只用于形状自检与错误提示文案；真发送在 Rust 侧，别在这儿发。
// ---------------------------------------------------------------------------

/// 会话键必须是 `agent:<star>:...` 形态（干活的群会话形如
/// `agent:tianji:feishu:group:oc_xxx`——`:main` 是舵，`:cron:` 是锚）。
export function isAgentSessionKey(raw) {
  const key = String(raw ?? "").trim();
  return key.startsWith("agent:") && key.length > "agent:".length;
}

/// 群会话键判定：唤醒只能发给群会话。SOP 里各星位在群里收发流转卡，
/// `:main` / `:cron:` 都不是干活的那一个。
export function isGroupSessionKey(raw) {
  return isAgentSessionKey(raw) && String(raw).includes(":group:");
}

/// 从 sessions.list 的快照里挑一颗星位的群会话键（唤醒目标）。
/// 认不出的返回 null——前端据此显示"网关上看不到这一星位"，别硬发。
export function groupSessionKeyOf(sessions, agentId) {
  const list = Array.isArray(sessions) ? sessions : [];
  const found = list.find(
    (session) => session?.agentId === agentId && isGroupSessionKey(session?.key),
  );
  return found?.key ?? null;
}

/// 派发失败原因的人话版：Rust 侧回的是网关原话或自译文案，前端统一过一遍，
/// 让 Leo 看到的是"该怎么办"而不是一句英文错。
export function wakeupFailureText(error) {
  const text = String(error ?? "");
  if (!text) return "发送失败：没有原因回传";
  if (text.includes("未配置网关")) return "还没配网关：去设置页填上 ws://地址与 token";
  if (text.includes("群会话")) return "网关上找不到这颗星位的群会话：先让它在群里跑过一次";
  if (text.includes("unavailable")) {
    return "网关拒收：多半是设备没授 operator.write（openclaw devices approve）";
  }
  if (text.includes("must have required property")) {
    return "网关参数校验失败：这是代码 bug，把这句话原文记下来报给我";
  }
  return text;
}

// ---------------------------------------------------------------------------
// 本地账本行 → 指挥舱案件形态（Rust CaseListRow 是 snake_case，看板要 camelCase）
//
// 这一层必须显式：账本里存的是主表原话（stage 可能是 "01_建档" 这种自编号，
// 也可能是 SOP 规范名），看板只认 0..6 的下标。映射规则集中在这里，
// 别在组件里就地猜——猜错的后果是案子挂到错的星位格上。
// ---------------------------------------------------------------------------

/// 主表/账本的阶段文本 → DAG 下标（0..6）。认不出的落 0（建档）：
/// 宁可显示"刚起步"也别把跑到一半的案子挪到已完成。
///
/// 顺序即优先级：一条文本可能同时命中多个词（"等待确认选题"既有"选题"
/// 又有"确认"），先命中先返回。所以"定题/待确认"排在"研究/选题"前面——
/// 天权接过手了就不再算天璇在研究。
const STAGE_TO_STEP = [
  { match: /建档|接单|intake/i, step: 0 },
  { match: /二审|审稿|冻结|second|review/i, step: 4 },
  { match: /审题|定题|五轴|待确认|confirm/i, step: 2 },
  { match: /研究|选题|趋势|research/i, step: 1 },
  { match: /母稿|创作|草稿|draft/i, step: 3 },
  { match: /视觉|配图|视频|生图|分镜|并行|visual|video/i, step: 5 },
  { match: /分发|运营|关单|复盘|ops|close/i, step: 6 },
];

export function stageToStep(rawStage) {
  const text = String(rawStage ?? "").trim();
  if (!text) return 0;
  // 自编号前缀（"01_建档"/"05_母稿"）剥掉再匹配——编号本身就是顺序，
  // 但语义匹配更抗新增阶段名。
  const body = text.replace(/^\d{1,2}[_\-.\s]*/, "");
  const hit = STAGE_TO_STEP.find((entry) => entry.match.test(body));
  return hit ? hit.step : 0;
}

/// 这一行是不是「已关单」——口径照 Rust CaseStage::Closed（beidou_cases.rs：
/// "已关单" | "关单完成" => CaseStage::Closed，Closed 无列、移出泳道进案卷）。
/// 注意 "07_关单" 是 Distribution（分发运营与关单），不是 Closed：
/// 账本没写 Closed 就照实显示运营关单，不替它猜（前端无从知道它办完没办完）。
export function stageIsClosed(rawStage) {
  const body = String(rawStage ?? "").trim().replace(/^\d{1,2}[_\-.\s]*/, "");
  return body === "已关单" || body === "关单完成";
}

/// Rust beidou_cases.content_json 列：harvest_episode_content 从 session_run
/// 接力文本里提炼的真内容（正式标题 / 天权判词 / 打回链 / 研究编号注 /
/// 产出时间线）。老库没有这一列时 Rust 给空串；解析失败一律按空处理——
/// 一列脏 JSON 不许把整张看板炸掉（真机账本是本地文件，什么都有可能）。
function parseContentJson(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/// 时间线行只留渲染要的四列（at / star / what / dur）：Rust 的 atMs 是合并
/// 排序键，深潜舱不显示它。形状不对的行剔掉——PipelineView 直接 map 渲染，
/// 塞个 null 进去会整栏崩。
function cleanTimelineRows(rows) {
  if (!Array.isArray(rows)) return null;
  const out = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const at = String(r.at ?? "").trim();
    const what = String(r.what ?? "").trim();
    if (!at || !what) continue;
    out.push({
      at,
      star: String(r.star ?? "").trim(),
      what,
      dur: String(r.dur ?? "").trim(),
    });
  }
  return out.length > 0 ? out : null;
}

/// Rust CaseListRow → 看板案件。字段名换一遍 + 阶段翻成下标 + 打回次数取
/// 二审那份（SOP：打回计数挂在二审上，初审不过是退回天璇重选题，不算打回）。
export function ledgerRowToCase(row) {
  if (!row) return null;
  const secondStrikes = Math.max(0, Number(row.secondStrikes ?? 0));
  const content = parseContentJson(row.contentJson);
  const title = String(row.title ?? "").trim();
  // 正式标题（《》多跳一致的那一个）优先于账本占位标题：真机 BM-2601 的
  // title 列只有「室内设计」三个字，正式标题在接力文本里（天权定题后每一跳
  // 交接卡都带）。提炼不出来就照实落账本标题，不编。
  const formalTitle = String(content?.formalTitle ?? "").trim();
  return {
    caseId: String(row.caseId ?? ""),
    name: formalTitle || title || "未命名案件",
    title,
    step: stageToStep(row.stage),
    // 已关单标记：账本 stage 文本的口径（Rust CaseStage::Closed）。
    // PipelineView 据此把末格画成「已关单」而不是「运营关单在办」——
    // 否则摇光在跑别案时，关完的案会被画成 is-live + strip（Leo 2026-10-16 第 3 问）。
    closed: stageIsClosed(row.stage),
    deliverableMode: normalizeDeliverableMode(row.deliverableMode),
    ownerStar: row.ownerStar ?? null,
    residencyNote: row.liveAction ?? "",
    masterFrozen: Boolean(row.masterFrozen),
    // 二审打回次数：3/3 熔断时看板走自愈态（masterDocBadge 的口径）
    secondStrikes,
    masterDocUrl: row.masterDocUrl ?? "",
    folderUrl: row.folderUrl ?? "",
    researchDocUrl: row.researchDocUrl ?? "",
    reviewDocUrl: row.reviewDocUrl ?? "",
    // 复审报告链接：Rust 标签归槽写进的新槽（recheck_doc_url）。打回后的
    // 复审是真机里唯一带链接却没处摆的东西（mock21 左中栏都认这个字段）。
    reReviewDocUrl: row.recheckDocUrl ?? "",
    visualUrl: row.visualUrl ?? "",
    videoUrl: row.videoUrl ?? "",
    opsDocUrl: row.opsDocUrl ?? "",
    lastActivityMs: row.lastActivityMs ?? null,
    updatedAtMs: row.updatedAtMs ?? null,
    // 以下字段来自 content_json（Rust 从 session_run 接力文本提炼）：
    // 账本没提炼出东西时保持 null / ""，组件走各自的诚实空态——
    // 「判词还没落到本地账本」「这一案还没有跑过的记录」，
    // 别拿演示数据填，也别摆空列表让人以为真的没有。
    candidates: Array.isArray(content?.candidates) ? content.candidates : null,
    candidateNote: String(content?.candidateNote ?? ""),
    // 五轴分只在飞书主表，账本镜像不带：必须是 null 而不是 {}。
    // 给 {} 的话 PipelineView 会渲染出五条 0 分的假门禁（Leo 一眼看出"这两行为什么是 0"）。
    reviewAxes: null,
    strikeList: Array.isArray(content?.strikes) ? content.strikes : null,
    timeline: cleanTimelineRows(content?.timeline),
    criteria: null,
    verdictText: String(content?.verdictText ?? ""),
    verdictBy: String(content?.verdictBy ?? ""),
    researchIdNote: String(content?.researchIdNote ?? ""),
  };
}

export function ledgerRowsToCases(rows) {
  return (Array.isArray(rows) ? rows : []).map(ledgerRowToCase).filter(Boolean);
}

/// 深潜舱状态条文案（PipelineView 的 liveAction prop）：账本 live_action 列
/// （Rust 从飞书主表镜像下来，ledgerRowToCase 映射为 residencyNote）按属主星
/// 归并成 { star: 文案 }。同星多条案留 updatedAtMs 最新那条 —— 两条同星案互相
/// 覆盖时，旧文案会冒充正在跑的那条。并行列（ownerStar="par"）不进表：
/// strip 对并行列有「并行生产中」兜底，一条文案挂到玉衡/开阳两颗上只会显示两遍。
/// 取不到的星不出项 —— PipelineView 的 strip 有「执行中」兜底，不在这里编话。
export function buildLiveActionMap(cases) {
  const best = {};
  for (const c of Array.isArray(cases) ? cases : []) {
    const text = String(c?.residencyNote ?? "").trim();
    const star = c?.ownerStar;
    if (!text || !star || star === "par") continue;
    const at = Number(c?.updatedAtMs ?? 0);
    const prev = best[star];
    if (!prev || at >= prev.at) best[star] = { text, at };
  }
  return Object.fromEntries(Object.entries(best).map(([star, v]) => [star, v.text]));
}
