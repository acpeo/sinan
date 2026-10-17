// 演示数据（设计稿 mock20 那四案）。**只服务一个目的**：账本还没有真实案件时，
// 让界面按设计稿的样子渲染出来，并在页面上明标「演示数据」。
// 真实案件一旦落账本（哪怕只有一条），演示数据整体让位——绝不混排。
// 数据源 = src/preview-main.jsx 的预览案（BM-2601 是真机跑完的那一行，其余为演示）。

export const DEMO_CASES = [
  {
    caseId: "BM-2601",
    name: "客厅沙发摆放·链路测试",
    step: 6,
    closed: true,
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
    closed: false,
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
    closed: false,
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
    caseId: "BM-2604",
    name: "书房灯光改造",
    step: 1,
    closed: false,
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

export const DEMO_TELEMETRY = {
  tianshu: { model: "gpt-6", ctx: "525k", lastRun: "127s", note: "巡检核验 / 建档案" },
  tianxuan: { model: "gpt-6", ctx: "525k", lastRun: "869s", note: "趋势选题" },
  tianquan: { model: "gpt-6", ctx: "525k", lastRun: "674s", note: "skill 检查 · 674s" },
  tianji: { model: "gpt-6", ctx: "525k", lastRun: "377s", note: "母稿落盘" },
  yuheng: { model: "gpt-6", ctx: "525k", lastRun: "869s", note: "插图实测" },
  kaiyang: { model: "gpt-6", ctx: "525k", lastRun: "152s", note: "skill 检查 · 失败过 1 次" },
  yaoguang: { model: "gpt-6", ctx: "525k", lastRun: "1516s", note: "定版关单" },
};

export const DEMO_LIVE_ACTION = { tianji: "母稿创作 · 第 3 节", yuheng: "配图出图中" };

// 演示案的「谁在跑」从时间线哨兵推（末条 dur === 「进行中」），与泳道的判据同源；
// 并行列一次点亮两颗。真实模式下不走这里（liveStars 来自网关快照）。
export function demoLiveStars(cases) {
  const out = new Set();
  for (const item of cases) {
    const last = (item.timeline ?? []).slice(-1)[0];
    if (!last || last.dur !== "进行中") continue;
    if (last.star === "par") {
      out.add("yuheng");
      out.add("kaiyang");
    } else {
      out.add(last.star);
    }
  }
  return out;
}
