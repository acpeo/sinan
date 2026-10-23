import { useEffect, useMemo, useState } from "react";
import { loadBeidouCases, loadWorkboardCards } from "./taskClient.js";
import { ledgerRowsToCases } from "./cockpit.js";

/// 在途视图（2026-10-23）：单案、只读、按钮置灰。
/// 数据只读本地账本 + 工单镜像，不触发任何派发/写操作。
const STATIONS = [
  { key: "01", label: "接单建档", star: "天枢", seg: "01" },
  { key: "02", label: "选题研究", star: "天璇", seg: "02" },
  { key: "03", label: "初审 · 五轴定题", star: "天权", seg: "03" },
  { key: "04", label: "母稿 · 配图锚点", star: "天玑", seg: "04" },
  { key: "05", label: "二审 · 七轴门禁", star: "天权", seg: "05" },
  { key: "06", label: "并行生产", star: "玉衡 / 开阳", seg: "06" },
  { key: "07", label: "运营分发 · 关单", star: "摇光", seg: "07" },
];

const OUT_KEYS = ["researchDocUrl", "reviewDocUrl", "masterDocUrl", "reReviewDocUrl", "visualUrl", "videoUrl", "opsDocUrl"];

function fmtDate(ms) {
  if (!ms) return "—";
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function minutesBetween(a, b) {
  if (!a || !b || b <= a) return null;
  return Math.round((b - a) / 60000);
}

function modeText(mode) {
  if (mode === "IMAGE_ONLY") return "图文单出 · 不开阳";
  if (mode === "VIDEO_ONLY") return "视频单出 · 不派玉衡";
  if (mode === "DUAL") return "图文 + 视频双出";
  return "图文";
}

export default function InflightView() {
  const [cases, setCases] = useState([]);
  const [cards, setCards] = useState([]);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const [caseData, cardData] = await Promise.all([loadBeidouCases(), loadWorkboardCards()]);
        if (!alive) return;
        setCases(ledgerRowsToCases(caseData.cases ?? []));
        setCards(cardData.cards ?? []);
        setNow(Date.now());
      } catch {
        /* 只读失败不打扰，下一拍重试 */
      }
    };
    pull();
    const timer = window.setInterval(pull, 15_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  // 单案系统：取最近一个未关单的案子
  const active = useMemo(() => {
    const open = cases.filter((c) => !c.closed);
    return open.sort((a, b) => String(b.caseId).localeCompare(String(a.caseId)))[0] ?? null;
  }, [cases]);

  const caseCards = useMemo(() => {
    if (!active) return [];
    return cards.filter((c) => String(c.caseId ?? "").includes(active.caseId) || String(c.title ?? "").includes(active.caseId));
  }, [cards, active]);

  const todayClosed = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return cases
      .filter((c) => c.closed && (c.updatedAtMs ?? 0) >= start.getTime())
      .sort((a, b) => (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0))
      .slice(0, 4);
  }, [cases]);

  if (!active) {
    return (
      <div className="ifv">
        <style>{CSS}</style>
        <div className="ifv-empty">
          <b>没有在途案子</b>
          <p>北斗一次只跑一单；当前没有进行中的任务。</p>
        </div>
      </div>
    );
  }

  // 阶段以工单段卡为准。2026-10-23 BM-2614 实锤：账本停在 01_建档（靠会话文本
  // 推断），任务表已到 03 初审，两套源不一致，在途页因此一直显示天枢。
  const cardStep = (() => {
    let idx = 0;
    for (const c of caseCards) {
      const labels = Array.isArray(c.labels) ? c.labels.join(" ") : String(c.labels ?? "");
      const m = /seg:(\d{2})/.exec(labels);
      if (!m) continue;
      const st = String(c.status ?? "").toLowerCase();
      if (st !== "done" && st !== "running" && st !== "in_progress") continue;
      const i = STATIONS.findIndex((x) => x.seg === m[1]);
      if (i > idx) idx = i;
    }
    return idx;
  })();
  const fromLedger = Number(active.step);
  const step = Math.max(Number.isFinite(fromLedger) ? fromLedger : 0, cardStep);

  const stepCols = STATIONS.map((s, i) => {
    const done = i < step || active.closed;
    const nowAt = i === step && !active.closed;
    return { ...s, idx: i, done, now: nowAt };
  });

  const outputs = [
    { label: "天璇选题研究", url: active.researchDocUrl },
    { label: "初审报告", url: active.reviewDocUrl },
    { label: "母稿 docx", url: active.masterDocUrl },
    { label: "二审报告", url: active.reReviewDocUrl || active.reviewDocUrl },
    { label: "玉衡图文包", url: active.visualUrl },
    { label: "开阳视频包", url: active.videoUrl },
    { label: "摇光运营方案", url: active.opsDocUrl },
  ];
  const gotCount = outputs.filter((o) => o.url).length;
  const elapsedMin = Math.min(minutesBetween(active.lastActivityMs, now) ?? 0, 240);

  return (
    <div className="ifv">
      <style>{CSS}</style>

      <div className="ifv-head">
        <div className="ifv-eyebrow">
          <b>{active.caseId}</b>
          <span>公众号 · {modeText(active.deliverableMode)}</span>
        </div>
        <h1>{active.name}</h1>
        <div className="ifv-head-right">
          <span className="ifv-chip on">第 {step + 1} 站 · {STATIONS[step]?.star ?? "—"}</span>
          <div className="ifv-clock"><b>{elapsedMin} 分钟</b><span>预计 {fmtDate((active.lastActivityMs ?? now) + 15 * 60000)} 关单</span></div>
        </div>
      </div>

      <div className="ifv-rail">
        <div className="ifv-rail-grid">
          {stepCols.map((s) => (
            <div key={s.key} className={`ifv-node ${s.done ? "is-done" : ""} ${s.now ? "is-now" : ""} ${!s.done && !s.now ? "is-wait" : ""} ${s.key === "06" ? "is-split" : ""}`}>
              <div className="ifv-box">
                <div className="ifv-k">{s.key}{s.key === "06" ? " · 并行" : ""}</div>
                {s.key === "06" ? (
                  <>
                    <div className={`ifv-sub ${s.now ? "on" : ""}`}>
                      <span>{active.deliverableMode === "VIDEO_ONLY" ? "玉衡 · 未启用" : `玉衡 · ${s.done ? "已交付" : "出图中"}`}</span>
                    </div>
                    <div className={`ifv-sub ${active.deliverableMode === "DUAL" ? "on" : "off"}`}>
                      <span>{active.deliverableMode === "DUAL" ? "开阳 · 制作中" : "开阳 · 未启用"}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="ifv-s">{s.star}</div>
                    <div className="ifv-m">{s.done ? "已完成" : s.now ? "进行中" : "待命"}</div>
                  </>
                )}
              </div>
              {s.idx < stepCols.length - 1 ? <span className="ifv-wire" /> : null}
            </div>
          ))}
        </div>
        <div className="ifv-ticks">
          {stepCols.map((s) => (
            <div key={s.key} className={s.now ? "hot" : ""}>{s.done ? "已完成" : s.now ? "当前" : "未开始"}</div>
          ))}
        </div>
      </div>

      <div className="ifv-grid">
        <div className="ifv-card">
          <div className="ifv-card-h"><h2>这一单做了什么</h2><span /></div>
          <div className="ifv-timeline">
            {STATIONS.map((s, i) => {
              const done = i < step || active.closed;
              const nowAt = i === step && !active.closed;
              return (
                <div key={s.key} className={`ifv-stop ${done ? "is-done" : ""} ${nowAt ? "is-now" : ""} ${!done && !nowAt ? "is-wait" : ""}`}>
                  <span className="ifv-dot" />
                  <div className="ifv-body">
                    <div className="ifv-line1">
                      <span className="ifv-sn">{s.label}</span>
                      <span className="ifv-who">{s.star}</span>
                    </div>
                    <div className="ifv-what">
                      {s.key === "06"
                        ? active.deliverableMode === "DUAL"
                          ? "玉衡出图 + 开阳视频包并行"
                          : active.deliverableMode === "VIDEO_ONLY"
                            ? "视频单出，玉衡未启用"
                            : "图文单出，开阳未启用"
                        : done ? "已完成" : nowAt ? "进行中" : "等待上游"}
                    </div>
                  </div>
                  <div className="ifv-meta"><b>{done ? "✓" : nowAt ? "进行中" : "—"}</b>{nowAt ? `${elapsedMin} 分钟` : ""}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="ifv-side">
          <div className="ifv-card">
            <div className="ifv-card-h"><h2>当前卡点</h2><span /></div>
            <div className="ifv-focus">
              <div className="ifv-focus-t"><b>{STATIONS[step]?.star ?? "—"} · {STATIONS[step]?.label ?? "—"}</b><span>已 {elapsedMin} 分钟</span></div>
              <p>{active.residencyNote || "暂无驻留说明；等待该星位落盘后自动推进。"}</p>
              <div className="ifv-actions">
                <button className="ifv-btn primary" disabled title="下一版接入">看会话</button>
                <button className="ifv-btn" disabled title="下一版接入">催一次</button>
                <button className="ifv-btn" disabled title="下一版接入">跳过</button>
              </div>
              <div className="ifv-divider" />
              <div className="ifv-kv">
                <div><span>补发</span><b>—</b></div>
                <div><span>watchdog</span><b>—</b></div>
                <div><span>最近活动</span><b>{fmtDate(active.lastActivityMs)}</b></div>
                <div><span>阶段</span><b>{STATIONS[step]?.label ?? "—"}</b></div>
              </div>
            </div>
          </div>

          <div className="ifv-card">
            <div className="ifv-card-h"><h2>产出</h2><span /></div>
            <div className="ifv-docs">
              <div className="ifv-cnt"><span>已生成 {gotCount} / 7</span><span>{active.closed ? "已关单" : "进行中"}</span></div>
              <div className="ifv-bar"><i style={{ width: `${(gotCount / 7) * 100}%` }} /></div>
              {outputs.map((o) => (
                <div key={o.label} className={`ifv-row ${o.url ? "" : "pending"}`}>
                  {o.url ? <a href={o.url} target="_blank" rel="noreferrer">{o.label}</a> : <span>{o.label}</span>}
                  <span className="t">{o.url ? "已生成" : "待生成"}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="ifv-card ifv-today">
        <div className="ifv-card-h"><h2>今日已关单</h2><span>{todayClosed.length} 单</span></div>
        {todayClosed.length ? todayClosed.map((c) => (
          <div key={c.caseId} className="ifv-trow">
            <b>{c.caseId}</b><span>{c.name}</span>
            <span className="d">{minutesBetween(c.lastActivityMs, c.updatedAtMs) ?? "—"} 分钟</span>
            <span className="t">{fmtDate(c.updatedAtMs)}</span>
          </div>
        )) : <div className="ifv-trow"><span style={{ color: "#a8afa7" }}>今天还没有关单记录</span></div>}
      </div>
    </div>
  );
}

const CSS = `
.ifv{max-width:1240px;margin:0 auto;padding:6px 4px 28px;color:#181d19;font-size:14px;line-height:1.55;
  font-family:"SF Pro Text","PingFang SC","Microsoft YaHei",system-ui,sans-serif;font-variant-numeric:tabular-nums}
.ifv-empty{padding:80px 20px;text-align:center;color:#7d857d}
.ifv-empty b{font-size:16px;color:#181d19}
.ifv-empty p{margin:8px 0 0;font-size:13px}
.ifv-head{display:flex;align-items:flex-end;gap:14px;padding:10px 2px 14px;flex-wrap:wrap}
.ifv-eyebrow{display:flex;gap:8px;font-size:11px;color:#a8afa7;letter-spacing:.12em}
.ifv-eyebrow b{font-family:"SF Mono",Consolas,monospace;color:#2c5f46;letter-spacing:.08em}
.ifv-head h1{margin:0;font-size:20px;font-weight:650;letter-spacing:-.01em;width:100%}
.ifv-head-right{margin-left:auto;display:flex;align-items:center;gap:10px}
.ifv-chip{padding:4px 10px;border-radius:8px;background:#eaf2ec;border:1px solid #d3e3d8;color:#245740;font-size:11.5px}
.ifv-clock{text-align:right;line-height:1.2}
.ifv-clock b{display:block;font-family:"SF Mono",Consolas,monospace;font-size:15px}
.ifv-clock span{font-size:10.5px;color:#a8afa7}
.ifv-rail{background:#fffefb;border:1px solid #e6e0d4;border-radius:16px;padding:14px 16px 8px;
  box-shadow:0 1px 2px rgba(24,29,25,.04),0 12px 32px rgba(24,29,25,.06)}
.ifv-rail-grid{display:grid;grid-template-columns:repeat(7,1fr)}
.ifv-node{position:relative;padding:0 6px;text-align:center}
.ifv-box{border:1px solid #e6e0d4;border-radius:10px;background:#fff;min-height:64px;
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px}
.ifv-k{font-size:9.5px;letter-spacing:.16em;color:#a8afa7;font-family:"SF Mono",Consolas,monospace}
.ifv-s{font-size:12.5px;font-weight:650;color:#3d453f}
.ifv-m{font-size:10px;color:#a8afa7}
.ifv-node.is-done .ifv-box{background:#fbfcfa;border-color:#e2ebe4}
.ifv-node.is-done .ifv-s{color:#5d6d60}
.ifv-node.is-now .ifv-box{border-color:#2c5f46;background:linear-gradient(180deg,#f2f8f3,#eaf2ec);
  box-shadow:0 0 0 4px rgba(44,95,70,.08)}
.ifv-node.is-now .ifv-s,.ifv-node.is-now .ifv-m{color:#1f4e39}
.ifv-node.is-wait .ifv-box{opacity:.55}
.ifv-node.is-wait{opacity:.8}
.ifv-wire{position:absolute;top:38px;height:1.5px;background:#e6e0d4}
.ifv-node:not(:last-child) .ifv-wire{left:calc(50% + 34px);width:calc(100% - 68px)}
.ifv-node.is-done .ifv-wire{background:#b7d0bf}
.ifv-node.is-now .ifv-wire{background:linear-gradient(90deg,#2c5f46 0 55%,#e6e0d4 55% 100%)}
.ifv-node.is-split .ifv-box{justify-content:flex-start;padding:5px;gap:1px}
.ifv-sub{width:100%;font-size:9.5px;color:#a8afa7;line-height:1.5}
.ifv-sub + .ifv-sub{border-top:1px dashed #d3e3d8;padding-top:2px}
.ifv-sub.on{color:#1f4e39;font-weight:600}
.ifv-ticks{display:grid;grid-template-columns:repeat(7,1fr);margin-top:8px}
.ifv-ticks div{font-size:9.5px;color:#a8afa7;text-align:center}
.ifv-ticks div.hot{color:#2c5f46;font-weight:600}
.ifv-grid{display:grid;grid-template-columns:1.42fr .92fr;gap:16px;margin-top:16px;align-items:stretch}
.ifv-card{background:#fffefb;border:1px solid #e6e0d4;border-radius:16px;
  box-shadow:0 1px 2px rgba(24,29,25,.04),0 12px 32px rgba(24,29,25,.06)}
.ifv-card-h{display:flex;align-items:center;gap:10px;padding:13px 18px 8px}
.ifv-card-h h2{margin:0;font-size:12px;font-weight:650;color:#7d857d;letter-spacing:.12em}
.ifv-card-h span{margin-left:auto;font-size:10.5px;color:#a8afa7}
.ifv-timeline{padding:0 18px 12px}
.ifv-stop{display:grid;grid-template-columns:18px 1fr auto;gap:10px;padding:10px 0;border-top:1px solid #efeae0}
.ifv-stop:first-child{border-top:0}
.ifv-dot{width:9px;height:9px;border-radius:50%;background:#c8d4cb;margin:6px 0 0 4px}
.ifv-stop.is-done .ifv-dot{background:#3f7d5c}
.ifv-stop.is-now .ifv-dot{width:11px;height:11px;background:#fff;border:2px solid #2c5f46;margin:4px 0 0 2px;box-shadow:0 0 0 4px rgba(44,95,70,.1)}
.ifv-stop.is-wait{opacity:.55}
.ifv-line1{display:flex;align-items:baseline;gap:8px}
.ifv-sn{font-size:13.5px;font-weight:650}
.ifv-stop.is-now .ifv-sn{font-size:14.5px;color:#1f4e39}
.ifv-who{font-size:11px;color:#7d857d;background:#f7f4ec;border:1px solid #efeae0;padding:1px 7px;border-radius:6px}
.ifv-what{font-size:12.5px;color:#7d857d;margin-top:2px}
.ifv-meta{text-align:right;font-size:10.5px;color:#a8afa7;white-space:nowrap}
.ifv-meta b{display:block;font-family:"SF Mono",Consolas,monospace;font-weight:500;color:#3d453f}
.ifv-stop.is-now .ifv-meta b{color:#2c5f46}
.ifv-side{display:flex;flex-direction:column;gap:16px;height:100%}
.ifv-side > .ifv-card:last-child{flex:1;display:flex;flex-direction:column}
.ifv-focus{padding:2px 18px 14px}
.ifv-focus-t{display:flex;align-items:baseline;gap:8px}
.ifv-focus-t b{font-size:16px}
.ifv-focus-t span{margin-left:auto;font-family:"SF Mono",Consolas,monospace;font-size:13px;color:#2c5f46}
.ifv-focus p{margin:6px 0 0;font-size:12.5px;color:#7d857d}
.ifv-actions{display:flex;gap:7px;margin-top:11px}
.ifv-btn{padding:6px 12px;border-radius:9px;border:1px solid #e6e0d4;background:#fff;font-size:12px;color:#3d453f}
.ifv-btn:disabled{opacity:.45;cursor:not-allowed}
.ifv-btn.primary{background:#f2f6f3;border-color:#cfdfd5;color:#2c5f46}
.ifv-divider{height:1px;background:#efeae0;margin:13px 0 11px}
.ifv-kv{display:grid;grid-template-columns:1fr 1fr;gap:9px 14px}
.ifv-kv div{display:flex;flex-direction:column}
.ifv-kv span{font-size:10px;color:#a8afa7}
.ifv-kv b{font-size:12.5px;font-weight:600;color:#3d453f}
.ifv-docs{padding:0 18px 12px;display:flex;flex-direction:column;flex:1}
.ifv-cnt{display:flex;justify-content:space-between;font-size:10.5px;color:#a8afa7}
.ifv-bar{height:3px;border-radius:99px;background:#eeece4;overflow:hidden;margin:7px 0 6px}
.ifv-bar i{display:block;height:100%;background:linear-gradient(90deg,#8fb8a0,#3f7d5c)}
.ifv-row{display:flex;align-items:center;gap:8px;padding:6px 0;font-size:12px;border-top:1px dashed #f0ece2}
.ifv-row:first-of-type{border-top:0}
.ifv-row a{color:#2f5f8a;text-decoration:none;border-bottom:1px solid rgba(47,95,138,.28)}
.ifv-row.pending{color:#b3b8b0}
.ifv-row .t{margin-left:auto;font-family:"SF Mono",Consolas,monospace;font-size:10.5px;color:#a8afa7}
.ifv-today{margin-top:16px;padding-bottom:6px}
.ifv-trow{display:grid;grid-template-columns:78px 1fr 76px 64px;gap:12px;padding:8px 18px;
  border-top:1px solid #efeae0;font-size:12px;color:#7d857d}
.ifv-trow b{font-family:"SF Mono",Consolas,monospace;font-size:11.5px;color:#3d453f}
.ifv-trow .d,.ifv-trow .t{font-family:"SF Mono",Consolas,monospace;text-align:right;font-size:11px}
`;
