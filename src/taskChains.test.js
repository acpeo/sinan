import assert from "node:assert/strict";
import test from "node:test";

import {
  activeRelayEpisodes,
  agentDisplayName,
  buildCronNextByAgent,
  detectRoundNotifications,
  isQuietNow,
  benignStateOf,
  buildAgentNameMap,
  buildTaskChains,
  chainHopsFor,
  cleanTaskTitle,
  cleanSessionTitle,
  cronNextRunMs,
  cronScheduleText,
  defuseStaleSnapshotActivity,
  SNAPSHOT_FRESH_MS,
  gatewayResultsAllOk,
  gatewayFailureText,
  failureClassOf,
  groupSessionEpisodes,
  isSubagentTask,
  hopGlyphOf,
  listIdleSessions,
  hopToneOf,
  isActiveTask,
  countIdleSessions,
  selectUsageSessions,
  sessionEpisodeHops,
  sessionErrorText,
  buildAgentRoster,
  buildFleetModules,
  sessionRunHopStatus,
  sessionRunHop,
  toolProgressLabel,
} from "./taskChains.js";

const task = (overrides) => ({
  taskId: overrides.taskId,
  status: overrides.status ?? "running",
  title: overrides.title ?? overrides.taskId,
  agentId: overrides.agentId,
  sessionKey: overrides.sessionKey,
  childSessionKey: overrides.childSessionKey,
  runId: overrides.runId,
  startedAtMs: overrides.startedAtMs ?? 0,
  firstSeenMs: overrides.firstSeenMs ?? 0,
});

test("chain groups tasks by shared runId in started order", () => {
  const tasks = [
    task({ taskId: "b", runId: "r1", agentId: "tianxuan", startedAtMs: 2000, sessionKey: "s-b" }),
    task({ taskId: "a", runId: "r1", agentId: "tianshu", startedAtMs: 1000, sessionKey: "s-a" }),
    task({ taskId: "c", runId: "r2", agentId: "tianji", startedAtMs: 3000, sessionKey: "s-c" }),
  ];
  const index = buildTaskChains(tasks);
  const hops = chainHopsFor(tasks[0], index);
  assert.deepEqual(hops.map((hop) => hop.taskId), ["a", "b"]);
});

test("parent childSessionKey joins the spawned subagent task across runIds", () => {
  const tasks = [
    task({
      taskId: "parent",
      status: "succeeded",
      agentId: "tianshu",
      sessionKey: "agent:tianshu:main",
      childSessionKey: "agent:tianxuan:subagent:xyz",
      runId: "exec:alpha",
      startedAtMs: 1000,
    }),
    task({
      taskId: "child",
      agentId: "tianxuan",
      sessionKey: "agent:tianxuan:subagent:xyz",
      runId: "exec:beta",
      startedAtMs: 5000,
    }),
  ];
  const index = buildTaskChains(tasks);
  const hops = chainHopsFor(tasks[1], index);
  assert.deepEqual(hops.map((hop) => hop.taskId), ["parent", "child"]);
});

test("cyclic parent links terminate instead of looping forever", () => {
  const tasks = [
    task({
      taskId: "x",
      sessionKey: "s-x",
      childSessionKey: "s-y",
      startedAtMs: 1000,
    }),
    task({
      taskId: "y",
      sessionKey: "s-y",
      childSessionKey: "s-x",
      startedAtMs: 2000,
    }),
  ];
  const index = buildTaskChains(tasks);
  const hops = chainHopsFor(tasks[0], index);
  assert.equal(hops.length, 2);
});

test("agent name map resolves both gateway-prefixed and short agent ids", () => {
  const map = buildAgentNameMap([
    { agentId: "VPS-北斗:tianshu", name: "天枢" },
    { agentId: "VPS-北斗:tianxuan", name: "天璇" },
  ]);
  assert.equal(agentDisplayName(map, "VPS-北斗:tianshu"), "天枢");
  assert.equal(agentDisplayName(map, "tianshu"), "天枢");
  assert.equal(agentDisplayName(map, "unknown"), "unknown");
  assert.equal(agentDisplayName(map, undefined), "");
});

test("usage sessions: 只收有真实水位的会话，按水位降序（Leo 2026-10-04 定案：卡回答'谁快满了'，不做目录）", () => {
  const now = 1_800_000_000_000;
  const sessions = [
    // 有水位的群会话：上卡，但按水位排——刚活跃的 40k 排在 154k 之后
    { key: "agent:tianshu:feishu:group:oc_a", isGroup: true, estimatedPromptTokens: 40_000, contextTokenBudget: 525_000, updatedAt: now - 100 },
    // 有水位的主会话：水位最高，排最前（哪怕 3 天没动）
    { key: "agent:tianshu:main", isGroup: false, estimatedPromptTokens: 154_000, contextTokenBudget: 525_000, updatedAt: now - 3 * 24 * 3600_000 },
    // 无水位的群会话：不逐行占位（Leo 截图里一排"预 525k"的病根）
    { key: "agent:tianxuan:feishu:group:oc_a", isGroup: true, estimatedPromptTokens: null, updatedAt: now - 60_000 },
    // cron 会话：永远排除
    { key: "agent:tianshu:cron:cb75:run:e1", estimatedPromptTokens: 9_000, updatedAt: now - 50 },
    // 0 水位 = 没聊过：不上卡
    { key: "agent:kaiyang:feishu:group:oc_b", isGroup: true, estimatedPromptTokens: 0, updatedAt: now - 60 },
    // 刚接活、思考中（运行中无水位）：无条件上卡且置顶（Leo 2026-10-04 补的场景）
    { key: "agent:tianxuan:feishu:group:oc_b", isGroup: true, estimatedPromptTokens: null, hasActiveRun: true, updatedAt: now - 5 },
    // 脏数据
    { key: "", estimatedPromptTokens: 12_000 },
    null,
  ];
  const picked = selectUsageSessions(sessions, { limit: 10 });
  assert.deepEqual(picked.map((session) => session.key), [
    "agent:tianxuan:feishu:group:oc_b", // 运行中置顶
    "agent:tianshu:main",
    "agent:tianshu:feishu:group:oc_a",
  ]);
  // limit 截断先保运行中，再按水位取最满的
  const capped = selectUsageSessions(sessions, { limit: 1 });
  assert.deepEqual(capped.map((session) => session.key), ["agent:tianxuan:feishu:group:oc_b"]);
});

test("countIdleSessions/listIdleSessions: 空闲数与清单口径一致（cron 不算）", () => {
  const sessions = [
    { key: "agent:a:main", estimatedPromptTokens: 100 },
    { key: "agent:b:main", estimatedPromptTokens: null },
    { key: "agent:c:feishu:group:g", isGroup: true },
    { key: "agent:x:cron:1", estimatedPromptTokens: 50 },
  ];
  const shown = selectUsageSessions(sessions);
  assert.equal(countIdleSessions(sessions, shown), 2);
  assert.deepEqual(listIdleSessions(sessions, shown).map((session) => session.key), [
    "agent:b:main",
    "agent:c:feishu:group:g",
  ]);
  assert.equal(countIdleSessions(null, []), 0);
  assert.deepEqual(listIdleSessions(null, []), []);
});

test("usage sessions tolerate null/undefined input", () => {
  assert.deepEqual(selectUsageSessions(null), []);
  assert.deepEqual(selectUsageSessions(undefined), []);
});

test("hopToneOf: 四档状态映射，current 只认正在跑的任务本身（状态驱动不点名）", () => {
  assert.equal(hopToneOf({ status: "succeeded", taskId: "a" }, "x").tone, "done");
  assert.equal(hopToneOf({ status: "failed", taskId: "a" }, "a").tone, "failed");
  assert.equal(hopToneOf({ status: "timed_out", taskId: "a" }, "a").tone, "failed");
  assert.equal(hopToneOf({ status: "queued", taskId: "a" }, "a").tone, "pending");
  const running = hopToneOf({ status: "running", taskId: "a" }, "a");
  assert.equal(running.tone, "current");
  assert.equal(running.current, true);
  assert.equal(hopToneOf({ status: "running", taskId: "a" }, "b").current, false);
});

test("failureClassOf: 真机话术分诊，词表外一律真失败（宁可错杀不漏报）", () => {
  // 真机 18791 采集的三类良性话术
  assert.equal(failureClassOf("heartbeat skipped: quiet-hours"), "skip");
  assert.equal(failureClassOf("agent run aborted for restart | OPENCLAW_RESTART_ABORT"), "abort");
  assert.equal(failureClassOf("Cancelled by operator"), "cancel");
  // 真失败与话术外新错误
  assert.equal(failureClassOf("Command failed (exit code 124)"), "real");
  assert.equal(failureClassOf("provider 502，未产出即回"), "real");
  assert.equal(failureClassOf("some new failure mode"), "real");
  assert.equal(failureClassOf(null), "real");
  assert.equal(failureClassOf(undefined), "real");
  assert.equal(failureClassOf(""), "real");
});

test("hopToneOf: 良性未跑走 skipped 档（灰显不染红），cancelled 也算", () => {
  const skip = hopToneOf({ status: "failed", taskId: "a", error: "heartbeat skipped: quiet-hours" }, "a");
  assert.equal(skip.tone, "skipped");
  assert.equal(skip.failed, false);
  assert.equal(skip.benign, true);
  const abort = hopToneOf({ status: "failed", taskId: "a", error: "OPENCLAW_RESTART_ABORT" }, "a");
  assert.equal(abort.tone, "skipped");
  const cancel = hopToneOf({ status: "cancelled", taskId: "a" }, "a");
  assert.equal(cancel.tone, "skipped");
  assert.equal(benignStateOf("heartbeat skipped: quiet-hours", "failed"), "静默跳过");
  assert.equal(benignStateOf("OPENCLAW_RESTART_ABORT", "failed"), "重启中止");
  assert.equal(benignStateOf(null, "cancelled"), "已取消");
  // 真失败不受影响
  const real = hopToneOf({ status: "failed", taskId: "a", error: "exit code 124" }, "a");
  assert.equal(real.tone, "failed");
  assert.equal(real.benign, false);
});

test("hopGlyphOf: 字形与 tone 一一对应（含 skipped ◌）", () => {
  assert.equal(hopGlyphOf("done"), "✓");
  assert.equal(hopGlyphOf("failed"), "✕");
  assert.equal(hopGlyphOf("skipped"), "◌");
  assert.equal(hopGlyphOf("pending"), "○");
  assert.equal(hopGlyphOf("current"), "●");
});

test("isActiveTask: running/queued 算活跃，其余与缺状态不算", () => {
  assert.equal(isActiveTask({ status: "running" }), true);
  assert.equal(isActiveTask({ status: "queued" }), true);
  assert.equal(isActiveTask({ status: "succeeded" }), false);
  assert.equal(isActiveTask({}), false);
  assert.equal(isActiveTask(null), false);
});

test("sessionRunHopStatus: done→succeeded、failed→failed、running 保持", () => {
  assert.equal(sessionRunHopStatus("done"), "succeeded");
  assert.equal(sessionRunHopStatus("succeeded"), "succeeded");
  assert.equal(sessionRunHopStatus("failed"), "failed");
  assert.equal(sessionRunHopStatus("timed_out"), "failed");
  assert.equal(sessionRunHopStatus("running"), "running");
  assert.equal(sessionRunHopStatus(null), "running");
});

test("sessionEpisodeHops: 同群聊接力链按交接连续性成段，跨群/断档不入列", () => {
  const now = Date.now();
  const runs = [
    { id: 1, sessionKey: "agent:tianxuan:feishu:group:oc_a", agentId: "tianxuan", status: "failed", startedAtMs: now - 500_000, endedAtMs: now - 370_000, title: "首轮" },
    { id: 2, sessionKey: "agent:tianshu:feishu:group:oc_a", agentId: "tianshu", status: "running", startedAtMs: now - 230_000, title: "补发" },
    { id: 3, sessionKey: "agent:tianji:feishu:group:oc_b", agentId: "tianji", status: "running", startedAtMs: now - 100_000, title: "别的群" },
    { id: 4, sessionKey: "agent:tianshu:main", agentId: "tianshu", status: "done", startedAtMs: now - 300_000, endedAtMs: now - 290_000, title: "主会话" },
  ];
  const focus = { sessionKey: "agent:tianshu:feishu:group:oc_a", startedAtMs: now - 230_000 };
  const hops = sessionEpisodeHops(runs, focus);
  // 同群（oc_a）的两拍：天璇失败 → 天枢运行中（交接间隔 140s，连续）；跨群 oc_b 与主会话不入列
  assert.equal(hops.length, 2);
  assert.equal(hops[0].taskId, "session-run:1");
  assert.equal(hops[0].status, "failed");
  assert.equal(hops[1].taskId, "session-run:2");
  assert.equal(hops[1].status, "running");
  assert.equal(hops[1].title, "补发");
  // 断档（上一棒结束距当前 run 开始 > 1h 沉默）不入列——哪怕同群
  const far = [...runs, { id: 5, sessionKey: "agent:tianxuan:feishu:group:oc_a", agentId: "tianxuan", status: "done", startedAtMs: now - 3 * 3_600_000, endedAtMs: now - 2.9 * 3_600_000 }];
  assert.equal(sessionEpisodeHops(far, focus).length, 2);
  // 不设格数上限：持续交接的长链全部入列（总时长 10 分钟、10 棒）
  const many = Array.from({ length: 10 }, (_, index) => ({
    id: 100 + index,
    sessionKey: "agent:tianshu:feishu:group:oc_a",
    agentId: "tianshu",
    status: "done",
    startedAtMs: now - (600 - index) * 60_000,
    endedAtMs: now - (599 - index) * 60_000,
  }));
  assert.equal(sessionEpisodeHops(many, many[9]).length, 10);
});

test("sessionEpisodeHops: 长任务只要交接连续就不断链，沉默超 1h 才切开", () => {
  const now = Date.now();
  const min = 60_000;
  // 三个星位接力，总时长 2.5 小时（远超旧 30 分钟窗），但每次交接只隔 1 分钟
  const longChain = [
    { id: 1, sessionKey: "agent:tianshu:feishu:group:oc_c", agentId: "tianshu", status: "done", startedAtMs: now - 150 * min, endedAtMs: now - 148 * min, title: "派活" },
    { id: 2, sessionKey: "agent:tianxuan:feishu:group:oc_c", agentId: "tianxuan", status: "done", startedAtMs: now - 147 * min, endedAtMs: now - 90 * min, title: "研究" },
    { id: 3, sessionKey: "agent:tianquan:feishu:group:oc_c", agentId: "tianquan", status: "done", startedAtMs: now - 89 * min, endedAtMs: now - 40 * min, title: "初审" },
    { id: 4, sessionKey: "agent:tianji:feishu:group:oc_c", agentId: "tianji", status: "running", startedAtMs: now - 39 * min, title: "创作" },
  ];
  const focus = { sessionKey: "agent:tianji:feishu:group:oc_c", startedAtMs: now - 39 * min };
  assert.equal(sessionEpisodeHops(longChain, focus).length, 4);
  // 中途沉默 65 分钟（等 Leo 确认去了）：后半段自成一段，前半段不混入
  const withPause = [
    longChain[0],
    longChain[1],
    { id: 5, sessionKey: "agent:tianquan:feishu:group:oc_c", agentId: "tianquan", status: "done", startedAtMs: now - 25 * min, endedAtMs: now - 20 * min, title: "复审" },
    { id: 6, sessionKey: "agent:tianji:feishu:group:oc_c", agentId: "tianji", status: "running", startedAtMs: now - 5 * min, title: "续作" },
  ];
  const laterFocus = { sessionKey: "agent:tianji:feishu:group:oc_c", startedAtMs: now - 5 * min };
  const hops = sessionEpisodeHops(withPause, laterFocus);
  // 复审（-25min 起）与续作（-5min 起）交接间隔 15min → 同段；研究（-90min 终）
  // 结束后到复审开始沉默 65 分钟 > 1h → 断开
  assert.deepEqual(hops.map((hop) => hop.taskId), ["session-run:5", "session-run:6"]);
  // 沉默上限可调（设置页 episodeGapMin）：放宽到 2h，65 分钟的沉默也串回来
  const relaxed = sessionEpisodeHops(withPause, laterFocus, 2 * 3_600_000);
  assert.deepEqual(relaxed.map((hop) => hop.taskId), ["session-run:1", "session-run:2", "session-run:5", "session-run:6"]);
});

test("toolProgressLabel/sessionErrorText: 工具名与常见报错的中文显示层", () => {
  assert.equal(toolProgressLabel("web_search"), "联网搜索");
  assert.equal(toolProgressLabel("exec"), "执行命令");
  assert.equal(toolProgressLabel("sessions_send"), "派发星位");
  assert.equal(toolProgressLabel("mystery_tool"), "mystery_tool");
  assert.equal(toolProgressLabel(null), "");
  assert.equal(
    sessionErrorText(
      "leo/gpt-6 request failed (provider internal error, HTTP 502). This is usually temporary — try again shortly.",
    ),
    "模型请求失败（provider 内部错误，HTTP 502）——通常是临时的，稍后重试",
  );
  assert.equal(sessionErrorText("LLM request timed out."), "模型请求超时");
  assert.equal(sessionErrorText("自定义错误原话"), "自定义错误原话");
  assert.equal(sessionErrorText(null), "");
});

test("toolProgressLabel/sessionErrorText: 关闭中文映射 = 回原文", () => {
  assert.equal(toolProgressLabel("exec", false), "exec");
  assert.equal(
    sessionErrorText("leo/gpt-6 request failed (provider internal error, HTTP 502).", false),
    "leo/gpt-6 request failed (provider internal error, HTTP 502).",
  );
});

test("groupSessionEpisodes: 台账全量按 gap 链分段，段按最近活动新→旧", () => {
  const min = 60_000;
  const now = 10_000_000_000;
  const at = (minAgo) => now - minAgo * min;
  const run = (id, sessionKey, startedMin, endedMin, status = "done") => ({
    id,
    sessionKey,
    status,
    startedAtMs: at(startedMin),
    endedAtMs: endedMin == null ? null : at(endedMin),
  });
  const runs = [
    // 同一群聊：3h 前一小轮（2 run）+ 刚才的一轮（3 run），中间沉默 2h 切段
    run(1, "agent:tianshu:feishu:group:oc_demo", 180, 176),
    run(2, "agent:tianxuan:feishu:group:oc_demo", 175, 171),
    run(3, "agent:tianshu:feishu:group:oc_demo", 40, 36),
    run(4, "agent:tianxuan:feishu:group:oc_demo", 35, 30),
    run(5, "agent:tianji:feishu:group:oc_demo", 30, 29, "failed"),
    // 另一个群聊的独立轮次（最近活动更新，应排最前）
    run(6, "agent:yuheng:feishu:group:oc_other", 25, 20),
  ];
  const episodes = groupSessionEpisodes(runs);
  assert.equal(episodes.length, 3);
  // 最近活动排序：oc_other 的轮次（20min）最靠前
  assert.equal(episodes[0].runs[0].id, 6);
  // 段内旧→新：刚收尾的一段是 3→4→5
  assert.deepEqual(episodes[1].runs.map((r) => r.id), [3, 4, 5]);
  assert.deepEqual(episodes[2].runs.map((r) => r.id), [1, 2]);
  // 段时间戳：开始 = 首跳开始，最近活动 = 末跳结束
  assert.equal(episodes[1].startedAtMs, at(40));
  assert.equal(episodes[1].lastActivityMs, at(29));
});

test("groupSessionEpisodes: 沉默上限跟随设置放宽/收紧", () => {
  const min = 60_000;
  const runs = [
    { id: 1, sessionKey: "agent:a:feishu:group:g", status: "done", startedAtMs: 120 * min, endedAtMs: 118 * min },
    { id: 2, sessionKey: "agent:b:feishu:group:g", status: "done", startedAtMs: 80 * min, endedAtMs: 75 * min },
  ];
  // 1h 上限：40 分钟沉默串成一段
  assert.equal(groupSessionEpisodes(runs).length, 1);
  // 20 分钟上限：切段
  assert.equal(groupSessionEpisodes(runs, 20 * min).length, 2);
  assert.equal(groupSessionEpisodes([]).length, 0);
  assert.equal(groupSessionEpisodes(null).length, 0);
});

test("isSubagentTask/cleanTaskTitle: 子 agent 任务识别与标题清理（真机 18791 形态）", () => {
  // 真机样例：tasks.list 里 kind=cli 的行，sessionKey/childSessionKey 落在
  // agent:天枢:subagent:<uuid>，标题 = spawn 上下文原文
  const sub = {
    kind: "cli",
    sessionKey: "agent:tianshu:subagent:59af0ac6-c53f-4baa-89ec-6095706bff34",
    childSessionKey: "agent:tianshu:subagent:59af0ac6-c53f-4baa-89ec-6095706bff34",
    title: "[Subagent Context] You are operating as a subagent of tianshu.",
  };
  assert.equal(isSubagentTask(sub), true);
  assert.equal(isSubagentTask({ sessionKey: "agent:tianshu:main" }), false);
  assert.equal(isSubagentTask({ sessionKey: "agent:tianshu:feishu:group:oc_x" }), false);
  assert.equal(isSubagentTask(null), false);
  assert.equal(
    cleanTaskTitle(sub),
    "You are operating as a subagent of tianshu.",
  );
  assert.equal(cleanTaskTitle({ title: "北斗巡检-OpenAI安全黑洞任务" }), "北斗巡检-OpenAI安全黑洞任务");
  assert.equal(cleanTaskTitle({ title: "" }), "");
  assert.equal(cleanTaskTitle(null), "");
});

test("cleanSessionTitle: openclaw cron 会话主题剥壳（真机 sinan.sqlite3 形态）", () => {
  // 真机样例：cron 触发的会话主题 = "[cron:<jobId> <任务名>] <指令原文>"，
  // 星盘副行/接力卡标题切前 8 字会露出 "[cron:a7…" 生料（Leo 装机截图抓到）。
  assert.equal(
    cleanSessionTitle(
      "[cron:a764a0f8-68e7-4bfe-bbca-a2a37aa2f842 skill-collection-review-tianji] Review this agent's Skill Workshop as a collection.",
    ),
    "skill-collection-review-tianji",
  );
  // 非 cron 主题原样透传；空值安全
  assert.equal(cleanSessionTitle("周报终稿校对并写入共享盘"), "周报终稿校对并写入共享盘");
  assert.equal(cleanSessionTitle(""), "");
  assert.equal(cleanSessionTitle(null), "");
});

test("sessionRunHop: 透传收工结论 terminalSummary（成果速览六案①）", () => {
  const hop = sessionRunHop({
    id: 9,
    status: "done",
    agentId: "tianshu",
    title: "巡检",
    terminalSummary: "巡检完成：发现 1 处卡点，已补发续跑卡。",
  });
  assert.equal(hop.terminalSummary, "巡检完成：发现 1 处卡点，已补发续跑卡。");
  assert.equal(sessionRunHop({ id: 1, status: "done" }).terminalSummary, null);
  assert.equal(sessionRunHop({}).terminalSummary, null);
});

test("cronScheduleText: 北斗常用族人话，其余透传", () => {
  assert.equal(cronScheduleText("0 14 * * *"), "每天 14:00");
  assert.equal(cronScheduleText("0 3 * * *"), "每天 03:00");
  assert.equal(cronScheduleText("*/30 * * * *"), "每 30 分钟");
  assert.equal(cronScheduleText("0 */6 * * *"), "每 6 小时");
  assert.equal(cronScheduleText("0 9 * * 1-5"), "工作日 09:00");
  assert.equal(cronScheduleText("15 8 1 * *"), "15 8 1 * *");
  assert.equal(cronScheduleText(""), "");
  assert.equal(cronScheduleText(null), "");
});

test("cronNextRunMs: 每天/工作日与每 N 分钟两族，其余 null", () => {
  const now = new Date("2026-10-04T15:00:00").getTime(); // 周六
  // 每天 14:00 已过 → 明天 14:00
  const nextDaily = cronNextRunMs("0 14 * * *", now);
  assert.equal(new Date(nextDaily).getDate(), 5);
  assert.equal(new Date(nextDaily).getHours(), 14);
  // 每 30 分钟 → 对齐到下个半点/整点
  const nextStep = cronNextRunMs("*/30 * * * *", now);
  assert.equal((nextStep - now) > 0 && (nextStep - now) <= 30 * 60_000, true);
  assert.equal(nextStep % (30 * 60_000), 0);
  // 工作日 09:00，周六 15:00 → 周一 09:00
  const nextWorkday = cronNextRunMs("0 9 * * 1-5", now);
  assert.equal(new Date(nextWorkday).getDay(), 1);
  assert.equal(new Date(nextWorkday).getHours(), 9);
  // 月度等不猜
  assert.equal(cronNextRunMs("15 8 1 * *", now), null);
  assert.equal(cronNextRunMs(null, now), null);
});

test("activeRelayEpisodes: 同群聊只留最新 run，展开完整轮次", () => {
  const now = 10_000_000_000;
  const min = 60_000;
  const runs = [
    { id: 1, sessionKey: "agent:tianshu:feishu:group:oc_r", agentId: "tianshu", status: "done", startedAtMs: now - 26 * min, endedAtMs: now - 24 * min },
    { id: 2, sessionKey: "agent:tianxuan:feishu:group:oc_r", agentId: "tianxuan", status: "done", startedAtMs: now - 24 * min, endedAtMs: now - 18 * min },
    { id: 3, sessionKey: "agent:tianji:feishu:group:oc_r", agentId: "tianji", status: "running", startedAtMs: now - 3 * min },
    // 另一群聊的活跃 run：独立成条
    { id: 4, sessionKey: "agent:yuheng:feishu:group:oc_other", agentId: "yuheng", status: "running", startedAtMs: now - 2 * min },
    // 已结束的 run 不是"活跃"
    { id: 5, sessionKey: "agent:kaiyang:feishu:group:oc_done", agentId: "kaiyang", status: "done", startedAtMs: now - min, endedAtMs: now - 30_000 },
  ];
  const activeRuns = runs.filter((run) => run.status === "running");
  const episodes = activeRelayEpisodes(runs, activeRuns);
  // oc_r 展开为 3 跳（1→2→3）；oc_other 单 run 不成链，不进全景
  assert.equal(episodes.length, 1);
  const relay = episodes[0];
  assert.equal(relay.chatId, "group:oc_r");
  assert.equal(relay.hops.length, 3);
  assert.equal(relay.hops[0].agentId, "tianshu");
  assert.equal(relay.hops[2].agentId, "tianji");
});

test("isQuietNow: 跨午夜免打扰与开关", () => {
  const at = (h, m) => new Date(2026, 9, 4, h, m);
  assert.equal(isQuietNow(true, "23:00", "08:00", at(23, 30)), true);
  assert.equal(isQuietNow(true, "23:00", "08:00", at(2, 0)), true);
  assert.equal(isQuietNow(true, "23:00", "08:00", at(12, 0)), false);
  assert.equal(isQuietNow(true, "23:00", "08:00", at(23, 0)), true);
  assert.equal(isQuietNow(true, "23:00", "08:00", at(8, 0)), false); // 端点右开
  assert.equal(isQuietNow(false, "23:00", "08:00", at(23, 30)), false); // 开关关=不静默
  assert.equal(isQuietNow(true, "12:00", "14:00", at(13, 0)), true); // 非跨午夜
  assert.equal(isQuietNow(true, "abc", "08:00", at(23, 30)), false); // 非法时间
});

test("detectRoundNotifications: 真失败响、良性哑、开机不回放历史", () => {
  const now = 10_000_000_000;
  const min = 60_000;
  const run = (over) => ({ agentId: "tianji", sessionKey: "agent:tianji:feishu:group:oc_r", ...over });
  const runs = [
    run({ id: 1, status: "done", title: "拆解", startedAtMs: now - 10 * min, endedAtMs: now - 9 * min }),
    // 真失败，新鲜 → 响
    run({ id: 2, status: "failed", title: "创作", error: "provider 502，未产出即回", startedAtMs: now - 6 * min, endedAtMs: now - 2 * min }),
    // 良性跳过 → 永远哑
    run({ id: 3, sessionKey: "agent:yuheng:cron:c1", agentId: "yuheng", status: "failed", title: "heartbeat", error: "heartbeat skipped: quiet-hours", startedAtMs: now - 3 * min, endedAtMs: now - 3 * min }),
    // 旧失败（超出新鲜窗）→ 不回放
    run({ id: 4, status: "failed", title: "旧账", error: "provider 502", startedAtMs: now - 60 * min, endedAtMs: now - 55 * min }),
  ];
  const config = { episodeGapMin: 60, freshnessMs: 15 * min, quietOn: false };
  const { toasts, next } = detectRoundNotifications(runs, {}, config, now);
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].kind, "fail");
  assert.ok(toasts[0].body.includes("创作"));
  // 第二拍：同一批 runs 再来 → 不重复响（failedSeen 已记）
  const second = detectRoundNotifications(runs, next, config, now + 3000);
  assert.equal(second.toasts.length, 0);
});

test("detectRoundNotifications: 跨轮失败合并成一张聚合卡", () => {
  const now = 10_000_000_000;
  const min = 60_000;
  const runs = [
    { id: 1, agentId: "tianxuan", sessionKey: "agent:tianxuan:feishu:group:oc_a", status: "failed", title: "研究", error: "provider 502", startedAtMs: now - 4 * min, endedAtMs: now - 2 * min },
    { id: 2, agentId: "tianji", sessionKey: "agent:tianji:feishu:group:oc_b", status: "failed", title: "创作", error: "LLM request timed out.", startedAtMs: now - 3 * min, endedAtMs: now - min },
  ];
  const { toasts } = detectRoundNotifications(runs, {}, { episodeGapMin: 60, freshnessMs: 15 * min }, now);
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].kind, "merge");
  assert.ok(toasts[0].body.includes("2 个轮次"));
});

test("detectRoundNotifications: 完成提醒只响一次，补发中的轮不提前响", () => {
  const now = 10_000_000_000;
  const min = 60_000;
  const key = "agent:tianji:feishu:group:oc_r";
  const done = { id: 2, agentId: "tianji", sessionKey: key, status: "done", title: "创作收工", startedAtMs: now - 5 * min, endedAtMs: now - 30_000 };
  // 上一拍：这轮还在跑（天枢 done + 天玑 running）
  const prevRuns = [
    { id: 1, agentId: "tianshu", sessionKey: key, status: "done", title: "拆解", startedAtMs: now - 10 * min, endedAtMs: now - 6 * min },
    { id: 2, agentId: "tianji", sessionKey: key, status: "running", title: "创作", startedAtMs: now - 5 * min },
  ];
  const config = { episodeGapMin: 60, freshnessMs: 15 * min };
  const first = detectRoundNotifications(prevRuns, {}, config, now - min);
  assert.equal(first.toasts.length, 0); // 还在跑，不响
  // 本拍：天玑收行 done → 完成提醒一次
  const second = detectRoundNotifications([...prevRuns.slice(0, 1), done], first.next, config, now);
  assert.equal(second.toasts.length, 1);
  assert.equal(second.toasts[0].kind, "ok");
  // 第三拍：同快照再来 → 不重复
  const third = detectRoundNotifications([done], second.next, config, now + min);
  assert.equal(third.toasts.length, 0);
});

test("detectRoundNotifications: 免打扰时段整批丢弃", () => {
  const now = new Date(2026, 9, 4, 23, 30).getTime();
  const min = 60_000;
  const runs = [
    { id: 1, agentId: "tianji", sessionKey: "agent:tianji:feishu:group:oc_r", status: "failed", title: "创作", error: "provider 502", startedAtMs: now - 2 * min, endedAtMs: now - min },
  ];
  const { toasts, next } = detectRoundNotifications(runs, {}, { episodeGapMin: 60, quietOn: true, quietStart: "23:00", quietEnd: "08:00" }, now);
  assert.equal(toasts.length, 0);
  // 免打扰里丢掉的失败，failedSeen 已记 → 时段过后也不回放（静默=不发）
  const later = detectRoundNotifications(runs, next, { episodeGapMin: 60 }, now + 3_600_000);
  assert.equal(later.toasts.length, 0);
});

test("buildFleetModules: 一个 agent 一块，跑的在前收班在后，记事取最近收班结论", () => {
  const dayStart = 1_000_000_000_000;
  const now = dayStart + 8 * 3_600_000;
  const modules = buildFleetModules({
    tasks: [
      { taskId: "t1", gateway: "g", agentId: "tianji", status: "running", title: "北斗矩阵", startedAtMs: now - 720_000, lastSeenMs: now - 60_000, toolUseCount: 3 },
      { taskId: "t0", gateway: "g", agentId: "tianji", status: "succeeded", title: "北斗矩阵", startedAtMs: dayStart + 1_000_000, endedAtMs: dayStart + 1_100_000, terminalSummary: "已定位真相并完成配置修改" },
    ],
    runs: [
      { id: "r1", agentId: "main", status: "done", title: "[Replying to: …] 不对，我之前…", startedAtMs: dayStart + 500_000, endedAtMs: dayStart + 560_000, terminalSummary: "不是必须添个堵", sessionKey: "agent:main:main:group:room1" },
      { id: "r2", agentId: "main", status: "running", title: "直接降级", startedAtMs: now - 300_000, sessionKey: "agent:main:main:group:room1" },
      { id: "r9", agentId: "tianquan", status: "done", title: "skill 检查", startedAtMs: dayStart - 86_400_000, endedAtMs: dayStart - 86_000_000, sessionKey: "agent:tianquan:main" },
    ],
    now,
    dayStartMs: dayStart,
  });
  assert.equal(modules.length, 2); // tianquan 的 run 在今天 0 点前，不占模块
  assert.equal(modules[0].agentId, "main"); // 跑着的按开始时间新→旧
  assert.equal(modules[1].agentId, "tianji");
  assert.ok(modules[0].running, "main 是活模块");
  assert.equal(modules[0].roundIndex, 2, "同会话第 2 轮");
  assert.equal(modules[0].lastEnded.terminalSummary, "不是必须添个堵");
  assert.ok(modules[1].running, "tianji 任务跑着");
  assert.equal(modules[1].lastEnded.terminalSummary, "已定位真相并完成配置修改");
  assert.equal(modules[1].records[0].title, "北斗矩阵");
});

test("buildFleetModules: 纯收班 agent 出暗模块，空输入不出模块", () => {
  const dayStart = 1_000_000_000_000;
  const modules = buildFleetModules({
    tasks: [],
    runs: [{ id: "r1", agentId: "yuheng", status: "failed", title: "北斗矩阵", startedAtMs: dayStart + 100, endedAtMs: dayStart + 200, error: "boom", sessionKey: "k" }],
    now: dayStart + 999_999,
    dayStartMs: dayStart,
  });
  assert.equal(modules.length, 1);
  assert.equal(modules[0].agentId, "yuheng");
  assert.equal(modules[0].running, null);
  assert.equal(modules[0].lastEnded.status, "failed");
  assert.equal(buildFleetModules({ tasks: [], runs: [], now: dayStart, dayStartMs: dayStart }).length, 0);
});

test("buildAgentRoster: 一星一格去重，灯色取今夜最新一跳，无记录=rest", () => {
  const dayStart = 1_000_000_000_000;
  const roster = buildAgentRoster({
    agents: ["tianshu", "tianxuan", "tianji", "tianquan", "yuheng", "kaiyang", "yaoguang", "main"],
    tasks: [],
    runs: [
      // 天璇今夜两跳（最新=done），天玑跑着，天权今夜失败，玉衡昨天跳过（不算）
      { id: "r1", agentId: "tianxuan", status: "done", startedAtMs: dayStart + 100, endedAtMs: dayStart + 200 },
      { id: "r2", agentId: "tianxuan", status: "running", startedAtMs: dayStart + 300, sessionKey: "k" },
      { id: "r3", agentId: "tianji", status: "running", startedAtMs: dayStart + 150 },
      { id: "r4", agentId: "tianquan", status: "failed", startedAtMs: dayStart + 120, endedAtMs: dayStart + 180, error: "boom" },
      { id: "r5", agentId: "yuheng", status: "done", startedAtMs: dayStart - 86_400_000, endedAtMs: dayStart - 86_000_000 },
    ],
    now: dayStart + 999_999,
    dayStartMs: dayStart,
    order: ["tianshu", "tianxuan", "tianji", "tianquan", "yuheng", "kaiyang", "yaoguang", "main"],
  });
  assert.equal(roster.length, 7); // 花名册：北斗七星全量；客星（main）编制豁免空闲不占格
  assert.equal(roster[0].agentId, "tianshu");
  assert.equal(roster[0].tone, "rest"); // 今夜无活动
  assert.equal(roster.some((e) => e.agentId === "main"), false); // 客星空闲不出格
  const tianxuan = roster.find((e) => e.agentId === "tianxuan");
  assert.equal(tianxuan.tone, "current"); // 最新一跳 running → ● 绿呼吸
  assert.equal(tianxuan.records.length, 2); // 悬停星卡按星聚合今夜全部跳
  const tianji = roster.find((e) => e.agentId === "tianji");
  assert.equal(tianji.tone, "current");
  const tianquan = roster.find((e) => e.agentId === "tianquan");
  assert.equal(tianquan.tone, "failed");
  const yuheng = roster.find((e) => e.agentId === "yuheng");
  assert.equal(yuheng.tone, "rest"); // 昨天的跳不入灯（今夜窗口）
});

test("buildAgentRoster: order 外的新星追加尾部，agents.list 独占的星也占格", () => {
  const dayStart = 1_000_000_000_000;
  const roster = buildAgentRoster({
    agents: ["tianshu", "xinbin"],
    tasks: [{ gateway: "vps", taskId: "t1", agentId: "xinbin", status: "succeeded", startedAtMs: dayStart + 10, endedAtMs: dayStart + 20 }],
    runs: [],
    now: dayStart + 999,
    dayStartMs: dayStart,
    order: ["tianshu", "tianxuan"],
  });
  assert.equal(roster.length, 2);
  assert.equal(roster[0].agentId, "tianshu"); // order 在前
  assert.equal(roster[1].agentId, "xinbin"); // 新星追加尾部
  assert.equal(roster[0].tone, "rest");
  assert.equal(roster[1].tone, "done"); // 登记任务也参与灯色
});

test("buildAgentRoster: agents.list 全 id（VPS-北斗:x）与账本短 id 同星归一，绝不双格", () => {
  const dayStart = 1_000_000_000_000;
  // 真机形态：agentNameMap 同时注册短 id 与网关全 id（buildAgentNameMap 双注），
  // 2026-10-07 装机实锤：不归一=天枢✓后面跟着第二个○天枢。
  const roster = buildAgentRoster({
    agents: [
      "main", "tianshu", "tianxuan", "tianji", "tianquan", "yuheng", "kaiyang", "yaoguang",
      "VPS-北斗:tianshu", "VPS-北斗:tianxuan", "VPS-北斗:tianji", "VPS-北斗:tianquan",
      "VPS-北斗:yuheng", "VPS-北斗:kaiyang", "VPS-北斗:yaoguang",
    ],
    tasks: [],
    runs: [
      { id: "r1", agentId: "tianshu", status: "done", startedAtMs: dayStart + 100, endedAtMs: dayStart + 200 },
    ],
    now: dayStart + 999_999,
    dayStartMs: dayStart,
    order: ["tianshu", "tianxuan", "tianji", "tianquan", "yuheng", "kaiyang", "yaoguang", "main"],
  });
  const ids = roster.map((entry) => entry.agentId);
  assert.equal(new Set(ids).size, ids.length, "同星只能占一格");
  assert.equal(roster.length, 7);
  assert.equal(ids.filter((id) => id === "tianshu").length, 1);
  assert.equal(roster.find((entry) => entry.agentId === "tianshu").tone, "done");
});

test("buildAgentRoster: 客星（openclaw 兜底）空闲不占格，今夜有活动进末位", () => {
  const dayStart = 1_000_000_000_000;
  const order = ["tianshu", "tianxuan", "tianji", "tianquan", "yuheng", "kaiyang", "yaoguang", "main"];
  const agents = [
    "tianshu", "tianxuan", "tianji", "tianquan", "yuheng", "kaiyang", "yaoguang",
    "VPS-北斗:tianshu", "main",
  ];
  // 空闲：客星不占格，七星各一
  const idle = buildAgentRoster({ agents, tasks: [], runs: [], now: dayStart + 999, dayStartMs: dayStart, order });
  assert.equal(idle.some((entry) => entry.agentId === "main"), false, "客星空闲不出格");
  assert.equal(idle.length, 7);
  assert.deepEqual(idle.map((entry) => entry.agentId), order.slice(0, 7), "北斗星序");
  // 有活动：客星追加末位（兜底星动了才值得看）
  const active = buildAgentRoster({
    agents,
    tasks: [],
    runs: [
      { id: "m1", agentId: "main", status: "failed", startedAtMs: dayStart + 100, endedAtMs: dayStart + 300, error: "boom" },
    ],
    now: dayStart + 999_999,
    dayStartMs: dayStart,
    order,
  });
  assert.equal(active.length, 8);
  assert.equal(active[7].agentId, "main", "客星有活动进末位");
  assert.equal(active[7].tone, "failed");
});


test("buildCronNextByAgent keeps the earliest enabled next run per star, skips unattributable or disabled jobs", () => {
  const now = 1_700_000_000_000;
  const map = buildCronNextByAgent([
    { id: "patrol", enabled: true, agentId: "tianji", nextRunAtMs: now + 3_600_000, name: "巡检" },
    { id: "heartbeat", enabled: true, agentId: "VPS-北斗:tianji", nextRunAtMs: now + 600_000, name: "心跳" },
    { id: "keepalive", enabled: true, agentId: "tianshu", nextRunAtMs: now + 60_000, name: "保活" },
    { id: "disabled", enabled: false, agentId: "tianshu", nextRunAtMs: now + 1_000, name: "停用" },
    { id: "orphan", enabled: true, nextRunAtMs: now + 2_000, name: "无主" },
    { id: "stale", enabled: true, agentId: "yuheng", nextRunAtMs: now - 500_000, scheduleEveryMs: 600_000, name: "过期滚动" },
  ], now);
  assert.equal(map.size, 3);
  // 同星双任务取最早；全 id 归一（VPS-北斗: 前缀剥掉）后命中同星。
  assert.equal(map.get("tianji").atMs, now + 600_000);
  assert.equal(map.get("tianji").job.id, "heartbeat");
  assert.equal(map.get("tianshu").atMs, now + 60_000);
  // 过期时刻按 everyMs 滚动到未来（cronNextAtOf 语义）。
  assert.ok(map.get("yuheng").atMs > now);
});

test("buildAgentRoster: 实时活跃融合与僵尸行判死（Leo 2026-10-07 实锤胶囊慢/常亮）", () => {
  const now = 1_700_000_000_000;
  const dayStart = now - 8 * 3_600_000;
  const roster = buildAgentRoster({
    agents: ["tianji", "yuheng", "tianquan", "tianshu"],
    tasks: [],
    runs: [
      // 天玑：台账今夜收班，但快照说在跑 → 立即亮 ●（合成"已接收"跳）
      { id: 1, agentId: "tianji", status: "done", startedAtMs: dayStart + 3_600_000, endedAtMs: dayStart + 3_600_000 + 60_000, lastSeenMs: dayStart + 3_600_000 + 60_000, title: "镜像去重" },
      // 玉衡：台账 running 但 last_seen 停在 1 小时前 = 僵尸 → 不亮灯按收班呈现
      { id: 2, agentId: "yuheng", status: "running", startedAtMs: now - 3_600_000, lastSeenMs: now - 3_600_000 },
      // 天权：台账 running 且新鲜（cron 类会话不在 sessions.list）→ 保持 ●
      { id: 3, agentId: "tianquan", status: "running", startedAtMs: now - 30_000, lastSeenMs: now - 3_000 },
    ],
    dayStartMs: dayStart,
    order: ["tianji", "yuheng", "tianquan", "tianshu"],
    nowMs: now,
    staleMs: 120_000,
    liveActiveAgentIds: new Set(["tianji", "tianshu"]),
  });
  const byId = new Map(roster.map((entry) => [entry.agentId, entry]));
  // 快照活跃压过台账收班：同一拍亮、同一拍熄（与星位上下文同源）。
  assert.equal(byId.get("tianji").tone, "current");
  assert.equal(byId.get("tianji").hop.startedAtMs, now);
  assert.equal(byId.get("tianji").hop.title, "镜像去重");
  // 僵尸 running 行：running 判死 + 呈现层降级，绝不呼吸。
  assert.equal(byId.get("yuheng").running, null);
  assert.equal(byId.get("yuheng").tone, "done");
  // 新鲜的台账 running 行（cron 类不在 sessions.list）保持 ●。
  assert.equal(byId.get("tianquan").tone, "current");
  assert.equal(byId.get("tianquan").running.lastSeenMs, now - 3_000);
  // 台账零行但快照活跃：合成"已接收"跳占格亮灯。
  assert.equal(byId.get("tianshu").tone, "current");
  assert.equal(byId.get("tianshu").hop.taskId, "live:tianshu");
  assert.equal(byId.get("tianshu").hop.title, "");
});

test("buildAgentRoster: 快照覆盖到的星以快照为唯一真相——台账收行滞后 18 秒也不再亮（Leo 2026-10-07 二轮实锤）", () => {
  const now = 1_700_000_000_000;
  const dayStart = now - 8 * 3_600_000;
  const roster = buildAgentRoster({
    agents: ["tianshu"],
    tasks: [],
    runs: [
      // 复刻 21:16 现场台账：running 行 25 秒前开始、last_seen 停在 14 秒前
      // （回复已到、收行要等会话再次现身）——快照覆盖到天枢且全空闲。
      { id: 7, agentId: "tianshu", status: "running", startedAtMs: now - 25_000, lastSeenMs: now - 14_000, title: "群派活" },
    ],
    dayStartMs: dayStart,
    order: ["tianshu"],
    nowMs: now,
    staleMs: 120_000,
    liveActiveAgentIds: new Set(),
    snapshotAgentIds: new Set(["tianshu"]),
  });
  assert.equal(roster[0].running, null);
  assert.equal(roster[0].tone, "done");
  // 对照组：快照没覆盖的星（纯 cron 场景/快照整体失败）同款行保持 ●。
  const roster2 = buildAgentRoster({
    agents: ["tianquan"],
    tasks: [],
    runs: [{ id: 8, agentId: "tianquan", status: "running", startedAtMs: now - 30_000, lastSeenMs: now - 3_000 }],
    dayStartMs: dayStart,
    order: ["tianquan"],
    nowMs: now,
    staleMs: 120_000,
    liveActiveAgentIds: new Set(),
    snapshotAgentIds: new Set(),
  });
  assert.equal(roster2[0].tone, "current");
});

test("stale snapshot defuses active lights instead of lying (Leo 2026-10-08)", () => {
  const now = 1_700_000_000_000;
  const snap = {
    retrievedAt: now,
    agents: [{ agentId: "tianshu", active: true, runningTasks: 1 }],
    sessions: [
      { key: "agent:tianshu:feishu:group:g1", agentId: "tianshu", hasActiveRun: true, contextTokens: 138_000 },
      { key: "agent:tianshu:main", agentId: "tianshu", hasActiveRun: false, contextTokens: 26_000 },
    ],
  };
  // 新鲜快照原样透传（活跃灯该亮就亮）。
  assert.equal(defuseStaleSnapshotActivity(snap, now), snap);
  assert.equal(defuseStaleSnapshotActivity(snap, now + SNAPSHOT_FRESH_MS), snap);
  // 过龄快照：活跃灯一律熄灭，数字与会话一个不丢。
  const defused = defuseStaleSnapshotActivity(snap, now + SNAPSHOT_FRESH_MS + 1);
  assert.notEqual(defused, snap);
  assert.equal(defused.sessions.length, 2);
  assert.equal(defused.sessions[0].hasActiveRun, false);
  assert.equal(defused.sessions[0].contextTokens, 138_000);
  assert.equal(defused.sessions[0].key, "agent:tianshu:feishu:group:g1");
  // 没 retrievedAt 的（浏览器演示/未知形态）不掺和；本来就没活跃灯的不重建对象。
  assert.equal(defuseStaleSnapshotActivity({ sessions: [] }, now + 10 ** 9).sessions.length, 0);
  const idleOnly = { retrievedAt: now - 10 ** 9, sessions: [{ hasActiveRun: false }] };
  assert.equal(defuseStaleSnapshotActivity(idleOnly, now).sessions[0].hasActiveRun, false);
});

test("connection light trusts agent snapshot results, never an empty shell call", () => {
  // 真连接：至少一个网关上报且全成功
  assert.equal(gatewayResultsAllOk([{ gateway: "vps", ok: true }]), true);
  assert.equal(
    gatewayResultsAllOk([{ gateway: "vps", ok: true }, { gateway: "local", ok: true }]),
    true,
  );
  // 空名单=没上报，不许谎报已连接（旧逻辑空数组 every 恒 true 正是假绿灯来源）
  assert.equal(gatewayResultsAllOk([]), false);
  assert.equal(gatewayResultsAllOk(null), false);
  assert.equal(gatewayResultsAllOk(undefined), false);
  // 任一失败=未连接
  assert.equal(gatewayResultsAllOk([{ gateway: "vps", ok: true }, { gateway: "local", ok: false }]), false);
  // 缓存回放的载荷带同一份 results：两窗看到同一个灯
  const cached = { agents: [], sessions: [], results: [{ gateway: "vps", ok: false, error: "timeout" }] };
  assert.equal(gatewayResultsAllOk(cached.results), false);
});

test("gateway failure text names the gateway and its error", () => {
  assert.equal(gatewayFailureText([]), "");
  assert.equal(gatewayFailureText(null), "");
  assert.equal(
    gatewayFailureText([
      { gateway: "vps", ok: false, error: "connect failed" },
      { gateway: "local", ok: true },
      { gateway: "backup", ok: false, error: "timeout" },
    ]),
    "vps：connect failed；backup：timeout",
  );
  // 缺字段不炸，如实兜底
  assert.equal(gatewayFailureText([{ ok: false }]), "?：未知错误");
});
