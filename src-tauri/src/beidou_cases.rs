//! 北斗一案一卡桥接层（Leo 2026-10-14 拍板「飞书主表 + 本地状态映射」双层架构）。
//!
//! 要解决的问题：8 列阶段门禁泳道需要「一案一卡」，但 OpenClaw 原生
//! gateway_task 只是单次星位执行的算力日志——一案被拆成 N 条 task 行，
//! 且表里没有任何案件标识列。魔改 gateway_task 表结构会跟 OpenClaw 升级
//! 冲突，所以这里不动它，另建映射层：
//!
//! ```text
//!   飞书主表 tblGWeeAWrYadALt  ←── 真相源：一案一 ID、当前阶段、打回次数、产物链接
//!          │  record_id / BM-xxxx
//!          ▼
//!   beidou_cases（本地 sqlite）  ←── 本模块：主键 = case_id
//!          ▲
//!          │  sessions_send payload 里的 [CASE_ID: BM-xxxx] 正则归拢
//!   gateway_task（算力日志，不改结构）← 子状态：running→呼吸灯，failed→熔断
//! ```
//!
//! 三条数据线各自独立、可单独打通，任一来源缺席都不影响其余（真机现状：
//! CASE_ID 尚未注入 = 0 行，飞书主表未接，docx 链接已在 terminal_summary
//! 里裸奔——所以链接兜底先行，前两条等北斗侧派单约定落地）。

// 本文件前半是「8 列阶段门禁泳道」时代的桥接模型（CaseStage / CaseCard /
// CaseArtifacts / extract_case_id / extract_feishu_links …）。Leo 2026-10-14
// 把看板推翻重排成指挥舱后，前端不再消费这些类型，但它们不是废码——
// 是飞书主表 tblGWeeAWrYadALt 接通后要立刻接上的那一层（一案一 ID、阶段
// 推导、产物链接归拢）。所以逐个标注 allow(dead_code) 留着，等主表回填时
// 直接接，不用从零再写一遍。CASE_ID 归拢（extract_case_id）尤其要先留着：
// 北斗侧一旦按规范注入 [CASE_ID: BM-xxxx]，台账里的 70 行就能自动归案。

use rusqlite::{Connection, OptionalExtension};
use serde_json::Value;

/// 一案在主表里的业务阶段（8 列泳道的列号）。
/// 数字即列序：第 3 列是全链路唯一固定人类断点（Leo 标题确认）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // 指挥舱改造后前端暂不消费，等飞书主表回填
pub enum CaseStage {
    /// 第 1 列 · 接单建档（天枢）
    Intake,
    /// 第 2 列 · 趋势与选题（天璇）
    Research,
    /// 第 3 列 · 🔔 Leo 标题确认点（人类断点，琥珀金高亮挂起）
    TitleConfirm,
    /// 第 4 列 · ⚖️ 门禁一：初审（天权）
    FirstReview,
    /// 第 5 列 · 母稿创作（天玑）
    Drafting,
    /// 第 6 列 · ⚖️ 门禁二：二审（天权）
    SecondReview,
    /// 第 7 列 · 视听并行生产（玉衡 & 开阳）
    Production,
    /// 第 8 列 · 分发运营与关单（摇光 & 天枢）
    Distribution,
    /// 已关单（移出泳道，进案卷）
    Closed,
}

#[allow(dead_code)] // 指挥舱改造后前端暂不消费，等飞书主表回填
impl CaseStage {
    /// 列号（1..=8）。Closed 无列，返回 None——关单的卡不该占泳道。
    pub fn column(self) -> Option<u8> {
        match self {
            CaseStage::Intake => Some(1),
            CaseStage::Research => Some(2),
            CaseStage::TitleConfirm => Some(3),
            CaseStage::FirstReview => Some(4),
            CaseStage::Drafting => Some(5),
            CaseStage::SecondReview => Some(6),
            CaseStage::Production => Some(7),
            CaseStage::Distribution => Some(8),
            CaseStage::Closed => None,
        }
    }

    /// 人话列名（前端泳道头直接用，不各写一套）。
    pub fn label(self) -> &'static str {
        match self {
            CaseStage::Intake => "接单建档",
            CaseStage::Research => "趋势与选题",
            CaseStage::TitleConfirm => "Leo 标题确认",
            CaseStage::FirstReview => "门禁一 · 初审",
            CaseStage::Drafting => "母稿创作",
            CaseStage::SecondReview => "门禁二 · 二审",
            CaseStage::Production => "视听并行生产",
            CaseStage::Distribution => "分发运营与关单",
            CaseStage::Closed => "已关单",
        }
    }

    /// 主表【当前阶段】字段的人话值 → 列。主表是真相源，这里只做它的字典；
    /// 认不出来的值返回 None（由调用方决定保留原阶段还是报错），绝不瞎猜一列。
    pub fn from_master_text(text: &str) -> Option<Self> {
        let t = text.trim();
        // 主表阶段字段两种可能写法都容错：纯中文 或 "5_母稿创作" 带序号前缀。
        let t = t.split_once('_').map(|(_, rest)| rest).unwrap_or(t).trim();
        Some(match t {
            "接单建档" | "建档" => CaseStage::Intake,
            "趋势与选题" | "选题" | "研究" => CaseStage::Research,
            "标题确认" | "待确认" | "待 Leo 确认" => CaseStage::TitleConfirm,
            "初审" | "门禁一" | "初审中" => CaseStage::FirstReview,
            "母稿创作" | "母稿" | "创作中" => CaseStage::Drafting,
            "二审" | "门禁二" | "二审中" => CaseStage::SecondReview,
            "视听并行" | "并行生产" | "生产中" => CaseStage::Production,
            "分发运营" | "运营" | "关单" => CaseStage::Distribution,
            "已关单" | "关单完成" => CaseStage::Closed,
            _ => return None,
        })
    }
}

/// 卡片内部的算力子状态（来自 gateway_task，只影响呼吸灯，不影响卡片停在哪列）。
/// 主表阶段说卡片停第 5 列；天玑这一跳在跑就点绿灯，脚本报错立刻升级熔断。
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // 指挥舱改造后前端暂不消费，等飞书主表回填
pub enum CaseComputeState {
    /// 有未结束的 running 行 → 绿色呼吸灯
    Running,
    /// 全部 succeeded → 静默（健康）
    Idle,
    /// 出现 failed 行 → 顶部红色熔断报警（脚本层真的炸了）
    Failed,
}

/// 打回计数器（防呆设计）：哪道门禁、烧了几格、还剩几格升级 Leo。
/// 满 3 次 FAIL 飞顶部熔断池。
pub const STRIKE_LIMIT: u8 = 3;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // 指挥舱改造后前端暂不消费，等飞书主表回填
pub struct StrikeCounter {
    /// 门禁名（初审 / 二审）
    pub gate: &'static str,
    /// 已打回次数
    pub hits: u8,
    /// 是否已满 3 次（触发熔断升级 Leo）
    pub melted: bool,
    /// 距离升级还差几次
    pub remaining: u8,
}

#[allow(dead_code)] // 指挥舱改造后前端暂不消费，等飞书主表回填
impl StrikeCounter {
    pub fn new(gate: &'static str, hits: u8) -> Self {
        let hits = hits.min(STRIKE_LIMIT);
        StrikeCounter {
            gate,
            hits,
            melted: hits >= STRIKE_LIMIT,
            remaining: STRIKE_LIMIT - hits,
        }
    }
}

/// 一案在飞书主表里的交付物链接（冲突三的解法）。
/// 主表字段直接提取；主表没回填的用 terminal_summary 里的裸链接兜底。
#[derive(Debug, Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // 指挥舱改造后前端暂不消费，等飞书主表回填
pub struct CaseArtifacts {
    /// 该案唯一的飞书云盘文件夹
    pub folder_url: Option<String>,
    /// 选题研究 docx（天璇）
    pub research_doc_url: Option<String>,
    /// 母稿 docx（天玑）
    pub master_doc_url: Option<String>,
    /// 审查报告 docx（天权）
    pub review_doc_url: Option<String>,
    /// 视觉包 url（玉衡）
    pub visual_url: Option<String>,
    /// 视频包 url（开阳）
    pub video_url: Option<String>,
    /// 运营方案 docx（摇光）
    pub ops_doc_url: Option<String>,
}

#[allow(dead_code)] // 指挥舱改造后前端暂不消费，等飞书主表回填
impl CaseArtifacts {
    /// 有没有任何一个可点击入口（全空则前端不渲染云盘区块，不摆死按钮）。
    pub fn any(&self) -> bool {
        self.folder_url.is_some()
            || self.research_doc_url.is_some()
            || self.master_doc_url.is_some()
            || self.review_doc_url.is_some()
            || self.visual_url.is_some()
            || self.video_url.is_some()
            || self.ops_doc_url.is_some()
    }
}

/// 一案一卡视图（前端泳道的直接渲染单元）。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // 指挥舱改造后前端暂不消费，等飞书主表回填
pub struct CaseCard {
    /// 一案一 ID：飞书主表 record_id 映射的 BM-xxxx（桥接主键）
    pub case_id: String,
    /// 正式标题；未确认前为空，前端显示「待 Leo 确认标题」琥珀标签
    pub title: Option<String>,
    /// 任务类型：图文 / 视频 / 图文+视频（决定第 7 列单轨还是双轨）
    pub task_type: Option<String>,
    /// 当前所在列（主表阶段推导，真相源）
    pub stage: CaseStage,
    /// 算力子状态（gateway_task 聚合，只点灯不改列）
    pub compute: CaseComputeState,
    /// 初审打回计数
    pub first_strike: StrikeCounter,
    /// 二审打回计数
    pub second_strike: StrikeCounter,
    /// 母稿是否已冻结（过了二审常驻 🔒）
    pub master_frozen: bool,
    /// 归属星位（当前列上干活的那颗）
    pub owner_star: Option<String>,
    /// 实时动作流（当前星位底层动作，单行滚动）
    pub live_action: Option<String>,
    /// 飞书交付物链接
    pub artifacts: CaseArtifacts,
    /// 归拢到这一案下的 gateway_task 行数（算力日志条数，一眼看这一案跑了几跳）
    pub task_rows: usize,
    /// 最近一次算力活动时间（ms）
    pub last_activity_ms: Option<i64>,
}

/// 建 beidou_cases 表。与 gateway_task 完全分离——OpenClaw 升级改它的表结构
/// 与本层无关，这是双层架构的全部意义。
pub fn ensure_case_tables(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS beidou_cases (
            case_id            TEXT PRIMARY KEY,
            gateway            TEXT NOT NULL,
            title              TEXT,
            task_type          TEXT,
            stage              TEXT NOT NULL,
            first_strike       INTEGER NOT NULL DEFAULT 0,
            second_strike      INTEGER NOT NULL DEFAULT 0,
            master_frozen      INTEGER NOT NULL DEFAULT 0,
            owner_star         TEXT,
            live_action        TEXT,
            folder_url         TEXT,
            research_doc_url   TEXT,
            master_doc_url     TEXT,
            review_doc_url     TEXT,
            visual_url         TEXT,
            video_url          TEXT,
            ops_doc_url        TEXT,
            last_activity_ms   INTEGER,
            updated_at_ms      INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_beidou_cases_stage
            ON beidou_cases(gateway, stage);
        -- 算力日志 → 一案的归拢边：哪条 gateway_task 属于哪个 BM-xxxx。
        -- 一张边表而不是给 gateway_task 加列：原表结构一个字不改。
        CREATE TABLE IF NOT EXISTS beidou_case_tasks (
            case_id   TEXT NOT NULL,
            gateway   TEXT NOT NULL,
            task_id   TEXT NOT NULL,
            agent_id  TEXT,
            attached_ms INTEGER NOT NULL,
            PRIMARY KEY (gateway, task_id)
        );
        CREATE INDEX IF NOT EXISTS idx_beidou_case_tasks_case
            ON beidou_case_tasks(case_id);",
    )
}

/// 从一段自由文本里提取 CASE_ID（北斗侧派单/交接卡的强制注入位）。
/// 只认带 `CASE_ID` 标签的规范形：`[CASE_ID: BM-2604]` 或 `CASE_ID: bm-2604`。
/// 大小写不敏感，编号段 3-6 位字母数字。
/// 刻意不做裸编号兜底——理由见下方注释里的真机实测教训。
#[allow(dead_code)] // 指挥舱改造后前端暂不消费，等飞书主表回填
pub fn extract_case_id(text: &str) -> Option<String> {
    let t = text.trim();
    if t.is_empty() {
        return None;
    }
    // 只认带 CASE_ID 标签的规范形，不做"任何 XX-1234 形串"的裸编号兜底。
    // 真机实测的教训：70 行结论里裸兜底会命中 LARK-CLI / QWEN-IMAGE /
    // SDXL-API / CNB-COMFY / TOOL-IMAGE 共 10 行——那些是工具名和模块名，
    // 不是案件编号。误拢的后果是卡片挂到错的案下，比拢不上更糟（拢不上只是
    // 少一跳，拢错是把别人的活计到这一案名下）。所以宁可要求北斗按规范注入。
    regex_lite_capture(t, "CASE_ID", r"[:\s]+([A-Za-z]{2,4}-[A-Za-z0-9]{3,8})")
        .map(|found| found.to_uppercase())
}

/// 极简正则捕获（不引第三方正则 crate，手写扫描器）。
/// `label` 非空时要求标签出现在编号之前（CASE_ID 语义）。
/// 编号形如 `BM-2604`：2-4 字母前缀 + 连字符 + 3-6 位字母数字。
///
/// 按 char（码点）走，不按 byte：编号两侧是中文时（北斗结论全是中文），
/// 字节下标和码点下标不是同一套坐标系，用 bytes 扫、用 &text[a..b] 切会
/// 切在字符中间——真机实测「客厅沙发」一案第 4 跳就被切成 " BM-260"。
#[allow(dead_code)] // 指挥舱改造后前端暂不消费，等飞书主表回填
fn regex_lite_capture(text: &str, label: &str, _pattern: &str) -> Option<String> {
    let chars: Vec<char> = text.chars().collect();
    // 标签锚点：先找到标签位置，只从其后再开始找编号。
    // 锚点必须按 char 下标算——find 返回的是字节下标，直接拿去索引 Vec<char>
    // 会在中文前导段上错位（真机「派发天权初审 [CASE_ID: BM-2604]」字节锚点 15
    // 落在「派」的第三个字节里，char 锚点应是 7）。ASCII 前缀时两者相等所以
    // 只有中文输入才炸，测试里第一个中文断言就是这么挂的。
    let start = if label.is_empty() {
        0
    } else {
        let label_up = label.to_uppercase();
        let label_len = label_up.chars().count();
        let at = chars
            .windows(label_len)
            .position(|window| window.iter().collect::<String>().to_uppercase() == label_up);
        at? + label_len
    };
    let mut i = start;
    while i < chars.len() {
        // 找前缀字母段（2-4 个字母）
        let seg_start = i;
        let mut j = i;
        while j < chars.len() && chars[j].is_ascii_alphabetic() && j - seg_start < 4 {
            j += 1;
        }
        if j - seg_start < 2 {
            i += 1;
            continue;
        }
        // 必须紧跟连字符
        if j >= chars.len() || chars[j] != '-' {
            i += 1;
            continue;
        }
        // 连字符后 3-6 位字母数字。上限取 6 而不是 8：真机上 "BM-2604xyz"
        // 这类把编号当单词尾巴的串，贪婪扫会吃到 7 位，而 next_ok 只看下一字符
        // 是否字母数字（已到串尾）就误判合法。北斗真实编号（BM-2604 / TSK-9f3a）
        // 都在 4 位内，6 位留足余量又不放过 7 位以上的长单词。
        let mut k = j + 1;
        while k < chars.len() && chars[k].is_ascii_alphanumeric() && k - (j + 1) < 6 {
            k += 1;
        }
        if k - (j + 1) < 3 {
            i += 1;
            continue;
        }
        let candidate: String = chars[seg_start..k].iter().collect();
        // 前缀不能紧跟更多字母（避免把 "abcBM-2604" 的 abcBM 当前缀）
        let prev_ok = seg_start == 0 || !chars[seg_start - 1].is_ascii_alphanumeric();
        // 编号后不能紧跟字母数字（避免 "BM-2604abc" 截半）
        let next_ok = k >= chars.len() || !chars[k].is_ascii_alphanumeric();
        if prev_ok && next_ok {
            return Some(candidate);
        }
        i = k;
    }
    None
}

/// 把一条 gateway_task 行归拢到一案下（边表挂载，原表不动）。
/// 幂等：同一条 task 重复挂载只保留第一次（PRIMARY KEY 保证）。
#[allow(dead_code)] // 指挥舱改造后前端暂不消费，等飞书主表回填
pub fn attach_task_to_case(
    connection: &Connection,
    gateway: &str,
    task_id: &str,
    case_id: &str,
    agent_id: Option<&str>,
    now_ms: i64,
) -> rusqlite::Result<bool> {
    let changed = connection.execute(
        "INSERT OR IGNORE INTO beidou_case_tasks (case_id, gateway, task_id, agent_id, attached_ms)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![case_id, gateway, task_id, agent_id, now_ms],
    )?;
    Ok(changed > 0)
}

/// 链接兜底收割（本文件头说的「链接兜底先行」——之前一直没接线）：
/// 扫 gateway_task 的 terminal_summary / progress_summary，文本里带
/// [CASE_ID: BM-xxxx] 的，把里面的飞书链接按 URL 形态归进对应案的产物列。
/// 没带标记的任务直接跳过——归不了案的东西不硬塞（数据诚实）。
/// 在账本读取前跑一遍：gateway_task 是几十行级别的本地表，成本可忽略。
pub fn harvest_links_from_tasks(connection: &Connection) -> rusqlite::Result<usize> {
    type TaskRow = (String, String, Option<String>, Option<String>, Option<String>);
    let mut harvested = 0usize;
    let rows: Vec<TaskRow> = {
        let mut stmt = connection.prepare(
            "SELECT task_id, gateway, agent_id, terminal_summary, progress_summary FROM gateway_task
             WHERE COALESCE(terminal_summary, '') != '' OR COALESCE(progress_summary, '') != ''",
        )?;
        let mapped = stmt.query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?))
        })?;
        mapped.filter_map(|item| item.ok()).collect()
    };
    for (task_id, gateway, agent_id, terminal, progress) in rows {
        for text in [terminal.as_deref(), progress.as_deref()].into_iter().flatten() {
            let Some(case_id) = extract_case_id(text) else { continue };
            ensure_case_row(connection, &case_id)?;
            // 归拢边：这条任务从此记在这一案名下（主键去重，重复扫不重复记）。
            connection.execute(
                "INSERT INTO beidou_case_tasks (case_id, gateway, task_id, agent_id, attached_ms)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(gateway, task_id) DO NOTHING",
                rusqlite::params![
                    case_id,
                    gateway,
                    task_id,
                    agent_id,
                    chrono::Utc::now().timestamp_millis()
                ],
            )?;
            let links = extract_feishu_links(text);
            for link in &links {
                if attach_link(connection, &case_id, link)? > 0 {
                    harvested += 1;
                }
            }
            break; // 一条任务只归一个案：首个 CASE_ID 说了算
        }
    }
    Ok(harvested)
}

/// 接力会话兜底收割（2026-10-18 Leo 实机核查后补的第二条收割线）。
///
/// 为什么需要它：北斗整条 relay 其实走飞书群聊会话，gateway_task 里反而
/// 没有一条带 [CASE_ID] 标签（真机 BM-2601 实测：23 条网关任务 0 条带标签，
/// 案号只在派单会话的标题/结论里）——只扫 gateway_task 的那条线对整个
/// 接力是瞎的，案行/阶段/产出链接全空。Leo 明确 VPS 侧不会补标签注入，
/// 所以本地必须自己从 session_run 把案号挖出来。
///
/// 分段规则与前端 UI 同款（taskChains.groupSessionEpisodes）：同群聊
/// （session_key 的 :group: 后段）+ 交接沉默 ≤ SESSION_EPISODE_GAP_MS 算
/// 同一轮。轮内任一跳文本带 [CASE_ID: BM-xxxx] → 案号传播给整轮所有跳，
/// 各跳结论里的飞书链接收进该案。派单卡（天枢）通常带标签，后续跳只带
/// 裸案号或链接——所以必须整轮传播，不能逐跳归拢。
///
/// gap 用常量 60 分钟（= 前端 episodeGapMin 默认值）。设置页改前端配置时
/// 两边会差；兜底收割宁大勿小（大 gap 最多多拢同群聊相邻案，attach_link
/// 只填空位，误拢损失有限；小 gap 直接漏整段）。
const SESSION_EPISODE_GAP_MS: i64 = 60 * 60 * 1000;

/// 群聊键：与前端 chatIdOf 同规则——session_key 里 ":group:" 的后段，
/// 没有 marker 时整个键即一群（单聊/cron 会话自成一群）。
fn session_chat_id(session_key: &str) -> &str {
    match session_key.find(":group:") {
        Some(at) => &session_key[at + ":group:".len()..],
        None => session_key,
    }
}

/// session_run 一行的收割视角字段（元组类型别名：clippy type-complexity）。
type SessionHarvestRow = (
    String,         // session_key
    Option<String>, // agent_id
    Option<String>, // title
    Option<String>, // terminal_summary
    Option<String>, // progress_summary
    Option<i64>,    // started_at_ms
    Option<i64>,    // ended_at_ms
);

pub fn harvest_links_from_sessions(connection: &Connection) -> rusqlite::Result<usize> {
    let rows: Vec<SessionHarvestRow> = {
        let mut stmt = connection.prepare(
            "SELECT session_key, agent_id, title, terminal_summary, progress_summary,
                    started_at_ms, ended_at_ms
             FROM session_run
             WHERE COALESCE(title, '') != '' OR COALESCE(terminal_summary, '') != ''
                OR COALESCE(progress_summary, '') != ''",
        )?;
        let mapped = stmt.query_map([], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                row.get(6)?,
            ))
        })?;
        mapped.filter_map(|item| item.ok()).collect()
    };
    if rows.is_empty() {
        return Ok(0);
    }
    // 分群聊 → 按 started 倒序切段（链内最旧一跳的开始 vs 候选跳的结束，
    // 沉默超限即切段）——与 groupSessionEpisodes 同一比较。
    let mut by_chat: std::collections::BTreeMap<&str, Vec<&SessionHarvestRow>> =
        std::collections::BTreeMap::new();
    for row in &rows {
        by_chat
            .entry(session_chat_id(&row.0))
            .or_default()
            .push(row);
    }
    let mut harvested = 0usize;
    for chat_rows in by_chat.values() {
        let mut ordered: Vec<&SessionHarvestRow> = chat_rows.clone();
        ordered.sort_by(|a, b| b.5.unwrap_or(0).cmp(&a.5.unwrap_or(0)));
        let mut current: Vec<&SessionHarvestRow> = Vec::new();
        let mut episodes: Vec<Vec<&SessionHarvestRow>> = Vec::new();
        for row in ordered {
            if let Some(oldest) = current.last() {
                let chain_start = oldest.5.unwrap_or(0);
                let run_end = row.6.unwrap_or_else(|| row.5.unwrap_or(0));
                if chain_start - run_end > SESSION_EPISODE_GAP_MS {
                    episodes.push(std::mem::take(&mut current));
                }
            }
            current.push(row);
        }
        if !current.is_empty() {
            episodes.push(current);
        }
        for episode in episodes {
            let mut hops = episode;
            hops.sort_by(|a, b| a.5.unwrap_or(0).cmp(&b.5.unwrap_or(0)));
            // 段内逐跳找带标签的案号——第一个命中的赢。同群聊同一轮就是
            // 同一案（跨案必然沉默超限被切段），多个命中取最早一跳的。
            let case_id = hops.iter().find_map(|row| {
                for text in [row.2.as_deref(), row.3.as_deref(), row.4.as_deref()]
                    .into_iter()
                    .flatten()
                {
                    if let Some(found) = extract_case_id(text) {
                        return Some(found);
                    }
                }
                None
            });
            let Some(case_id) = case_id else { continue };
            let now = chrono::Utc::now().timestamp_millis();
            // 兜底归案时案行可能还不存在（VPS 先跑、本地没发过车）。
            ensure_case_row(connection, &case_id)?;
            for row in &hops {
                for text in [row.2.as_deref(), row.3.as_deref(), row.4.as_deref()]
                    .into_iter()
                    .flatten()
                {
                    for link in extract_feishu_links(text) {
                        harvested += attach_link(connection, &case_id, &link)?;
                    }
                }
            }
            // 关单传播：看门狗关单分支的摘要明写「已关单」——案实际跑完，
            // 本地 stage 还停在 01_建档（launch 时建的初值）。窄规则：同段
            // 文本出现「已关单」或「关单完成」时推进。只进不退（关单是终态），
            // 且只在有案号的段里判——不认没有案号归属的裸文本。
            let closed_text = hops.iter().any(|row| {
                [row.3.as_deref(), row.4.as_deref(), row.2.as_deref()]
                    .into_iter()
                    .flatten()
                    .any(|text| text.contains("已关单") || text.contains("关单完成"))
            });
            if closed_text {
                connection.execute(
                    "UPDATE beidou_cases SET stage = '08_已关单', updated_at_ms = ?2
                     WHERE case_id = ?1 AND stage NOT IN ('08_已关单', '08_关单完成')",
                    rusqlite::params![case_id, now],
                )?;
            }
            // 这一轮有案号 = 该案今天有活动：刷新活动时间，卷宗排序不冻。
            connection.execute(
                "UPDATE beidou_cases SET last_activity_ms = ?2, updated_at_ms = ?2
                 WHERE case_id = ?1",
                rusqlite::params![case_id, now],
            )?;
        }
    }
    Ok(harvested)
}

/// 兜底归案时案行可能还不存在（VPS 先跑、本地没发过车）：建一行最小案，
/// 标题暂用案号占位，真实标题从别的线（发车/主表）进来时由 upsert 覆盖。
fn ensure_case_row(connection: &Connection, case_id: &str) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO beidou_cases (
            case_id, gateway, title, task_type, stage, first_strike, second_strike,
            master_frozen, owner_star, last_activity_ms, updated_at_ms
         ) VALUES (?1, '本机', ?1, 'IMAGE_ONLY', '01_建档', 0, 0, 0, 'tianshu', ?2, ?2)
         ON CONFLICT(case_id) DO NOTHING",
        rusqlite::params![case_id, chrono::Utc::now().timestamp_millis()],
    )?;
    Ok(())
}

/// 链接按 URL 形态归列：drive/folder → 任务文件夹；docx → 按 SOP 产出序
/// 依次填空位链（研究→母稿→二审→视觉包→视频包→运营），其余飞书链接 →
/// 运营列。已占的位不覆盖（权威数据先来，兜底只补空）。
/// 列名来自固定数组，不是用户输入，无注入面。
fn attach_link(connection: &Connection, case_id: &str, link: &str) -> rusqlite::Result<usize> {
    // 一案下同名形态会出现多个 docx（选题研究/母稿/二审报告/运营方案…），
    // 兜底分不清是哪一份，按北斗 SOP 的固定产出顺序填空位——顺序即语义。
    let columns: &[&str] = if link.contains("/drive/folder/") {
        &["folder_url"]
    } else if link.contains("/docx/") {
        &[
            "research_doc_url",
            "master_doc_url",
            "review_doc_url",
            "visual_url",
            "video_url",
            "ops_doc_url",
        ]
    } else {
        &["ops_doc_url"]
    };
    for column in columns {
        let sql = format!(
            "UPDATE beidou_cases SET {column} = ?2
             WHERE case_id = ?1 AND ({column} IS NULL OR {column} = '')"
        );
        // 一个链接只占一个槽：本条填空了就到手，不继续往后面的槽塞。
        if connection.execute(&sql, rusqlite::params![case_id, link])? > 0 {
            return Ok(1);
        }
    }
    Ok(0)
}

/// 从一段自由文本（terminal_summary / 交接卡）里捞出所有飞书链接。
/// 真机实测：链接裸奔在 session_run.terminal_summary 里，形如
/// `https://my.feishu.cn/docx/CDcfd…` 与 `https://my.feishu.cn/drive/folder/Rbpj…`。
/// 顺手剥掉 markdown 强调记号（** 结尾）和尾随标点，别把 `)**` 带进 URL。
pub fn extract_feishu_links(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        // 找协议头
        if bytes[i..].starts_with(b"https://") || bytes[i..].starts_with(b"http://") {
            let start = i;
            let mut j = i;
            // URL 字符：字母数字 + 常见安全符号；遇到空白/中文/引号即收
            while j < bytes.len() {
                let ch = bytes[j];
                let is_url_char = ch.is_ascii_alphanumeric()
                    || matches!(
                        ch,
                        b':' | b'/'
                            | b'.'
                            | b'-'
                            | b'_'
                            | b'~'
                            | b'?'
                            | b'#'
                            | b'='
                            | b'&'
                            | b'%'
                            | b'+'
                    );
                if !is_url_char {
                    break;
                }
                j += 1;
            }
            let raw = &text[start..j];
            // 只留飞书域（本层只关心飞书产物；别的链接不塞进云盘入口）
            let host = raw
                .trim_start_matches("https://")
                .trim_start_matches("http://")
                .split('/')
                .next()
                .unwrap_or("");
            if host.ends_with("feishu.cn") || host.ends_with("larksuite.com") {
                out.push(clean_link(raw));
            }
            i = j;
            continue;
        }
        i += 1;
    }
    out
}

/// 剥掉 markdown 强调与尾随标点：真机链接常写成 `https://…docx/xxx**`。
fn clean_link(raw: &str) -> String {
    let mut s = raw.trim();
    // 尾部 markdown/标点记号逐个剥（**、*、，。、）) 、、] 】 等）
    loop {
        let trimmed = s.trim_end_matches(|c: char| {
            matches!(
                c,
                '*' | '_'
                    | '`'
                    | ','
                    | '，'
                    | '。'
                    | ')'
                    | '）'
                    | ']'
                    | '】'
                    | ';'
                    | '；'
                    | '"'
                    | '\''
            )
        });
        if trimmed.len() == s.len() {
            break;
        }
        s = trimmed;
    }
    s.to_owned()
}

/// 按链接形态分派到交付物槽位。
/// 真机链接形态：/docx/<id> 是云文档，/drive/folder/<id> 是文件夹。
/// 一个案下同名形态可能出现多个 docx（选题研究/母稿/审查报告/运营方案），
/// 按出现顺序依次填空位——北斗 SOP 里产出顺序固定，顺序即语义。
#[allow(dead_code)] // 指挥舱改造后前端暂不消费，等飞书主表回填
pub fn assign_artifacts(links: &[String], into: &mut CaseArtifacts) {
    let mut docx_slots: Vec<&mut Option<String>> = Vec::new();
    // 顺序 = SOP 产出序：研究 → 母稿 → 审查 → 视觉包 → 视频包 → 运营
    // 视觉包/视频包也可能是 docx 之外的链接，所以先收 folder 与 docx，
    // docx 按序填前四个槽，剩下的（第 5 个起）视作运营方案。
    if into.folder_url.is_none() {
        if let Some(folder) = links.iter().find(|l| l.contains("/drive/folder/")) {
            into.folder_url = Some(folder.clone());
        }
    }
    let docx: Vec<&String> = links.iter().filter(|l| l.contains("/docx/")).collect();
    if into.research_doc_url.is_none() {
        if let Some(first) = docx.first() {
            into.research_doc_url = Some((*first).clone());
        }
    }
    if into.master_doc_url.is_none() {
        if let Some(second) = docx.get(1) {
            into.master_doc_url = Some((*second).clone());
        }
    }
    if into.review_doc_url.is_none() {
        if let Some(third) = docx.get(2) {
            into.review_doc_url = Some((*third).clone());
        }
    }
    if into.ops_doc_url.is_none() {
        if let Some(later) = docx.get(3) {
            into.ops_doc_url = Some((*later).clone());
        }
    }
    // 非 docx、非 folder 的其余飞书链接（设计稿里的视觉包/视频包可能是
    // drive file 或外部 CDN）按序补 visual / video 空位。
    let others: Vec<&String> = links
        .iter()
        .filter(|l| !l.contains("/docx/") && !l.contains("/drive/folder/"))
        .collect();
    for (idx, slot) in [&mut into.visual_url, &mut into.video_url]
        .into_iter()
        .enumerate()
    {
        if slot.is_none() {
            if let Some(found) = others.get(idx) {
                *slot = Some((*found).clone());
            }
        }
    }
    let _ = &mut docx_slots;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn case_id_extracts_from_bracket_and_bare_forms() {
        // 规范形：北斗交接卡强制注入位
        assert_eq!(
            extract_case_id("派发天权初审 [CASE_ID: BM-2604] 请查收"),
            Some("BM-2604".to_owned())
        );
        // 大小写不敏感
        assert_eq!(
            extract_case_id("case_id: bm-1188"),
            Some("BM-1188".to_owned())
        );
        // 标签在前、编号在后，中间的杂字不干扰
        assert_eq!(
            extract_case_id("CASE_ID 已注入，编号是 TSK-9f3a，请归拢"),
            Some("TSK-9F3A".to_owned())
        );
        // 编号前后贴字母不当编号（避免从单词里切半）
        assert_eq!(extract_case_id("[CASE_ID: abcBM-2604]"), None);
        assert_eq!(extract_case_id("[CASE_ID: BM-2604xyz]"), None);
        // 空文本与无编号文本
        assert_eq!(extract_case_id(""), None);
        assert_eq!(extract_case_id("今天天气不错"), None);
    }

    #[test]
    fn case_id_refuses_bare_hyphenated_tokens() {
        // 真机实测教训：70 行结论里做裸编号兜底，会命中这些工具名/模块名——
        // 误拢的后果是卡片挂到错的案下，比拢不上更糟。
        assert_eq!(extract_case_id("lark-cli 读取主表"), None);
        assert_eq!(
            extract_case_id("**工作流收敛到一个**：`assets/QWEN-IMAGE`"),
            None
        );
        assert_eq!(extract_case_id("SDXL-API 环境已确认 closed"), None);
        assert_eq!(extract_case_id("CNB-COMFY 两个脚本该合成一个"), None);
        assert_eq!(extract_case_id("TOOL-IMAGE 英文提示词这张对了"), None);
        // 同理，纯裸编号（没有 CASE_ID 标签）也不认
        assert_eq!(extract_case_id("母稿已落盘 BM-2604 见链接"), None);
    }

    #[test]
    fn case_id_rejects_too_short_numbers() {
        // 有 CASE_ID 标签但编号太短（不足 3 位）→ 不认
        assert_eq!(extract_case_id("[CASE_ID: BM-12]"), None);
        assert_eq!(extract_case_id("[CASE_ID: BM-1]"), None);
    }

    #[test]
    fn feishu_links_extracted_and_cleaned() {
        // 真机形态：docx 链接尾部带 markdown 强调记号
        let links = extract_feishu_links(
            "母稿：https://my.feishu.cn/docx/CDcfdyrAtoVAAJxRhY7ca8OtnNg** 已落盘",
        );
        assert_eq!(
            links,
            vec!["https://my.feishu.cn/docx/CDcfdyrAtoVAAJxRhY7ca8OtnNg".to_owned()]
        );
        // folder 链接 + 中文标点结尾
        let links = extract_feishu_links(
            "文件夹：https://my.feishu.cn/drive/folder/RbpjfPLoPllQDGdSVDLca8zrnxg。",
        );
        assert_eq!(
            links,
            vec!["https://my.feishu.cn/drive/folder/RbpjfPLoPllQDGdSVDLca8zrnxg".to_owned()]
        );
        // 非飞书链接不收（本层只捞飞书产物）
        assert!(extract_feishu_links("参考 https://example.com/docx/x").is_empty());
        // 多个链接按出现顺序
        let links = extract_feishu_links(
            "https://my.feishu.cn/docx/AAA111 https://my.feishu.cn/docx/BBB222",
        );
        assert_eq!(links.len(), 2);
        assert!(links[0].contains("AAA111"));
    }

    #[test]
    fn artifacts_assigned_by_link_shape() {
        // 真机一案产出的链接集合：folder + 4 个 docx（研究/母稿/审查/运营）
        let links = vec![
            "https://my.feishu.cn/drive/folder/RbpjfPLoPllQDGdSVDLca8zrnxg".to_owned(),
            "https://my.feishu.cn/docx/ResearchDoc1".to_owned(),
            "https://my.feishu.cn/docx/MasterDoc22".to_owned(),
            "https://my.feishu.cn/docx/ReviewDoc33".to_owned(),
            "https://my.feishu.cn/docx/OpsDoc4444".to_owned(),
        ];
        let mut art = CaseArtifacts::default();
        assign_artifacts(&links, &mut art);
        assert!(art.folder_url.as_deref().unwrap().contains("Rbpj"));
        assert!(art
            .research_doc_url
            .as_deref()
            .unwrap()
            .contains("ResearchDoc1"));
        assert!(art
            .master_doc_url
            .as_deref()
            .unwrap()
            .contains("MasterDoc22"));
        assert!(art
            .review_doc_url
            .as_deref()
            .unwrap()
            .contains("ReviewDoc33"));
        assert!(art.ops_doc_url.as_deref().unwrap().contains("OpsDoc4444"));
        assert!(art.any());
        // 空链接集 → any() 假，前端不渲染云盘区块
        assert!(!CaseArtifacts::default().any());
    }

    #[test]
    fn stage_maps_from_master_text() {
        // 主表阶段字段两种写法都认
        assert_eq!(
            CaseStage::from_master_text("母稿创作"),
            Some(CaseStage::Drafting)
        );
        assert_eq!(
            CaseStage::from_master_text("5_母稿创作"),
            Some(CaseStage::Drafting)
        );
        assert_eq!(
            CaseStage::from_master_text("待 Leo 确认"),
            Some(CaseStage::TitleConfirm)
        );
        assert_eq!(
            CaseStage::from_master_text("二审"),
            Some(CaseStage::SecondReview)
        );
        // 认不出来的值返回 None，绝不瞎猜一列
        assert_eq!(CaseStage::from_master_text("天枢在想什么"), None);
        assert_eq!(CaseStage::from_master_text(""), None);
        // 列号
        assert_eq!(CaseStage::TitleConfirm.column(), Some(3));
        assert_eq!(CaseStage::Closed.column(), None);
    }

    #[test]
    fn strike_counter_melts_at_three() {
        let s0 = StrikeCounter::new("初审", 0);
        assert!(!s0.melted && s0.remaining == 3);
        let s2 = StrikeCounter::new("初审", 2);
        assert!(!s2.melted && s2.remaining == 1);
        let s3 = StrikeCounter::new("二审", 3);
        assert!(s3.melted && s3.remaining == 0);
        // 超过上限夹住（防脏数据把 remaining 算成负数）
        let s9 = StrikeCounter::new("二审", 9);
        assert!(s9.melted && s9.remaining == 0);
    }
}

// ---------------------------------------------------------------------------
// 指挥舱派发层的账本助手（direct-launch / append-video 两个命令用）
//
// 这几个函数只做本地 sqlite 的读写：案件号分配、主表行落库、唤醒流水留痕、
// 交付模式改写。真正的 sessions_send 在北斗侧网关发，这里只存凭据——
// 主理人点「立即发车」后要能在界面上看到"车确实发出去了"。
// ---------------------------------------------------------------------------

/// 分配下一个案件号：BM- 后接 4 位序号，从本地账本现有最大值往上走。
/// 不用随机也不用时间戳——案件号要能口头念、要在飞书主表里对得上。
pub fn next_case_id(connection: &Connection) -> rusqlite::Result<String> {
    let rows = connection
        .prepare("SELECT case_id FROM beidou_cases")?
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut max_seq = 2600u32;
    for id in rows {
        // 只认 BM- 前缀 + 纯数字尾段的规范形
        if let Some(tail) = id.strip_prefix("BM-") {
            if let Ok(seq) = tail.parse::<u32>() {
                if seq > max_seq {
                    max_seq = seq;
                }
            }
        }
    }
    Ok(format!("BM-{}", max_seq + 1))
}

/// 主表行 → 本地账本 upsert。字段缺省按最保守的初值（未冻结、零打回）。
/// 返回受影响行数（1 = 新建，>1 = 更新了已有行，用于回包给前端）。
pub fn upsert_case_from_master_row(
    connection: &Connection,
    row: &serde_json::Value,
) -> rusqlite::Result<usize> {
    let text = |key: &str| row.get(key).and_then(Value::as_str).map(str::to_owned);
    let num = |key: &str| row.get(key).and_then(Value::as_i64).unwrap_or(0);
    let case_id = text("record_id").unwrap_or_default();
    if case_id.is_empty() {
        return Ok(0);
    }
    let now_ms = chrono::Utc::now().timestamp_millis();
    let changed = connection.execute(
        "INSERT INTO beidou_cases (
            case_id, gateway, title, task_type, stage, first_strike, second_strike,
            master_frozen, owner_star, live_action, folder_url, research_doc_url,
            master_doc_url, review_doc_url, visual_url, video_url, ops_doc_url,
            last_activity_ms, updated_at_ms
         ) VALUES (?1, '本机', ?2, ?3, ?4, ?5, ?6, ?7, 'tianshu', NULL, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
         ON CONFLICT(case_id) DO UPDATE SET
            title = excluded.title,
            task_type = excluded.task_type,
            stage = excluded.stage,
            first_strike = excluded.first_strike,
            second_strike = excluded.second_strike,
            master_frozen = excluded.master_frozen,
            folder_url = COALESCE(excluded.folder_url, beidou_cases.folder_url),
            research_doc_url = COALESCE(excluded.research_doc_url, beidou_cases.research_doc_url),
            master_doc_url = COALESCE(excluded.master_doc_url, beidou_cases.master_doc_url),
            review_doc_url = COALESCE(excluded.review_doc_url, beidou_cases.review_doc_url),
            visual_url = COALESCE(excluded.visual_url, beidou_cases.visual_url),
            video_url = COALESCE(excluded.video_url, beidou_cases.video_url),
            ops_doc_url = COALESCE(excluded.ops_doc_url, beidou_cases.ops_doc_url),
            last_activity_ms = excluded.last_activity_ms,
            updated_at_ms = excluded.updated_at_ms",
        rusqlite::params![
            case_id,
            text("title"),
            text("deliverable_mode"),
            text("stage").unwrap_or_else(|| "01_建档".to_owned()),
            num("first_strike"),
            num("second_strike"),
            // 母稿冻结只认主表显式 FROZEN，别把"快好了"当冻结
            if text("master_doc_status").as_deref() == Some("FROZEN") { 1 } else { 0 },
            text("folder_url"),
            text("research_doc_id"),
            text("master_doc_id"),
            text("review_doc_id"),
            text("visual_doc_id"),
            text("video_doc_id"),
            text("ops_doc_id"),
            now_ms,
            now_ms,
        ],
    )?;
    Ok(changed)
}

/// 案件在本地账本里的一行（append-video 判门槛用）。
/// 现在命令层只读 deliverable_mode 与 master_doc_url 两个字段；其余是
/// 飞书主表接通后指挥舱卷宗列表要直接渲染的（标题、母稿状态、打回次数、
/// 冻结锁），先随行取回来，省得那时再改一次 SQL。
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct CaseLedgerRow {
    pub case_id: String,
    pub title: Option<String>,
    pub deliverable_mode: String,
    pub master_doc_url: String,
    pub master_doc_status: String,
    pub second_strikes: i64,
    pub master_frozen: bool,
}

pub fn load_case(
    connection: &Connection,
    case_id: &str,
) -> rusqlite::Result<Option<CaseLedgerRow>> {
    connection
        .query_row(
            // 列名是 second_strike（单数）——建表语句里的原名，别写成 strikes
            "SELECT case_id, title, task_type, master_doc_url, master_frozen, second_strike
             FROM beidou_cases WHERE case_id = ?1",
            rusqlite::params![case_id],
            |row| {
                Ok(CaseLedgerRow {
                    case_id: row.get(0)?,
                    title: row.get(1)?,
                    // task_type 列存的就是交付模式（IMAGE_ONLY/DUAL/VIDEO_ONLY）
                    deliverable_mode: row
                        .get::<_, Option<String>>(2)?
                        .unwrap_or_else(|| "IMAGE_ONLY".to_owned()),
                    master_doc_url: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                    master_doc_status: if row.get::<_, i64>(4)? == 1 {
                        "FROZEN".to_owned()
                    } else {
                        "NONE".to_owned()
                    },
                    second_strikes: row.get(5)?,
                    master_frozen: row.get::<_, i64>(4)? == 1,
                })
            },
        )
        .optional()
}

/// 母稿状态（追投门槛的判据）：FROZEN / NONE / REJECTED。
pub fn master_doc_status(connection: &Connection, case_id: &str) -> rusqlite::Result<String> {
    let status = connection
        .query_row(
            "SELECT master_frozen, second_strike FROM beidou_cases WHERE case_id = ?1",
            rusqlite::params![case_id],
            |row| {
                let frozen = row.get::<_, i64>(0)? == 1;
                let strikes = row.get::<_, i64>(1)?;
                Ok((frozen, strikes))
            },
        )
        .optional()?;
    Ok(match status {
        Some((true, _)) => "FROZEN".to_owned(),
        Some((false, strikes)) if strikes >= STRIKE_LIMIT as i64 => "REJECTED".to_owned(),
        _ => "NONE".to_owned(),
    })
}

/// 唤醒流水留痕：sessions_send 的 payload 原样存一行。
/// 群消息只作留痕、没有唤醒效力——但留痕本身要有，出问题能照着查是谁派的。
pub fn record_wakeup(
    connection: &Connection,
    case_id: &str,
    payload: &serde_json::Value,
) -> rusqlite::Result<()> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS beidou_wakeups (
            case_id    TEXT NOT NULL,
            to_agent   TEXT NOT NULL,
            text       TEXT NOT NULL,
            mode       TEXT,
            sent_ms    INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_beidou_wakeups_case ON beidou_wakeups(case_id);",
    )?;
    connection.execute(
        "INSERT INTO beidou_wakeups (case_id, to_agent, text, mode, sent_ms)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![
            case_id,
            payload.get("to").and_then(Value::as_str).unwrap_or(""),
            payload.get("text").and_then(Value::as_str).unwrap_or(""),
            payload
                .get("deliverable_mode")
                .and_then(Value::as_str)
                .unwrap_or(""),
            chrono::Utc::now().timestamp_millis(),
        ],
    )?;
    Ok(())
}

/// 改写交付模式（追投视频：IMAGE_ONLY → DUAL）。
pub fn set_deliverable_mode(
    connection: &Connection,
    case_id: &str,
    mode: &str,
) -> rusqlite::Result<usize> {
    connection.execute(
        "UPDATE beidou_cases SET task_type = ?2, updated_at_ms = ?3 WHERE case_id = ?1",
        rusqlite::params![case_id, mode, chrono::Utc::now().timestamp_millis()],
    )
}

/// 一案在卷宗列表里的一行（指挥舱左侧名册 + 泳道的唯一数据源）。
/// 与 CaseLedgerRow 分开：那个是追投门槛的判据（只取三个字段），这个是
/// 前端要渲染的全部列——标题、阶段、打回次数、产物链接、唤醒时间。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaseListRow {
    pub case_id: String,
    pub title: Option<String>,
    pub deliverable_mode: String,
    pub stage: String,
    pub owner_star: Option<String>,
    pub live_action: Option<String>,
    pub first_strikes: i64,
    pub second_strikes: i64,
    pub master_frozen: bool,
    pub master_doc_url: String,
    pub folder_url: String,
    pub research_doc_url: String,
    pub review_doc_url: String,
    pub visual_url: String,
    pub video_url: String,
    pub ops_doc_url: String,
    pub last_activity_ms: Option<i64>,
    pub updated_at_ms: i64,
}

/// 列全部案件：按最后活动倒序（新案在上）。limit 缺省 200，上限 500。
/// 这就是指挥舱卷宗的真读入口——此前只有 load_case（按 ID 单取），
/// 前端没有任何一处在调，所以看板永远兜底在 DEMO_CASES 上。
pub fn list_cases(connection: &Connection, limit: Option<u32>) -> rusqlite::Result<Vec<CaseListRow>> {
    let limit = limit.unwrap_or(200).min(500);
    let sql = format!(
        "SELECT case_id, title, task_type, stage, owner_star, live_action,
                first_strike, second_strike, master_frozen,
                folder_url, research_doc_url, master_doc_url, review_doc_url,
                visual_url, video_url, ops_doc_url, last_activity_ms, updated_at_ms
         FROM beidou_cases
         ORDER BY COALESCE(last_activity_ms, updated_at_ms) DESC, updated_at_ms DESC
         LIMIT {limit}"
    );
    let mut statement = connection.prepare(&sql)?;
    let rows = statement.query_map([], |row| {
        let text = |index: usize| row.get::<_, Option<String>>(index).unwrap_or_default();
        Ok(CaseListRow {
            case_id: row.get::<_, String>(0)?,
            title: row.get::<_, Option<String>>(1)?,
            deliverable_mode: text(2).unwrap_or_else(|| "IMAGE_ONLY".to_owned()),
            stage: row.get::<_, String>(3)?,
            owner_star: text(4),
            live_action: text(5),
            first_strikes: row.get::<_, i64>(6)?,
            second_strikes: row.get::<_, i64>(7)?,
            master_frozen: row.get::<_, i64>(8)? == 1,
            folder_url: text(9).unwrap_or_default(),
            research_doc_url: text(10).unwrap_or_default(),
            master_doc_url: text(11).unwrap_or_default(),
            review_doc_url: text(12).unwrap_or_default(),
            visual_url: text(13).unwrap_or_default(),
            video_url: text(14).unwrap_or_default(),
            ops_doc_url: text(15).unwrap_or_default(),
            last_activity_ms: row.get::<_, Option<i64>>(16)?,
            updated_at_ms: row.get::<_, i64>(17)?,
        })
    })?;
    rows.collect()
}

#[cfg(test)]
mod dispatch_helper_tests {
    use super::*;

    fn memory_db() -> Connection {
        let connection = Connection::open_in_memory().expect("in-memory db");
        ensure_case_tables(&connection).expect("tables");
        connection
    }

    #[test]
    fn next_case_id_walks_up_from_existing() {
        let db = memory_db();
        let row = serde_json::json!({
            "record_id": "BM-2601", "title": "甲案", "deliverable_mode": "IMAGE_ONLY", "stage": "01_建档"
        });
        assert_eq!(upsert_case_from_master_row(&db, &row).expect("upsert"), 1);
        assert_eq!(next_case_id(&db).expect("next"), "BM-2602");
        // 脏数据（非规范形）不参与最大值计算，不能把序号顶飞
        let junk = serde_json::json!({ "record_id": "LARK-CLI", "title": "工具名不是案件" });
        assert_eq!(
            upsert_case_from_master_row(&db, &junk).expect("upsert junk"),
            1
        );
        assert_eq!(next_case_id(&db).expect("next after junk"), "BM-2602");
    }

    #[test]
    fn master_row_upsert_defaults_to_unfrozen() {
        let db = memory_db();
        let row = serde_json::json!({
            "record_id": "BM-2604", "title": "乙案", "deliverable_mode": "DUAL", "stage": "05_母稿"
        });
        upsert_case_from_master_row(&db, &row).expect("upsert");
        let loaded = load_case(&db, "BM-2604").expect("load").expect("row");
        assert_eq!(loaded.deliverable_mode, "DUAL");
        assert!(!loaded.master_frozen);
        assert_eq!(master_doc_status(&db, "BM-2604").expect("status"), "NONE");
    }

    #[test]
    fn frozen_only_when_master_row_says_frozen() {
        let db = memory_db();
        let row = serde_json::json!({
            "record_id": "BM-2605", "title": "丙案", "deliverable_mode": "IMAGE_ONLY",
            "stage": "05_母稿", "master_doc_status": "FROZEN",
            "master_doc_id": "https://my.feishu.cn/docx/CYeOddF3UosU8Wx0a04cSBDMnBe"
        });
        upsert_case_from_master_row(&db, &row).expect("upsert");
        let loaded = load_case(&db, "BM-2605").expect("load").expect("row");
        assert!(loaded.master_frozen);
        assert!(loaded.master_doc_url.contains("docx"));
        assert_eq!(master_doc_status(&db, "BM-2605").expect("status"), "FROZEN");
    }

    #[test]
    fn rejected_when_strikes_hit_limit() {
        let db = memory_db();
        let row = serde_json::json!({
            "record_id": "BM-2606", "title": "戊案", "second_strike": 3
        });
        upsert_case_from_master_row(&db, &row).expect("upsert");
        // 3/3 熔断：母稿状态是 REJECTED 而不是 NONE——追投门槛据此拦住，
        // 别让开阳基于一份被打回三次的母稿干活。
        assert_eq!(
            master_doc_status(&db, "BM-2606").expect("status"),
            "REJECTED"
        );
    }

    #[test]
    fn none_when_strikes_below_limit() {
        let db = memory_db();
        let row = serde_json::json!({
            "record_id": "BM-2607", "title": "己案", "second_strike": 2
        });
        upsert_case_from_master_row(&db, &row).expect("upsert");
        // 2/3 还在改，没到熔断线：状态 NONE，既不是冻结也不是毙掉
        assert_eq!(master_doc_status(&db, "BM-2607").expect("status"), "NONE");
    }

    #[test]
    fn wakeup_receipt_is_recorded() {
        let db = memory_db();
        let payload = serde_json::json!({
            "to": "tianshu", "text": "[CASE_ID: BM-2601] 建档", "deliverable_mode": "IMAGE_ONLY"
        });
        record_wakeup(&db, "BM-2601", &payload).expect("record");
        let count: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM beidou_wakeups WHERE case_id = 'BM-2601'",
                [],
                |row| row.get(0),
            )
            .expect("count");
        assert_eq!(count, 1);
    }

    #[test]
    fn set_deliverable_mode_updates_row() {
        let db = memory_db();
        let row = serde_json::json!({ "record_id": "BM-2603", "title": "丁案", "deliverable_mode": "IMAGE_ONLY" });
        upsert_case_from_master_row(&db, &row).expect("upsert");
        assert_eq!(
            set_deliverable_mode(&db, "BM-2603", "DUAL").expect("update"),
            1
        );
        assert_eq!(
            load_case(&db, "BM-2603")
                .expect("load")
                .expect("row")
                .deliverable_mode,
            "DUAL"
        );
    }

    #[test]
    fn missing_case_loads_as_none() {
        let db = memory_db();
        assert!(load_case(&db, "BM-9999").expect("load").is_none());
    }

    #[test]
    fn list_cases_orders_by_activity_and_carries_links() {
        let db = memory_db();
        for (id, title) in [("BM-2601", "甲案"), ("BM-2602", "乙案")] {
            let row = serde_json::json!({
                "record_id": id, "title": title, "deliverable_mode": "DUAL",
                "stage": "05_母稿", "master_doc_id": format!("https://my.feishu.cn/docx/{title}")
            });
            upsert_case_from_master_row(&db, &row).expect("upsert");
        }
        // 2601 后写但活动更晚 → 它排第一（倒序），别按插入顺序糊弄。
        // 注意别写成小数字：另一行的 last_activity_ms 是 upsert 时的真实毫秒
        // （1.7e12 量级），写成 2 反而把自己排到最后，用例就反了。
        db.execute(
            "UPDATE beidou_cases SET last_activity_ms = 9999999999999 WHERE case_id = 'BM-2601'",
            [],
        )
        .expect("touch");
        let list = list_cases(&db, None).expect("list");
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].case_id, "BM-2601");
        assert_eq!(list[0].title.as_deref(), Some("甲案"));
        assert_eq!(list[0].deliverable_mode, "DUAL");
        assert_eq!(list[0].stage, "05_母稿");
        assert!(list[0].master_doc_url.contains("docx"));
        assert!(!list[0].master_frozen);
        assert_eq!(list[1].case_id, "BM-2602");
    }

    #[test]
    fn list_cases_on_empty_ledger_is_empty_not_error() {
        // 真机现状：账本还没落过一行。前端不能因为空表就崩，要显示"还没有案件"。
        let db = memory_db();
        assert!(list_cases(&db, None).expect("list").is_empty());
    }

    fn session_run_db() -> Connection {
        let db = memory_db();
        db.execute_batch(
            "CREATE TABLE session_run (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                gateway TEXT NOT NULL,
                session_key TEXT NOT NULL,
                agent_id TEXT,
                title TEXT,
                status TEXT,
                progress_summary TEXT,
                terminal_summary TEXT,
                started_at_ms INTEGER,
                ended_at_ms INTEGER,
                first_seen_ms INTEGER NOT NULL,
                last_seen_ms INTEGER NOT NULL
            )",
        )
        .expect("session_run table");
        db
    }

    fn insert_session(
        db: &Connection,
        session_key: &str,
        agent_id: &str,
        title: &str,
        terminal: Option<&str>,
        started_ms: i64,
    ) {
        db.execute(
            "INSERT INTO session_run (gateway, session_key, agent_id, title, status,
                                     terminal_summary, started_at_ms, ended_at_ms,
                                     first_seen_ms, last_seen_ms)
             VALUES ('vps', ?1, ?2, ?3, 'done', ?4, ?5, ?5, ?5, ?5)",
            rusqlite::params![session_key, agent_id, title, terminal, started_ms],
        )
        .expect("insert session");
    }

    #[test]
    fn session_harvest_spreads_case_id_along_the_relay() {
        // 真机 BM-2601 形态：派单卡（第一跳）标题带标签，后续跳只带裸案号和
        // 飞书链接——案号必须整轮传播，各跳链接按 SOP 顺序落槽位。
        let db = session_run_db();
        let base = 1_800_000_000_000i64;
        let min = 60_000i64;
        insert_session(
            &db,
            "cli:main:group:oc_beidou",
            "tianshu",
            "派发天权初审 [CASE_ID: BM-9999]",
            None,
            base,
        );
        insert_session(
            &db,
            "cli:main:group:oc_beidou",
            "tianquan",
            "二审报告",
            Some("二审通过 https://my.feishu.cn/docx/ZPkVdNh9abc**"),
            base + 10 * min,
        );
        insert_session(
            &db,
            "cli:main:group:oc_beidou",
            "tianji",
            "母稿",
            Some("母稿已冻结 https://my.feishu.cn/docx/GfNndXZsdef"),
            base + 15 * min,
        );
        // 2 条链接落槽（案行本身由 ensure_case_row 兜底建出，不计 harvested）。
        assert_eq!(harvest_links_from_sessions(&db).expect("harvest"), 2);
        let list = list_cases(&db, None).expect("list");
        assert_eq!(list.len(), 1);
        let row = &list[0];
        assert_eq!(row.case_id, "BM-9999");
        // docx 按产出序填空位链：先研究位、再母稿位，不挤同一个槽。
        assert_eq!(
            row.research_doc_url,
            "https://my.feishu.cn/docx/ZPkVdNh9abc"
        );
        assert_eq!(
            row.master_doc_url,
            "https://my.feishu.cn/docx/GfNndXZsdef"
        );
        assert!(row.last_activity_ms.unwrap_or(0) > 0, "活动时间要刷新");
    }

    #[test]
    fn session_harvest_does_not_cross_episode_boundaries() {
        // 沉默超过 60 分钟切段：后一段没有标签的 run 不继承前一段的案号，
        // 链接也不跨段收——拢不上只是少一跳，拢错是把别人的活计挂到本案名下。
        let db = session_run_db();
        let base = 1_800_000_000_000i64;
        let min = 60_000i64;
        insert_session(
            &db,
            "cli:main:group:oc_beidou",
            "tianshu",
            "派发天权初审 [CASE_ID: BM-9998]",
            None,
            base,
        );
        // 3 小时后另一个案开跑：同群聊，但沉默超限，必须切成两段。
        insert_session(
            &db,
            "cli:main:group:oc_beidou",
            "tianxuan",
            "选题",
            Some("研究文档 https://my.feishu.cn/docx/DDyLd0zghi"),
            base + 180 * min,
        );
        assert_eq!(harvest_links_from_sessions(&db).expect("harvest"), 0);
        let list = list_cases(&db, None).expect("list");
        assert_eq!(list.len(), 1, "只有带标签那一段建案");
        assert_eq!(list[0].case_id, "BM-9998");
        assert_eq!(list[0].research_doc_url, "", "跨段的链接不收");
    }

    #[test]
    fn session_harvest_closes_case_from_watchdog_summary() {
        // 看门狗关单分支摘要明写「BM-2601｜已关单」：本地 stage 必须跟着
        // 推进到 08_已关单（closed 推导认这个值），否则案永远停在 01_建档。
        let db = session_run_db();
        let base = 1_800_000_000_000i64;
        insert_session(
            &db,
            "cli:main:group:oc_beidou",
            "tianshu",
            "派发天权初审 [CASE_ID: BM-9997]",
            None,
            base,
        );
        insert_session(
            &db,
            "cli:main:group:oc_beidou",
            "watchdog",
            "巡检简报",
            Some("BM-2601｜已关单：reset 6 个群会话、删除 watchdog job"),
            base + 10 * 60_000,
        );
        harvest_links_from_sessions(&db).expect("harvest");
        let list = list_cases(&db, None).expect("list");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].stage, "08_已关单");
    }
}
