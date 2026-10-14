// cockpit.js 纯逻辑测试（node --test）。本地没有 cargo，Rust 侧只能靠 CI 兜，
// 所以能测的逻辑全部钉在 JS 侧——尤其是 Leo 逐条点过的 7 个 bug 的防回归。

import test from "node:test";
import assert from "node:assert/strict";

import {
  DELIVERABLE_MODES,
  DELIVERABLE_MODE_LABEL,
  normalizeDeliverableMode,
  normalizeEntryMode,
  textWantsDual,
  stripDualMarker,
  parseLaunchInput,
  DAG_STEPS,
  PARALLEL_BRANCHES,
  dagStepOfCase,
  branchStatesOf,
  mergeLockOf,
  GATE_VERDICTS,
  normalizeGateVerdict,
  GATE_VERDICT_LABEL,
  STRIKE_LIMIT,
  masterDocBadge,
  isAutoHealing,
  SEVEN_AXES,
  FIVE_AXES,
  HUMANITY_PROBES,
  axisScores,
  axisTone,
  fiveAxisTotal,
  rankCandidateTitles,
  WATCHDOG_BRANCHES,
  WATCHDOG_PERIOD_MS,
  watchdogEventBranch,
  watchdogMatrix,
  archiveRowTitle,
  archiveResidencyText,
  starNameOf,
  starOnlineTone,
  canAppendVideo,
  assetSlotState,
} from "./cockpit.js";

// ---------------------------------------------------------------------------
test("交付模式三态归一：默认仅图文，别名与大小写都吃", () => {
  assert.equal(normalizeDeliverableMode("IMAGE_ONLY"), "IMAGE_ONLY");
  assert.equal(normalizeDeliverableMode("dual"), "DUAL");
  assert.equal(normalizeDeliverableMode(" 图文+视频双出 "), "DUAL");
  assert.equal(normalizeDeliverableMode("video"), "VIDEO_ONLY");
  assert.equal(normalizeDeliverableMode(""), "IMAGE_ONLY");
  assert.equal(normalizeDeliverableMode("garbage"), "IMAGE_ONLY");
  assert.equal(normalizeDeliverableMode(null), "IMAGE_ONLY");
  // 三态一个不少
  assert.equal(DELIVERABLE_MODES.length, 3);
  for (const mode of DELIVERABLE_MODES) assert.ok(DELIVERABLE_MODE_LABEL[mode]);
});

test("入口模式：默认自主寻题", () => {
  assert.equal(normalizeEntryMode("DIRECT_TITLE"), "DIRECT_TITLE");
  assert.equal(normalizeEntryMode("direct"), "DIRECT_TITLE");
  assert.equal(normalizeEntryMode("AUTO_DISCOVERY"), "AUTO_DISCOVERY");
  assert.equal(normalizeEntryMode(""), "AUTO_DISCOVERY");
});

// ---------------------------------------------------------------------------
test("智能输入联动：+视频 命中双出并整段剥掉", () => {
  assert.equal(textWantsDual("玄关别堆杂物 +视频"), true);
  assert.equal(textWantsDual("玄关别堆杂物 双出"), true);
  assert.equal(textWantsDual("餐边柜改造 含视频"), true);
  assert.equal(textWantsDual("普通图文标题"), false);
  assert.equal(textWantsDual(""), false);
  assert.equal(textWantsDual(null), false);
});

test("剥离标记词后标题干净，无残渣符号", () => {
  assert.equal(stripDualMarker("玄关别堆杂物 +视频"), "玄关别堆杂物");
  assert.equal(stripDualMarker("玄关别堆杂物 双出"), "玄关别堆杂物");
  assert.equal(stripDualMarker("餐边柜，含视频"), "餐边柜");
  assert.equal(stripDualMarker("标题 /加视频"), "标题");
  // 两连标记词也要吃干净
  assert.equal(stripDualMarker("标题 +视频 双出"), "标题");
  // 收尾孤立符号
  assert.equal(stripDualMarker("标题 -"), "标题");
  assert.equal(stripDualMarker("标题，"), "标题");
  // 没有标记词时原样
  assert.equal(stripDualMarker("沙发别贴空墙｜3 个细节"), "沙发别贴空墙｜3 个细节");
  // 中间出现的视频词不是尾缀，不动（那是标题本义）
  assert.equal(stripDualMarker("视频拍摄入门指南"), "视频拍摄入门指南");
  assert.equal(stripDualMarker(""), "");
});

test("发车参数：标记词强制升 DUAL，显式选择被顶掉要有标记", () => {
  // 显式仅图文 + 输入带 +视频 → 升 DUAL 且标出被顶掉
  const overridden = parseLaunchInput("玄关 +视频", "IMAGE_ONLY");
  assert.equal(overridden.title, "玄关");
  assert.equal(overridden.deliverableMode, "DUAL");
  assert.equal(overridden.modeOverridden, true);
  assert.equal(overridden.ready, true);

  // 显式选双出，输入干净 → 维持 DUAL，不算顶掉
  const explicitDual = parseLaunchInput("玄关收纳", "DUAL");
  assert.equal(explicitDual.deliverableMode, "DUAL");
  assert.equal(explicitDual.modeOverridden, false);

  // 空标题 → 不可发车
  const empty = parseLaunchInput("   ", "IMAGE_ONLY");
  assert.equal(empty.ready, false);
  assert.equal(empty.deliverableMode, "IMAGE_ONLY");

  // 只有标记词没标题 → 剥完为空，不可发车（不能发一条"双出"上去）
  const onlyMarker = parseLaunchInput("+视频", "IMAGE_ONLY");
  assert.equal(onlyMarker.title, "");
  assert.equal(onlyMarker.ready, false);
});

// ---------------------------------------------------------------------------
test("DAG 拓扑：严格 7 步，无 Leo 阻塞节点", () => {
  assert.equal(DAG_STEPS.length, 7);
  const stars = DAG_STEPS.map((s) => s.star);
  // Leo 明确要求移除第 4 个 Leo 定题阻塞节点
  assert.ok(!stars.includes("leo"));
  // 顺序：天枢→天璇→天权初审→天玑→天权二审→并行→摇光
  assert.deepEqual(stars, ["tianshu", "tianxuan", "tianquan", "tianji", "tianquan", "par", "yaoguang"]);
  // 编号 01..07
  assert.deepEqual(DAG_STEPS.map((s) => s.no), ["01", "02", "03", "04", "05", "06", "07"]);
  // 门禁只在二审
  assert.equal(DAG_STEPS.filter((s) => s.gate).length, 1);
  assert.equal(DAG_STEPS[4].gate, "second");
  // 并行位是第 6 步
  assert.equal(DAG_STEPS[5].parallel, true);
});

test("并行分支副标题：玉衡=视觉插图封面，开阳=脚本分镜视频（不再重复）", () => {
  assert.equal(PARALLEL_BRANCHES.length, 2);
  const [yuheng, kaiyang] = PARALLEL_BRANCHES;
  assert.equal(yuheng.star, "yuheng");
  assert.equal(kaiyang.star, "kaiyang");
  assert.match(yuheng.title, /视觉/);
  assert.match(yuheng.title, /封面/);
  assert.match(kaiyang.title, /脚本/);
  assert.match(kaiyang.title, /视频/);
  assert.notEqual(yuheng.title, kaiyang.title);
  assert.equal(yuheng.key, "06A");
  assert.equal(kaiyang.key, "06B");
});

test("dagStepOfCase：越界夹回 0..6", () => {
  assert.equal(dagStepOfCase(0), 0);
  assert.equal(dagStepOfCase(6), 6);
  assert.equal(dagStepOfCase(99), 6);
  assert.equal(dagStepOfCase(-5), 0);
  assert.equal(dagStepOfCase("abc"), 0);
  assert.equal(dagStepOfCase(undefined), 0);
});

// ---------------------------------------------------------------------------
test("分支激活态：仅图文时开阳 STANDBY，双出时双激活", () => {
  // 仅图文，正在并行位
  const imageOnly = branchStatesOf({ step: 5, deliverableMode: "IMAGE_ONLY" });
  assert.equal(imageOnly.yuheng, "active");
  assert.equal(imageOnly.kaiyang, "standby");

  // 双出，正在并行位
  const dual = branchStatesOf({ step: 5, deliverableMode: "DUAL" });
  assert.equal(dual.yuheng, "active");
  assert.equal(dual.kaiyang, "active");

  // 仅视频：玉衡反过来待命
  const videoOnly = branchStatesOf({ step: 5, deliverableMode: "VIDEO_ONLY" });
  assert.equal(videoOnly.yuheng, "standby");
  assert.equal(videoOnly.kaiyang, "active");

  // 未到并行位：都是 idle（不该提前亮）
  const early = branchStatesOf({ step: 2, deliverableMode: "DUAL" });
  assert.equal(early.yuheng, "idle");
  assert.equal(early.kaiyang, "idle");

  // 已过并行位：done
  const done = branchStatesOf({ step: 6, deliverableMode: "DUAL" });
  assert.equal(done.yuheng, "done");
  assert.equal(done.kaiyang, "done");
});

test("双轨合流锁：仅双出且到并行位后才渲染", () => {
  assert.equal(mergeLockOf({ step: 2, deliverableMode: "DUAL" }), null);
  assert.equal(mergeLockOf({ step: 5, deliverableMode: "IMAGE_ONLY" }), null);

  const partial = mergeLockOf({ step: 5, deliverableMode: "DUAL", visualProgress: 1, videoProgress: 0.5 });
  assert.equal(partial.done, 1);
  assert.equal(partial.total, 2);
  assert.equal(partial.ready, false);

  const full = mergeLockOf({ step: 5, deliverableMode: "DUAL", visualProgress: 1, videoProgress: 1 });
  assert.equal(full.done, 2);
  assert.equal(full.ready, true);

  // 进度越界夹回 0..1
  const clamped = mergeLockOf({ step: 5, deliverableMode: "DUAL", visualProgress: 3, videoProgress: -1 });
  assert.equal(clamped.visual, 1);
  assert.equal(clamped.video, 0);
});

// ---------------------------------------------------------------------------
test("门禁结论归一：五种结论一个不漏", () => {
  assert.equal(GATE_VERDICTS.length, 5);
  assert.equal(normalizeGateVerdict("PASS"), "PASS");
  assert.equal(normalizeGateVerdict("passed"), "PASS");
  assert.equal(normalizeGateVerdict("通过"), "PASS");
  assert.equal(normalizeGateVerdict("FAIL · 小改"), "FAIL_MINOR");
  assert.equal(normalizeGateVerdict("fail minor"), "FAIL_MINOR");
  assert.equal(normalizeGateVerdict("FAIL · 中改"), "FAIL_MAJOR");
  assert.equal(normalizeGateVerdict("FAIL · 重写"), "FAIL_REWRITE");
  assert.equal(normalizeGateVerdict("FATAL"), "FATAL");
  // 认不出的按小改（最安全的中间态），不能默认 PASS
  assert.equal(normalizeGateVerdict(""), "FAIL_MINOR");
  assert.equal(normalizeGateVerdict("???"), "FAIL_MINOR");
  for (const v of GATE_VERDICTS) assert.ok(GATE_VERDICT_LABEL[v]);
});

test("母稿冻结徽章：只有二审 PASS 后才允许说已冻结（Bug 2）", () => {
  // PASS → 冻结
  const frozen = masterDocBadge({ secondVerdict: "PASS", masterFrozen: true, secondStrikes: 0 });
  assert.equal(frozen.kind, "frozen");
  assert.equal(frozen.tone, "indigo");
  assert.match(frozen.text, /母稿已冻结/);

  // FAIL 但 masterFrozen 标志误置 → 严禁渲染"已冻结"
  const failNotFrozen = masterDocBadge({ secondVerdict: "FAIL · 中改", masterFrozen: true, secondStrikes: 1 });
  assert.notEqual(failNotFrozen.kind, "frozen");
  assert.equal(failNotFrozen.kind, "strike");
  assert.match(failNotFrozen.text, /打回重审 1\/3/);

  // 3/3 → 自愈重修，不是"已冻结"
  const healing = masterDocBadge({ secondVerdict: "FAIL · 重写", masterFrozen: false, secondStrikes: 3 });
  assert.equal(healing.kind, "autoheal");
  assert.equal(healing.tone, "amber");
  assert.match(healing.text, /天枢自愈重修中/);

  // 超限打回次数也走自愈（4 次等同熔断）
  assert.equal(masterDocBadge({ secondStrikes: 5 }).kind, "autoheal");

  // FATAL → 母稿被毙
  const dead = masterDocBadge({ secondVerdict: "FATAL", secondStrikes: 0 });
  assert.equal(dead.kind, "rejected");
  assert.equal(dead.tone, "cinnabar");

  // 无结论 → 进行中
  assert.equal(masterDocBadge({ secondStrikes: 0 }).kind, "pending");
});

test("熔断自愈判定：3/3 触发", () => {
  assert.equal(STRIKE_LIMIT, 3);
  assert.equal(isAutoHealing({ secondStrikes: 2 }), false);
  assert.equal(isAutoHealing({ secondStrikes: 3 }), true);
  assert.equal(isAutoHealing({ secondStrikes: 4 }), true);
  assert.equal(isAutoHealing({}), false);
});

// ---------------------------------------------------------------------------
test("七轴严格对齐 SOP 4.3，去 AI 味细项单列（Bug 5）", () => {
  assert.deepEqual(SEVEN_AXES.map((a) => a.label), [
    "准确性", "合规性", "人味", "人设一致性", "传播性", "逻辑性", "可读性",
  ]);
  // 原看板误当七轴的那批，必须只在探针细项里
  assert.deepEqual(HUMANITY_PROBES.map((p) => p.label), [
    "具体度", "节奏", "禁用词", "立场安全", "结构", "标题契合",
  ]);
  for (const probe of HUMANITY_PROBES) {
    assert.ok(!SEVEN_AXES.some((axis) => axis.label === probe.label));
  }
  // 初审五轴 ≠ 二审七轴
  assert.equal(FIVE_AXES.length, 5);
  assert.ok(FIVE_AXES.length < SEVEN_AXES.length);
});

test("七轴分数归一与色阶", () => {
  const s = axisScores({ accuracy: 90, compliance: 62, humanity: 28 });
  assert.equal(s.accuracy, 90);
  assert.equal(s.compliance, 62);
  assert.equal(s.humanity, 28);
  // 缺轴按 0，不能显示成绿
  assert.equal(s.persona, 0);
  // 越界夹回
  assert.equal(axisScores({ accuracy: 150 }).accuracy, 100);
  assert.equal(axisScores({ accuracy: -9 }).accuracy, 0);
  assert.equal(axisScores(null).accuracy, 0);

  assert.equal(axisTone(90), "jade");
  assert.equal(axisTone(80), "jade");
  assert.equal(axisTone(79), "bronze");
  assert.equal(axisTone(60), "bronze");
  assert.equal(axisTone(59), "cinnabar");
  assert.equal(axisTone(0), "cinnabar");
});

test("候选标题排名：总分第一自动钦定", () => {
  const ranked = rankCandidateTitles([
    { title: "候选二", scores: { accuracy: 80, compliance: 80, humanity: 80, persona: 80, spread: 80 } },
    { title: "候选一", scores: { accuracy: 90, compliance: 90, humanity: 90, persona: 90, spread: 90 } },
    { title: "候选三", scores: { accuracy: 60, compliance: 60, humanity: 60, persona: 60, spread: 60 } },
  ]);
  assert.equal(ranked[0].title, "候选一");
  assert.equal(ranked[0].champion, true);
  assert.equal(ranked[0].total, 450);
  assert.equal(ranked[1].total, 400);
  assert.equal(ranked[2].total, 300);
  assert.equal(ranked.filter((r) => r.champion).length, 1);
  assert.equal(fiveAxisTotal({ accuracy: 90, spread: 10 }), 100);

  // 平分时取靠前那个（稳定，不随机钦定）
  const tie = rankCandidateTitles([
    { title: "A", scores: { accuracy: 50 } },
    { title: "B", scores: { accuracy: 50 } },
  ]);
  assert.equal(tie[0].title, "A");
  assert.equal(tie[0].champion, true);
  assert.equal(tie[1].champion, true);

  assert.deepEqual(rankCandidateTitles(null), []);
});

// ---------------------------------------------------------------------------
test("Watchdog：20 分钟周期 + 五分支 + 处置回执（Bug 7）", () => {
  assert.equal(WATCHDOG_PERIOD_MS, 20 * 60 * 1000);
  assert.equal(WATCHDOG_BRANCHES.length, 5);
  assert.deepEqual(WATCHDOG_BRANCHES.map((b) => b.label), [
    "无事静默", "漏派自动补发", "超时重唤醒", "熔断自愈中", "今日自动关单",
  ]);

  const ev = watchdogEventBranch({ kind: "REWAKE", at: 1000, receipt: "天权 判词驻留超 20m -> Watchdog 已自动重发 sessions_send 唤醒" });
  assert.equal(ev.key, "rewake");
  assert.match(ev.receipt, /sessions_send/);

  assert.equal(watchdogEventBranch({ kind: "MISSING_DISPATCH" }).key, "redispatch");
  assert.equal(watchdogEventBranch({ kind: "AUTO_HEAL" }).key, "heal");
  assert.equal(watchdogEventBranch({ kind: "AUTO_CLOSE" }).key, "closed");
  // 认不出的分支按静默（不能凭空造一个红）
  assert.equal(watchdogEventBranch({ kind: "???" }).key, "silent");
});

test("巡检矩阵：每分支取最近一条，空分支不占位", () => {
  const matrix = watchdogMatrix([
    { kind: "REWAKE", at: 1000, receipt: "旧回执" },
    { kind: "REWAKE", at: 5000, receipt: "新回执" },
    { kind: "AUTO_HEAL", at: 3000, receipt: "自愈回执" },
    { kind: "SILENT", at: 2000 },
  ]);
  assert.equal(matrix.length, 3);
  const rewake = matrix.find((b) => b.key === "rewake");
  assert.equal(rewake.at, 5000);
  assert.equal(rewake.receipt, "新回执");
  assert.ok(matrix.find((b) => b.key === "heal"));
  // redispatch 与 closed 没发生过，不该出现
  assert.ok(!matrix.find((b) => b.key === "redispatch"));
  assert.ok(!matrix.find((b) => b.key === "closed"));
  assert.deepEqual(watchdogMatrix(null), []);
});

// ---------------------------------------------------------------------------
test("卷宗列表：任务名优先，阶段名不许当主标题（Bug 6）", () => {
  // 有正式标题 → 用标题
  assert.equal(archiveRowTitle({ title: "沙发别贴空墙｜3 个细节", name: "客厅沙发摆放" }), "沙发别贴空墙｜3 个细节");
  // 无标题 → 用任务名
  assert.equal(archiveRowTitle({ name: "客厅沙发摆放" }), "客厅沙发摆放");
  // 两者都无 → 兜底
  assert.equal(archiveRowTitle({ fallbackName: "未命名案件" }), "未命名案件");
  assert.equal(archiveRowTitle({}), "未命名案件");
  // 阶段状态名绝不当主标题（Leo 抓到的串台）
  assert.notEqual(archiveRowTitle({ residencyNote: "天权二审中", name: "餐边柜" }), "天权二审中");
});

test("驻留描述：单一节点 + 模式微标，不写含糊双挂", () => {
  const row = archiveResidencyText({ step: 4, ownerStar: "tianquan", deliverableMode: "IMAGE_ONLY", residencyNote: "母稿待冻结" });
  assert.match(row.text, /05/);
  assert.match(row.text, /天权/);
  assert.match(row.text, /母稿待冻结/);
  assert.equal(row.mode, "图文");
  assert.equal(archiveResidencyText({ step: 5, deliverableMode: "DUAL" }).mode, "双出");
  assert.equal(archiveResidencyText({ step: 5, deliverableMode: "VIDEO_ONLY" }).mode, "视频");
});

test("星位名映射", () => {
  assert.equal(starNameOf("tianshu"), "天枢");
  assert.equal(starNameOf("tianquan"), "天权");
  assert.equal(starNameOf("VPS-北斗:yuheng"), "玉衡");
  assert.equal(starNameOf("main"), "客星");
});

// ---------------------------------------------------------------------------
test("星位在线灯：4/7 严禁绿灯（Leo 点过的监控撒谎）", () => {
  assert.equal(starOnlineTone(7, 7), "jade");
  // Leo 规格：在线数 < 7/7 如 4/7 时必须渲染琥珀黄/朱砂红告警灯，严禁绿灯
  assert.equal(starOnlineTone(4, 7), "bronze");
  // 一半以下（3/7）= 半个舰队不在，升级朱砂
  assert.equal(starOnlineTone(3, 7), "cinnabar");
  assert.equal(starOnlineTone(2, 7), "cinnabar");
  assert.equal(starOnlineTone(0, 7), "cinnabar");
  // 6/7 也只到琥珀——缺一颗就不算满员
  assert.equal(starOnlineTone(6, 7), "bronze");
  // 4 星满编的小编队：4/4 算绿；半数（2/4）仍算琥珀，跌破半数才朱砂
  assert.equal(starOnlineTone(4, 4), "jade");
  assert.equal(starOnlineTone(2, 4), "bronze");
  assert.equal(starOnlineTone(1, 4), "cinnabar");
});

// ---------------------------------------------------------------------------
test("一键追投视频：仅图文 + 母稿已冻结才给入口", () => {
  // 仅图文且二审 PASS → 可追投
  assert.equal(canAppendVideo({ deliverableMode: "IMAGE_ONLY", secondVerdict: "PASS", masterFrozen: true }), true);
  // 仅图文但没过二审 → 不给（母稿还会改）
  assert.equal(canAppendVideo({ deliverableMode: "IMAGE_ONLY", secondVerdict: "FAIL · 中改", secondStrikes: 1 }), false);
  // 已是双出 → 不用追投
  assert.equal(canAppendVideo({ deliverableMode: "DUAL", secondVerdict: "PASS" }), false);
  // 仅视频 → 无意义
  assert.equal(canAppendVideo({ deliverableMode: "VIDEO_ONLY" }), false);
  // 冻结标志误置但结论是 FAIL → 仍不给
  assert.equal(canAppendVideo({ deliverableMode: "IMAGE_ONLY", secondVerdict: "FAIL", masterFrozen: true }), false);
});

test("发布包槽位状态", () => {
  // 仅图文 + 未冻结 → 视频槽待命（虚线）
  assert.equal(assetSlotState({ deliverableMode: "IMAGE_ONLY", step: 5 }, "video"), "standby");
  // 仅图文 + 已冻结 → 可追投
  assert.equal(assetSlotState({ deliverableMode: "IMAGE_ONLY", secondVerdict: "PASS", step: 5 }, "video"), "appendable");
  // 双出并行中 → 视频槽在产
  assert.equal(assetSlotState({ deliverableMode: "DUAL", step: 5 }, "video"), "active");
  // 双出已过分发 → 就绪
  assert.equal(assetSlotState({ deliverableMode: "DUAL", step: 6 }, "video"), "ready");
  // 未到并行位 → 空槽
  assert.equal(assetSlotState({ deliverableMode: "DUAL", step: 2 }, "video"), "empty");
  // 图文槽：并行中在产，过后就绪
  assert.equal(assetSlotState({ deliverableMode: "IMAGE_ONLY", step: 5 }, "visual"), "active");
  assert.equal(assetSlotState({ deliverableMode: "IMAGE_ONLY", step: 6 }, "visual"), "ready");
});

// ---------------------------------------------------------------------------
test("标记词自动升 DUAL 的口径：picked 是什么就顶掉什么", () => {
  // 纯逻辑层只负责"标记词优先"这一条口径（Leo 规格：末尾输入 +视频 自动
  // 切换双出并剥离）。"用户显式点过胶囊后不再被顶掉"是组件层的 pin 状态，
  // 组件把用户选中的模式传给 picked 时不叠加标记词——两边配合才是完整语义。
  const autoDual = parseLaunchInput("玄关 +视频", "IMAGE_ONLY");
  assert.equal(autoDual.deliverableMode, "DUAL");
  assert.equal(autoDual.modeOverridden, true);
  assert.equal(autoDual.title, "玄关");

  // 标记词也顶掉显式选的仅视频——纯函数不知道用户"点过"，
  // 所以组件必须先判断 pin 再决定传什么 picked。
  const stillDual = parseLaunchInput("视频拍摄 +视频", "VIDEO_ONLY");
  assert.equal(stillDual.deliverableMode, "DUAL");

  // 没有标记词时 picked 原样生效
  const cleanVideo = parseLaunchInput("视频拍摄入门", "VIDEO_ONLY");
  assert.equal(cleanVideo.deliverableMode, "VIDEO_ONLY");
  assert.equal(cleanVideo.modeOverridden, false);
  assert.equal(cleanVideo.title, "视频拍摄入门");
});
