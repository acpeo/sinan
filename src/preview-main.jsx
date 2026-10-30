// 版式预览入口（preview.html 用）：只挂 PipelineView，喂一份真数据形态。
// 与产品代码的区别仅此一处——App.jsx 的 cases 来自 loadBeidouCases（真账本），
// 这里来自写死的预览数据。组件本身是同一份，改版式两边同时生效。
import { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { PipelineView } from "./PipelineView.jsx";
import { installExternalLinkHandler } from "./externalLinks.js";
import "./styles.css";

installExternalLinkHandler();

// 泳道案件的预览数据。BM-2601 = Leo 真机账本那一行（客厅沙发摆放·链路测试，
// 10-13 由摇光跑完关单），字段名与 Rust CaseListRow 对齐；另两条演示案
// 只为了让泳道看得出"多案并发 + 一颗星在跑别的案子"的形状。
const CASES = [
  {
    caseId: "BM-2601",
    name: "客厅沙发摆放·链路测试",
    step: 6,
    entryMode: "AUTO_DISCOVERY",
    deliverableMode: "IMAGE_ONLY",
    ownerStar: "yaoguang",
    masterFrozen: true,
    secondStrikes: 0,
    masterDocUrl: "https://my.feishu.cn/docx/CYeOddF3UosU8Wx0a04cSBDMnBe",
    folderUrl: "https://my.feishu.cn/drive/folder/RbpjfPLoPllQDGdSVDLca8zrnxg",
    researchDocUrl: "https://my.feishu.cn/docx/CDcfdyrAtoVAAJxRhY7ca8OtnNg",
    opsDocUrl: "https://my.feishu.cn/docx/Wb2Udrq6HocjhUxyTMpcbx1FnTe",
    reviewAxes: { accuracy: 93, compliance: 95, readability: 90, logic: 92, spread: 89 },
    verdictText: "链路已跑完：天玑母稿落盘 → 天枢预核 → 天权二审 PASS → 母稿冻结 → 玉衡插图实测 → 摇光定版关单。Leo 于 10-13 05:44 圈定标题 1。",
    criteria: [
      { mark: "pass", text: "母稿落盘（约 1500 字，三个细节：背后不做主动线/背后要有界定/尺度校验）" },
      { mark: "pass", text: "天枢预核：必改段均在，禁用词零命中，无立场风险句" },
      { mark: "pass", text: "天权二审 PASS · 母稿已冻结 🔒" },
      { mark: "pass", text: "玉衡插图实测通过（锚点位置变成图，不是链接）" },
      { mark: "pass", text: "摇光定版关单 · 标题 1 圈定" },
    ],
    // 天璇呈题 + 五轴钦定：左栏「定题结论」显示这一组。
    // 与中栏的审稿五轴是两件事——这里选标题，那里过门禁。
    candidates: [
      { title: "客厅沙发别贴墙：留白那一拳的距离", champion: true },
      { title: "沙发背后那面墙，到底该留多宽", champion: false },
      { title: "客厅显大的唯一秘诀：把沙发往前挪", champion: false },
    ],
    timeline: [
      { at: "10-12 12:34", star: "tianshu", what: "天枢建档 + 建任务文件夹", dur: "10716s" },
      { at: "10-12 15:27", star: "tianshu", what: "派单参数改两个 · 派发天玑", dur: "867s" },
      { at: "10-12 15:38", star: "tianji", what: "天玑母稿落盘（docx）", dur: "377s" },
      { at: "10-13 04:20", star: "tianshu", what: "天枢预核母稿 + 补发天权二审", dur: "106s" },
      { at: "10-13 05:05", star: "yaoguang", what: "摇光发布运营方案 + 定版关单", dur: "1516s" },
    ],
  },
  {
    caseId: "BM-2602",
    name: "阳台改茶室",
    step: 5,
    deliverableMode: "DUAL",
    ownerStar: "par",
    masterFrozen: true,
    secondStrikes: 3,
    masterDocUrl: "https://my.feishu.cn/docx/CYeOddF3UosU8Wx0a04cSBDMnBe",
    reviewAxes: { accuracy: 91, compliance: 93, readability: 89, logic: 87, spread: 90 },
    verdictText: "演示案：一审 FAIL（小改：开头两段按上次意见重写），已派回天玑；复审通过后母稿冻结，玉衡图文包与开阳视频包并行生产中。",
    strikeList: [
      { verdict: "FAIL · 小改", sev: "语气", at: "10-12 14:06", note: "开头两段仍是 AI 起手式（「在这个快节奏的时代」），删掉重写；三个细节的次序按使用频率调。" },
      { verdict: "FAIL · 中改", sev: "结构", at: "10-12 16:20", note: "第二小节把「界定」和「尺度」混在一段里讲，读者分不出两次动作各自解决什么问题；拆开，各配一个场景。" },
      { verdict: "FAIL · 重写", sev: "事实", at: "10-12 19:44", note: "沙发尺寸那组数字与母稿第三段不一致（一个写 2.1m 一个写 210cm 且基准面不同），按主表口径统一并注明测量基准。" },
    ],
    criteria: [
      { mark: "pass", text: "数据有出处" },
      { mark: "pass", text: "人味 ≥ 85（89）" },
      { mark: "pass", text: "禁用词零命中" },
      { mark: "wait", text: "玉衡/开阳产出后摇光关单" },
    ],
    timeline: [
      { at: "10-12 09:10", star: "tianshu", what: "天枢建档", dur: "120s" },
      { at: "10-12 09:40", star: "tianxuan", what: "天璇呈题", dur: "900s" },
      { at: "10-12 11:30", star: "tianji", what: "天玑母稿落盘", dur: "1800s" },
      { at: "10-12 14:00", star: "tianquan", what: "天权审稿 PASS", dur: "420s" },
      { at: "现在", star: "par", what: "玉衡 // 开阳 并行生产中", dur: "进行中" },
    ],
  },
  {
    caseId: "BM-2603",
    name: "老房翻新预算表",
    step: 6,
    deliverableMode: "IMAGE_ONLY",
    ownerStar: "yaoguang",
    masterFrozen: true,
    secondStrikes: 0,
    reviewAxes: { accuracy: 93, compliance: 95, readability: 90, logic: 92, spread: 89 },
    verdictText: "演示案：审稿 PASS，母稿冻结，视觉包已就绪，等摇光运营关单。",
    criteria: [
      { mark: "pass", text: "数据有出处" },
      { mark: "pass", text: "人味 ≥ 85（90）" },
      { mark: "pass", text: "禁用词零命中" },
      { mark: "pass", text: "配图锚点 6/6" },
      { mark: "wait", text: "摇光产出最终交付链接" },
    ],
    timeline: [
      { at: "10-11 08:30", star: "tianshu", what: "天枢建档", dur: "300s" },
      { at: "10-11 09:20", star: "tianquan", what: "天权审题 PASS", dur: "380s" },
      { at: "10-11 10:50", star: "tianji", what: "天玑母稿落盘", dur: "1500s" },
      { at: "10-11 13:40", star: "tianquan", what: "天权审稿 PASS", dur: "410s" },
      { at: "10-12 10:20", star: "yuheng", what: "玉衡图文包就绪", dur: "2400s" },
      { at: "现在", star: "yaoguang", what: "摇光运营中", dur: "进行中" },
    ],
  },
  {
    // 御批台演示案：天璇呈了 3 个候选标题，Leo 还没圈定——
    // 这条案会点亮"待定题"御批卡。选完之后 champion 落在某一个上，卡片消失。
    caseId: "BM-2604",
    name: "书房灯光改造",
    step: 1,
    deliverableMode: "IMAGE_ONLY",
    ownerStar: "tianxuan",
    masterFrozen: false,
    secondStrikes: 0,
    reviewAxes: null,
    verdictText: "",
    candidates: [
      { title: "书房别只装一盏顶灯：三盏灯各管一件事", champion: false },
      { title: "伏案两小时不累，灯光要这样分层", champion: false },
      { title: "小书房显大的秘诀：把光打在天花板上", champion: false },
    ],
    criteria: null,
    timeline: [
      { at: "10-15 09:12", star: "tianshu", what: "天枢建档 + 建任务文件夹", dur: "96s" },
      { at: "10-15 10:40", star: "tianxuan", what: "天璇呈题 · 3 个候选标题", dur: "712s" },
    ],
  },
];

// 真机形态：budget = contextTokenBudget（模型窗口），estimate =
// estimatedPromptTokens（已用，只有跑过 run 的会话才有；空闲会话是 null）。
// 七颗星都 gpt-6 所以预算都是 525k —— 以前浮层把 525k 当"用量"显示，
// 七行一模一样，就是这个原因。
// sessionKey/sessionIsGroup/estimatedAtMs（Leo 2026-10-20 审计新增）：
// 水位数字是上一次 run 的 pre-prompt 快照，跑完不刷新。预览按真机实测摆：
// 天玑 182k 来自 10 小时前的 main 会话（watchdog 派发通道，SOP 不清它），
// 玉衡 96k 来自 22 分钟前的流水线群会话（关单后会被 reset 的那类）。
const HOUR = 3600_000;
const PREVIEW_NOW = Date.now();
const TELEMETRY = {
  tianshu: { model: "gpt-6", budget: 525000, estimate: null, lastRun: "127s", note: "巡检核验 / 建档案" },
  tianxuan: { model: "gpt-6", budget: 525000, estimate: 41000, lastRun: "869s", note: "趋势选题", sessionKey: "agent:tianxuan:main", sessionIsGroup: false, estimatedAtMs: PREVIEW_NOW - 3 * HOUR },
  tianquan: { model: "gpt-6", budget: 525000, estimate: null, lastRun: "674s", note: "skill 检查 · 674s" },
  tianji: { model: "gpt-6", budget: 525000, estimate: 182000, lastRun: "377s", note: "母稿落盘", sessionKey: "agent:tianji:main", sessionIsGroup: false, estimatedAtMs: PREVIEW_NOW - 10 * HOUR },
  yuheng: { model: "gpt-6", budget: 525000, estimate: 96000, lastRun: "869s", note: "插图实测", sessionKey: "agent:yuheng:feishu:group:oc_b15d1b110f2473c56fd31373fc88da6a", sessionIsGroup: true, estimatedAtMs: PREVIEW_NOW - 22 * 60_000 },
  kaiyang: { model: "gpt-6", budget: 525000, estimate: null, lastRun: "152s", note: "skill 检查 · 失败过 1 次" },
  yaoguang: { model: "gpt-6", budget: 525000, estimate: null, lastRun: "1516s", note: "定版关单" },
};


// 预览页把「哪几颗星在跑」做成可切的：?live=tianji,yuheng
// 这样不用等真机开工，也能看到流动虚线/呼吸点/琥珀态长什么样。
const live = (new URLSearchParams(location.search).get("live") ?? "tianji")
  .split(",").map((s) => s.trim()).filter(Boolean);

// ?ledger=1 = 真账本形态：本地镜像只有链接没有五轴分/判词/打回链（那些都在
// 飞书主表）。用来对稿"缺字段时说缺，别画五条 0 分的假门禁"。
const ledgerMode = new URLSearchParams(location.search).get("ledger") === "1";
const CASES_TO_SHOW = ledgerMode
  ? CASES.map((c) => ({
      ...c,
      reviewAxes: null,
      strikeList: null,
      criteria: null,
      timeline: null,
      verdictText: "",
    }))
  : CASES;

// styles.css 的 #root 是 place-items:center 的 grid，会把 PipelineView 按内容宽
// （泳道 min-width 760px）撑开——窄屏截图就量不到真实的降栏。桌面真机里
// .console-scroll 定宽，没这问题；预览页这里把它掰直。
document.getElementById("root").classList.add("pl-preview-host");

// ?shell=glass-light|glass-clear|paper —— 给预览页套上真机的玻璃壳
// （.console-root.console-shell）。有几类毛病只在壳里现形：星位明细浮层的
// 透底、发车按钮压在 --cp-ink 上的字色、滚动条宽度，都来自壳对 --cp-* 的
// 覆盖。不套壳的预览永远是纸感档，看不出这些（Leo 2026-10-20 第 2/3/4 条）。
const shellKind = new URLSearchParams(location.search).get("shell") ?? "";
// ?stars=1 —— 直接把星位明细浮层摊开。产品里它由顶栏按钮切，无头截图点不到，
// 预览页这里改成 URL 控制（浮层实底那条只能靠它验）。
const starsOpen = new URLSearchParams(location.search).get("stars") === "1";

// 「⚡ 一键追投视频」在预览页也要是真按钮：点一下把该案交付模式升成 DUAL，
// 开阳槽从「未启用」翻成出包分支——和产品侧 handleBeidouAppendVideo 的可见
// 效果同向（产品还多派一次开阳唤醒，预览没有网关，只做形态变化）。
function PreviewRoot() {
  const [cases, setCases] = useState(CASES_TO_SHOW);
  const handleAppendVideo = useCallback(({ caseId }) => {
    setCases((prev) =>
      prev.map((c) => (c.caseId === caseId && c.deliverableMode === "IMAGE_ONLY" ? { ...c, deliverableMode: "DUAL" } : c)),
    );
  }, []);
  const view = (
    <PipelineView
      cases={cases}
      starTelemetry={TELEMETRY}
      liveStars={new Set(live)}
      liveAction={{ tianji: "母稿创作 · 第 3 节", yuheng: "配图出图中" }}
      conn={{ state: live.length ? "ok" : "ok", text: live.length ? `已连接 · ${live.length} 星在跑` : "已连接 · VPS", title: "预览数据" }}
      onRetryConn={() => {}}
      onLaunch={() => {}}
      onAppendVideo={handleAppendVideo}
      starsOpen={starsOpen}
      onToggleStars={() => {}}
    />
  );
  return shellKind ? (
    <div className={`console-root console-shell console-shell--${shellKind}`}>{view}</div>
  ) : view;
}

createRoot(document.getElementById("root")).render(<PreviewRoot />);
