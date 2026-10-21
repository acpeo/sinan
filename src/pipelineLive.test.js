// 星位流水线的「哪一列在跑」判据（Leo 2026-10-21 反馈的回归测试）。
//
// 事故形态：判据按**星**算，天权一跑审题，审稿那块列头也跟着呼吸，
// 看上去像两处同时交接。判据必须按**列**：案子停在哪一列、那一列才亮。
import test from "node:test";
import assert from "node:assert/strict";

import { STAGE_COLS, liveColumnsOf, liveIndex, starLiveOf } from "./pipelineLive.js";

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
