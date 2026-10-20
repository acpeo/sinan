// 北斗 · 星位流水线（Leo 2026-10-15 定稿 mock10 的产品落地）。
//
// 与旧指挥舱（CockpitView）的分工：那一屏是"给主理人下指令"的（顶部发车栏 +
// 自愈引擎 + 发布包），这一屏是"看链路"的——一行一案横看进度，竖看星位队列，
// 点一列头筛这一星位上的全部案子，点泳道行下面的深潜舱跟着重渲染。
//
// 三条真数据线，断一条都不演：
//   1) 案件 = loadBeidouCases（本地账本 beidou_cases 镜像）
//   2) 星位遥测 = gateway_agents_snapshot 的 sessions（model / 上下文 / hasActiveRun）
//   3) 定时 = gateway_cron_list（网关 cron.list 的本地镜像）
// 浏览器预览（无 Tauri）三条都空，此时整页显示空态而不是摆演示案——
// Leo 2026-10-15：实际用的时候不会有假案子。

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  DAG_STEPS,
  DELIVERABLE_MODES,
  DELIVERABLE_MODE_LABEL,
  FIVE_AXES,
  normalizeDeliverableMode,
  parseLaunchInput,
  stageToStep,
  ledgerRowToCase,
  starNameOf,
  textWantsDual,
} from "./cockpit.js";
import { contextEstimateAge, ESTIMATE_STALE_MS } from "./taskChains.js";

export const STAR_ICON = {
  tianshu: "🧭", tianxuan: "🔭", tianquan: "⚖️", tianji: "🖋️",
  yuheng: "🎨", kaiyang: "🎬", yaoguang: "🚀", main: "✨",
};

/// SOP「当前阶段映射表」的规范阶段名。天权出现两次（审题 / 审稿）——
/// 它是链路上唯一的两度门禁，所以给它两列，列头各自标清楚。
export const STAGE_COLS = [
  { key: "tianshu", star: "tianshu", label: "建档", role: "建档 · 巡检" },
  { key: "tianxuan", star: "tianxuan", label: "研究中", role: "趋势 · 选题" },
  { key: "tianquan", star: "tianquan", label: "审题中", role: "审题门禁" },
  { key: "tianji", star: "tianji", label: "创作中", role: "母稿创作" },
  { key: "tianquan2", star: "tianquan", label: "审稿中", role: "审稿门禁 · 冻结", gate: true },
  { key: "par", star: "par", label: "视觉/视频", role: "图文 // 视频", parallel: true },
  { key: "yaoguang", star: "yaoguang", label: "运营关单", role: "分发 · 关单" },
];

/// 已关单判定（Leo 2026-10-16 第 3 问：「这运营关单是在执行中还是已经完成了」）。
/// 停在最后一列、且这一步已经办完。两路数据两个判据，都不新造字段：
///   ① 带时间线的案（预览/演示数据）：末条 dur 不是「进行中」就是办完了。
///      BM-2601 末条「摇光发布运营方案 + 定版关单」dur=1516s → 已关单；
///      BM-2603 末条「摇光运营中」dur=进行中 → 在办。同一列两种状态，
///      不判的话关完的案会被画成 is-live + 挂「摇光执行中」浮层 + 出 strip，
///      三处一起假装在办（e2e-product.mjs S1 修复前在真组件上实测复现）。
///   ② 账本镜像（ledgerRowToCase）：没有时间线，看 Rust CaseStage::Closed
///      （stage 文本「已关单」/「关单完成」）。账本写的是 Distribution
///      （如「07_关单」）就照实显示运营关单，不替它猜。
const LAST_COL = STAGE_COLS.length - 1;
const caseInFlight = (c) => Boolean(c.timeline?.length) && c.timeline[c.timeline.length - 1].dur === "进行中";
const caseClosed = (c) => {
  if (c.step !== LAST_COL) return false;
  if (c.closed === true || c.closed === false) return c.closed;
  return Boolean(c.timeline?.length) && !caseInFlight(c);
};

const STAR_ORDER = ["tianshu", "tianxuan", "tianquan", "tianji", "yuheng", "kaiyang", "yaoguang"];

const axisTone = (score) => (score >= 85 ? "jade" : score >= 75 ? "bronze" : "cinnabar");

function AxisRow({ label, score, slim }) {
  const tone = axisTone(score);
  return (
    <div className={slim ? "pl-axis pl-axis--slim" : "pl-axis"}>
      <span className="pl-axis-label">{label}</span>
      <span className="pl-axis-track">
        <span className={`pl-axis-fill pl-axis-fill--${tone}`} style={{ width: `${score}%` }} />
      </span>
      <span className={`pl-axis-val pl-axis-val--${tone} cp-mono`}>{score}</span>
    </div>
  );
}

function StarChip({ star, size = 19 }) {
  return (
    <span className={`cp-star cp-star--${star || "main"}`} style={{ width: size, height: size, fontSize: size * 0.58 }} aria-hidden="true">
      {STAR_ICON[star] || STAR_ICON.main}
    </span>
  );
}

/* ═══════════ 顶栏：品牌 + 分区页签 + 状态 ═══════════
   Leo 2026-10-17：设计稿是"一行顶栏"——品牌在左、页签紧随、状态在右。
   产品原来把页签单独占一行（console-tabs），于是顶上有两排东西、跟设计稿对不上。
   现在指挥舱把页签收进这一行；别的分区（任务/定时任务/设置）仍走原来的 console 壳。

   两枚状态 chip 只报能算出来的数：
   · 在途 = 账本里没关单的案数
   · 待你裁决 = 打回满 3 次的案数（这种案停着等人改判）
   设计稿里还有「今日接力 12 跳」，产品没有这个数据源（要读 session_run 的当日完成数），
   算不出来就不摆——宁可少一枚，不摆假数字。 */
function PipelineTopBar({ conn, onOpenStars, tabs, activeTab, onTab, cases = [] }) {
  const tone = conn.state === "ok" ? "jade" : conn.state === "retry" ? "amber" : "cinnabar";
  const pending = cases.filter((item) => (item.secondStrikes ?? 0) >= 3).length;
  const inFlight = cases.filter((item) => !caseClosed(item)).length;
  return (
    <header className="pl-topbar" data-tauri-drag-region>
      <div className="pl-brand">
        {/* 品牌标：设计稿是深色方角块 + 白色星芒，不是一个彩色 emoji 圆点
            （Leo 2026-10-17：emoji 直接把"标题"整行拉低了一个档次）。 */}
        <BrandLogo />
        <div>
          <div className="pl-brand-name">司南 · 北斗矩阵</div>
          <div className="pl-brand-sub">Sinan · Zero-Touch</div>
        </div>
      </div>
      {tabs?.length ? (
        <nav className="pl-tabs" role="tablist" aria-label="任务台分区">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={activeTab === item.id}
              className={activeTab === item.id ? "is-on" : ""}
              onClick={() => onTab?.(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      ) : null}
      <div className="pl-topright">
        {pending > 0 ? (
          <span className="pl-chip pl-chip--alert" title="打回满 3 次，停着等你改判">
            <span className="pl-dot pl-dot--cinnabar" />待你裁决 {pending}
          </span>
        ) : null}
        <span className="pl-chip" title="账本里还没关单的案">{inFlight} 在途</span>
        {/* 连接呼吸灯：不是只摆个 ws 地址。绿=握手活着；琥珀=重连中；朱砂=断了 */}
        <button
          type="button"
          className={`pl-badge pl-badge--${tone}`}
          title={conn.title}
          onClick={conn.onRetry}
        >
          <span className={`pl-dot pl-dot--${tone} pl-breathe`} />
          <span>{conn.text}</span>
        </button>
        <button type="button" className="pl-btn pl-btn--sm" onClick={onOpenStars}>⭐ 星位明细</button>
      </div>
    </header>
  );
}


/* 品牌标：直接用打包图标原图（src-tauri/icons/128x128.png → src/assets）。
   之前手绘的北斗七星 SVG 和 ✦ 都是近似，Leo 2026-10-18 指出与任务栏图标
   对不上——真标志就一张图，别画第二份。 */
import sinanLogoUrl from "./assets/sinan-logo.png";

export function BrandLogo({ size = 28 }) {
  return (
    <img
      src={sinanLogoUrl}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      style={{ flex: "none", display: "block", borderRadius: 7 }}
    />
  );
}

/* ═══════════ 命题直通发车栏（Leo：主要是看，但能指挥算锦上添花）═════════ */
function LaunchBar({ onLaunch, busy }) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState("IMAGE_ONLY");
  const [pinned, setPinned] = useState(false);
  const inputRef = useRef(null);
  // ⌘K / Ctrl+K 直达输入框（旧指挥舱同一条快捷键，迁移过来别丢）。
  useEffect(() => {
    const onKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // 标记词联动：标题里带 +视频/双出 → 胶囊预览切双出。用户显式点过胶囊后
  // 以用户为准（pinned），否则想选仅视频时标题带个"视频"就永远切不过去。
  const wantsDual = textWantsDual(text);
  const effective = wantsDual && !pinned ? "DUAL" : mode;
  const parsed = useMemo(() => parseLaunchInput(text, effective), [text, effective]);
  const submit = useCallback(() => {
    if (!parsed.ready) return;
    onLaunch?.({ title: parsed.title, deliverableMode: parsed.deliverableMode });
    setText("");
  }, [onLaunch, parsed]);
  return (
    <div className="pl-launch">
      <span className="pl-launch-bolt" aria-hidden="true">⚡</span>
      <input
        ref={inputRef}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") submit(); }}
        placeholder="输入指定标题直通发车（末尾输入 +视频 自动切双出）"
        aria-label="命题直通发车标题"
      />
      {wantsDual ? <span className="pl-chip pl-chip--bronze">将剥离「+视频」</span> : null}
      <span className="cp-mono pl-launch-kbd">⌘K</span>
      <div className="pl-seg" role="group" aria-label="交付模式">
        {DELIVERABLE_MODES.map((key) => {
          const meta = DELIVERABLE_MODE_LABEL[key];
          return (
            <button
              key={key}
              type="button"
              className={`pl-seg-btn${effective === key ? " is-on" : ""}`}
              aria-pressed={effective === key}
              onClick={() => { setMode(key); setPinned(true); }}
              title={meta.full}
            >
              <span aria-hidden="true">{meta.icon}</span>{meta.short}
            </button>
          );
        })}
      </div>
      <button type="button" className="pl-btn pl-btn--primary" disabled={!parsed.ready || busy} onClick={submit}>
        立即发车 <span aria-hidden="true">→</span>
      </button>
      {/* 说清楚这一脚踢给谁：司南只唤醒天枢建档派单，之后每一跳都是北斗
          自己的 SOP 链路在星位之间流转，面板只读账本镜像。不写这句，
          看的人会以为发车=命令七个 agent 同时开工（Leo 2026-10-15 问的）。 */}
      <span className="pl-launch-hint" title="发车只唤醒天枢建档并派单；之后天璇→天玑→天权→玉衡/开阳→摇光由北斗自己的 SOP 链路流转，本面板只读账本镜像。">
        唤醒天枢建档 → 后续星位按 SOP 自动接力
      </span>
    </div>
  );
}

/* ═══════════ 星位流水线：一行一案 ═══════════ */
function LaneGrid({ cases, totalCount, activeId, onPick, liveStars, colFilter, onColFilter, starTelemetry }) {
  const hostRef = useRef(null);
  const list = useMemo(() => {
    if (!colFilter) return cases;
    return cases.filter((item) => (STAGE_COLS[item.step]?.key ?? "").replace(/2$/, "") === colFilter);
  }, [cases, colFilter]);

  // 打回回环的弧线要按真实坐标算（列宽随窗口变）。每次渲染后重算：
  // 从审稿门禁格底部绕到创作中格顶部，挂一个朱砂端点。
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const draw = () => {
      host.querySelectorAll(".pl-lane-row").forEach((row) => {
        const svg = row.querySelector(".pl-loop");
        if (!svg) return;
        const nodes = row.querySelectorAll(".pl-cell .pl-node, .pl-cell .pl-par-slot");
        // 链路：... 天玑(3) → 天权审稿(4) → 并行(5) ...
        const from = nodes[4];   // 打回的起点：天权审稿
        const to = nodes[3];     // 打回的目标：天玑重写
        if (!from || !to) return;
        const rr = row.getBoundingClientRect();
        const a = from.getBoundingClientRect();
        const b = to.getBoundingClientRect();
        // v20.2 定稿形状（Leo 2026-10-16 第 ④ 条：回环只留一条 S 动线、零文字）：
        // 锚在两张卡**相对的两条侧边**（离上缘 12px / 离下缘 14px，避开 10px 圆角），
        // 跨度正好是格子之间那条 32px 空档（gap 6 + 格子 padding-left 26），
        // 整条待在行高里，不再往下绕、也就不需要额外留底高。
        // 早先那版是"从审稿格底部中点向下扎、绕到创作格正下方"的 U，
        // 每行要多留 34px 空带，标签删掉之后那条空带就只剩一条悬着的弧。
        const x1 = a.left - rr.left;              // 发起：审稿格左缘
        const y1 = a.top - rr.top + 12;
        const x2 = b.right - rr.left;             // 落点：创作格右缘
        const y2 = b.bottom - rr.top - 14;
        const dx = (x1 - x2) * 0.46;              // smooth-step：两端切线都水平
        const TAIL = 3.4;                         // 线尾回缩，别让圆头磨钝箭尖
        const path = svg.querySelector(".pl-loop-path");
        path.setAttribute("d", `M ${x1} ${y1} C ${x1 - dx} ${y1}, ${x2 + dx} ${y2}, ${x2 + TAIL} ${y2}`);
        const dot = svg.querySelector(".pl-loop-dot");
        dot.setAttribute("cx", x1);
        dot.setAttribute("cy", y1);
        const head = svg.querySelector(".pl-loop-head");
        const HL = 7.6;
        const HW = 3.6;
        head.setAttribute("d", `M ${x2 + HL} ${y2 - HW} L ${x2 + HL} ${y2 + HW} L ${x2} ${y2} Z`);
        svg.setAttribute("viewBox", `0 0 ${rr.width} ${rr.height}`);
      });
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(host);
    return () => ro.disconnect();
  }, [list.length, activeId, colFilter]);

  return (
    <div className="pl-lanes" ref={hostRef}>
      {/* 列头 = 星位遥测：三行（星名+在跑点 / 链路职责 / 模型+最近一次 run 用时）。
          状态点只在真在跑时出现（琥珀呼吸）——空闲不挂点：早年"空闲挂绿点"
          被读成"都在活动"（Leo 2026-10-18），绿点语义歧义，删。 */}
      <div className="pl-lane-grid pl-colhead-row">
        <div className="pl-colhead-lead">案件 / CASE</div>
        {STAGE_COLS.map((col) => {
        const star = col.key.replace(/2$/, "");
        const tele = starTelemetry?.[col.star] ?? {};
        const live = liveStars.has(col.star) || (col.parallel && (liveStars.has("yuheng") || liveStars.has("kaiyang")));
        // 并行列（玉衡 // 开阳）各自有遥测，不能拿单颗星的 tele 顶两行。
        const parTele = col.parallel
          ? {
              model: starTelemetry?.yuheng?.model ?? starTelemetry?.kaiyang?.model ?? "gpt-6",
              yuhengLast: starTelemetry?.yuheng?.lastRun ?? "—",
              kaiyangLast: starTelemetry?.kaiyang?.lastRun ?? "—",
            }
          : null;
          return (
            <button
              key={col.key}
              type="button"
              className={`pl-colhead${colFilter === star ? " is-on" : ""}`}
              onClick={() => onColFilter(colFilter === star ? null : star)}
              title={`筛选：只看${starNameOf(col.star)}这一列的案子`}
            >
              {col.parallel ? (
                <>
                  <div className="pl-colhead-star"><StarChip star="yuheng" size={24} /><b>玉衡</b>{liveStars.has("yuheng") ? <span className="pl-dot pl-dot--amber pl-breathe" /> : null}</div>
                  <div className="pl-colhead-star"><StarChip star="kaiyang" size={24} /><b>开阳</b>{liveStars.has("kaiyang") ? <span className="pl-dot pl-dot--amber pl-breathe" /> : null}</div>
                </>
              ) : (
                <div className="pl-colhead-star">
                  <StarChip star={col.star} size={24} />
                  <b>{starNameOf(col.star)}</b>
                  {col.gate
                    ? (
                      <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 3 }}>
                        🔒{live ? <span className="pl-dot pl-dot--amber pl-breathe" /> : null}
                      </span>
                    )
                    : live
                      ? <span className="pl-dot pl-dot--amber pl-breathe" style={{ marginLeft: "auto" }} />
                      : null}
                </div>
              )}
              <div className="pl-colhead-role cp-mono">{col.role}</div>
              <div className="pl-colhead-model cp-mono">
                {col.parallel
                  ? `${parTele.model} · ${parTele.yuhengLast} / ${parTele.kaiyangLast}`
                  : `${tele.model ?? "—"} · 上次 ${tele.lastRun ?? "—"}`}
              </div>
            </button>
          );
        })}
      </div>

      {list.map((item) => {
        const on = item.caseId === activeId;
        const cells = STAGE_COLS.map((col, index) => {
          // 已关单的案：末格不再是「当前步」（不画成铜色在办），改画已完成底色（jade）。
          const closedHere = caseClosed(item);
          const isCur = index === item.step && !(closedHere && index === LAST_COL);
          const isDone = index < item.step || (closedHere && index === LAST_COL);
          if (col.parallel) {
            // 并行格的"在跑"必须是双条件：这颗星真在跑 + 本案当前步就在这一列。
            // 早先只判 liveStars.has("yuheng")，于是任何一颗星开工，所有案子
            // 的并行格都亮起来跑线——BM-2601/BM-2603 早过视觉列了还在跑
            // （Leo 2026-10-15："玉衡开阳怎么还有跑线"）。
            const parIsCur = isCur;
            const yuLive = liveStars.has("yuheng") && parIsCur;
            const kaLive = liveStars.has("kaiyang") && parIsCur;
            const standby = item.deliverableMode === "IMAGE_ONLY";
            // 入线只在真有活儿往并行格送的时候画：上一格（天玑母稿）已交付、
            // 本案当前步就在这一列、且两颗里至少有一颗在跑。
            const prevDone = index > 0 && index - 1 < item.step;
            const parFlowing = prevDone && parIsCur && (yuLive || kaLive);
            return (
              <div className={`pl-cell${parFlowing ? " has-link is-flowing" : ""}`} key={col.key}>
                {/* 一股进、两股出：横线接母稿那一格，两股竖线分别对准玉衡/开阳。
                    早先只有一根 20px 竖线戳在中点，看着像挂在线上的一截死线
                    （Leo 2026-10-15："底下还有一个会死的竖线"）。 */}
                {parFlowing ? (
                  <span className="pl-link pl-link--fork" aria-hidden="true">
                    <span className="pl-fork-arm pl-fork-arm--up" />
                    <span className="pl-fork-arm pl-fork-arm--down" />
                  </span>
                ) : null}
                <div className={`pl-par-slot${isCur ? " is-active" : isDone ? " is-done" : " is-idle"}`}>
                  <div className={`pl-par-node${yuLive ? " is-live" : ""}`} title={yuLive ? "玉衡执行中" : undefined}>
                    <StarChip star="yuheng" size={17} /><b>玉衡</b>
                    {yuLive ? <span className="pl-live-dot" /> : <span className="pl-par-tail">图文</span>}
                  </div>
                  <div className={`pl-par-node${standby ? " is-standby" : ""}${kaLive ? " is-live" : ""}`} title={kaLive ? "开阳执行中" : undefined}>
                    <StarChip star="kaiyang" size={17} /><b>开阳</b>
                    {standby ? <span className="pl-par-tail">{item.masterFrozen ? "可追投" : "未启用"}</span> : <span className="pl-par-tail">视频</span>}
                  </div>
                </div>
              </div>
            );
          }
          // 实时三态：本案当前步在跑 = 琥珀实心+呼吸点；别的案子在跑 = 细琥珀边；
          // 都没跑 = 按进度显示当前/已完成/未到。Leo 2026-10-15：agent 一活动就动。
          const liveHere = liveStars.has(col.star);
          const liveIsThisCase = liveHere && isCur;
          // 已关单的末格也不描忙边：它停在摇光列、摇光此刻确实在跑，但跑的是
          // 别的案（BM-2603）；这一案的摇光已经定版关单了 —— 再描一道琥珀忙边、
          // 挂一个「摇光执行中」的浮层，就是在关完的案上假装在办。
          const liveShow = liveHere && !(closedHere && index === LAST_COL);
          const cls = [
            isCur ? "is-cur" : isDone ? "is-done" : "is-idle",
            liveIsThisCase ? "is-live" : "",
            liveShow && !liveIsThisCase ? "is-busy" : "",
          ].filter(Boolean).join(" ");
          const labelColor = liveIsThisCase ? "var(--cp-amber)" : isCur ? "var(--cp-bronze)" : isDone ? "var(--cp-jade)" : "var(--cp-body)";
          // 与上一格之间的投递线（Leo 2026-10-15 第一轮：看得见"活儿递给谁了"；
          // 同日第二轮收口）：只在"上一格刚交付、这一格就是当前、且这一格的星
          // 真在跑"时画一条跑动虚线——那是唯一一段"正在路上"的路。
          // 已经走完的段一律不画线（Leo：视觉上不好看），没走到的地方本来就没有。
          // 早先的写法把"已完成"也画成静止绿线，于是每条链路都挂着一串绿线，
          // 而且最后一格前面必然已完成，终点格也中招跑线。
          const prev = STAGE_COLS[index - 1];
          const prevDone = index > 0 && index - 1 < item.step;
          const flowing = !!prev && prevDone && isCur && liveIsThisCase;
          return (
            <div className={`pl-cell${flowing ? " has-link is-flowing" : ""}`} key={col.key}>
              {flowing ? <span className="pl-link" aria-hidden="true" /> : null}
              <div className={`pl-node ${cls}`} title={liveShow ? `${starNameOf(col.star)}执行中` : undefined}>
                {col.gate && item.masterFrozen ? <span className="pl-gate-mark">🔒</span> : null}
                {col.gate && item.secondStrikes > 0 ? <span className="pl-strike-mark">{item.secondStrikes}/3</span> : null}
                {liveIsThisCase ? <span className="pl-live-dot pl-live-dot--corner" /> : null}
                <StarChip star={col.star} />
                <span className="pl-node-label" style={{ color: labelColor }}>{closedHere && index === LAST_COL ? "已关单" : col.label}</span>
              </div>
            </div>
          );
        });
        return (
          <div className={`pl-lane-grid pl-lane-row${on ? " is-on" : ""}`} key={item.caseId}>
            <button type="button" className="pl-lane-id" onClick={() => onPick(item.caseId)} title={`${item.name}（${item.caseId}）`}>
              <span className={`pl-lane-bar${on ? " is-on" : ""}`} />
              {/* 打回次数只在弧线标签和审稿门禁角的红标上出现：
                  案名列再挂一枚 chip 是同一件事说第三遍，
                  还把 132px 的案件名列挤成一团（Leo 2026-10-15）。 */}
              <span className="pl-lane-text">
                <span className="cp-mono pl-lane-code">{item.caseId}</span>
                <span className="pl-lane-name">{item.name}</span>
              </span>
            </button>
            {cells}
            {/* 打回回环：从审稿门禁绕一条弧线回创作中。
                **只留动线、零文字**（Leo 2026-10-16 第 ④ 条口径）——
                原来这里还挂过一个「🔁 打回重审 n/3」的朱砂标，产品一直没跟着
                设计稿去掉，2026-10-19 Leo 明确要求删。打回次数在深潜舱的
                「打回链 · REJECT LOOP」和头部徽标里都有，泳道上不重复。 */}
            {item.secondStrikes > 0 ? (
              <svg className="pl-loop" aria-hidden="true">
                <path d="M 0 0" className="pl-loop-path" />
                <circle className="pl-loop-dot" r="2" />
                <path d="M 0 0" className="pl-loop-head" />
              </svg>
            ) : null}
          </div>
        );
      })}
      {/* 空态分两种，别用同一句话糊过去：
          ① 账本本来就是空的 → 这里不吭声，让深潜舱那段「在上面输入标题点立即发车」
             一处说清（原来两块各说一句，一屏两个空态，还互相矛盾）；
          ② 账本有案但被列筛掉了 → 才说「没有符合条件的案件」。 */}
      {/* 账本真空：摆几行虚线占位，让矩阵看上去还是"矩阵"，
          而不是一排列头下面拖一片白（Leo 2026-10-17：排版散）。 */}
      {list.length === 0 && (totalCount ?? cases.length) === 0
        ? Array.from({ length: 4 }).map((_, rowIndex) => (
            <div className="pl-lane-grid pl-lane-row pl-lane-row--ghost" key={`ghost-${rowIndex}`} aria-hidden="true">
              <div className="pl-lane-ghost-id" />
              {STAGE_COLS.map((col) => (
                <div className="pl-cell" key={col.key}>
                  <div className="pl-node is-ghost" />
                </div>
              ))}
            </div>
          ))
        : null}

      {list.length === 0 && (totalCount ?? cases.length) > 0 ? (
        <p className="pl-lane-empty">没有符合条件的案件。</p>
      ) : null}
    </div>
  );
}

/* ═══════════ 单案深潜舱 ═══════════ */
function Inspector({ caseItem, liveStars, liveAction, hasCases }) {
  // 自愈是真会发指令出去，所以两步确认：第一下上膛、第二下才发。换案自动收回
  // （用 ref 记住上膛的是哪一案，不额外跑 effect，也不多一次渲染）。
  const [armedHeal, setArmedHeal] = useState(false);
  const armedHealCaseRef = useRef(null);
  if (!caseItem) {
    // 两种「没内容」不是一回事：账本真空 vs 有案但没选中。
    // 之前一律写「本地账本还没有案件」—— 有案没选中时这句话就是假话。
    return (
      <div className="pl-insp-empty">
        <p className="pl-insp-empty-title">{hasCases ? "还没选中案件" : "账本还没有案件"}</p>
        <p className="pl-insp-empty-body">
          {hasCases
            ? "点上面泳道里的任意一行（或点案名列），它的五轴、打回次数和产出链接都摊在这里。"
            : "北斗在 VPS 上跑、产出在飞书文档，这里只是本地镜像：点「立即发车」会生成案号（BM-xxxx）并把任务派到网关，任务带上案件标记后，每一跳的状态才会归进这张账本。"}
        </p>
      </div>
    );
  }
  const c = caseItem;
  const col = STAGE_COLS[c.step];
  const stageName = col.parallel ? "玉衡 // 开阳" : starNameOf(col.star);
  // 与泳道同口径：关完的案徽标写「已关单」，不写「运营关单」。
  const stageLabel = caseClosed(c) ? "已关单" : col.label;
  const modeMeta = DELIVERABLE_MODE_LABEL[normalizeDeliverableMode(c.deliverableMode)];
  // 冻结只看母稿冻结这一个事实，不与打回次数挂钩：BM-2601 真机就是
  // 「打过一回 → 复审 PASS → 母稿 FROZEN（rev 7）」——旧逻辑
  // （frozen && secondStrikes === 0）让这种案显示「母稿未冻结」，
  // 还憋回追投按钮（真机截图实锤，Leo 2026-10-21 批的 mock21 同口径）。
  const frozen = Boolean(c.masterFrozen);
  // 换了案就把"上膛"状态收回，别让上一案的确认态带到下一案头上。
  const armedHealForThisCase = armedHeal && armedHealCaseRef.current === c.caseId;
  // 已关单的案不亮 strip：strip 说的是「这一步正在办」，关完的案没有正在办的步
  // （在跑的是别的案的摇光）。Leo 2026-10-16 第 3 问前半句问的就是这个歧义。
  const liveWho = caseClosed(c)
    ? []
    : col.parallel
      ? ["yuheng", "kaiyang"].filter((id) => liveStars.has(id))
      : liveStars.has(col.star) ? [col.star] : [];

  return (
    <>
      <div className="pl-insp-head">
        <span className="pl-insp-kicker">单案深潜舱 · CASE INSPECTOR</span>
        <span className="cp-mono pl-insp-id">{c.caseId}</span>
        <span className="pl-insp-name">{c.name}</span>
        <span className="pl-insp-badges">
          {frozen ? <span className="pl-badge pl-badge--indigo">🔒 母稿已冻结</span> : null}
          {c.secondStrikes > 0 ? <span className="pl-badge pl-badge--cinnabar">🔁 打回 {c.secondStrikes}/3</span> : null}
          <span className="pl-badge pl-badge--slate">{modeMeta.icon} {modeMeta.short}</span>
        </span>
        {liveWho.length > 0 ? (
          <span className="pl-live-strip">
            <span className="pl-dot pl-dot--amber pl-pulse" />
            {/* 只挂有文案的星：取不到就整条落一个兜底，别「执行中 · 执行中」
                两截并排（P-4：两颗星都没文案时 App.jsx 真机路径实测就是这个）。
                并行列的兜底用 fixture 原话「并行生产中」。 */}
            <span className="pl-live-strip-text">
              {liveWho.map((id) => liveAction[id]).filter(Boolean).join(" · ")
                || (col.parallel ? "并行生产中" : "执行中")}
            </span>
          </span>
        ) : null}
        <span className={`pl-badge pl-badge--${c.secondStrikes > 0 ? "cinnabar" : frozen ? "jade" : "bronze"} pl-insp-stage`}>
          {stageLabel} · {stageName}
        </span>
      </div>
      <div className="pl-insp-body">
        {/* 左栏：定题与背调依据（定题结论 + 研究文档 + 飞书云盘）*/}
        <article className="cp-card pl-insp-col">
          <div className="pl-insp-colhead">
            <StarChip star="tianxuan" />
            <div className="pl-insp-coltitle">
              <h3>定题与背调依据</h3>
              <p>Auto-Title &amp; Research · 天璇</p>
            </div>
            {c.entryMode === "AUTO_DISCOVERY" ? (
              <span className="pl-badge pl-badge--slate">🧭 自主寻题</span>
            ) : null}
          </div>
          <div className="pl-slot">
            <div className="pl-kicker">天璇研究文档</div>
            {/* 没链接时给研究编号注（看门狗摘录里天璇产出的截断编号——
                完整链接没回传时的诚实注），连注都没有才写「未回填」。
                原来这里四个案共用一句写死样板句（Leo 2026-10-16 抓出：
                它是 fixture 漏进了渲染层）。 */}
            {c.researchDocUrl
              ? <a className="pl-btn pl-btn--sm" href={c.researchDocUrl} target="_blank" rel="noreferrer">📄 打开 docx ↗</a>
              : <p className="pl-strike-none">{c.researchIdNote || "主表未回填研究文档链接。"}</p>}
          </div>
          <div>
            <div className="pl-kicker">定题结论 · 天璇呈题</div>
            {/* 这里原来画的是"初审五轴"，与中栏的"二审五轴"读同一个字段、
                渲染同一套轴——同一组数字画两遍。Leo 2026-10-15 抓出来的。
                初审是选标题阶段打的分，二审是审稿门禁打的分，SOP 上是两套；
                但本地账本与飞书主表都没有任何一列存它们，所以：
                左栏改成定题结论（候选标题 + 钦定），五轴只在中栏门禁处出现一次。
                "等你圈定"是这个案当前唯一需要 Leo 动作的事——在这里标出来，
                不另起一层御批台（起第三层会把泳道和深潜舱挤没）。 */}
            {(c.candidates ?? []).length > 0 ? (
              <>
                <div className="pl-cand-list">
                  {c.candidates.map((x, i) => (
                    <div className={`pl-cand${x.champion ? " is-champion" : ""}`} key={i}>
                      <span className="pl-cand-no">{i + 1}</span>
                      <span className="pl-cand-title">{x.title}</span>
                      {/* 五轴总分：天权定题卡写的是「候选1 家务动线 455」，
                          账本提出来就摆在这儿；提不到就不摆分。 */}
                      {x.score ? <span className="cp-mono pl-cand-score">{x.score}</span> : null}
                      {x.champion ? <span className="pl-badge pl-badge--bronze">🏆 钦定</span> : null}
                    </div>
                  ))}
                </div>
                {(c.candidates ?? []).some((x) => x.champion) ? null : (
                  <p className="pl-strike-none">⏳ 等你圈定一个标题：圈定后母稿才能冻结，天玑才会动笔。</p>
                )}
              </>
            ) : (
              <p className="pl-strike-none">
                候选标题与五轴定题分都存在飞书主表，本地账本只镜像链接；天璇回填后这里显示被钦定的那个标题。
              </p>
            )}
            {c.candidateNote
              ? <p className="pl-strike-none" style={{ marginTop: 6 }}>{c.candidateNote}</p>
              : null}
          </div>
          <div className="pl-slot pl-insp-foot">
            <div className="pl-kicker">飞书云盘</div>
            {c.folderUrl
              ? <a className="pl-btn pl-btn--sm" href={c.folderUrl} target="_blank" rel="noreferrer">📁 本案文件夹 ↗</a>
              : <p className="pl-strike-none">主表未回填文件夹链接。</p>}
          </div>
        </article>

        {/* 中栏：二审五轴宽条 + 打回链 + 验收标准 + 自愈终端 */}
        <article className="cp-card pl-insp-col">
          <div className="pl-insp-colhead">
            <StarChip star="tianquan" />
            <div className="pl-insp-coltitle">
              <h3>天权审稿门禁</h3>
              <p>5-Axis Gate · SOP 打回规则</p>
            </div>
            <span className={`pl-badge pl-badge--${c.secondStrikes > 0 ? "cinnabar" : frozen ? "jade" : "bronze"}`}>
              {c.secondStrikes > 0 ? "FAIL" : frozen ? "PASS" : "审稿中"}
            </span>
          </div>
          <div className="pl-axis-list">
            {c.reviewAxes
              ? FIVE_AXES.map((axis) => (
                  <AxisRow key={axis.key} label={axis.label} score={c.reviewAxes?.[axis.key] ?? 0} />
                ))
              : <p className="pl-strike-none">五轴分是天权二审在飞书主表打的，本地账本只镜像链接不打分——判词回填后这里显示真分数。</p>}
          </div>
          <div>
            <div className="pl-kicker">打回链 · REJECT LOOP（打回 → 改 → 复审，最多 3 次升级 Leo）</div>
            {(c.strikeList ?? []).length > 0 ? (
              c.strikeList.map((s, i) => (
                <div className="pl-strike" key={i}>
                  <span className="pl-strike-no">{i + 1}</span>
                  <div className="pl-strike-body">
                    <div className="pl-strike-meta">
                      <span className="pl-badge pl-badge--cinnabar">{s.verdict}</span>
                      <span className="pl-badge pl-badge--amber">{s.sev}</span>
                      <span className="cp-mono pl-strike-at">{s.at}</span>
                    </div>
                    <p className="pl-strike-note">{s.note}</p>
                    <p className="pl-strike-next">→ 天玑按 Fix instruction 修改 → 重新 dispatch 天权重审（不得跳过）</p>
                  </div>
                </div>
              ))
            ) : (
              <p className="pl-strike-none">本案无打回记录。</p>
            )}
          </div>
          {c.verdictText ? (
            <div>
              <div className="pl-kicker">天权原话 · 本地接力账本</div>
              {/* verdictBy 带归属：复审 PASS 与二审 FAIL 是两句不同的话，
                  复审判词挂「天权 · 复审判词」——真机 BM-2601 末次结论就是
                  复审（同跳贴了【复审报告】），Rust 从接力文本判的。 */}
              <blockquote className="pl-quote">
                {c.verdictText}
                <div className="pl-quote-by">—— {c.verdictBy || "天权 · 审稿判词"}</div>
              </blockquote>
            </div>
          ) : (
            <p className="pl-strike-none">判词还没落到本地账本：飞书主表回填后这里显示天权原话。</p>
          )}
          <div>
            <div className="pl-kicker">审稿文档 · 按产出星位归槽</div>
            <div className="pl-chip-row">
              {c.reviewDocUrl ? <a className="pl-btn pl-btn--sm" href={c.reviewDocUrl} target="_blank" rel="noreferrer">📄 二审报告 ↗</a> : null}
              {c.reReviewDocUrl ? <a className="pl-btn pl-btn--sm" href={c.reReviewDocUrl} target="_blank" rel="noreferrer">📄 复审报告 ↗</a> : null}
            </div>
          </div>
          <div>
            <div className="pl-kicker">验收标准 · ACCEPTANCE CRITERIA</div>
            {(c.criteria ?? []).length > 0
              ? c.criteria.map((x, i) => (
                <div className="pl-crit" key={i}>
                  <span className={`pl-crit-mark pl-crit-mark--${x.mark}`}>{x.mark === "pass" ? "✓" : x.mark === "fail" ? "✕" : "·"}</span>
                  <span>{x.text}</span>
                </div>
              ))
              : <p className="pl-strike-none">验收清单随天权判词回填。</p>}
          </div>
          {c.secondStrikes >= 3 ? (
            <div>
              <div className="pl-kicker">♻️ 3/3 已熔断 · 派局部重修</div>
              {/* 这段原来是一个写死的假终端：摆着 `openclaw reset …` 和
                  `✓ session cleared` / `✓ dispatched`，但没绑任何动作，也没接
                  beidouAutoHeal —— 3/3 的案会看到"已重置并派发"，其实什么都没发生
                  （Leo 2026-10-19 盘账抓出，违反"不摆假数据"）。现在接真的是：
                  后端只发一条"仅重写被打回段落、母稿骨架不动"的指令给天玑，
                  会话重置的时机仍归 watchdog，这里不代劳。 */}
              <p className="pl-note">
                按 SOP，打回满 3 次转自愈：给天玑下「仅重写被打回段落、母稿骨架与已通过小节不动」的指令。
                会话重置由北斗 watchdog 在网关侧决定时机，这里不代劳。
              </p>
              {c.onAutoHeal ? (
                <button
                  type="button"
                  className={`pl-btn pl-btn--sm${armedHealForThisCase ? " pl-btn--primary" : ""}`}
                  onClick={() => {
                    if (!armedHealForThisCase) {
                      armedHealCaseRef.current = c.caseId;
                      setArmedHeal(true);
                      return;
                    }
                    armedHealCaseRef.current = null;
                    setArmedHeal(false);
                    c.onAutoHeal?.();
                  }}
                >
                  {armedHealForThisCase ? "再点一次：确认派给天玑" : "⚡ 派局部重修给天玑"}
                </button>
              ) : null}
            </div>
          ) : null}
        </article>

        {/* 右栏：产出包 + 时间线 */}
        <article className="cp-card pl-insp-col">
          <div className="pl-insp-colhead">
            <StarChip star="yuheng" />
            <div className="pl-insp-coltitle">
              <h3>产出包</h3>
              <p>Asset Delivery</p>
            </div>
          </div>
          <div className="pl-slot">
            <div className="pl-slot-head">
              <StarChip star="yuheng" /><b>玉衡 · 图文发布包</b>
              <span className={`pl-badge pl-badge--${c.step > 5 ? "jade" : c.step === 5 ? "bronze" : "slate"}`}>
                {c.step > 5 ? "已就绪" : c.step === 5 ? "出图中" : "待启动"}
              </span>
            </div>
            <div className="pl-chip-row">
              <span className="pl-chip">配图锚点</span><span className="pl-chip">小红书 3:4</span><span className="pl-chip">公众号 1:1</span>
            </div>
            {/* 账本里真有链接的产出才摆按钮（母稿 / 图文包 / 运营方案）——
                缺的短一截，不摆空按钮。mock21 同版式。 */}
            <div className="pl-chip-row">
              {c.masterDocUrl ? <a className="pl-btn pl-btn--sm" href={c.masterDocUrl} target="_blank" rel="noreferrer">📄 母稿 docx ↗</a> : null}
              {c.visualUrl ? <a className="pl-btn pl-btn--sm" href={c.visualUrl} target="_blank" rel="noreferrer">🖼 图文包 docx ↗</a> : null}
              {c.opsDocUrl ? <a className="pl-btn pl-btn--sm" href={c.opsDocUrl} target="_blank" rel="noreferrer">📣 运营方案 ↗</a> : null}
            </div>
          </div>
          {c.deliverableMode === "IMAGE_ONLY" ? (
            <div className="pl-standby">
              <div className="pl-slot-head">
                <StarChip star="kaiyang" /><b>开阳 · 视频发布包</b>
                <span className="pl-badge pl-badge--slate">未启用</span>
              </div>
              <p className="pl-note">
                {frozen
                  ? "母稿已冻结，可从冻结母稿追投视频，无需重跑前序节点。"
                  : "母稿未冻结，追投前先过审稿门禁。"}
              </p>
              {frozen ? <button type="button" className="pl-btn pl-btn--primary pl-btn--sm" onClick={() => c.onAppendVideo?.()}>⚡ 一键追投视频</button> : null}
            </div>
          ) : (
            <div className="pl-slot">
              <div className="pl-slot-head">
                <StarChip star="kaiyang" /><b>开阳 · 视频发布包</b>
                {/* 与玉衡同口径三态：没过审稿门禁就是「待启动」——产品原来
                    只有「已就绪 / 制作中」两态，没过门禁的双出案会显示
                    「玉衡 待启动、开阳 制作中」，同一个 step 两个说法
                    （Leo 2026-10-16 抓出，mock21 同口径修法）。 */}
                <span className={`pl-badge pl-badge--${c.step > 5 ? "jade" : c.step === 5 ? "bronze" : "slate"}`}>
                  {c.step > 5 ? "已就绪" : c.step === 5 ? "制作中" : "待启动"}
                </span>
              </div>
              <div className="pl-chip-row">
                <span className="pl-chip">黄金钩子口播 3s</span><span className="pl-chip">分镜表 12 镜头</span>
                <span className="pl-chip">视频号 16:9</span><span className="pl-chip">抖音 9:16</span>
              </div>
              {c.step <= 4 ? <p className="pl-note">视频支线要等审稿门禁 PASS、母稿冻结之后才起，现在还没派给开阳。</p> : null}
            </div>
          )}
          <div className="pl-slot pl-insp-foot">
            <div className="pl-kicker">产出时间线</div>
            {(c.timeline ?? []).length > 0 ? (
              c.timeline.map((r, i) => (
                <div className="pl-tl-row" key={i}>
                  <span className="cp-mono pl-tl-at">{r.at}</span>
                  <span className="pl-tl-icon">{STAR_ICON[r.star] ?? "✨"}</span>
                  <span className="pl-tl-what">{r.what}</span>
                  <span className="cp-mono pl-tl-dur">{r.dur}</span>
                </div>
              ))
            ) : (
              <p className="pl-strike-none">时间线来自本地 session_run 账本：这一案还没有跑过的记录。</p>
            )}
          </div>
        </article>
      </div>
    </>
  );
}

/* ═══════════ 主组件 ═══════════ */
export function PipelineView({
  cases = [],
  starTelemetry = {},
  liveStars = new Set(),
  liveAction = {},
  conn = { state: "error", text: "未连接", title: "" },
  onRetryConn,
  onLaunch,
  onAppendVideo,
  onAutoHeal,
  busy = false,
  tabs = null,
  activeTab = "cockpit",
  onTab,
  focusCaseId = null,
  starsOpen: starsOpenProp,
  onToggleStars,
}) {
  const [activeId, setActiveId] = useState(cases[0]?.caseId);
  const [colFilter, setColFilter] = useState(null);
  // 泳道区高度：null = 按内容（0 案时就是一排列头高，不留死空间）；
  // 拖过之后存**像素**。以前存比例（0.46），等于把「拖那一刻的主区高度」记死，
  // 换窗口尺寸就多出/少掉一截 —— 0 案的机器上就变成一大片白。
  const [lanePx, setLanePx] = useState(null);
  const [starsOpenInner, setStarsOpenInner] = useState(false);
  // 产品模式（App 统一外壳）下「星位明细」按钮在外壳顶栏，这里受控；
  // 预览页没人传，走自己的内部态。
  const starsOpen = starsOpenProp ?? starsOpenInner;
  const toggleStars = () => {
    if (onToggleStars) onToggleStars();
    else setStarsOpenInner((v) => !v);
  };
  const lanesRef = useRef(null);
  const dragRef = useRef(null);

  const active = cases.find((item) => item.caseId === activeId) ?? cases[0];

  // 从「案件卷宗」点一行跳过来时，要选中那一案，而不是默认第一个。
  // 依赖里放 cases.length：账本是异步读的，先跳后到货也要能选中。
  useEffect(() => {
    if (!focusCaseId) return;
    if (cases.some((item) => item.caseId === focusCaseId)) setActiveId(focusCaseId);
  }, [focusCaseId, cases.length]);

  // 泳道行/深潜舱的分割比拖动：140px 保底（泳道至少看得下一行），
  // 上限留 220px 给深潜舱（三栏各至少一个标题加两行）。
  const onDragMove = useCallback((event) => {
    const host = dragRef.current;
    if (!host) return;
    const total = host.getBoundingClientRect().height;
    if (total <= 0) return;
    const next = Math.max(140, Math.min(total - 220, event.clientY - host.getBoundingClientRect().top));
    setLanePx(next);
  }, []);

  // 换窗口尺寸后把记住的像素夹回可用范围，别把深潜舱挤没。
  useEffect(() => {
    if (lanePx == null) return undefined;
    const clamp = () => {
      const host = dragRef.current;
      if (!host) return;
      const total = host.getBoundingClientRect().height;
      if (total <= 0) return;
      const max = Math.max(140, total - 220);
      setLanePx((px) => (px != null && px > max ? max : px));
    };
    window.addEventListener("resize", clamp);
    return () => window.removeEventListener("resize", clamp);
  }, [lanePx]);
  useEffect(() => {
    const stop = () => {
      window.removeEventListener("mousemove", onDragMove);
      window.removeEventListener("mouseup", stop);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    return stop;
  }, [onDragMove]);

  const withActions = useMemo(
    () => cases.map((item) => ({
      ...item,
      onAppendVideo: () => onAppendVideo?.(item),
      onAutoHeal: () => onAutoHeal?.(item),
    })),
    [cases, onAppendVideo, onAutoHeal],
  );
  const activeWithActions = withActions.find((item) => item.caseId === active?.caseId);

  return (
    <div className="pl-root">
      {/* 产品模式：顶栏由 App 统一外壳渲染；预览页（没传 tabs）仍走自己的顶栏。 */}
      {tabs ? null : (
        <PipelineTopBar
          conn={{ ...conn, onRetry: onRetryConn }}
          onOpenStars={toggleStars}
          cases={cases}
        />
      )}

      <main className="pl-main" ref={dragRef}>
          <LaunchBar onLaunch={onLaunch} busy={busy} />
          <section
            className="pl-lane-section"
            style={lanePx == null ? undefined : { flex: `0 0 ${lanePx}px` }}
          >
            <div className="pl-section-head">
              <h1>星位流水线</h1>
              <span className="pl-section-sub">一行一案 · 横看案件进度 · 竖看星位队列</span>
              {/* 四态图例：设计稿 mock20 段头就有，落地时漏了 —— 于是「格子颜色
                  是什么意思」只能靠猜。四态与泳道节点一一对应：
                  投递中=琥珀虚线 / 执行中=琥珀底 / 已交付=jade 底 / 未开始=白底。 */}
              <span className="pl-legend" aria-label="动线图例">
                <span><i className="lg lg--flow" />投递中</span>
                <span><i className="lg lg--run" />执行中</span>
                <span><i className="lg lg--done" />已交付</span>
                <span><i className="lg lg--idle" />未开始</span>
              </span>
              <span className="pl-chip" style={{ marginLeft: "auto" }}>
                {colFilter ? `筛选：${starNameOf(colFilter)} 列 · 再点一次取消` : "列头可点 · 点星位列筛选"}
              </span>
            </div>
            <div className="pl-lane-scroll" ref={lanesRef}>
              <LaneGrid
                cases={withActions}
                totalCount={cases.length}
                activeId={active?.caseId}
                onPick={setActiveId}
                liveStars={liveStars}
                colFilter={colFilter}
                onColFilter={setColFilter}
                starTelemetry={starTelemetry}
              />
            </div>
          </section>

          <button
            type="button"
            className="pl-drag"
            title="上下拖动调整深潜舱高度"
            onMouseDown={(event) => {
              event.preventDefault();
              document.body.style.cursor = "row-resize";
              document.body.style.userSelect = "none";
              window.addEventListener("mousemove", onDragMove);
              window.addEventListener("mouseup", () => {
                window.removeEventListener("mousemove", onDragMove);
                document.body.style.cursor = "";
                document.body.style.userSelect = "";
              }, { once: true });
            }}
          >
            <span className="pl-drag-grip" />
          </button>

          <section className="pl-insp">
            <Inspector
              caseItem={activeWithActions}
              liveStars={liveStars}
              liveAction={liveAction}
              hasCases={cases.length > 0}
            />
          </section>
      </main>

      {starsOpen ? (
        <StarDetail telemetry={starTelemetry} liveStars={liveStars} onClose={toggleStars} />
      ) : null}
      {busy ? <span className="pl-busy" role="status">派发中…</span> : null}
    </div>
  );
}

/// token 数紧凑写法：525000 -> "525k"，12345 -> "12.3k"，999 -> "999"。
function compactTokens(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1000) return String(Math.round(n));
  const k = n / 1000;
  return `${k >= 100 ? Math.round(k) : Math.round(k * 10) / 10}k`;
}

/* ═══════════ 星位明细浮层 ═══════════ */
function StarDetail({ telemetry, liveStars, onClose }) {
  return (
    <div className="pl-stardetail" role="dialog" aria-label="星位明细">
      <div className="pl-stardetail-head">
        <b>星位明细</b>
        <span className="pl-kicker">模型 · 上下文 · 最近一次 run 用时</span>
        <button type="button" className="pl-btn pl-btn--ghost pl-btn--sm" style={{ marginLeft: "auto" }} onClick={onClose}>✕</button>
      </div>
      <div className="pl-stardetail-body">
        {STAR_ORDER.map((id) => {
          const t = telemetry[id] ?? {};
          const live = liveStars.has(id);
          // 上下文水位 = 已用 / 预算。网关只对跑过 run 的会话给
          // estimatedPromptTokens（空闲会话缺省），所以没有 estimate 时只报
          // 预算、进度条留空 —— 画成 0% 等于谎称"用了零"。
          const hasLevel =
            typeof t.estimate === "number" && Number.isFinite(t.estimate) && t.budget > 0;
          const fillPct = hasLevel
            ? Math.min(100, Math.round((t.estimate / t.budget) * 100))
            : null;
          const ctxText = hasLevel
            ? `${compactTokens(t.estimate)} / ${compactTokens(t.budget)}`
            : t.budget
              ? `— / ${compactTokens(t.budget)}`
              : "—";
          // 代表会话的群/主身份 + 水位估算年龄（Leo 2026-10-20 审计）：
          // SOP 关单后清的是**群**上下文，main 会话（agent 间派发通道）没人清
          // ——天权 207k 就在 main 上。不标身份，这个数会被读成群的水位；
          // 不标年龄，10 小时前的快照看起来像实时。
          const sessionBadge = t.sessionIsGroup
            ? "群"
            : typeof t.sessionKey === "string" && t.sessionKey.endsWith(":main")
              ? "主"
              : null;
          const estimateAge =
            typeof t.estimatedAtMs === "number" ? contextEstimateAge(t.estimatedAtMs) : "";
          const estimateStale =
            typeof t.estimatedAtMs === "number"
            && Date.now() - t.estimatedAtMs >= ESTIMATE_STALE_MS;
          return (
            <div className="pl-stardetail-row" key={id}>
              <StarChip star={id} size={22} />
              <div className="pl-stardetail-name">
                <span className="pl-stardetail-line">
                  <b>{starNameOf(id)}</b>
                  <span className="pl-chip" style={{ fontSize: 9.5, padding: "1px 5px" }}>{t.model ?? "—"}</span>
                  {sessionBadge ? (
                    <span className="pl-chip pl-chip--dim" style={{ fontSize: 9.5, padding: "1px 5px" }}>{sessionBadge}</span>
                  ) : null}
                  {live ? <span className="pl-badge pl-badge--amber">执行中</span> : <span className="pl-badge pl-badge--slate">空闲</span>}
                </span>
                <span className="pl-stardetail-note">{t.note ?? ""}</span>
              </div>
              {/* 水位条放中间那条空白里（Leo 2026-10-19：挤在右边数字下面，
                  左边留一大片空，中间更合适）。它自己吃掉剩余宽度。 */}
              <span
                className={`task-context-bar pl-stardetail-bar${fillPct == null ? " task-context-bar--empty" : ""}`}
                title={
                  hasLevel
                    ? `已用 ${fillPct}% · ${t.estimate.toLocaleString()} / ${t.budget.toLocaleString()} tok${estimateAge ? ` · 估算于 ${estimateAge}` : ""}${typeof t.sessionKey === "string" ? ` · ${t.sessionKey}` : ""}`
                    : "空闲会话，网关不报上下文水位"
                }
              >
                <i
                  className={fillPct != null && fillPct >= 80 ? "task-context-fill--warn" : undefined}
                  style={fillPct != null ? { width: `${fillPct}%` } : undefined}
                />
              </span>
              <div className="pl-stardetail-right">
                <span className="cp-mono pl-stardetail-ctx">上下文 {ctxText}</span>
                <span className="cp-mono pl-stardetail-last">上次 {t.lastRun ?? "—"}</span>
                {estimateStale ? (
                  <span
                    className="cp-mono pl-stardetail-last pl-stardetail-last--stale"
                    title={`水位估算取样于 ${estimateAge}，此后该会话没有新 run；若期间被 reset，实际已重置`}
                  >
                    估算 {estimateAge}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      <div className="pl-stardetail-foot">
        说明：上下文是<span className="cp-mono">已用 / 预算</span>，取自网关的
        <span className="cp-mono">estimatedPromptTokens</span>——只有跑过 run 的会话带这个值，
        空闲会话缺省，那种行只报预算、进度条留空（不画成 0%）。
        数字是<span className="cp-mono">上一次 run 的快照</span>，跑完不再刷新：超过 1 小时未跑的会话会标出估算年龄
        （群徽标 = 流水线群会话，主 = agent 间派发通道；SOP 关单只清群上下文）。
        累计 token 计数器仍是关的（<span className="cp-mono">sessions.usage</span> 全 0），
        等真开了计量再加「本任务累计 token」。
      </div>
    </div>
  );
}

export { ledgerRowToCase, stageToStep };
