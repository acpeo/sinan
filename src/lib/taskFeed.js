import { cleanSessionTitle, cleanTaskTitle, hopTitleOf, hopToneOf } from "./taskChains.js";
import { starNameOf } from "./agents.js";
import { DIAL_TONE } from "./taskVisual.js";

// 用户语言的类型词：巡检简报 / 巡检 / Memory / 定时 / 任务 / 接力。
export function cjkRatioOf(text) {
  const t = String(text ?? "").replace(/\s/g, "");
  if (!t) return 0;
  let han = 0;
  for (const ch of t) if (/\p{Script=Han}/u.test(ch)) han += 1;
  return han / [...t].length;
}
export function taskKindOf(row) {
  const title = row.label || row.title || "";
  if (/巡检/.test(title) && cjkRatioOf(row.terminalSummary) > 0.3) return "巡检简报";
  if (/skill-collection-review/i.test(title)) return "巡检";
  if (/Memory/i.test(title)) return "Memory";
  return row.kind === "automation_run" ? "定时" : "任务";
}
export function isBriefingRow(row) {
  return taskKindOf(row) === "巡检简报";
}
// 定时任务显示名：网关 job 名是英文标识符，显示层换人话；未知名字原样透传
//（Leo：定时任务不能只能英文显示）。词表=openclaw 生态高频任务词（官方内置
// 只有 heartbeat，其余是社区常见 automation：digest/briefing/cleanup 等）。
export function jobDisplayName(name) {
  const t = String(name ?? "").trim();
  let m = /^skill-collection-review-(\w+)$/.exec(t);
  if (m) return `skill 检查 · ${starNameOf(m[1])}`;
  m = /^heartbeat-(\w+)$/.exec(t);
  if (m) return `心跳保活 · ${starNameOf(m[1])}`;
  if (/^heartbeat$/i.test(t)) return "心跳保活";
  if (/^memory dreaming promotion$/i.test(t)) return "记忆整理晋升";
  if (!/[\u4e00-\u9fff]/.test(t)) {
    if (/consolidat|flush|dream/i.test(t)) return "记忆整理";
    if (/digest/i.test(t)) return "每日摘要";
    if (/briefing/i.test(t)) return "简报汇总";
    if (/(daily|morning).?(report|update)/i.test(t)) return "每日报告";
    if (/cleanup|prune|sweep/i.test(t)) return "清理维护";
    if (/backup/i.test(t)) return "备份";
    if (/inbox/i.test(t)) return "收件箱巡检";
    if (/compact/i.test(t)) return "上下文压缩";
  }
  return t;
}
export function taskTitleOf(row) {
  const id = row.taskId ?? "";
  const degenerate = !cleanTaskTitle(row) && !row.label && !row.title
    && (/^cronrun:/.test(id) || /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(id));
  if (degenerate) {
    // 网关对 cron/automation 的 run 常常 label 和 title 两列都空，一排
    // 「定时运行」谁也认不出是哪件事（Leo 2026-10-19：飞书里跑的那轮
    // RT-01 压测，17 轮巡检折成一张「定时运行 · 17 次」，他根本没认出来）。
    // 结论摘要里其实写着这轮在干什么——巡检是北斗的常态产出，先认它。
    if (/巡检/.test(String(row.terminalSummary ?? ""))) return "巡检";
    return row.kind === "automation_run" ? "定时运行" : `${row.runtime ?? "任务"} 运行`;
  }
  return jobDisplayName(cleanTaskTitle(row) || row.label || row.title || row.taskId || "未命名任务");
}
export function isSlugTitle(row) {
  return /skill-collection-review/i.test(row.label || row.title || "");
}
export function feedToneOf(row) {
  if (row.status === "running") return "live";
  if (row.status === "failed" || row.status === "timed_out") return "fail";
  if (row.status === "cancelled" || row.status === "skipped") return "cancel";
  return "done";
}
export const atMsOf = (row) => row.startedAtMs ?? row.createdAtMs ?? row.lastSeenMs ?? 0;
export const hhMmOf = (ms) => new Date(ms).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" });

// 动态流视图模型：exec 聚合 / NO_REPLY 跳过 / 简报置顶去重 / 同日巡检批次聚合。


// 动态流视图模型：exec 聚合 / NO_REPLY 跳过 / 简报置顶去重 / 同日巡检批次聚合。
export function buildTasksFeedModel({ rows, episodes, now }) {
  const atOf = (row) => atMsOf(row);
  const items = [];
  const execAgg = new Map();
  let skippedNoReply = 0;
  for (const row of rows) {
    const kind = row.kind ?? "";
    // exec 聚合口径：kind 明确是 exec/cli 的命令行；runtime=cli 但 kind 缺失的
    // 是被重启中止的 agent run（取消卡），不进聚合。
    if (kind === "exec" || (kind === "cli" && row.runtime === "cli")) {
      const agent = row.agentId || "main";
      const agg = execAgg.get(agent) ?? { total: 0, ok: 0, bad: 0, cancel: 0 };
      agg.total += 1;
      if (row.status === "succeeded") agg.ok += 1;
      else if (row.status === "cancelled") agg.cancel += 1;
      else if (row.status && row.status !== "running") agg.bad += 1;
      execAgg.set(agent, agg);
      continue;
    }
    const summary = String(row.terminalSummary ?? "").trim();
    if (summary === "NO_REPLY" || (!summary && row.status === "succeeded" && !row.label && !row.title)) {
      skippedNoReply += 1;
      continue;
    }
    items.push(row);
  }
  const makeTaskVm = (row) => {
    const tone = feedToneOf(row);
    const summary = String(row.terminalSummary ?? "").trim();
    return {
      key: `row:${row.gateway}:${row.taskId}`,
      type: "task", agentId: row.agentId || "main",
      agent: starNameOf(row.agentId), kind: taskKindOf(row),
      at: atOf(row), tone,
      color: DIAL_TONE[tone],
      title: taskTitleOf(row), slug: isSlugTitle(row),
      summary, cjk: cjkRatioOf(summary) > 0.3,
      status: row.status, error: row.error,
      startedAtMs: row.startedAtMs, endedAtMs: row.endedAtMs,
      toolUseCount: row.toolUseCount,
      progress: String(row.progressSummary ?? "").trim(),
      decayed: tone === "done" && now - atOf(row) > 86_400_000,
    };
  };
  // 双写去重：tasks.list 时代的旧账行与 cron.runs 新行同源（同 jobId+同时刻），
  // 相邻 120 秒内视为同一次运行只留一条；旧行缺结论而新行有时把结论搬过去。
  const deduped = [];
  const twinsBySource = new Map();
  for (const row of items) {
    if (row.kind !== "automation_run" || !row.sourceId) { deduped.push(row); continue; }
    let peers = twinsBySource.get(row.sourceId);
    if (!peers) { peers = []; twinsBySource.set(row.sourceId, peers); }
    const at = atOf(row);
    const twin = peers.find((other) => Math.abs(atOf(other) - at) <= 120_000);
    if (twin) {
      if (!String(twin.terminalSummary ?? "").trim() && String(row.terminalSummary ?? "").trim()) {
        twin.terminalSummary = row.terminalSummary;
      }
      continue;
    }
    peers.push(row);
    deduped.push(row);
  }
  const briefings = deduped
    .filter((row) => isBriefingRow(row) && now - atOf(row) <= 48 * 3_600_000)
    .sort((a, b) => atOf(b) - atOf(a));
  const briefing = briefings.length ? makeTaskVm(briefings[0]) : null;
  const rest = briefing ? deduped.filter((row) => row !== briefings[0]) : deduped;
  // 同 job 折叠：同一 sourceId 同一天 ≥2 次运行收成一张卡（心跳 30 分钟一次，
  // 不折就是刷屏，Leo 2026-10-05 点名）。巡检简报不折（最值钱的中文产出）。
  const foldedLevels = [];
  const foldBySourceDay = new Map();
  for (const row of rest) {
    if (row.kind !== "automation_run" || isBriefingRow(row)) { foldedLevels.push(row); continue; }
    const day = new Date(atOf(row)).toDateString();
    const key = `${row.sourceId}:${day}`;
    const fold = foldBySourceDay.get(key);
    if (fold) { fold.rows.push(row); continue; }
    const fresh = { foldKey: key, rows: [row] };
    foldBySourceDay.set(key, fresh);
    foldedLevels.push(fresh);
  }
  const restFolded = foldedLevels.map((entry) => (
    Array.isArray(entry?.rows) && entry.rows.length < 2 ? entry.rows[0] : entry
  ));
  // 同日多星巡检批次（≥2 星才聚，单卡还原）；同 job 折叠卡直接过不参与
  const batched = [];
  const batchByDay = new Map();
  for (const entry of restFolded) {
    if (!Array.isArray(entry?.rows) && taskKindOf(entry) === "巡检") {
      const day = new Date(atOf(entry)).toDateString();
      const batch = batchByDay.get(day);
      if (batch) { batch.rows.push(entry); continue; }
      const fresh = { batchDay: day, rows: [entry] };
      batchByDay.set(day, fresh);
      batched.push(fresh);
      continue;
    }
    batched.push(entry);
  }
  const flattened = batched.map((entry) => (
    Array.isArray(entry?.rows) && entry.rows.length < 2 ? entry.rows[0] : entry
  ));
  const cards = [];
  for (const entry of flattened) {
    if (Array.isArray(entry?.rows) && entry.foldKey) {
      // 同 job 折叠卡：N 次运行一张卡，展开逐条；连续失败 ≥3 显著标注
      const group = [...entry.rows].sort((a, b) => atOf(a) - atOf(b));
      const okN = group.filter((r) => r.status === "succeeded").length;
      const skipN = group.filter((r) => r.status === "skipped").length;
      const badN = group.length - okN - skipN;
      let streak = 0;
      for (let i = group.length - 1; i >= 0; i -= 1) {
        if (group[i].status === "failed" || group[i].status === "timed_out") streak += 1;
        else break;
      }
      const last = group[group.length - 1];
      const tone = feedToneOf(last) === "fail" ? "fail" : "done";
      cards.push({
        key: `fold:${entry.foldKey}`,
        type: "fold", agentId: last.agentId || "main",
        agent: starNameOf(last.agentId), kind: taskKindOf(last),
        at: atOf(last), tone, color: DIAL_TONE[tone],
        title: `${taskTitleOf(last)} · ${group.length} 次`,
        detail: `✓ ${okN} · ✕ ${badN}${skipN ? ` · 跳过 ${skipN}` : ""}（${hhMmOf(atOf(group[0]))}–${hhMmOf(atOf(last))}）${streak >= 3 ? ` · 连续失败 ${streak} 次` : ""}`,
        rows: group, decayed: false,
      });
      continue;
    }
    if (Array.isArray(entry?.rows)) {
      const group = entry.rows;
      const okN = group.filter((r) => r.status === "succeeded").length;
      const badN = group.length - okN;
      cards.push({
        key: `batch:${entry.batchDay}:${group[0].taskId}`,
        type: "batch", agentId: null, agent: "多星", kind: "巡检",
        at: Math.max(...group.map(atOf)), tone: badN ? "fail" : "done",
        color: DIAL_TONE[badN ? "fail" : "done"],
        title: `巡检批次 · ${group.length} 星 · ${badN ? `${okN} 成 ${badN} 异常` : "全部正常"}`,
        detail: group.map((r) => `${starNameOf(r.agentId)} ${hhMmOf(atOf(r))} ${r.status === "succeeded" ? "✓" : "✕"}`).join(" · "),
      });
      continue;
    }
    cards.push(makeTaskVm(entry));
  }
  // 收工接力轮 → 一条接力卡（实时跳转归小组件，主窗管案的结论与状态）。
  // 案的锚 = 星位 run（v7.1 Leo 拍板"怎么可能这么多"的修正）：星位自己的
  // 会话才是派活干活；主 Agent 的纯对话轮（群聊/私聊，账本里一晚几十条）
  // 不成案，降级为 mainChat 卡走事件流水——主窗案卡不再被聊天记录淹没。
  for (const ep of episodes) {
    const latest = ep.runs[ep.runs.length - 1];
    if (!latest) continue;
    const epAgent = latest.agentId || "main";
    const { tone } = hopToneOf({ status: latest.status, taskId: latest.taskId ?? latest.id, error: latest.error });
    // 结论行取**链尾往回第一条有意义的话**：末跳若还在跑，它的摘要往往只有
    // 一个工具名（"exec" / "message"），照抄上去整张卡就成了 --dump 灰样，
    // 看着跟没有内容一样——Leo 2026-10-20 说"一点动静没有"，一头就栽在这。
    const summary = (() => {
      for (let i = ep.runs.length - 1; i >= 0; i -= 1) {
        const run = ep.runs[i];
        for (const raw of [run?.terminalSummary, run?.progressSummary]) {
          const text = String(raw ?? "").trim();
          if (text && !/^(exec|message|cli|bash|shell|read|write|edit|grep|glob)$/i.test(text)) {
            return text;
          }
        }
      }
      return "";
    })();
    const key = `ep:${ep.startedAtMs}:${latest.id ?? latest.sessionKey ?? "ep"}`;
    const at = ep.lastActivityMs ?? ep.startedAtMs ?? 0;
    if (epAgent === "main") {
      cards.push({
        key, type: "mainchat", episode: ep, agentId: "main", agent: "客星",
        kind: "对话", at,
        tone: tone === "failed" ? "fail" : "done",
        color: DIAL_TONE[tone === "failed" ? "fail" : "done"],
        title: hopTitleOf(latest) || "客星 会话",
        slug: false, summary: "", cjk: false,
        status: latest.status, error: latest.error, decayed: false,
        mainChat: true,
      });
      continue;
    }
    // 收工/在跑都进盘（Leo 2026-10-11 实锤"有星在活跃，对应星位却没动作"）：
    // 此前这里把 tone 归一成 failed/done，还在跑的轮次被硬写成"done"——
    // 星盘拿到的永远是收班态，呼吸圈与绿点从来没机会亮。现在按原状态分色：
    // 进行中=绿（活的事）、失败=红、其余=收班蓝。
    // 轮次标题取**轮内最早一条带有派活原话**的跳（Leo 自己在群里打的那句），
    // 不是末跳：末跳多是收尾/交接卡，title 列是空的，卡片会一律叫「天璇 的派活」
    // ——2026-10-20 实测他认不出那张卡就是自己刚派的活。
    const speaking = ep.runs.find((run) => {
      const text = cleanSessionTitle(run?.title ?? "");
      return text && !/^(ou|oc|om)_[0-9a-f]{16,}$/i.test(text.trim());
    });
    const episodeTitle = (speaking ? hopTitleOf(speaking) : "") || hopTitleOf(latest);
    cards.push({
      key, type: "episode", episode: ep, agentId: epAgent,
      agent: starNameOf(epAgent),
      // 跳数上卡面：一条接力只出一张卡，不写跳数的话，一条正在跑的 10 跳链
      // 在动态流里就是一张静止的卡（跳数还会随每一跳落库而增长，是活的进度）。
      kind: ep.runs.length > 1 ? `接力 ${ep.runs.length} 跳` : "接力",
      at,
      tone: tone === "failed" ? "fail" : tone === "done" ? "done" : "live",
      color: tone === "failed" ? DIAL_TONE.fail : tone === "done" ? DIAL_TONE.done : DIAL_TONE.live,
      title: episodeTitle || `${starNameOf(epAgent)} 的派活`,
      slug: false,
      summary, cjk: cjkRatioOf(summary) > 0.3,
      status: latest.status, error: latest.error, decayed: false,
      progress: String(latest.progressSummary ?? "").trim(),
    });
  }
  cards.sort((a, b) => b.at - a.at);
  return { briefing, cards, execAgg, skippedNoReply };
}




// 案卡链路行（v7.2 折叠芯片，Leo 2026-10-06 拍板）：连续同星同果的跳折叠成
// 一枚芯片（✓×N），星序一眼可读；悬停芯片弹该星跳列表（时刻/时长/结论），
// 运行中芯片弹实时卡（任务/已跑/最近动作）。主 Agent 对话不进案卡。





// 案卡链路行（v7.2 折叠芯片，Leo 2026-10-06 拍板）：连续同星同果的跳折叠成
// 一枚芯片（✓×N），星序一眼可读；悬停芯片弹该星跳列表（时刻/时长/结论），
// 运行中芯片弹实时卡（任务/已跑/最近动作）。主 Agent 对话不进案卡。
export function foldCaseChain(episode) {
  const hops = (episode?.hops ?? []).filter((hop) => hop.agentId && hop.agentId !== "main");
  const segments = [];
  hops.forEach((hop, i) => {
    const { tone } = hopToneOf({ status: hop.status, taskId: hop.taskId ?? hop.id, error: hop.error });
    const toneKey = hop.status === "running" ? "running" : tone;
    const last = segments[segments.length - 1];
    if (last && last.agentId === hop.agentId && last.toneKey === toneKey && toneKey !== "running") {
      last.count += 1;
      last.hops.push({ ...hop, seq: i + 1 });
    } else {
      segments.push({
        agentId: hop.agentId,
        toneKey,
        count: 1,
        running: hop.status === "running",
        hops: [{ ...hop, seq: i + 1 }],
      });
    }
  });
  return segments;
}

