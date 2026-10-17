import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DAG_STEPS,
  DELIVERABLE_MODES,
  DELIVERABLE_MODE_LABEL,
  FIVE_AXES,
  GATE_VERDICT_LABEL,
  HUMANITY_PROBES,
  PARALLEL_BRANCHES,
  SEVEN_AXES,
  STRIKE_LIMIT,
  WATCHDOG_BRANCHES,
  WATCHDOG_PERIOD_MS,
  archiveResidencyText,
  archiveRowTitle,
  assetSlotState,
  axisScores,
  axisTone,
  branchStatesOf,
  canAppendVideo,
  dagStepOfCase,
  fiveAxisTotal,
  isAutoHealing,
  masterDocBadge,
  mergeLockOf,
  normalizeDeliverableMode,
  normalizeEntryMode,
  normalizeGateVerdict,
  parseLaunchInput,
  rankCandidateTitles,
  starNameOf,
  starOnlineTone,
  stripDualMarker,
  textWantsDual,
  watchdogMatrix,
} from "./cockpit.js";
import { agentDisplayName, buildAgentNameMap } from "./taskChains.js";

const STAR_ICON = {
  tianshu: "🧭", tianxuan: "🔭", tianquan: "⚖️", tianji: "🖋️",
  yuheng: "🎨", kaiyang: "🎬", yaoguang: "🚀", main: "✨",
};

/// 指挥舱演示数据（真机台账目前只跑通一个案件，其余为形态占位）。
/// 演示行的 caseId 与真实台账的 record_id 解耦——串台防护见 cockpit.js 测试。
const DEMO_CASES = [
  {
    caseId: "BM-2601",
    name: "中式玄关",
    title: "",
    step: 1,
    deliverableMode: "IMAGE_ONLY",
    ownerStar: "tianxuan",
    entryMode: "AUTO_DISCOVERY",
    residencyNote: "候选标题已呈 3 个",
    folderUrl: "https://my.feishu.cn/drive/folder/RbpjfPLoPllQDGdSVDLca8zrnxg",
    researchDocUrl: "https://my.feishu.cn/docx/CDcfdyrAtoVAAJxRhY7ca8OtnNg",
    candidates: [
      { title: "玄关别堆杂物｜3 个收纳心法，进门就有秩序感", scores: { accuracy: 92, compliance: 90, humanity: 88, persona: 85, spread: 94 } },
      { title: "一进门就见心静：中式玄关的留白讲究", scores: { accuracy: 88, compliance: 92, humanity: 90, persona: 88, spread: 71 } },
      { title: "玄关这 1㎡ 最值得：换鞋、挂衣、藏伞一次到位", scores: { accuracy: 90, compliance: 88, humanity: 82, persona: 80, spread: 86 } },
    ],
  },
  {
    caseId: "BM-2604",
    name: "天璇呈题待定",
    title: "",
    step: 2,
    deliverableMode: "IMAGE_ONLY",
    ownerStar: "tianquan",
    entryMode: "AUTO_DISCOVERY",
    residencyNote: "天权五轴定题中",
    folderUrl: "https://my.feishu.cn/drive/folder/RbpjfPLoPllQDGdSVDLca8zrnxg",
    researchDocUrl: "https://my.feishu.cn/docx/CDcfdyrAtoVAAJxRhY7ca8OtnNg",
    candidates: [
      { title: "小户型餐边柜：3 个位置决定厨房好不好用", scores: { accuracy: 90, compliance: 91, humanity: 86, persona: 84, spread: 92 } },
      { title: "餐边柜不是收纳柜：留一面墙给生活的余地", scores: { accuracy: 86, compliance: 90, humanity: 92, persona: 90, spread: 78 } },
    ],
  },
  {
    caseId: "BM-2605",
    name: "小户型餐边柜",
    title: "餐边柜别贴厨房墙：3 个尺度细节，决定台面好不好用",
    step: 5,
    deliverableMode: "IMAGE_ONLY",
    ownerStar: "tianquan",
    entryMode: "AUTO_DISCOVERY",
    residencyNote: "母稿待冻结",
    masterFrozen: true,
    secondVerdict: "PASS",
    secondStrikes: 0,
    folderUrl: "https://my.feishu.cn/drive/folder/RbpjfPLoPllQDGdSVDLca8zrnxg",
    masterDocUrl: "https://my.feishu.cn/docx/CYeOddF3UosU8Wx0a04cSBDMnBe",
    visualProgress: 1,
    videoProgress: 0,
    axisScores: { accuracy: 94, compliance: 92, humanity: 88, persona: 90, spread: 86, logic: 89, readability: 91 },
    verdictText:
      "七轴全过。人味 88 已达线，开头两段按上次打回意见重写过，删掉了 AI 起手式。配图锚点 6 个与正文小节一一对应，母稿可以冻结。",
    humanityProbes: { concrete: 92, rhythm: 88, banned: 100, stance: 96, structure: 90, titleFit: 94 },
  },
  {
    caseId: "BM-2603",
    name: "阳台茶室",
    title: "阳台改茶室：1.5㎡ 也能坐下喝茶晒太阳",
    step: 5,
    deliverableMode: "DUAL",
    ownerStar: "par",
    entryMode: "DIRECT_TITLE",
    residencyNote: "双轨并行中",
    masterFrozen: true,
    secondVerdict: "PASS",
    secondStrikes: 0,
    folderUrl: "https://my.feishu.cn/drive/folder/RbpjfPLoPllQDGdSVDLca8zrnxg",
    masterDocUrl: "https://my.feishu.cn/docx/CYeOddF3UosU8Wx0a04cSBDMnBe",
    visualProgress: 1,
    videoProgress: 0.42,
    axisScores: { accuracy: 91, compliance: 93, humanity: 85, persona: 88, spread: 90, logic: 87, readability: 89 },
    verdictText: "七轴过线，视频分支已按双出模式并行推进，分镜表 12 镜头已落盘 7 条。",
    humanityProbes: { concrete: 88, rhythm: 84, banned: 100, stance: 94, structure: 88, titleFit: 90 },
  },
  {
    caseId: "BM-2602",
    name: "老房翻新预算表",
    title: "老房翻新预算怎么排：先动水电还是先动墙面",
    step: 6,
    deliverableMode: "IMAGE_ONLY",
    ownerStar: "yaoguang",
    entryMode: "DIRECT_TITLE",
    residencyNote: "分发中 · 24h 待复盘",
    masterFrozen: true,
    secondVerdict: "PASS",
    secondStrikes: 0,
    folderUrl: "https://my.feishu.cn/drive/folder/RbpjfPLoPllQDGdSVDLca8zrnxg",
    masterDocUrl: "https://my.feishu.cn/docx/CYeOddF3UosU8Wx0a04cSBDMnBe",
    opsDocUrl: "https://my.feishu.cn/docx/Wb2Udrq6HocjhUxyTMpcbx1FnTe",
    visualProgress: 1,
    videoProgress: 0,
    axisScores: { accuracy: 93, compliance: 95, humanity: 87, persona: 91, spread: 89, logic: 92, readability: 90 },
    verdictText: "二审一次通过，母稿冻结后进入分发。",
    humanityProbes: { concrete: 90, rhythm: 86, banned: 100, stance: 97, structure: 91, titleFit: 92 },
  },
];

const DEMO_WATCHDOG = [
  { kind: "REWAKE", at: 60_000, receipt: "天权 判词驻留超 20m -> Watchdog 已自动重发 sessions_send 唤醒" },
  { kind: "AUTO_HEAL", at: 180_000, receipt: "BM-2604 天璇 3/3 熔断 -> 天枢 reset 会话并派发局部重修" },
  { kind: "AUTO_CLOSE", at: 600_000, receipt: "BM-2602 摇光收尾 -> 任务关单，Watchdog 自删" },
  { kind: "SILENT", at: 1_200_000, receipt: "其余 4 个任务无异常" },
];

function StarBadge({ star, size }) {
  const cls = `cp-star cp-star--${star || "main"}`;
  return (
    <span className={cls} style={size ? { width: size, height: size, fontSize: size * 0.55 } : undefined} aria-hidden="true">
      {STAR_ICON[star] || STAR_ICON.main}
    </span>
  );
}

function AxisBar({ label, score }) {
  const tone = axisTone(score);
  return (
    <div className="cp-axis">
      <span className="cp-axis-label">{label}</span>
      <span className="cp-axis-track">
        <span className={`cp-axis-fill cp-axis-fill--${tone}`} style={{ width: `${score}%` }} />
      </span>
      <span className={`cp-axis-val cp-axis-val--${tone}`}>{score}</span>
    </div>
  );
}

/* ═══════════ 顶部指令舱 ═══════════ */
function CommandBar({
  onLaunch,
  busy,
  onlineCount,
  totalStars,
  inFlight,
  todayHops,
  tokens,
  zeroTouch,
  onToggleZeroTouch,
}) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState("IMAGE_ONLY");
  const inputRef = useRef(null);

  // 智能输入联动：打字含 +视频/双出/含视频 → 胶囊平滑切到双出。
  // 注意这是"预览态"：标记词在，输入框右侧就显示 DUAL 选中。但用户显式
  // 点别的模式时以用户为准——inputPinned 记住用户最后一次显式选择，
  // 只要他动过胶囊，就不再被输入里的标记词顶掉（否则想选仅视频时
  // 标题里带"视频"两个字就永远切不过去）。
  const wantsDual = textWantsDual(text);
  const [inputPinned, setInputPinned] = useState(false);
  const effectiveMode = wantsDual && !inputPinned ? "DUAL" : mode;
  const pickMode = useCallback((next) => {
    setMode(next);
    setInputPinned(true);
  }, []);
  const parsed = useMemo(() => parseLaunchInput(text, effectiveMode), [text, effectiveMode]);

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

  const submit = useCallback(() => {
    if (!parsed.ready) return;
    onLaunch?.({ title: parsed.title, deliverableMode: parsed.deliverableMode });
    setText("");
  }, [onLaunch, parsed]);

  const tone = starOnlineTone(onlineCount, totalStars);
  const onlineLabel = `星位在线 ${onlineCount}/${totalStars}`;

  return (
    <header className="cp-topbar">
      <div className="flex items-center gap-2.5" style={{ flex: "none" }}>
        <span className="cp-star cp-star--tianshu" style={{ width: 26, height: 26, fontSize: 14 }} aria-hidden="true">司</span>
        <div className="leading-none">
          <div className="cp-title" style={{ fontSize: 13 }}>司南 SINAN · 北斗七星全自动指挥舱</div>
          <div className="cp-meta-text" style={{ fontSize: 10, marginTop: 3 }}>Zero-Touch · 无人值守</div>
        </div>
      </div>

      {/* 命题直通发车栏 + 交付模式三态胶囊 */}
      <div className="cp-launch">
        <span style={{ flex: "none", marginRight: 7, fontSize: 12 }} aria-hidden="true">⚡</span>
        <input
          ref={inputRef}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") submit(); }}
          placeholder="输入指定标题直通发车（支持末尾输入 +视频 自动切换双出）"
          aria-label="命题直通发车标题"
        />
        {wantsDual ? <span className="cp-chip cp-chip--bronze" style={{ flex: "none", marginRight: 6 }}>将剥离「+视频」</span> : null}
        <span className="cp-launch-kbd cp-mono">⌘K</span>
      </div>

      <div className="cp-seg" role="group" aria-label="交付模式">
        {DELIVERABLE_MODES.map((key) => {
          const meta = DELIVERABLE_MODE_LABEL[key];
          return (
            <button
              key={key}
              type="button"
              data-mode={key}
              className={`cp-seg-btn${effectiveMode === key ? " is-on" : ""}`}
              aria-pressed={effectiveMode === key}
              onClick={() => pickMode(key)}
              title={meta.full}
            >
              <span aria-hidden="true">{meta.icon}</span>
              {meta.short}
            </button>
          );
        })}
      </div>

      <button type="button" className="cp-btn cp-btn--primary" style={{ flex: "none" }} disabled={!parsed.ready || busy} onClick={submit}>
        立即发车 <span aria-hidden="true">→</span>
      </button>

      <div className="cp-tele" style={{ marginLeft: "auto", flex: "none" }}>
        <button
          type="button"
          className={`cp-tele-pill${zeroTouch ? "" : " cp-tele-pill--warn"}`}
          onClick={onToggleZeroTouch}
          title="全自动巡航常驻开启；点此切到旁路观察（不自动派单）"
        >
          <span aria-hidden="true">🤖</span>
          {zeroTouch ? "ZERO-TOUCH 全自动巡航" : "旁路观察模式"}
        </button>
        <span className={`cp-tele-pill${tone === "jade" ? "" : tone === "bronze" ? " cp-tele-pill--warn" : " cp-tele-pill--crit"}`} title="星位在线数">
          <span className={`cp-dot cp-dot--${tone}`} />
          {onlineLabel}
        </span>
        <span className="cp-tele-pill">在途 <b>{inFlight}</b></span>
        <span className="cp-tele-pill">今日接力 <b>{todayHops}</b> 跳</span>
        <span className="cp-tele-pill">Token <b>{tokens}</b></span>
      </div>
    </header>
  );
}

/* ═══════════ 七星 DAG 拓扑星轨 ═══════════ */
function OrbitTrack({ caseItem, healing, onAppendVideo }) {
  const step = dagStepOfCase(caseItem?.step);
  const mode = normalizeDeliverableMode(caseItem?.deliverableMode);
  const branch = branchStatesOf(caseItem);
  const lock = mergeLockOf(caseItem);
  const badge = masterDocBadge(caseItem);
  const trackRef = useRef(null);

  const edges = [];
  const nodes = [];
  DAG_STEPS.forEach((node, index) => {
    const isCur = index === step;
    const isDone = index < step;
    if (node.parallel) {
      nodes.push(
        <div className="cp-par" key="par">
          {PARALLEL_BRANCHES.map((br) => {
            const state = br.star === "yuheng" ? branch.yuheng : branch.kaiyang;
            const cls = state === "active" ? "is-active" : state === "done" ? "is-done" : state === "standby" ? "is-standby" : "is-idle";
            const appendable = br.star === "kaiyang" && state === "standby" && canAppendVideo(caseItem);
            return (
              <div className={`cp-par-node ${cls}`} key={br.key} title={state === "standby" ? "本案未启用视频分支" : br.sub}>
                <StarBadge star={br.star} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 11.5, fontWeight: 600 }}>{starNameOf(br.star)}</span>
                  <span style={{ display: "block", fontSize: 9.5, opacity: 0.78 }}>{br.title}</span>
                </span>
                {appendable ? (
                  <button type="button" className="cp-btn" style={{ height: 22, padding: "0 8px", fontSize: 10.5, marginLeft: "auto", flex: "none" }} onClick={onAppendVideo}>
                    ⚡ 一键追投视频
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>,
      );
    } else {
      nodes.push(
        <div className={`cp-node${isCur ? " is-cur" : isDone ? " is-done" : " is-idle"}`} key={`${node.no}-${node.star}`}>
          {node.gate === "second" ? (
            <span className="cp-node-gate cp-node-gate--second" title="二审门禁：PASS 后母稿冻结">🔒</span>
          ) : null}
          <span className="cp-node-no">{node.no}</span>
          <StarBadge star={node.star} />
          <span className="cp-node-title">{starNameOf(node.star)}</span>
          <span className="cp-node-sub">{node.title}</span>
        </div>,
      );
    }
    if (index < DAG_STEPS.length - 1) {
      const edgeDone = index < step;
      const edgeCur = index === step;
      const isIntoPar = DAG_STEPS[index + 1]?.parallel;
      const standbyEdge = isIntoPar && mode === "IMAGE_ONLY";
      edges.push(
        <span className="cp-edge" key={`e-${index}`}>
          <svg width="26" height="12" viewBox="0 0 26 12">
            {edgeCur ? (
              <line x1="0" y1="6" x2="26" y2="6" className="cp-edge-flow" />
            ) : standbyEdge ? (
              <line x1="0" y1="6" x2="26" y2="6" className="cp-edge-standby" />
            ) : (
              <line x1="0" y1="6" x2="26" y2="6" className={`cp-edge-line${edgeDone ? " is-done" : ""}`} />
            )}
          </svg>
        </span>,
      );
    }
  });

  // 交错拼装：node edge node edge ...
  const row = [];
  DAG_STEPS.forEach((_, index) => {
    row.push(nodes[index]);
    if (edges[index]) row.push(edges[index]);
  });

  // 自愈回环：二审(05) 打回 母稿(04)，琥珀脉冲虚线
  const healingLoop = healing ? (
    <LoopArc trackRef={trackRef} fromIndex={4} toIndex={3} strikes={caseItem?.secondStrikes ?? STRIKE_LIMIT} />
  ) : null;

  return (
    <section className="cp-orbit">
      <div className="cp-orbit-head">
        <div style={{ minWidth: 0 }}>
          <h2 className="cp-title" style={{ fontSize: 15, margin: 0 }}>
            🌌 {archiveRowTitle(caseItem)} · 案 <span className="cp-mono">{caseItem?.caseId}</span>
          </h2>
          <p className="cp-meta-text" style={{ fontSize: 11.5, margin: "5px 0 0" }}>
            当前驻留：<b style={{ color: "var(--cp-bronze)" }}>{DAG_STEPS[step].no} {starNameOf(DAG_STEPS[step].star)} · {DAG_STEPS[step].title}</b>
            {caseItem?.residencyNote ? ` · ${caseItem.residencyNote}` : ""}
          </p>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 7, flex: "none" }}>
          <span className={`cp-badge cp-badge--${badge.tone}`}>
            <span aria-hidden="true">{badge.icon}</span>
            {badge.text}
          </span>
          <span className={`cp-badge cp-badge--${mode === "DUAL" ? "bronze" : mode === "VIDEO_ONLY" ? "indigo" : "slate"}`}>
            {DELIVERABLE_MODE_LABEL[mode].badge}
          </span>
          {lock ? (
            <span className={`cp-merge-lock${lock.ready ? " is-ready" : ""}`} title="玉衡/开阳两个 doc_id 的落盘合流进度">
              🔗 双轨合流锁 {lock.done}/{lock.total} {lock.ready ? "已就绪" : ""}
            </span>
          ) : null}
        </div>
      </div>
      <div className="cp-orbit-track" ref={trackRef}>
        <div className="cp-orbit-row">{row}</div>
        {healingLoop}
      </div>
    </section>
  );
}

/// 自愈回环弧线：从被打回节点绕回目标节点，弧中点挂「🔁 打回重审 n/3」。
function LoopArc({ trackRef, fromIndex, toIndex, strikes }) {
  const [geom, setGeom] = useState(null);

  useEffect(() => {
    const measure = () => {
      const track = trackRef.current;
      if (!track) return;
      const kids = [...track.querySelectorAll(".cp-orbit-row > *")];
      // .cp-node 与 .cp-par 交错，取节点容器（有 cp-node / cp-par 类的）
      const boxes = kids.filter((n) => n.classList.contains("cp-node") || n.classList.contains("cp-par"));
      const from = boxes[fromIndex];
      const to = boxes[toIndex];
      if (!from || !to) return;
      const tr = track.getBoundingClientRect();
      const fr = from.getBoundingClientRect();
      const tr2 = to.getBoundingClientRect();
      setGeom({
        x1: fr.left - tr.left + fr.width / 2,
        y1: fr.top - tr.top + fr.height,
        x2: tr2.left - tr.left + tr2.width / 2,
        y2: tr2.top - tr.top,
      });
    };
    measure();
    const timer = setInterval(measure, 600);
    window.addEventListener("resize", measure);
    return () => { clearInterval(timer); window.removeEventListener("resize", measure); };
  }, [trackRef, fromIndex, toIndex]);

  if (!geom) return null;
  const dip = Math.max(40, geom.y1 - geom.y2 + 36);
  return (
    <>
      <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none" }} aria-hidden="true">
        <path
          d={`M${geom.x1} ${geom.y1} C ${geom.x1} ${geom.y1 + dip}, ${geom.x2} ${geom.y2 - dip}, ${geom.x2} ${geom.y2 - 5}`}
          className="cp-edge-loop"
        />
        <circle cx={geom.x2} cy={geom.y2 - 5} r="3.5" fill="var(--cp-amber)" />
      </svg>
      <span className="cp-loop-tag" style={{ left: (geom.x1 + geom.x2) / 2, top: geom.y1 + dip * 0.52 }}>
        ♻️ 自愈重修 · 打回 {strikes}/{STRIKE_LIMIT}
      </span>
    </>
  );
}

/* ═══════════ 自动定题与命题路由实况 ═══════════ */
function AutoTitlePanel({ caseItem, onOverride }) {
  const entry = normalizeEntryMode(caseItem?.entryMode);
  const ranked = useMemo(() => rankCandidateTitles(caseItem?.candidates), [caseItem]);
  const champion = ranked.find((item) => item.champion);

  return (
    <article className="cp-card cp-panel">
      <div className="cp-panel-head">
        <span className="cp-star cp-star--tianxuan" aria-hidden="true">🎯</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3 className="cp-title" style={{ fontSize: 13.5, margin: 0 }}>自动定题与命题路由实况</h3>
          <p className="cp-meta-text" style={{ fontSize: 11, margin: "3px 0 0" }}>Auto-Title &amp; Research Telemetry</p>
        </div>
        <span className={`cp-badge cp-badge--${entry === "DIRECT_TITLE" ? "bronze" : "slate"}`} style={{ flex: "none" }}>
          {entry === "DIRECT_TITLE" ? "⚡ 命题直通 (DIRECT_TITLE)" : "🧭 自主寻题 (天权五轴竞优定题)"}
        </span>
      </div>

      {entry === "DIRECT_TITLE" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="cp-slot" style={{ padding: "11px 12px" }}>
            <div className="cp-meta-text" style={{ fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase" }}>直通正式标题</div>
            <div className="cp-title" style={{ fontSize: 14, marginTop: 6, lineHeight: 1.5 }}>{archiveRowTitle(caseItem)}</div>
          </div>
          <div className="cp-slot" style={{ padding: "11px 12px" }}>
            <div className="cp-meta-text" style={{ fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase" }}>天璇自动背调 · 传统环境文化典故支撑</div>
            <p className="cp-body-text" style={{ fontSize: 11.5, lineHeight: 1.7, margin: "6px 0 0" }}>
              对标账号样本 12 篇，同题内容均分互动 <span className="cp-mono">312</span>；人设卡九字纲领取「留白 / 界定 / 尺度」，
              典故线用《长物志》居止篇对"宁古无时"的取舍作支撑，避开 AI 套话起手式。
            </p>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {ranked.map((item) => (
            <div className={`cp-cand${item.champion ? " is-champ" : ""}`} key={item.title}>
              <span style={{ flex: "none", width: 14, paddingTop: 2, fontSize: 10.5, fontWeight: 700, color: "var(--cp-meta)" }} className="cp-mono">
                {String(ranked.indexOf(item) + 1).padStart(2, "0")}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="cp-cand-title">{item.title}</span>
                {item.champion ? (
                  <span className="cp-badge cp-badge--bronze" style={{ marginTop: 6 }}>🏆 天权五轴钦定 · 正式标题</span>
                ) : null}
                <span style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 7 }}>
                  {FIVE_AXES.map((axis) => {
                    const score = axisScores(item.scores, FIVE_AXES)[axis.key];
                    return <AxisBar key={axis.key} label={axis.label} score={score} />;
                  })}
                  <span className="cp-meta-text cp-mono" style={{ fontSize: 10, textAlign: "right" }}>
                    五轴总分 {fiveAxisTotal(item.scores)}
                  </span>
                </span>
              </span>
            </div>
          ))}
          <div className="cp-slot" style={{ padding: "10px 12px" }}>
            <div className="cp-meta-text" style={{ fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase" }}>选题风险分析</div>
            <p className="cp-body-text" style={{ fontSize: 11.5, lineHeight: 1.7, margin: "5px 0 0" }}>
              基于对标账号样本数据与人设卡九字纲领：候选一共鸣强但同题饱和度 <span className="cp-mono">高</span>，
              需在开头 3 行做出差异；候选二文化味重、搜索量偏低，适合做系列第二篇。
            </p>
          </div>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: "auto", paddingTop: 12 }}>
        {caseItem?.researchDocUrl ? (
          <a className="cp-btn" href={caseItem.researchDocUrl} target="_blank" rel="noreferrer">
            📄 天璇研究文档 ↗
          </a>
        ) : null}
        <button type="button" className="cp-btn cp-btn--ghost" style={{ marginLeft: "auto" }} onClick={onOverride} title="人工介入改题（旁路，不影响自动流水线）">
          人工介入改题 (Override)
        </button>
      </div>
    </article>
  );
}

/* ═══════════ 天权七轴门禁与天枢自愈引擎 ═══════════ */
function GateEnginePanel({ caseItem }) {
  const verdict = normalizeGateVerdict(caseItem?.secondVerdict);
  const verdictMeta = GATE_VERDICT_LABEL[verdict];
  const scores = axisScores(caseItem?.axisScores, SEVEN_AXES);
  const probes = axisScores(caseItem?.humanityProbes, HUMANITY_PROBES);
  const healing = isAutoHealing(caseItem);

  const healLog = healing
    ? [
        { t: "prompt", text: "$ openclaw reset --session agent:tianji:main --reason second-gate-meltdown" },
        { t: "ok", text: "  ✓ session cleared (ctx 41.2k tokens flushed)" },
        { t: "ok", text: "  ✓ watchdog receipt: beidou-cases/BM-2604 heal#1" },
        { t: "prompt", text: "$ sessions_send --to tianji --profile tianji --as bot" },
        { t: "text", text: "  payload: [CASE_ID: BM-2604] 局部重修：仅重写前三段与第 4 节" },
        { t: "warn", text: "  ⚠ 保留母稿骨架与已通过小节，未触发全量重跑" },
        { t: "ok", text: "  ✓ dispatched (no human approval required)" },
      ]
    : [];

  return (
    <article className="cp-card cp-panel">
      <div className="cp-panel-head">
        <span className="cp-star cp-star--tianquan" aria-hidden="true">🛡️</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3 className="cp-title" style={{ fontSize: 13.5, margin: 0 }}>天权七轴门禁与天枢自愈引擎</h3>
          <p className="cp-meta-text" style={{ fontSize: 11, margin: "3px 0 0" }}>7-Axis Gate &amp; Auto-Heal Engine</p>
        </div>
        <span className={`cp-badge cp-badge--${verdictMeta.tone}`} style={{ flex: "none" }}>{verdictMeta.text}</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {SEVEN_AXES.map((axis) => (
          <AxisBar key={axis.key} label={axis.label} score={scores[axis.key]} />
        ))}
      </div>

      <details style={{ marginTop: 10 }}>
        <summary className="cp-meta-text" style={{ fontSize: 11, cursor: "pointer", userSelect: "none" }}>
          🔍 人味（去 AI 味）探针细项拆解
        </summary>
        <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 8 }}>
          {HUMANITY_PROBES.map((probe) => (
            <AxisBar key={probe.key} label={probe.label} score={probes[probe.key]} />
          ))}
        </div>
      </details>

      {caseItem?.verdictText ? (
        <blockquote className="cp-quote" style={{ marginTop: 11 }}>
          {caseItem.verdictText}
          <footer className="cp-meta-text" style={{ fontSize: 10.5, marginTop: 6 }}>—— 天权 · 二审判词</footer>
        </blockquote>
      ) : null}

      {healing ? (
        <div style={{ marginTop: 11 }}>
          <div className="cp-meta-text" style={{ fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", marginBottom: 5 }}>
            💻 天枢自动自愈流水日志（Auto-Heal Terminal）
          </div>
          <div className="cp-term">
            {healLog.map((line, index) => (
              <span className={`cp-term-line cp-term-${line.t}`} key={index}>{line.text}</span>
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}

/* ═══════════ 双通道发布包预览带 ═══════════ */
function AssetStrip({ caseItem, onAppendVideo }) {
  const mode = normalizeDeliverableMode(caseItem?.deliverableMode);
  const visual = assetSlotState(caseItem, "visual");
  const video = assetSlotState(caseItem, "video");
  const link = caseItem?.masterDocUrl;

  return (
    <div className="cp-strip">
      <article className="cp-card cp-slotcard">
        <div className="cp-panel-head" style={{ marginBottom: 0 }}>
          <StarBadge star="yuheng" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 className="cp-title" style={{ fontSize: 13, margin: 0 }}>06A 玉衡 · 图文发布包</h3>
          </div>
          <span className={`cp-badge cp-badge--${visual === "ready" ? "jade" : visual === "active" ? "bronze" : "slate"}`}>
            {visual === "ready" ? "已就绪" : visual === "active" ? "出图中" : "待启动"}
          </span>
        </div>
        <div className="cp-asset-row">
          <span className="cp-chip">配图锚点 {caseItem?.visualProgress >= 1 ? "6/6 已出图" : "生成中"}</span>
          <span className="cp-chip">小红书 3:4</span>
          <span className="cp-chip">公众号 1:1</span>
        </div>
        {link ? (
          <a className="cp-btn" href={link} target="_blank" rel="noreferrer" style={{ alignSelf: "flex-start" }}>
            📄 图文包 docx ↗
          </a>
        ) : null}
      </article>

      <article className={`cp-card cp-slotcard${video === "standby" ? " cp-standby" : ""}`}>
        <div className="cp-panel-head" style={{ marginBottom: 0 }}>
          <StarBadge star="kaiyang" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 className="cp-title" style={{ fontSize: 13, margin: 0 }}>06B 开阳 · 视频发布包</h3>
          </div>
          <span className={`cp-badge cp-badge--${video === "ready" ? "jade" : video === "active" ? "bronze" : "slate"}`}>
            {video === "ready" ? "已就绪" : video === "active" ? "制作中" : video === "appendable" ? "可追投" : "未启用"}
          </span>
        </div>
        {video === "standby" ? (
          <div className="cp-empty-slot" style={{ flex: 1 }}>
            <span>本案未启用视频分支</span>
            <span style={{ fontSize: 10.5 }}>{mode === "IMAGE_ONLY" ? "仅图文模式下开阳待命" : "当前交付模式不含视频"}</span>
          </div>
        ) : video === "appendable" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 9, flex: 1 }}>
            <div className="cp-asset-row cp-meta-text" style={{ fontSize: 11 }}>
              母稿已冻结 · 可从冻结母稿直接追投，无需重跑前序节点
            </div>
            <button type="button" className="cp-btn cp-btn--primary" onClick={onAppendVideo} style={{ alignSelf: "flex-start" }}>
              ⚡ 从冻结母稿一键追投视频
            </button>
          </div>
        ) : (
          <>
            <div className="cp-asset-row">
              <span className="cp-chip">黄金钩子口播预览 3s</span>
              <span className="cp-chip">分镜表 {caseItem?.videoProgress >= 1 ? "12/12 已落盘" : "生成中"}</span>
            </div>
            <div className="cp-asset-row">
              <span className="cp-chip">视频号 16:9</span>
              <span className="cp-chip">抖音 9:16</span>
            </div>
            <blockquote className="cp-quote" style={{ fontSize: 11.5 }}>
              「小户型最贵的不是面积，是放错位置的那 30 公分。」
            </blockquote>
          </>
        )}
      </article>
    </div>
  );
}

/* ═══════════ 左侧卷宗 + Watchdog ═══════════ */
function ArchiveRail({ cases, activeId, onPick, watchdogEvents }) {
  const matrix = useMemo(() => watchdogMatrix(watchdogEvents), [watchdogEvents]);
  return (
    <aside className="cp-rail">
      <div className="cp-rail-head">
        <span className="cp-rail-title">在途案件</span>
        <span className="cp-chip" style={{ marginLeft: "auto" }}>{cases.length}</span>
      </div>
      <div className="cp-arch-list">
        {cases.map((item) => {
          const residency = archiveResidencyText(item);
          const on = item.caseId === activeId;
          return (
            <button
              type="button"
              key={item.caseId}
              className={`cp-arch${on ? " is-on" : ""}`}
              onClick={() => onPick(item.caseId)}
              aria-current={on ? "true" : undefined}
            >
              <span className="cp-arch-top">
                <span className="cp-arch-name" title={archiveRowTitle(item)}>{archiveRowTitle(item)}</span>
                <span className="cp-arch-id">{item.caseId}</span>
              </span>
              <span className="cp-arch-row2">
                <span className={`cp-badge cp-badge--${normalizeDeliverableMode(item.deliverableMode) === "DUAL" ? "bronze" : normalizeDeliverableMode(item.deliverableMode) === "VIDEO_ONLY" ? "indigo" : "slate"}`} style={{ fontSize: 10, padding: "2px 6px" }}>
                  {DELIVERABLE_MODE_LABEL[normalizeDeliverableMode(item.deliverableMode)].icon} {residency.mode}
                </span>
                <span className="cp-badge cp-badge--slate" style={{ fontSize: 10, padding: "2px 6px" }}>
                  <StarBadge star={item.ownerStar === "par" ? "yuheng" : item.ownerStar} size={13} />
                  {item.ownerStar === "par" ? "玉衡 // 开阳" : starNameOf(item.ownerStar)}
                </span>
                {item.masterFrozen ? <span title="母稿冻结锁">🔒</span> : null}
                <a
                  className="cp-btn cp-btn--ghost"
                  href={item.folderUrl || "#"}
                  target="_blank"
                  rel="noreferrer"
                  style={{ marginLeft: "auto", height: 22, padding: "0 7px", fontSize: 10.5 }}
                  onClick={(event) => event.stopPropagation()}
                  title="飞书云盘文件夹直达"
                >
                  📁
                </a>
              </span>
              <span className="cp-arch-note">{residency.text}</span>
            </button>
          );
        })}
      </div>
      <div className="cp-watch">
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span className="cp-rail-title">Watchdog 巡检</span>
          <span className="cp-meta-text cp-mono" style={{ fontSize: 10 }}>每 20 分钟一轮 · 一任务一 Watchdog（跑完自删）</span>
        </div>
        <div style={{ marginTop: 7 }}>
          {matrix.length ? matrix.map((row) => (
            <div className="cp-watch-row" key={row.key}>
              <span aria-hidden="true" style={{ flex: "none" }}>{row.icon}</span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <b style={{ fontWeight: 600 }}>{row.label}</b>
                <span className="cp-meta-text"> · {row.desc}</span>
                {row.receipt ? <span className="cp-watch-receipt" style={{ display: "block" }}>{row.receipt}</span> : null}
              </span>
            </div>
          )) : (
            <div className="cp-watch-row cp-meta-text">
              <span aria-hidden="true">🟢</span>
              <span>无事静默 · {WATCHDOG_BRANCHES[0].desc}</span>
            </div>
          )}
        </div>
        <div className="cp-meta-text cp-mono" style={{ fontSize: 10, marginTop: 8 }}>
          周期 {WATCHDOG_PERIOD_MS / 60000}m · 五分支：{WATCHDOG_BRANCHES.map((b) => b.icon).join(" ")}
        </div>
      </div>
    </aside>
  );
}

/* ═══════════ 指挥舱主组件 ═══════════ */
export function CockpitView({ cases = DEMO_CASES, watchdogEvents = DEMO_WATCHDOG, agentNameMap, onLaunch, onAppendVideo, onOverrideTitle, busy, onlineCount = 7, totalStars = 7, todayHops = 12, tokens = "1.28M" }) {
  const [activeId, setActiveId] = useState(cases[0]?.caseId);
  const [zeroTouch, setZeroTouch] = useState(true);
  // 真机首发：本地账本一行都没有（飞书主表还没回填）。此时深潜舱渲染一个
  // 空案的 7 步星轨 + 一排 0 分，看着像"这一案坏掉了"——那是撒谎。
  // 改成明说"还没有案件，上面输入标题就能发第一车"，深潜舱整块让位。
  const active = cases.find((item) => item.caseId === activeId) ?? cases[0];
  const nameMap = agentNameMap ?? buildAgentNameMap([]);
  const healing = isAutoHealing(active);
  const inFlight = cases.filter((item) => dagStepOfCase(item.step) < 6).length;

  const appendVideo = useCallback(() => {
    if (!canAppendVideo(active)) return;
    onAppendVideo?.({ caseId: active.caseId, masterDocUrl: active.masterDocUrl });
  }, [active, onAppendVideo]);

  return (
    <div className="cp-root">
      <CommandBar
        onLaunch={onLaunch}
        busy={busy}
        onlineCount={onlineCount}
        totalStars={totalStars}
        inFlight={inFlight}
        todayHops={todayHops}
        tokens={tokens}
        zeroTouch={zeroTouch}
        onToggleZeroTouch={() => setZeroTouch((v) => !v)}
      />
      <div className="cp-body">
        <ArchiveRail
          cases={cases}
          activeId={active?.caseId}
          onPick={setActiveId}
          watchdogEvents={watchdogEvents}
        />
        <main className="cp-main">
          {active ? (
            <>
              <OrbitTrack caseItem={active} healing={healing} onAppendVideo={appendVideo} />
              <div className="cp-bento">
                <AutoTitlePanel caseItem={active} onOverride={() => onOverrideTitle?.(active.caseId)} />
                <GateEnginePanel caseItem={active} />
              </div>
              <AssetStrip caseItem={active} onAppendVideo={appendVideo} />
            </>
          ) : (
            <div className="cp-empty">
              <p className="cp-empty-title">本地账本还没有案件</p>
              <p className="cp-empty-body">
                在上面输入标题点「立即发车」，第一案会建档并唤醒天枢；之后每一跳的状态都落在这一页。
                卷宗列表、星位流水、定时任务都读同一份账本，不需要额外配置。
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export { DEMO_CASES, DEMO_WATCHDOG, agentDisplayName };
