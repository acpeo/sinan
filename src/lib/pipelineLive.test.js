// 星位流水线的「哪一列在跑」判据（Leo 2026-10-21 反馈的回归测试）。
//
// 事故形态：判据按**星**算，天权一跑审题，审稿那块列头也跟着呼吸，
// 看上去像两处同时交接。判据必须按**列**：案子停在哪一列、那一列才亮。
import test from "node:test";
import assert from "node:assert/strict";

import { STAGE_COLS, caseSeqOf, liveColumnsOf, liveIndex, nameOfCase, segIndexOf, sortCasesNewest, starLiveOf, wbBadgeText, wbSegsOfCol, wbStepByCase } from "./pipelineLive.js";

const only = (set) => [...set].sort((a, b) => a - b);

test("天权审题时只亮审题列（不是两块一起亮）", () => {
  const cols = liveColumnsOf([{ step: 2 }], new Set(["tianquan"]));
  assert.deepEqual(only(cols), [2], "只有 03-审题（下标 2）该亮");
  assert.equal(cols.has(4), false, "05-审稿（下标 4）不许亮");
});

test("天权审稿时只亮审稿列", () => {
  const cols = liveColumnsOf([{ step: 4 }], new Set(["tianquan"]));
  assert.deepEqual(only(cols), [4]);
  assert.equal(cols.has(2), false);
});

test("两案分别停在两列时，两列各亮各的", () => {
  const cols = liveColumnsOf([{ step: 2 }, { step: 4 }], new Set(["tianquan"]));
  assert.deepEqual(only(cols), [2, 4]);
});

test("并行列：玉衡或开阳任意一股在跑都算这一列", () => {
  assert.deepEqual(only(liveColumnsOf([{ step: 5 }], new Set(["yuheng"]))), [5]);
  assert.deepEqual(only(liveColumnsOf([{ step: 5 }], new Set(["kaiyang"]))), [5]);
  assert.deepEqual(only(liveColumnsOf([{ step: 5 }], new Set([]))), []);
});

test("星在跑但案子不在那一列 → 不亮", () => {
  // 天枢的 cron 巡检被排除后仍可能在跑，但案子停在天权列，天枢列不该亮
  assert.deepEqual(only(liveColumnsOf([{ step: 2 }], new Set(["tianshu"]))), []);
  // 案已关单停在第 6 列，天璇在跑也不该把第 1 列点亮
  assert.deepEqual(only(liveColumnsOf([{ step: 6 }], new Set(["tianxuan"]))), []);
});

test("越界/非法 step 一律忽略，不抛错", () => {
  assert.deepEqual(only(liveColumnsOf([{ step: 99 }, { step: -1 }, {}, null], new Set(["tianquan"]))), []);
  assert.deepEqual(only(liveColumnsOf(undefined, new Set(["tianquan"]))), []);
});

test("liveIndex：空闲 -1、多列取最小、单列原值", () => {
  assert.equal(liveIndex(new Set()), -1, "全线空闲必须是 -1，不能是 Infinity");
  assert.equal(liveIndex(new Set([2, 4])), 2);
  assert.equal(liveIndex(new Set([5])), 5);
});

test("starLiveOf：并行列两股任一，普通列只看自己", () => {
  const par = STAGE_COLS[5];
  assert.equal(starLiveOf(par, new Set(["yuheng"])), true);
  assert.equal(starLiveOf(par, new Set(["kaiyang"])), true);
  assert.equal(starLiveOf(par, new Set(["tianquan"])), false);
  assert.equal(starLiveOf(STAGE_COLS[2], new Set(["tianquan"])), true);
  assert.equal(starLiveOf(STAGE_COLS[4], new Set(["tianquan"])), true);
});

test("列头徽标：只在真在跑时挂，案子走过就摘掉", () => {
  // Leo 2026-10-21 17:01：案已到玉衡，前期列头还挂着「1卡在跑」
  assert.equal(wbBadgeText(1, false), null, "没人在做就不挂，哪怕卡还 running");
  assert.equal(wbBadgeText(0, true), null, "没人做也不挂");
  assert.equal(wbBadgeText(1, true), "1 案在跑");
  assert.equal(wbBadgeText(2, true), "2 案在跑");
});

test("段卡映射：天权两列各认各的段，天枢没有段卡", () => {
  assert.deepEqual(wbSegsOfCol({ key: "tianquan" }), ["03-初审"]);
  assert.deepEqual(wbSegsOfCol({ key: "tianquan2" }), ["05-二审"]);
  assert.deepEqual(wbSegsOfCol({ key: "par" }), ["06-出图", "06-视频"]);
  assert.deepEqual(wbSegsOfCol({ key: "tianshu" }), []);
  assert.deepEqual(wbSegsOfCol(null), []);
});

test("段名 → 列下标：六段各归各位，天枢无段", () => {
  assert.equal(segIndexOf("03-初审"), 2);
  assert.equal(segIndexOf("05-二审"), 4);
  assert.equal(segIndexOf("06-出图"), 5);
  assert.equal(segIndexOf("07-运营"), 6);
  assert.equal(segIndexOf("01-接单"), -1, "接单不是段卡列");
  assert.equal(segIndexOf(""), -1);
});

test("工单兜底 step：账本落后时用工单把它们抬上去", () => {
  // Leo 2026-10-21 17:28：账本写 06_出图（step=5）、工单已经 07-运营 在跑
  const cards = [
    { role: "segment", status: "done", caseId: "BM-2607", seg: "06-出图" },
    { role: "segment", status: "running", caseId: "BM-2607", seg: "07-运营" },
    { role: "segment", status: "ready", caseId: "BM-2607", seg: "05-二审" },
    { role: "parent", status: "done", caseId: "BM-2607" },
    { role: "segment", status: "done", caseId: "BM-2606", seg: "04-母稿" },
  ];
  const floor = wbStepByCase(cards);
  assert.equal(floor.get("BM-2607"), 6, "取 done/running 里最靠后的一段");
  assert.equal(floor.get("BM-2606"), 3);
  assert.deepEqual([...floor.keys()].sort(), ["BM-2606", "BM-2607"]);
});

test("工单兜底 step：ready/父卡/无 caseId 都不算", () => {
  const floor = wbStepByCase([
    { role: "segment", status: "ready", caseId: "X", seg: "06-出图" },
    { role: "parent", status: "done", caseId: "X" },
    { role: "segment", status: "done", seg: "04-母稿" },
    { role: "segment", status: "done", caseId: "Y", seg: "乱写的段" },
  ]);
  assert.equal(floor.size, 0);
});

test("泳道排序：新案在上，旧案依次往下", () => {
  const list = [{ caseId: "BM-2602" }, { caseId: "BM-2609" }, { caseId: "BM-2607" }];
  assert.deepEqual(sortCasesNewest(list).map((x) => x.caseId), ["BM-2609", "BM-2607", "BM-2602"]);
  assert.equal(caseSeqOf("BM-2610"), 2610);
  assert.equal(caseSeqOf("老房翻新"), -1);
});

test("任务名回退：账本只有案号时用工单父卡标题补", () => {
  assert.equal(nameOfCase({ caseId: "BM-2609", name: "BM-2609" }, "BM-2609 小户型衣柜换季收纳"), "小户型衣柜换季收纳");
  assert.equal(nameOfCase({ caseId: "BM-2609", name: "" }, "BM-2609 衣柜换季"), "衣柜换季");
  // 已经有正式名就不覆盖
  assert.equal(nameOfCase({ caseId: "BM-2602", name: "为什么你家总是收不完？" }, "BM-2602 别的名字"), "为什么你家总是收不完？");
  assert.equal(nameOfCase({ caseId: "BM-2610", name: "BM-2610" }, ""), "BM-2610");
});
