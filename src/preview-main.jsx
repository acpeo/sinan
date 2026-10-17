// 版式预览入口（preview.html 用）：只挂 PipelineView，喂一份真数据形态。
// 与产品代码的区别仅此一处——App.jsx 的 cases 来自 loadBeidouCases（真账本），
// 这里来自写死的预览数据。组件本身是同一份，改版式两边同时生效。
import { createRoot } from "react-dom/client";
import { PipelineView } from "./PipelineView.jsx";
import "./styles.css";
import { DEMO_CASES, DEMO_TELEMETRY, DEMO_LIVE_ACTION } from "./demoCases.js";

// 泳道案件的预览数据。BM-2601 = Leo 真机账本那一行（客厅沙发摆放·链路测试，
// 10-13 由摇光跑完关单），字段名与 Rust CaseListRow 对齐；另两条演示案
// 只为了让泳道看得出"多案并发 + 一颗星在跑别的案子"的形状。
const live = (new URLSearchParams(location.search).get("live") ?? "tianji")
  .split(",").map((s) => s.trim()).filter(Boolean);

// ?ledger=1 = 真账本形态：本地镜像只有链接没有五轴分/判词/打回链（那些都在
// 飞书主表）。用来对稿"缺字段时说缺，别画五条 0 分的假门禁"。
const ledgerMode = new URLSearchParams(location.search).get("ledger") === "1";
const CASES_TO_SHOW = ledgerMode
  ? DEMO_CASES.map((c) => ({
      ...c,
      reviewAxes: null,
      strikeList: null,
      criteria: null,
      timeline: null,
      verdictText: "",
    }))
  : DEMO_CASES;

// styles.css 的 #root 是 place-items:center 的 grid，会把 PipelineView 按内容宽
// （泳道 min-width 760px）撑开——窄屏截图就量不到真实的降栏。桌面真机里
// .console-scroll 定宽，没这问题；预览页这里把它掰直。
document.getElementById("root").classList.add("pl-preview-host");

createRoot(document.getElementById("root")).render(
  <PipelineView
    cases={CASES_TO_SHOW}
    starTelemetry={DEMO_TELEMETRY}
    liveStars={new Set(live)}
    liveAction={DEMO_LIVE_ACTION}
    conn={{ state: live.length ? "ok" : "ok", text: live.length ? `已连接 · ${live.length} 星在跑` : "已连接 · VPS", title: "预览数据" }}
    onRetryConn={() => {}}
    onLaunch={() => {}}
    onAppendVideo={() => {}}
  />,
);
