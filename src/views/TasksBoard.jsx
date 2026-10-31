import { Fragment, useMemo, useState } from "react";
import { agentDisplayName, buildStarState, cronNextAtOf, hopToneOf, sessionRunHop, toolProgressLabel } from "../lib/taskChains.js";
import { buildTasksFeedModel, foldCaseChain, hhMmOf, jobDisplayName } from "../lib/taskFeed.js";
import { DIAL_CHAIN, DIAL_HUB, DIAL_TONE, LOG_DONE_INK, LOG_ROW_BUDGET, TONE_LABEL } from "../lib/taskVisual.js";
import { STAR_NAME_FALLBACK, starNameOf } from "../lib/agents.js";
import { dayLabelOf, formatCompactDuration, formatCronNext, formatHistoryTime } from "../lib/format.js";
import { TaskChainTimeline } from "../components/TaskChainTimeline.jsx";
import { CaseChipPop } from "../components/CaseChipPop.jsx";
import { TasksUsageCard } from "../components/TasksUsageCard.jsx";


export function TasksBoard({ rows, episodes, activeEpisodes, cronJobs, lastRunByJob, now, agentNameMap, usageSessions, idleSessions, live, liveActiveIds, dialEpisodes }) {
  const [selectedStar, setSelectedStar] = useState(null);
  // 案卡折叠芯片的悬停态：null=无悬停，数字=悬停中的芯片序号
  const [hoverChip, setHoverChip] = useState(null);
  const [feedFilter, setFeedFilter] = useState("all"); // all | failed | cron
  // 事件流水"展开全部"（Leo 2026-10-13）：默认只上屏最近 LOG_ROW_BUDGET 行，
  // 点一下看更早的
  const [logExpanded, setLogExpanded] = useState(false);
  // 动态流视图（Leo 2026-10-06 拍板 B）：速览=按星分组（默认），明细=跨星时间线。
  // 「速览/明细」按钮从小组件标题栏换岗到这里（那边只剩抽屉一个用途=删除）。
  const [feedView, setFeedView] = useState(() =>
    localStorage.getItem("metrik:feedView") === "timeline" ? "timeline" : "stars",
  );
  const toggleFeedView = (next) => {
    setFeedView(next);
    localStorage.setItem("metrik:feedView", next);
  };
  const [expandedSet, setExpandedSet] = useState(() => new Set());
  const toggleExpanded = (key) => setExpandedSet((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  const feed = useMemo(
    () => buildTasksFeedModel({ rows, episodes: dialEpisodes ?? episodes, now }),
    [rows, dialEpisodes, episodes, now],
  );
  const starState = useMemo(
    () => buildStarState(feed.cards, now, liveActiveIds, DIAL_CHAIN),
    [feed, now, liveActiveIds],
  );

  const isCronKind = (card) => card.kind === "定时" || card.kind === "巡检简报" || card.kind === "巡检" || card.kind === "Memory";
  const filteredCards = feed.cards.filter((card) => {
    if (feedFilter === "failed" && card.tone !== "fail") return false;
    if (feedFilter === "cron" && !isCronKind(card)) return false;
    if (selectedStar && card.agentId !== selectedStar) return false;
    return true;
  });
  // v7 分栏：中文结论卡/接力/巡检批次走左栏"案与结论"（正文要空间），其余
  // （心跳折叠、取消、英文检查卡、主 Agent 对话卡）进右栏"事件流水"紧凑日志。
  const isConclusionCard = (card) =>
    !card.mainChat && ((card.summary && card.cjk) || card.type === "episode" || card.type === "batch");
  const conclusionCards = filteredCards.filter(isConclusionCard);
  // 统计口径（v7.1）：案 = 星位案 + 定时/任务结论卡；主 Agent 聊天不算案。
  // 统计行不跟视图过滤走（2026-10-18 审计）：选了某颗星或点了「失败」过滤后，
  // 「今日 N 案」如果跟着缩水，同一个数字就悄悄换了含义没人知道——统计永远
  // 数全量结论卡（statCards），下面动态流列表自己按过滤渲染，各管各的。
  const statCards = feed.cards.filter(isConclusionCard);
  const todayKey = new Date(now).toDateString();
  const isToday = (card) => new Date(card.at).toDateString() === todayKey;
  const visibleToday = statCards.filter(isToday).length;
  const failedToday = statCards.filter((card) => card.tone === "fail" && isToday(card)).length;
  // 值班案卡只装星位案：主 Agent 的纯对话轮不成案
  const starEpisodes = activeEpisodes.filter((ep) => ep.hops?.some((hop) => hop.agentId && hop.agentId !== "main"));
  const runningCount = starEpisodes.length + rows.filter((row) => row.status === "running").length;

  const statBits = [`今日 <b>${visibleToday} 案</b>`];
  if (failedToday) statBits.push(`失败 ${failedToday}`);
  if (runningCount) statBits.push(`进行中 ${runningCount}`);

  // 定时队列（v7）：网关权威 nextRunAtMs 优先（Rust 镜像列），表达式推算只作回落；
  // 之前只认两族表达式，10 个任务里 8 个 every 型全隐形。
  const enabledJobs = cronJobs.filter((job) => job.enabled);
  const runQueue = enabledJobs
    .map((job) => ({ job, at: cronNextAtOf(job, now) }))
    .filter((entry) => Number.isFinite(entry.at))
    .sort((a, b) => a.at - b.at);
  const queueRows = runQueue.slice(0, 4);
  const nextEntry = queueRows[0] ?? null;
  // 归星优先级：cron.list job 自带 agentId（网关权威）> 上次运行账本归属
  // （runs 无 agentId 字段，由 sessionKey 解析兜底）。都缺时 starNameOf 回落 main。
  const nextStar = nextEntry
    ? starNameOf(nextEntry.job.agentId ?? lastRunByJob.get(nextEntry.job.id)?.agentId)
    : "";

  const execTotal = [...feed.execAgg.values()].reduce((sum, agg) => sum + agg.total, 0);
  const execDetail = [...feed.execAgg.entries()].map(([agent, agg]) => `${starNameOf(agent)} ${agg.total}`).join(" · ");

  // 近 7 天节奏：与「今日 N 案」同一口径（结论卡按天计数），今日柱高亮。
  // 之前数的是全部 feed.cards（心跳折叠卡、英文检查卡都算）——今天这根柱子
  // 和左边的「今日 N 案」对不上，同一行两个数说的不是一件事（2026-10-18 审计）。
  const sparkSeries = (() => {
    const counts = new Map();
    for (const card of statCards) {
      const key = new Date(card.at).toDateString();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from({ length: 7 }, (_, i) => {
      const day = new Date(now - (6 - i) * 86_400_000);
      return { label: `${day.getMonth() + 1}/${day.getDate()}`, count: counts.get(day.toDateString()) ?? 0 };
    });
  })();
  const sparkPeak = Math.max(...sparkSeries.map((x) => x.count), 1);

  // 事件流水的符号与颜色（Leo 2026-10-11："完成不该再显示蓝点，容易和运行的绿点混"）：
  // 完成用中性灰 ✓ —— 符号本身已说清"完成"，颜色只留给活的事（绿=在跑、红=失败）。
  // 收班的沉下去，视线自然落在还在动的上面（与"静默=健康"同一条老规矩）。
  // 想改回青蓝：把下面 done 的颜色换回 DIAL_TONE.done 即可（单点可回退）。
  const LOG_GLYPH = { live: ["●", DIAL_TONE.live], fail: ["✕", DIAL_TONE.fail], done: ["✓", LOG_DONE_INK], cancel: ["○", DIAL_TONE.idle] };
  // 事件流水 = 事件节点，不是左栏的回放（Leo 2026-10-13 第三轮："这太长太多了，
  // 而且这里与动态流是不是重叠了"——上一轮把会话接力的每一跳都铺进流水，而每一跳
  // 在左栏结论卡里已有正文，同一批数据两栏各演一遍，右栏被撑成竖长条）。
  // 新口径两条：
  //   ① 一段接力只在流水里留一行：该段最近一次活动的星 + 起止 + 跳数。要看每跳
  //      的正文，左栏结论卡就是干这个的（点开有全文），流水不复制。
  //   ② 定时/任务卡照旧一行一条，它们是流水的老住户（失败/取消/心跳折叠）。
  // 这样流水回到"刚才舰队出了什么事"的一眼扫描：绿点=正在跑，灰✓=收班，红✕=失败。
  const logRowOf = (card) => {
    const [glyph, glyphColor] = LOG_GLYPH[card.tone] ?? ["○", DIAL_TONE.idle];
    // 折叠卡标题自带「· N 次」，时长列不再重复计数（Leo：事件流水排版错位）
    const dur = card.type === "fold"
      ? ""
      : Number.isFinite(card.endedAtMs) && Number.isFinite(card.startedAtMs) && card.endedAtMs > card.startedAtMs
        ? formatCompactDuration(card.startedAtMs, card.endedAtMs)
        : "";
    return { key: card.key, at: card.at, star: card.agent, event: card.title, glyph, glyphColor, dur, day: dayLabelOf(card.at, now) };
  };
  // 会话接力一段一行：短签只写"N 跳"，标题正文归左栏结论卡（Leo 2026-10-13
  // "与动态流重叠"——流水复制正文就是重复）。时间取该段最后一次活动，符号取最近
  // 一跳的态（在跑=绿、失败=红、收班=灰）。
  const relayLogRows = [];
  for (const card of filteredCards) {
    if (card.type !== "episode" || !card.episode) continue;
    const runs = card.episode.runs ?? [];
    if (!runs.length) continue;
    const latest = runs[runs.length - 1];
    const { tone } = hopToneOf({ status: latest.status, taskId: latest.taskId ?? latest.id, error: latest.error });
    const hopTone = tone === "failed" ? "fail" : tone === "done" ? "done" : "live";
    const [glyph, glyphColor] = LOG_GLYPH[hopTone] ?? ["○", DIAL_TONE.idle];
    const at = card.episode.lastActivityMs ?? latest.startedAtMs ?? 0;
    const starCount = new Set(runs.map((hop) => starNameOf(hop.agentId))).size;
    relayLogRows.push({
      key: `relay:${card.key}`,
      at, star: card.agent,
      event: starCount > 1 ? `接力 ${runs.length} 跳 · ${starCount} 星` : `接力 ${runs.length} 跳`,
      glyph, glyphColor,
      dur: Number.isFinite(latest.endedAtMs) && Number.isFinite(latest.startedAtMs) && latest.endedAtMs > latest.startedAtMs
        ? formatCompactDuration(latest.startedAtMs, latest.endedAtMs)
        : "",
      day: dayLabelOf(at, now),
    });
  }
  // 在跑的一律排在前面（绿点是流水的眼睛），其余按时间倒序。
  const sortedLogRows = [
    // episode 段已按上面的 relayLogRows 出一行，别再整段重复一行
    ...filteredCards.filter((card) => card.type !== "episode").map(logRowOf),
    ...relayLogRows,
  ]
    .sort((a, b) => {
      const liveA = a.glyph === LOG_GLYPH.live[0] ? 1 : 0;
      const liveB = b.glyph === LOG_GLYPH.live[0] ? 1 : 0;
      if (liveA !== liveB) return liveB - liveA;
      return b.at - a.at;
    });
  // 流水默认只上屏最近 LOG_ROW_BUDGET 行：全渲染会把右栏撑成竖长条，把下面的
  // 用量卡顶出屏幕（Leo 2026-10-13 实测注入 80 行两栏一起飙到 2678px）。
  // 更早的收进"展开全部"，要看史册时点一下——流水本职是看当下在动什么。
  const logRowBudget = logExpanded ? Infinity : LOG_ROW_BUDGET;
  const logRows = sortedLogRows.slice(0, logRowBudget);
  const logHiddenCount = sortedLogRows.length - logRows.length;
  const isEmpty = !feed.cards.length && !feed.execAgg.size && !activeEpisodes.length;
  // 值班案卡只装星位案（v7.1）：主 Agent 的纯对话轮不成案
  const dutyCase = starEpisodes[0] ?? null;
  // 接力链折叠芯片（v7.2）：连续同星同果的跳并成一枚，悬停弹该星明细
  const dutyChain = useMemo(() => foldCaseChain(dutyCase), [dutyCase]);
  const dutyProgress = (() => {
    const hop = dutyCase?.hops?.find((h) => h.status === "running");
    const text = String(hop?.progressSummary ?? "").split("\n")[0].trim();
    if (!text) return "";
    // 裸工具名（exec/message/…）过一遍人话映射，不是工具名则原样透传
    const label = toolProgressLabel(text);
    return (label.length > 30 ? `${label.slice(0, 30)}…` : label);
  })();

  // 卡片状态点（Leo 2026-10-11："完成的还是都有点点显示，看不出完没完"）：
  // 收班的点掏空成灰环、星名转中性墨——颜色只留给活的事（绿=在跑、红=失败），
  // 与事件流水的灰 ✓ 同一条规矩（静默=健康，收班的沉下去）。在跑的绿点加
  // 呼吸，完没完一眼分得开。spine 仍按原色，卡片不会整张失色。
  const dotOf = (card) => {
    if (card.tone === "done") {
      return { className: "v5-dot v5-dot--hollow", style: undefined, ink: LOG_DONE_INK };
    }
    return {
      className: `v5-dot${card.tone === "live" ? " v5-dot--live" : ""}`,
      style: { background: card.color, opacity: card.decayed ? 0.55 : 1 },
      ink: card.color,
    };
  };

  const renderCard = (card) => {
    if (card.type === "batch") {
      const dot = dotOf(card);
      return (
        <article key={card.key} className="v5card v5card--dump spine" style={{ "--spine": card.color }}>
          <div className="v5-l1"><i className={dot.className} style={dot.style} /><b style={{ color: dot.ink }}>{card.agent}</b><span className="v5-kind">巡检</span><span className="v5-when">{formatHistoryTime(card.at, now)}</span></div>
          <div className="v5-l2">{card.title}</div>
          <div className="v5-batchdetail">{card.detail}</div>
        </article>
      );
    }
    if (card.type === "episode") {
      const expanded = expandedSet.has(card.key);
      const dot = dotOf(card);
      return (
        <article key={card.key} className={`v5card spine${card.summary && card.cjk ? "" : " v5card--dump"}`} style={{ "--spine": card.color }}>
          <div className="v5-l1"><i className={dot.className} style={dot.style} /><b style={{ color: dot.ink }}>{card.agent}</b><span className="v5-kind">接力</span><span className="v5-when">{formatHistoryTime(card.at, now)}</span></div>
          <div className="v5-l2">{card.title}</div>
          {card.summary ? <div className="v5-concl">{card.summary}</div> : null}
          <div className="v5-morerow">
            <button type="button" className="v5-more" onClick={() => toggleExpanded(card.key)}>
              {expanded ? "收起链路" : "展开链路"}
            </button>
          </div>
          {expanded && (
            <div className="v5-hops">
              <TaskChainTimeline
                hops={card.episode.runs.map(sessionRunHop)}
                currentTaskId={card.episode.runs[card.episode.runs.length - 1]?.taskId}
                agentNameMap={agentNameMap}
              />
            </div>
          )}
        </article>
      );
    }
    const row = card;
    if (card.tone === "cancel") {
      const skipped = card.status === "skipped";
      const err = card.error ?? (skipped ? "免打扰/未满足条件" : "操作者取消");
      const pipeAt = err.lastIndexOf(" | ");
      const code = pipeAt > 0 ? err.slice(pipeAt + 3) : null;
      const msg = pipeAt > 0 ? err.slice(0, pipeAt) : err;
      return (
        <article key={card.key} className="v5card v5card--dump spine" style={{ "--spine": DIAL_TONE.cancel }}>
          <div className="v5-l1"><i className="v5-dot v5-dot--hollow" /><b style={{ color: DIAL_TONE.cancel }}>{card.agent}</b><span className="v5-kind">{card.kind}</span><span className="v5-when">{formatHistoryTime(card.at, now)}</span></div>
          <div className="v5-l2 v5-l2--soft">{card.title}</div>
          <div className="v5-cancelwhy">{skipped ? "静默跳过" : "已取消"} · {msg}</div>
          {code ? <div className="v5-errraw">{code} · {msg}</div> : null}
        </article>
      );
    }
    const isBriefing = card.kind === "巡检简报";
    const clamped = card.summary && card.summary.length > 96;
    const expanded = expandedSet.has(card.key);
    if (card.summary && !card.cjk) {
      const dot = dotOf(card);
      return (
        <article key={card.key} className="v5card v5card--dump spine" style={{ "--spine": card.color }}>
          <div className="v5-l1"><i className={dot.className} style={dot.style} /><b style={{ color: dot.ink }}>{card.agent}</b><span className="v5-kind">{card.kind}</span><span className="v5-when">{formatHistoryTime(card.at, now)}</span></div>
          <div className={`v5-l2${card.slug ? " is-slug" : ""}`}>{card.title}</div>
          <div className="v5-concl-en">{card.summary}</div>
        </article>
      );
    }
    const dot = dotOf(card);
    return (
      <article key={card.key} className={`v5card spine${isBriefing ? " v5card--brief" : ""}`} style={{ "--spine": card.color }}>
        <div className="v5-l1"><i className={dot.className} style={dot.style} /><b style={{ color: dot.ink }}>{card.agent}</b><span className={`v5-kind${isBriefing ? " v5-kind--gold" : ""}`}>{card.kind}</span><span className="v5-when">{formatHistoryTime(card.at, now)}</span></div>
        <div className={`v5-l2${card.slug ? " is-slug" : ""}`}>{card.title}</div>
        {card.summary ? <div className={`v5-concl${expanded ? " is-open" : ""}`}>{card.summary}</div> : null}
        {card.error && card.tone === "fail" ? <div className="v5-err">{card.error}</div> : null}
        {clamped ? (
          <div className="v5-morerow">
            <button type="button" className="v5-more" onClick={() => toggleExpanded(card.key)}>
              {expanded ? "收起" : "展开全文"}
            </button>
          </div>
        ) : null}
      </article>
    );
  };

  const feedNodes = [];
  if (feedView === "stars") {
    // 速览 = 按星分组：星按最近活跃排前，节内案按时间新→旧；一节 = 谁干了几案
    const groups = new Map();
    for (const card of conclusionCards) {
      if (!groups.has(card.agentId)) groups.set(card.agentId, []);
      groups.get(card.agentId).push(card);
    }
    const ordered = [...groups.entries()].sort(
      (a, b) => Math.max(...b[1].map((c) => c.at)) - Math.max(...a[1].map((c) => c.at)),
    );
    for (const [agentId, cards] of ordered) {
      const running = cards.filter((c) => c.tone === "live").length;
      const name = agentDisplayName(agentNameMap, agentId) || agentId;
      feedNodes.push(
        <section key={`g:${agentId}`} className="v7-gsec">
          <div className="v7-ghead">
            <i className="v5-dot" style={{ background: cards[0]?.color }} />
            <b>{name}</b>
            <small>{cards.length} 案{running ? ` · 进行中 ${running}` : ""}</small>
          </div>
          {cards.map(renderCard)}
        </section>,
      );
    }
  } else {
    // 明细 = 跨星时间线（原顺序：按天分组的案流）
    let lastDay = null;
    for (const card of conclusionCards) {
      const label = dayLabelOf(card.at, now);
      if (label !== lastDay) {
        feedNodes.push(<div className="v5-daybar" key={`day:${label}:${card.key}`}><span>{label}</span></div>);
        lastDay = label;
      }
      feedNodes.push(renderCard(card));
    }
  }

  return (
    <div className="tasksboard">
      <div className="v7row">
        <section className="v7card v7-dialcard">
          <div className="dial" role="img" aria-label="北斗七星状态盘">
            <svg viewBox="0 0 552 146" preserveAspectRatio="xMinYMid meet">
              <polyline
                className="dial-chain"
                points={DIAL_CHAIN.map(([, x, y]) => `${x},${y}`).join(" ")}
                fill="none" strokeWidth="1.6"
              />
          <line className="dial-leader" x1={DIAL_CHAIN[6][1] + 8} y1="88" x2="424" y2="85" stroke="rgba(217,168,96,.45)" strokeWidth="1" strokeDasharray="2 3" />
          <text x="428" y="89" fill="#D9A860" fontSize="12">›</text>
          <path d="M 24 143 Q 276 137 496 143" fill="none" stroke="#1E2735" strokeWidth="1" />
              {starState.map((star) => {
                const [, x, y] = DIAL_CHAIN.find(([id]) => id === star.id);
                const color = DIAL_TONE[star.tone];
                const above = star.id === "tianquan";
                const staleNote = star.stale ? (star.tone === "idle" ? " · 暂无记录" : " · 已超 24 小时") : "";
                return (
                  <g
                    key={star.id}
                    className={`dial-node${star.tone === "idle" ? " is-idle" : ""}${star.stale ? " is-stale" : ""}${selectedStar === star.id ? " is-selected" : ""}`}
                    transform={`translate(${x},${y})`}
                    onClick={() => setSelectedStar(selectedStar === star.id ? null : star.id)}
                  >
                    <title>{`${STAR_NAME_FALLBACK[star.id]} · ${TONE_LABEL[star.tone]}${staleNote}`}</title>
                    {selectedStar === star.id && <circle r="10" fill="none" stroke="#D9A860" strokeWidth="1.3" />}
                    {star.tone === "live" && <circle className="dial-halo" r="9.5" fill="none" stroke={color} strokeOpacity=".4" />}
                    <circle
                      className="dial-dot" r="5.5"
                      fill={star.tone === "idle" ? "none" : color}
                      stroke={star.tone === "idle" ? "#4A5568" : "none"}
                      strokeWidth={star.tone === "idle" ? 1.3 : 0}
                    />
                    <text x="0" y={above ? -11 : 19} textAnchor="middle" fontSize="9.5">{STAR_NAME_FALLBACK[star.id]}</text>
                    {star.label ? (
                      <text className={`dial-sub${star.tone === "live" ? " is-live" : ""}`} x="0" y={above ? -22 : 31} textAnchor="middle" fontSize="8.5">{star.label}</text>
                    ) : null}
                  </g>
                );
              })}
              <g className="dial-hub" transform={`translate(${DIAL_HUB.x},${DIAL_HUB.y})`}>
                <title>星君 · 北斗最高层（hermes，与网关同机）{live ? " · 在线" : " · 网关未连接"}</title>
                <circle r="5.5" fill="none" stroke={live ? "#D9A860" : "#6b6e78"} strokeWidth="1.4" />
                <text x="11" y="4" textAnchor="start" fontSize="9">星君</text>
                {!live && <text x="11" y="15" textAnchor="start" fontSize="8" fill="#F26D6D">未连接</text>}
              </g>
            </svg>
            <div className="dial-next">
              <div className="lb">下一次 · 定时</div>
              <div className="tm">{nextEntry ? hhMmOf(nextEntry.at) : "待排"}</div>
              <div className="sub">{nextEntry ? formatCronNext(nextEntry.at, now) : ""}{nextStar ? ` · ${nextStar}` : ""}</div>
            </div>
          </div>
        </section>
        <section className="v7card v7-croncard">
          <div className="v7-mhead">定时队列<span className="v7-mcount">{enabledJobs.length} 启用</span></div>
          {queueRows.map(({ job, at }) => (
            <div key={job.id} className="v7-qrow">
              <span className="v7-qname" title={job.description || job.name || job.id}>{jobDisplayName(job.name || job.id)}</span>
              <span className="v7-qnext">{formatCronNext(at, now)}<em> · {starNameOf(job.agentId ?? lastRunByJob.get(job.id)?.agentId)}</em></span>
            </div>
          ))}
          {!queueRows.length && <div className="v7-qempty">没有启用的定时任务</div>}
          <div className="v7-execblock">
            <div className="v7-exectop"><span className="v7-mhead" style={{ margin: 0 }}>命令执行</span><span className="v7-execnum">{execTotal} 条</span></div>
            <div className="v7-execdetail">{execDetail || "—"}</div>
          </div>
        </section>
      </div>

      <div className="v5-statrow">
        <span className="v5-stat" dangerouslySetInnerHTML={{ __html: statBits.join(" · ") }} />
        <span className="v7-spark">
          <em>近 7 天</em>
          <span className="v7-sbs">
            {sparkSeries.map((x, i) => (
              <i
                key={x.label}
                className={`v7-sb${i === sparkSeries.length - 1 ? " is-now" : ""}`}
                style={{ height: `${Math.max(2, Math.round((x.count / sparkPeak) * 20))}px` }}
                title={`${x.label} · ${x.count} 案`}
              />
            ))}
          </span>
          <em className="v7-peak">峰 {sparkPeak}</em>
        </span>
      </div>

      <div className="v7row v7-dutyrow">
        {dutyCase && (
          <article className="v5card v5case">
            <div className="v5-l1"><i className="v5-dot" style={{ background: DIAL_TONE.live }} /><b style={{ color: DIAL_TONE.live }}>案 · 接力</b><span className="v5-kind v5-kind--run">进行中</span><span className="v5-when">已跑 {formatCompactDuration(dutyCase.startedAtMs, now) || "1 分内"}</span></div>
            <div className="v5-l2">{dutyCase.hops?.[0]?.displayTitle || dutyCase.hops?.[0]?.title || "接力进行中"}</div>
            <div className="v5-chain">
              {dutyChain.map((seg, i) => (
                <Fragment key={`${seg.agentId}:${i}`}>
                  {i > 0 ? <span className="v5-chain-sep">→</span> : null}
                  <span
                    className={`v5-chain-chip v5-chain-chip--${seg.toneKey}${seg.running ? " v5-chain-chip--live" : ""}${hoverChip === i ? " is-hover" : ""}`}
                    onMouseEnter={() => setHoverChip(i)}
                    onMouseLeave={() => setHoverChip((cur) => (cur === i ? null : cur))}
                  >
                    <i aria-hidden="true" />
                    {starNameOf(seg.agentId)}{" "}
                    {seg.running ? "● 执行中" : seg.toneKey === "done" ? "✓" : seg.toneKey === "failed" ? "✕" : "○"}
                    {seg.count > 1 ? `×${seg.count}` : ""}
                  </span>
                </Fragment>
              ))}
            </div>
            {hoverChip != null && dutyChain[hoverChip] ? <CaseChipPop seg={dutyChain[hoverChip]} now={now} /> : null}
            {dutyProgress ? <div className="v7-progress"><i />{dutyProgress}</div> : null}
          </article>
        )}
        {feed.briefing && (!selectedStar || feed.briefing.agentId === selectedStar) && (
          <div className={dutyCase ? "v7-dutybrief" : "v7-dutybrief v7-solo"}>
            {renderCard({ ...feed.briefing })}
          </div>
        )}
      </div>

      {/* 动态流与事件流水 = 对称双卡（Leo 2026-10-06 复报"框边没对齐"）：
          左卡也装框，卡内头=标题+筛选 chips，与右侧事件流水卡同框同顶同底；
          此前的"对齐"只对齐了看不见的容器，卡框仍然一头高一头低 */}
      <div className="v7-feedrow">
        <div className="v7card v7-feedmain">
          <div className="v7-mhead">
            <span>动态流</span>
            <div className="v5-filters" style={{ marginLeft: "auto", marginRight: "10px" }}>
              {[["stars", "速览"], ["timeline", "明细"]].map(([id, label]) => (
                <button key={id} type="button" className={`v5-chip${feedView === id ? " is-on" : ""}`} onClick={() => toggleFeedView(id)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="v5-filters">
              {[["all", "全部"], ["failed", "失败"], ["cron", "定时"]].map(([id, label]) => (
                <button key={id} type="button" className={`v5-chip${feedFilter === id ? " is-on" : ""}`} onClick={() => setFeedFilter(id)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {isEmpty && (
            <p className="v5-empty">舰队还没有活动记录 · 连上网关派一轮活，这里会长出动态</p>
          )}
          {feedNodes}
          {feed.skippedNoReply > 0 && <div className="v5-foot">已跳过 {feed.skippedNoReply} 条空定时 · 不占位</div>}
        </div>
        <aside className="v7card v7-logcard">
          <div className="v7-mhead">
            <span>事件流水</span>
            {sortedLogRows.length > 0 && <span className="v7-mcount">{sortedLogRows.length} 条</span>}
          </div>
          {(() => {
            const nodes = [];
            let lastDay = null;
            for (const row of logRows) {
              if (row.day !== lastDay) {
                nodes.push(<div key={`ld:${row.day}:${row.key}`} className="v7-lday">{row.day}</div>);
                lastDay = row.day;
              }
              nodes.push(
                <div key={row.key} className="v7-lrow">
                  <span className="v7-lt">{hhMmOf(row.at)}</span>
                  <span className="v7-ls">{row.star}</span>
                  <span className="v7-le" title={row.event}>{row.event}</span>
                  <span className="v7-lg" style={{ color: row.glyphColor }}>{row.glyph}{row.dur ? ` ${row.dur}` : ""}</span>
                </div>
              );
            }
            if (!nodes.length) nodes.push(<div key="logempty" className="v7-qempty">没有事件</div>);
            return <div className="v7-lscroll">{nodes}</div>;
          })()}
          {logHiddenCount > 0 && (
            <button type="button" className="v5-foot v7-lmore" onClick={() => setLogExpanded(true)}>
              展开更早的 {logHiddenCount} 条
            </button>
          )}
          {logExpanded && logHiddenCount === 0 && sortedLogRows.length > LOG_ROW_BUDGET && (
            <button type="button" className="v5-foot v7-lmore" onClick={() => setLogExpanded(false)}>
              只回看最近 {LOG_ROW_BUDGET} 条
            </button>
          )}
        </aside>
      </div>
      <TasksUsageCard
        variant="board"
        usageSessions={usageSessions}
        idleSessions={idleSessions}
        agentNameMap={agentNameMap}
      />
    </div>
  );
}

