// 案件卷宗：本地账本（beidou_cases 只读镜像）的一屏总览。
// 版式照设计稿 mock20 的 #v-cases：标题 + 三枚计数 + 九列表格 + 空态说明 + 口径注。
//
// 数据诚实原则：账本镜像里**没有**建案/关单时间，也没有五轴判词（那些在飞书主表），
// 所以这几列一律留「—」，不拿 updatedAt 冒充建案时间、不拿 0 分冒充五轴。
import { useMemo, useState } from "react";

import { starNameOf } from "./cockpit.js";
import { STAGE_COLS, STAR_ICON } from "./PipelineView.jsx";

const COLS = "86px 1fr 86px 92px 64px 84px 74px 38px 58px";

function stageLabelOf(item) {
  if (item.closed) return "已关单";
  return STAGE_COLS[item.step]?.label ?? "—";
}

function outputLinks(item) {
  return [
    ["目录", item.folderUrl],
    ["母稿", item.masterDocUrl],
    ["配图", item.visualUrl],
    ["视频", item.videoUrl],
    ["运营", item.opsDocUrl],
    ["研报", item.researchDocUrl],
    ["审稿", item.reviewDocUrl],
  ].filter(([, url]) => Boolean(url));
}

export function CaseArchive({ cases = [], onOpenCase }) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("all"); // all | inflight | closed

  const inFlight = cases.filter((item) => !item.closed).length;
  const history = cases.length - inFlight;
  const strikes = cases.reduce((sum, item) => sum + (item.secondStrikes || 0), 0);

  const rows = useMemo(() => {
    const key = query.trim().toLowerCase();
    return cases
      .filter((item) => (scope === "all" ? true : scope === "closed" ? item.closed : !item.closed))
      .filter((item) => {
        if (!key) return true;
        const linkText = outputLinks(item).map(([, url]) => url).join(" ");
        return `${item.caseId} ${item.name} ${linkText}`.toLowerCase().includes(key);
      })
      .sort((a, b) => Number(b.lastActivityMs ?? b.updatedAtMs ?? 0) - Number(a.lastActivityMs ?? a.updatedAtMs ?? 0));
  }, [cases, query, scope]);

  return (
    <div className="ca-root">
      <header className="ca-head">
        <h2>📁 案件卷宗</h2>
        <span className="ca-sub">Case Ledger · 本地 SQLite 镜像 · 只读</span>
        <div className="ca-badges">
          <span className={`ca-badge${scope === "inflight" ? " is-on" : ""}`} onClick={() => setScope(scope === "inflight" ? "all" : "inflight")} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setScope(scope === "inflight" ? "all" : "inflight"); }}>在途 <b>{inFlight}</b></span>
          <span className={`ca-badge${scope === "closed" ? " is-on" : ""}`} onClick={() => setScope(scope === "closed" ? "all" : "closed")} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setScope(scope === "closed" ? "all" : "closed"); }}>历史 <b>{history}</b></span>
          {/* 打回徽标是累计二审打回次数（按案累加），与每行「打回」列的
              单案次数不同义——不写清，两处数字会被当成对不上（2026-10-18 审计） */}
          <span className="ca-badge" title="全部案件的二审打回次数之和（按案累加）">打回 <b>{strikes}</b></span>
        </div>
      </header>

      <div className="ca-tools">
        <input
          className="ca-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜案号 / 标题 / 产出链接…"
          aria-label="搜索案件"
        />
        <span className="ca-hint">共 {cases.length} 案 · 按最近活动排序</span>
      </div>

      {cases.length > 0 ? (
        <div className="ca-table" role="table" aria-label="案件卷宗">
          <div className="ca-thead" style={{ gridTemplateColumns: COLS }} role="row">
            <span>案号</span><span>标题</span><span>当前星位</span><span>阶段</span><span>建案</span>
            <span>关单</span><span>五轴</span><span>打回</span><span>产出</span>
          </div>
          {rows.map((item) => {
            const links = outputLinks(item);
            return (
              <div
                className="ca-row"
                style={{ gridTemplateColumns: COLS }}
                role="row"
                key={item.caseId}
                onClick={() => onOpenCase?.(item.caseId)}
                title="点这一行 → 回指挥舱看它的泳道与深潜舱"
              >
                <span className="ca-id">{item.caseId}</span>
                <span className="ca-title">{item.name}</span>
                <span className="ca-star">
                  <i aria-hidden="true">{STAR_ICON[item.ownerStar] || "·"}</i>
                  {item.ownerStar ? starNameOf(item.ownerStar) : "—"}
                </span>
                <span className={item.closed ? "ca-stage ca-stage--closed" : "ca-stage"}>{stageLabelOf(item)}</span>
                <span className="ca-dim" title="账本镜像不带建案时间">—</span>
                <span className="ca-dim" title="账本镜像不带关单时间">{item.closed ? "已关单" : "—"}</span>
                <span className="ca-dim" title="五轴判词只在飞书主表，本地镜像不带">未接通</span>
                <span className={item.secondStrikes > 0 ? "ca-strike" : "ca-dim"}>{item.secondStrikes || 0}</span>
                <span className="ca-out">
                  {links.length ? (
                    <a
                      href={links[0][1]}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(event) => event.stopPropagation()}
                      title={links.map(([k]) => k).join(" / ")}
                    >
                      打开 ↗
                    </a>
                  ) : (
                    <span className="ca-dim">—</span>
                  )}
                </span>
              </div>
            );
          })}
          {rows.length === 0 ? <p className="ca-none">没有符合条件的案件（换关键词或清掉筛选）。</p> : null}
        </div>
      ) : (
        <div className="ca-ghost">
          <p className="ca-ghost-title">在途 0 · 本地账本里没有在跑工单</p>
          <ul>
            <li>发一单之后，这里<b>按阶段逐行</b>出现：当前星位 / 驻留时长 / 打回次数 / 产出链接</li>
            <li>案件真身存<b>飞书主表（SSOT）</b>；本地 <code>beidou_cases</code> 只做只读镜像，五轴判词暂不落本地</li>
            <li>泳道里正在跑的案子要等它落本地账本才会出现在这里 —— 这张表只写真机镜像的行</li>
          </ul>
        </div>
      )}

      <p className="ca-note">
        口径：本地 <code>beidou_cases</code> 是只读镜像，<b>建案时间 / 关单时间 / 五轴判词</b>都不在这张表里
        （那些字段在飞书主表）。这三列留「—」「未接通」是照实说，不拿别的字段凑。
      </p>
    </div>
  );
}
