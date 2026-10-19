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
    )?;
    // 增量列（老库迁移）：episode 内容提取的产物。CREATE TABLE IF NOT EXISTS 对
    // 已存在的库不生效，老库（真机 10-18 之前建的）缺这两列 —— 按 pragma 补齐。
    // content_json 一个 JSON 列装全部内容产物：以后加内容字段不用再改表。
    for (name, ddl) in [
        ("content_json", "content_json TEXT"),
        ("recheck_doc_url", "recheck_doc_url TEXT"),
    ] {
        let exists: Option<i64> = connection
            .query_row(
                "SELECT 1 FROM pragma_table_info('beidou_cases') WHERE name = ?1",
                rusqlite::params![name],
                |row| row.get(0),
            )
            .optional()?;
        if exists.is_none() {
            connection.execute(&format!("ALTER TABLE beidou_cases ADD COLUMN {ddl}"), [])?;
        }
    }
    Ok(())
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
    type TaskRow = (
        String,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
    );
    let mut harvested = 0usize;
    let rows: Vec<TaskRow> = {
        let mut stmt = connection.prepare(
            "SELECT task_id, gateway, agent_id, terminal_summary, progress_summary FROM gateway_task
             WHERE COALESCE(terminal_summary, '') != '' OR COALESCE(progress_summary, '') != ''",
        )?;
        let mapped = stmt.query_map([], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
            ))
        })?;
        mapped.filter_map(|item| item.ok()).collect()
    };
    for (task_id, gateway, agent_id, terminal, progress) in rows {
        // 一条任务只归一个案：terminal 优先、首个 CASE_ID 说了算——取第一条
        // 非空摘要就收工（不是循环：clippy never_loop，且语义上只要一个案）。
        if let Some(text) = [terminal.as_deref(), progress.as_deref()]
            .into_iter()
            .flatten()
            .next()
        {
            if let Some(case_id) = extract_case_id(text) {
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
                for link in dedupe_links(extract_feishu_links(text)) {
                    harvested += attach_link(connection, &case_id, &link)?;
                }
            } else {
                // 兜底形：巡检/关单摘要不写标签，只写裸「BM-2601」或
                // 「BM-2601｜已关单」——VPS 侧不注入标签（Leo 2026-10-18 明确），
                // 本地必须自己吃裸案号，否则 watchdog 整条线都归不上。
                let bare = extract_bm_case_ids(text);
                // 只认全文唯一编号：多个编号说明这拍跨了案，不猜。
                if bare.len() == 1 && harvest_bare_case(connection, &bare[0], text)? {
                    harvested += 1;
                }
            }
        }
    }
    Ok(harvested)
}

/// 裸北斗案号（BM-2601 形）：只认 BM 前缀 + 3-6 位数字。
/// 与 extract_case_id 的分工：那个要 [CASE_ID] 标签（派单卡规范），这个吃
/// 巡检/关单摘要里的裸写法。刻意收窄到 BM-\d 形——extract_case_id 注释里
/// 记录的教训（LARK-CLI / QWEN-IMAGE / SDXL-API 等字母-字母形工具名）在
/// 这个形状下不存在；但也不放宽到任意字母前缀：多一分宽就多一分误拢。
/// 按码点走（中文前导段的字节/码点坐标系问题，同 regex_lite_capture 注释）。
fn extract_bm_case_ids(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let mut out: Vec<String> = Vec::new();
    let mut i = 0usize;
    while i + 2 < chars.len() {
        let prefix_ok = (chars[i] == 'B' || chars[i] == 'b')
            && (chars[i + 1] == 'M' || chars[i + 1] == 'm')
            && chars[i + 2] == '-';
        if !prefix_ok {
            i += 1;
            continue;
        }
        let prev_ok = i == 0 || !chars[i - 1].is_ascii_alphanumeric();
        let mut j = i + 3;
        while j < chars.len() && chars[j].is_ascii_digit() && j - (i + 3) < 6 {
            j += 1;
        }
        let digits = j - (i + 3);
        let next_ok = j >= chars.len() || !chars[j].is_ascii_alphanumeric();
        if prev_ok && next_ok && digits >= 3 {
            let candidate: String = chars[i..j].iter().collect::<String>().to_uppercase();
            if !out.contains(&candidate) {
                out.push(candidate);
            }
        }
        i = j.max(i + 1);
    }
    out
}

/// 巡检/关单摘要的裸案号兜底归拢。案必须已经在账本里（本地 launch 过或
/// 之前归拢过）——不认从没见过的案，防误建空案行。链接去重后按序归拢；
/// 文本带关单话术时把 stage 推进到 08_已关单（只进不退）。返回是否有动作。
fn harvest_bare_case(connection: &Connection, case_id: &str, text: &str) -> rusqlite::Result<bool> {
    let known: Option<i64> = connection
        .query_row(
            "SELECT 1 FROM beidou_cases WHERE case_id = ?1",
            rusqlite::params![case_id],
            |row| row.get(0),
        )
        .optional()?;
    if known.is_none() {
        return Ok(false);
    }
    let now = chrono::Utc::now().timestamp_millis();
    let mut acted = false;
    for link in dedupe_links(extract_feishu_links(text)) {
        acted |= attach_link(connection, case_id, &link)? > 0;
    }
    acted |= harvest_watchdog_artifacts(connection, case_id, text)?;
    if says_closed(text) {
        // 用 rowcount 判断"真有动作"：这条 SQL 自带 NOT IN 守卫，重复收割时
        // 一行都改不到，但旧代码照样把 acted 置真 → 每 15 秒推一次活动时间。
        acted |= connection.execute(
            "UPDATE beidou_cases SET stage = '08_已关单', updated_at_ms = ?2
             WHERE case_id = ?1 AND stage NOT IN ('08_已关单', '08_关单完成')",
            rusqlite::params![case_id, now],
        )? > 0;
    }
    // 真有动作才推活动时间，且只进不退：收割线被前端 15 秒一拍的账本重读
    // 反复跑，无条件写"此刻"会把该案永久钉在卷宗顶上。
    if acted {
        connection.execute(
            "UPDATE beidou_cases SET last_activity_ms = ?2, updated_at_ms = ?2
             WHERE case_id = ?1 AND COALESCE(last_activity_ms, 0) < ?2",
            rusqlite::params![case_id, now],
        )?;
    }
    Ok(acted)
}

/// 巡检摘要「交付物留痕」段的裸 ID 归拢（2026-10-18 真机 BM-2601 关单摘要
/// 实锤形态）：watchdog 不贴 URL，只贴反引号裸 docx ID——
///   【交付物留痕】玉衡图文包 `UiXMdOn…`；摇光发布运营方案 `LENQdQai…`；
///   文件夹 `QlkyfW…`
/// 按标签前缀拼飞书 URL 归槽。窄规则三重锚定：标签话术 + 反引号包裹 +
/// 只在 harvest_bare_case（全文唯一裸 BM + 案已存在）里调——误拢概率近零。
/// 已占的槽不覆盖（权威数据先来）。
fn harvest_watchdog_artifacts(
    connection: &Connection,
    case_id: &str,
    text: &str,
) -> rusqlite::Result<bool> {
    // 只在「交付物留痕」段里归拢。巡检摘要正文也会提「文件夹内已出现
    // …docx（`ID`」——那里的 ID 不是文件夹本身（2026-10-18 真机预演 v3
    // 实锤：folder 槽被图文包 ID 占掉）。关单摘要的交付物段格式稳定，
    // 段内标签到反引号恒为 1 字符；没有这个段的摘要（巡检拍）不归拢。
    let Some(segment) = text.split("交付物留痕").nth(1) else {
        return Ok(false);
    };
    // (标签, URL 前缀, 槽位列)——列名是固定字面量，不是用户输入，无注入面。
    const MARKS: [(&str, &str, &str); 3] = [
        ("图文包", "https://my.feishu.cn/docx/", "visual_url"),
        ("运营方案", "https://my.feishu.cn/docx/", "ops_doc_url"),
        ("文件夹", "https://my.feishu.cn/drive/folder/", "folder_url"),
    ];
    let mut acted = false;
    for (label, prefix, column) in MARKS {
        let Some(id) = backticked_id_after(segment, label) else {
            continue;
        };
        let link = format!("{prefix}{id}");
        let sql = format!(
            "UPDATE beidou_cases SET {column} = ?2
             WHERE case_id = ?1 AND ({column} IS NULL OR {column} = '')"
        );
        if connection.execute(&sql, rusqlite::params![case_id, link])? > 0 {
            acted = true;
        }
    }
    Ok(acted)
}

/// 找 `label` 之后第一个反引号包裹的 ID（8-40 位字母数字）。
/// 窗口语义（2026-10-18 二次修正）：12 字符只限制「标签 → 第一个反引号」
/// 的距离。调用方已把文本限定在「交付物留痕」段内（段内实测间距 1），
/// 12 是 12 倍余量；而巡检正文「文件夹内已出现…docx（`ID`」的间距 24
/// 必须排除——那里的 ID 不是标签自己的交付物。ID 本身一路收到反引号/
/// 非字母数字为止，绝不截断：截断会拼出半截 URL，比不收更糟。
/// 没有反引号 / ID 长度不在区间 → None（不硬猜）。
/// 按码点走：标签是中文，字节下标会在多字节字符中间错位。
fn backticked_id_after(text: &str, label: &str) -> Option<String> {
    let chars: Vec<char> = text.chars().collect();
    let label_chars: Vec<char> = label.chars().collect();
    if label_chars.is_empty() || chars.len() < label_chars.len() {
        return None;
    }
    let label_text: String = label_chars.iter().collect();
    let mut at = 0usize;
    while at + label_chars.len() <= chars.len() {
        let window: String = chars[at..at + label_chars.len()].iter().collect();
        if window == label_text {
            // 标签后 12 字符内找第一个反引号；找不到就换个标签出现位置。
            let scan_limit = (at + label_chars.len() + 12).min(chars.len());
            let mut i = at + label_chars.len();
            while i < scan_limit && chars[i] != '`' {
                i += 1;
            }
            if i < scan_limit {
                // 反引号后一路收字母数字（不设上限，长度校验兜底）。
                let mut id: Vec<char> = Vec::new();
                let mut j = i + 1;
                while j < chars.len() && chars[j].is_ascii_alphanumeric() {
                    id.push(chars[j]);
                    j += 1;
                }
                if (8..=40).contains(&id.len()) {
                    return Some(id.iter().collect());
                }
            }
        }
        at += 1;
    }
    None
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

/// 一跳的三段文本（标题 / 收尾摘要 / 进度摘要）按序展开——段名和链接
/// 经常跨字段（标签在标题、链接在摘要，真机「二审报告」跳就是这个形态），
/// 所以切段前先把它们拼成一跳全文。空串段跳过：真机有整跳三字段全空的
/// 占位行（rebound 会话），拼进去会污染切段。
fn hop_texts(row: &SessionHarvestRow) -> impl Iterator<Item = &str> {
    [row.2.as_deref(), row.3.as_deref(), row.4.as_deref()]
        .into_iter()
        .flatten()
}

/// 一跳全文：标题 + 收尾摘要 + 进度摘要，按序换行拼接。
fn hop_blob(row: &SessionHarvestRow) -> String {
    let mut out = String::new();
    for text in hop_texts(row) {
        if text.trim().is_empty() {
            continue;
        }
        if !out.is_empty() {
            out.push('\n');
        }
        out.push_str(text);
    }
    out
}

/// 交接卡的【段名】正文切段：`【母稿】https://…` 里的链接归属于段名「母稿」。
/// 没有【】的跳整段算一个无名段（段名空串）——段内照样找标签关键词，
/// 只是没有任何段名锚定（真机 watchdog 空转轮、Leo 的提问都是这个形态）。
/// 按 char 走不按 byte：书名号/方头括号都是多字节字符。
fn label_segments(blob: &str) -> Vec<(String, String)> {
    let chars: Vec<char> = blob.chars().collect();
    let mut out: Vec<(String, String)> = Vec::new();
    let mut label = String::new();
    let mut body = String::new();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '【' {
            out.push((std::mem::take(&mut label), std::mem::take(&mut body)));
            let mut j = i + 1;
            let mut name = String::new();
            while j < chars.len() && chars[j] != '】' {
                name.push(chars[j]);
                j += 1;
            }
            label = name.trim().to_owned();
            i = (j + 1).min(chars.len());
            continue;
        }
        body.push(chars[i]);
        i += 1;
    }
    out.push((label, body));
    out
}

/// 段内按案号归属切跳：一跳只要提到某个 BM 编号，就算它（以及紧随其后、
/// 没提编号的空转跳，如只有 "exec" 的玉衡跳）在办那一单；后面提到别的编号
/// 就换归属。真机 01:30 那段里 BM-2602 的巡检汇报和 BM-2603 的交接卡挨在一起，
/// 不切的话 BM-2602 的玉衡跳会把 BM-2603 推到「视听并行」，BM-2602 的《》会
/// 顶掉 BM-2603 的案名。
fn hops_of_case<'a>(hops: &[&'a SessionHarvestRow], case_id: &str) -> Vec<&'a SessionHarvestRow> {
    let mut out: Vec<&'a SessionHarvestRow> = Vec::new();
    let mut owner: Option<String> = None;
    for row in hops {
        let mut ids: Vec<String> = Vec::new();
        for text in hop_texts(row) {
            for id in extract_bm_case_ids(text) {
                if !ids.contains(&id) {
                    ids.push(id);
                }
            }
        }
        if let Some(first) = ids.into_iter().next() {
            owner = Some(first);
        }
        if owner.as_deref() == Some(case_id) {
            out.push(*row);
        }
    }
    out
}

/// 交接卡里「任务：BM-xxxx …」那一行指向的案号。只认行首的「任务：」
/// （交接卡的刚性格式），不去正文里随便抓 —— 正文里的编号可能是"参考
/// 上一单 BM-2602"这种。
fn handoff_case_id(blob: &str) -> Option<String> {
    for line in blob.lines() {
        let text = line
            .trim()
            .trim_start_matches(['*', ' ', '\t'])
            .trim();
        let rest = match text.strip_prefix("任务：").or_else(|| text.strip_prefix("任务:")) {
            Some(rest) => rest,
            None => continue,
        };
        if let Some(id) = extract_bm_case_ids(rest).into_iter().next() {
            return Some(id);
        }
    }
    None
}

/// 段归属案号：先认带 [CASE_ID] 标签的跳（北斗派单规范，第一个命中的赢）。
/// 标签缺失时（派单卡那一跳没落进本地账本——app 当时没开）退一步：
/// ① 交接卡「任务：BM-xxxx」行——SOP 刚性格式，**段内最后一次交接卡说了算**；
/// ② 「段里有交接卡 + 全段只有一个裸 BM 编号」。
/// Leo 2026-10-18 明确 VPS 侧不会注入 [CASE_ID]，但交接卡每一跳都有。
///
/// 为什么要有 ①（2026-10-20 01:30 真机实测）：旧版只有 ②，而那段里除了
/// BM-2603 的新交接卡，还压着上一单 BM-2602 的巡检汇报——一段两个案号就被
/// 判成"有歧义、不猜"，**新开的 BM-2603 永远进不了泳道**。交接卡的
/// 「任务：」行是唯一指向"这一跳在办哪一单"的刚性字段，比全段唯一的裸号硬。
fn episode_case_id(hops: &[&SessionHarvestRow]) -> Option<String> {
    for row in hops {
        for text in hop_texts(row) {
            if let Some(found) = extract_case_id(text) {
                return Some(found);
            }
        }
    }
    // ① 倒着找：越靠后的交接卡越接近"当前在办的那一单"。
    //    交接卡有两种开头，真机都出现过：
    //      【交接卡】@天权\n任务：BM-2603 …
    //      【交接卡｜天权 → 天玑｜BM-2603 …｜初审 PASS】
    for row in hops.iter().rev() {
        let blob = hop_blob(row);
        if !blob.contains("【交接卡") {
            continue;
        }
        if let Some(found) = handoff_case_id(&blob) {
            return Some(found);
        }
        // 第二种写法把案号写在标签名里，没有「任务：」行。
        for (label, _) in label_segments(&blob) {
            if !label.starts_with("交接卡") {
                continue;
            }
            if let Some(id) = extract_bm_case_ids(&label).into_iter().next() {
                return Some(id);
            }
        }
    }
    let has_handoff = hops
        .iter()
        .any(|row| hop_texts(row).any(|text| text.contains("【交接卡")));
    if !has_handoff {
        return None;
    }
    let mut ids: Vec<String> = Vec::new();
    for row in hops {
        for text in hop_texts(row) {
            for id in extract_bm_case_ids(text) {
                if !ids.contains(&id) {
                    ids.push(id);
                }
            }
        }
    }
    if ids.len() == 1 {
        ids.into_iter().next()
    } else {
        None
    }
}

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
            let Some(case_id) = episode_case_id(&hops) else {
                continue;
            };
            let now = chrono::Utc::now().timestamp_millis();
            // 兜底归案时案行可能还不存在（VPS 先跑、本地没发过车）。
            ensure_case_row(connection, &case_id)?;
            // 段里可能同时压着别的单（真机 01:30：BM-2603 的交接卡和 BM-2602 的
            // 巡检汇报落在同一段 60 分钟里）。所有提炼都只吃「归属本案的跳」，
            // 否则上一单的玉衡跳会把这一单推到视听并行、上一单的《》会顶掉这一
            // 单的案名（BM-2603 一度挂着 BM-2602 的名字，就是这一步漏了）。
            let case_hops = hops_of_case(&hops, &case_id);
            let hops = if case_hops.is_empty() { hops } else { case_hops };
            // ① 标签归槽：交接卡段名（【母稿】【二审报告】【复审报告】…）就是
            //    语义，比按 URL 出现顺序猜槽位硬得多。标签认领直接覆盖旧值——
            //    旧值可能是老版本盲猜塞错的（真机 BM-2601：二审报告的链接占着
            //    「研究文档」槽，母稿槽里是 25 位截断死链，复审报告无家可归）。
            let claims = labeled_link_claims(&hops);
            harvested += apply_labeled_claims(connection, &case_id, &claims)?;
            // ② 修复错槽：某槽里的链接若被别的标签认领，说明它是被 URL 顺序
            //    瞎猜塞进来的——清掉，等标签/盲填重来。没被任何标签认领的值
            //    不动（发车 payload、看门狗反引号 ID 填的那些有别的出处）。
            repair_mis_slots(connection, &case_id, &claims)?;
            // ③ 剩余链接盲填空位（SOP 产出顺序）。已经躺在任何槽里的链接不
            //    重复占槽——二审报告的链接归了 review，就不该再以"第一个空槽"
            //    的身份落进 research（旧版错位就是这么来的）。
            let mut links: Vec<String> = Vec::new();
            for row in &hops {
                for text in hop_texts(row) {
                    links.extend(extract_feishu_links(text));
                }
            }
            // 段级去重：同一链接在同段多跳里重复贴是常态（母稿链接在二审跳和
            // 母稿跳各一次），逐跳 attach 会连锁占槽（见 dedupe_links 注释）。
            for link in dedupe_links(links) {
                harvested += attach_link_unclaimed(connection, &case_id, &link)?;
            }
            // 关单传播：看门狗关单分支的摘要明写「已关单」——案实际跑完，
            // 本地 stage 还停在 01_建档（launch 时建的初值）。窄规则：同段
            // 文本出现「已关单」或「关单完成」时推进。只进不退（关单是终态），
            // 且只在有案号的段里判——不认没有案号归属的裸文本。
            let closed_text = hops.iter().any(|row| {
                [row.3.as_deref(), row.4.as_deref(), row.2.as_deref()]
                    .into_iter()
                    .flatten()
                    .any(says_closed)
            });
            if closed_text {
                connection.execute(
                    "UPDATE beidou_cases SET stage = '08_已关单', updated_at_ms = ?2
                     WHERE case_id = ?1 AND stage NOT IN ('08_已关单', '08_关单完成')",
                    rusqlite::params![case_id, now],
                )?;
            }
            // 这一轮有案号 = 该案有活动：把活动时间推到**轮内最新一跳的结束**，
            // 不是"此刻"。这条线被前端 15 秒一拍的账本重读反复调用，写"此刻"
            // 等于让该案永远显示刚刚有活动、永远排在卷宗顶上。只进不退：
            // 更旧的轮次（历史回补）不把时间倒退回去。
            let episode_end = hops
                .iter()
                .filter_map(|row| row.6.or(row.5))
                .max()
                .unwrap_or(now);
            connection.execute(
                "UPDATE beidou_cases SET last_activity_ms = ?2, updated_at_ms = ?2
                 WHERE case_id = ?1 AND COALESCE(last_activity_ms, 0) < ?2",
                rusqlite::params![case_id, episode_end],
            )?;
            // ④ episode 内容提取：正式标题 / 天权判词 / 打回链 / 研究编号注 /
            //    产出时间线，写进 content_json（深潜舱三栏的真内容，
            //    Leo 2026-10-21 批准——那三栏原来各摆一句假话）。
            harvest_episode_content(connection, &case_id, &hops)?;
            // ⑤ 阶段推进（只进不退）：账本原先只有「建档」和「已关单」两个写入点，
            //    中间六列从来没人写过，于是跑到玉衡的案在泳道上还挂着「01 建档」。
            promote_stage(connection, &case_id, &hops, now)?;
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

/// 保序去重：真机摘要里同一链接会重复出现（母稿链接在天权二审跳和天玑
/// 母稿跳各贴一次），attach_link 又是一个链接只占一个槽——不去重的话，
/// 第二次 attach 会继续往后找空槽，把 review/video 连锁占掉
/// （2026-10-18 真机预演实锤：母稿长形态占了 review 又占 video）。
fn dedupe_links(links: Vec<String>) -> Vec<String> {
    let mut seen: Vec<String> = Vec::with_capacity(links.len());
    for link in links {
        if !seen.contains(&link) {
            seen.push(link);
        }
    }
    seen
}

/// 链接按 URL 形态归列：drive/folder → 任务文件夹；docx → 按 SOP 产出序
/// 依次填空位链（研究→母稿→二审→视觉包→视频包→运营），其余飞书链接 →
/// 运营列。已占的位不覆盖（权威数据先来，兜底只补空）。
/// 列名来自固定数组，不是用户输入，无注入面。
fn attach_link(connection: &Connection, case_id: &str, link: &str) -> rusqlite::Result<usize> {
    // 一案下同名形态会出现多个 docx（选题研究/母稿/二审报告/运营方案…），
    // 兜底分不清是哪一份，按北斗 SOP 的固定产出顺序填空位——顺序即语义。
    // 图文案（IMAGE_ONLY）跳过 video 槽：真机 KTuydsjklonilHxFrAGcpqnunob
    // 这种不明文档占住「视频」位比空着更糟（2026-10-18 预演 v3 实锤）。
    let mode: String = connection
        .query_row(
            "SELECT COALESCE(task_type, 'IMAGE_ONLY') FROM beidou_cases WHERE case_id = ?1",
            rusqlite::params![case_id],
            |row| row.get(0),
        )
        .optional()?
        .unwrap_or_else(|| "IMAGE_ONLY".to_owned());
    let has_video = mode == "DUAL" || mode == "VIDEO_ONLY";
    let columns: &[&str] = if link.contains("/drive/folder/") {
        &["folder_url"]
    } else if link.contains("/docx/") {
        if has_video {
            &[
                "research_doc_url",
                "master_doc_url",
                "review_doc_url",
                "visual_url",
                "video_url",
                "ops_doc_url",
            ]
        } else {
            &[
                "research_doc_url",
                "master_doc_url",
                "review_doc_url",
                "visual_url",
                "ops_doc_url",
            ]
        }
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

/// 标签 → 账本槽位。键是交接卡段名里出现的关键词——段名经常带修饰
/// （真机复审跳写「母稿（已 FROZEN 冻结，只读，严禁修改正文）」），所以用
/// 包含匹配而不是全等。星位名同义：天玑产出=母稿、天璇产出=研究、
/// 玉衡产出=图文包、摇光产出=运营。列名来自本文件固定数组，不是用户输入。
const LABEL_SLOTS: &[(&str, &str)] = &[
    ("母稿", "master_doc_url"),
    ("天玑产出", "master_doc_url"),
    ("二审报告", "review_doc_url"),
    ("复审报告", "recheck_doc_url"),
    ("天璇产出", "research_doc_url"),
    ("研究文档", "research_doc_url"),
    ("图文包", "visual_url"),
    ("玉衡产出", "visual_url"),
    ("视频包", "video_url"),
    ("开阳产出", "video_url"),
    ("运营方案", "ops_doc_url"),
    ("摇光产出", "ops_doc_url"),
    ("任务文件夹", "folder_url"),
    ("文件夹", "folder_url"),
];

/// 全部产物槽位（错槽修复遍历用）。
const CASE_LINK_SLOTS: &[&str] = &[
    "folder_url",
    "research_doc_url",
    "master_doc_url",
    "review_doc_url",
    "recheck_doc_url",
    "visual_url",
    "video_url",
    "ops_doc_url",
];

/// 标签归槽：按【段名】认槽，不再按 URL 出现顺序猜。段内找关键词，取关键
/// 词之后、段内的第一条合法链接（段界即搜索窗——不会跨段把下一份文档的
/// 链接揽进来）。同一标签多次出现取最早那一跳的（母稿链接在二审跳和母稿
/// 跳各贴一次，取早不取晚：同一文档的两次引用，不是两个版本）。
/// 一条链接不占两个槽（段里同时出现「母稿」和「图文包」时各归各）。
fn labeled_link_claims(hops: &[&SessionHarvestRow]) -> Vec<(&'static str, String)> {
    let mut claims: Vec<(&'static str, String)> = Vec::new();
    for row in hops {
        let blob = hop_blob(row);
        if blob.is_empty() {
            continue;
        }
        for (label, body) in label_segments(&blob) {
            let segment = if label.is_empty() {
                body
            } else {
                format!("{label}{body}")
            };
            // 段内关键词按出现位置排序：最早出现的关键词先认领
            let mut hits: Vec<(usize, &'static str, &'static str)> = Vec::new();
            for &(key, slot) in LABEL_SLOTS {
                if let Some(at) = segment.find(key) {
                    hits.push((at, key, slot));
                }
            }
            hits.sort_by_key(|(at, _, _)| *at);
            for (at, key, slot) in hits {
                // 一槽一主：这个槽已经有主了就不换（首跳优先）
                if claims.iter().any(|(s, _)| *s == slot) {
                    continue;
                }
                let tail = &segment[at + key.len()..];
                let Some(link) = extract_feishu_links(tail).into_iter().next() else {
                    continue;
                };
                if claims.iter().any(|(_, l)| *l == link) {
                    continue;
                }
                claims.push((slot, link));
            }
        }
    }
    claims
}

/// 标签认领写进账本：标签是硬证据（文档自己的段名），直接覆盖旧值。
/// 返回写中的条数（只作计数用，重复收割同一案也会重写——值不变）。
fn apply_labeled_claims(
    connection: &Connection,
    case_id: &str,
    claims: &[(&'static str, String)],
) -> rusqlite::Result<usize> {
    let now = chrono::Utc::now().timestamp_millis();
    let mut applied = 0usize;
    for (slot, link) in claims {
        // 值没变就不写：收割线现在被前端 15 秒一拍的账本重读反复调用，
        // 无条件 UPDATE 会把 updated_at_ms 一直顶到"此刻"，该列还是卷宗排序的
        // 第二关键词（list_cases: COALESCE(last_activity_ms, updated_at_ms)），
        // 写一次是刷新，写一百次就是把排序钉死。
        let sql = format!(
            "UPDATE beidou_cases SET {slot} = ?2, updated_at_ms = ?3
             WHERE case_id = ?1 AND COALESCE({slot}, '') != ?2"
        );
        applied += connection.execute(&sql, rusqlite::params![case_id, link, now])?;
    }
    Ok(applied)
}

/// 修复旧版盲填的错槽：某槽里的链接若被某个标签认领、而那个标签的槽不是
/// 这一槽，说明这链接是被 URL 顺序瞎猜塞进来的——清掉。没被任何标签认领的
/// 值不动（发车 payload、看门狗反引号 ID 填的那些有别的出处，动了就是毁数据）。
fn repair_mis_slots(
    connection: &Connection,
    case_id: &str,
    claims: &[(&'static str, String)],
) -> rusqlite::Result<()> {
    let now = chrono::Utc::now().timestamp_millis();
    for slot in CASE_LINK_SLOTS {
        let current: String = connection
            .query_row(
                &format!("SELECT COALESCE({slot}, '') FROM beidou_cases WHERE case_id = ?1"),
                rusqlite::params![case_id],
                |row| row.get(0),
            )
            .optional()?
            .unwrap_or_default();
        if current.is_empty() {
            continue;
        }
        // 这个链接归哪个标签？归的槽不是本槽 → 它是被顺序猜塞进来的
        let owner = claims
            .iter()
            .find(|(_, link)| link.as_str() == current)
            .map(|(s, _)| *s);
        if let Some(owner) = owner {
            if owner != *slot {
                let sql = format!(
                    "UPDATE beidou_cases SET {slot} = '', updated_at_ms = ?2 WHERE case_id = ?1"
                );
                connection.execute(&sql, rusqlite::params![case_id, now])?;
            }
        }
    }
    Ok(())
}

/// 盲填（没有标签的链接兜底）：按 SOP 产出顺序填空位链。与 attach_link 的
/// 唯一区别：已经躺在任何槽里的链接不再重复占槽——二审报告的链接归了
/// review 槽，就不该再以"第一个空槽"的身份落进 research（旧版实锤错位）。
fn attach_link_unclaimed(
    connection: &Connection,
    case_id: &str,
    link: &str,
) -> rusqlite::Result<usize> {
    let taken: Option<i64> = connection
        .query_row(
            &format!(
                "SELECT 1 FROM beidou_cases WHERE case_id = ?1 AND ({})",
                CASE_LINK_SLOTS
                    .iter()
                    .map(|s| format!("COALESCE({s}, '') = ?2"))
                    .collect::<Vec<_>>()
                    .join(" OR ")
            ),
            rusqlite::params![case_id, link],
            |row| row.get(0),
        )
        .optional()?;
    if taken.is_some() {
        return Ok(0);
    }
    attach_link(connection, case_id, link)
}

// ---------------------------------------------------------------------------
// episode 内容提取（Leo 2026-10-21 批准；mock21 预览过的那几样真东西）
//
// 深潜舱三栏原来各摆一句假话：「这一案还没有跑过的记录」「判词还没落到
// 本地账本」，研究注是写死的样板句——而 session_run 里正式标题、天权判词、
// 打回记录、时间线全都在（真机 BM-2601 逐跳实锤）。这一函数把它们提炼进
// content_json 一个 JSON 列（老库按 pragma 迁移补齐，见 ensure_case_tables）：
//   formalTitle    多跳一致的《》正式标题（天权五轴定题后每一跳交接卡都带）
//   verdictText    末次【天权二审结论】原话；verdictBy 归属（复审/二审 + 时刻）
//   strikes        结论里写「打回」的跳 → 打回记录（次数回写 second_strike）
//   researchIdNote 看门狗摘录里天璇产出的截断编号（完整链接没回传时的诚实注）
//   timeline       接力跳（当前阶段行）+ 看门狗动作行（漏派/超时/关单）
// 数据只来自 session_run 本段 + gateway_task 里提到本案的行：不连网、不问飞书。
// ---------------------------------------------------------------------------

/// 看门狗巡检行（gateway_task 里提到本案的 automation 摘要）。真机 9 轮巡检
/// 都躺在这里；session_run 的 cron 会话只有最后一轮（关单那轮）。
type WatchRow = (
    Option<String>, // agent_id
    Option<String>, // terminal_summary
    Option<i64>,    // started_at_ms
    Option<i64>,    // ended_at_ms
);

/// episode 内容提取：把一跳一跳的自由文本提炼成深潜舱三栏要的那几样。
/// 幂等：同样的数据再跑一遍，写进去的 JSON 一字不差（合并按 (时刻, 内容)
/// 去重，空产物不写列——保留上一次提取的值）。
fn harvest_episode_content(
    connection: &Connection,
    case_id: &str,
    hops: &[&SessionHarvestRow],
) -> rusqlite::Result<()> {
    let now = chrono::Utc::now().timestamp_millis();
    // 看门狗巡检行。表不存在时（网关从没连过）跳过——内容提取不许把
    // session 收割线带崩（那条线还兼着链接归拢）。
    let watch_rows: Vec<WatchRow> = {
        let has_table: Option<i64> = connection
            .query_row(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'gateway_task'",
                [],
                |row| row.get(0),
            )
            .optional()?;
        if has_table.is_none() {
            Vec::new()
        } else {
            let mut stmt = connection.prepare(
                "SELECT agent_id, terminal_summary, started_at_ms, ended_at_ms
                 FROM gateway_task
                 WHERE COALESCE(terminal_summary, '') LIKE '%' || ?1 || '%'
                 ORDER BY COALESCE(started_at_ms, 0)",
            )?;
            let mapped = stmt.query_map(rusqlite::params![case_id], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })?;
            mapped.filter_map(|item| item.ok()).collect()
        }
    };

    // ── 正式标题：多跳一致的《》──
    // 天权五轴定题后，标题以《》形态写进每一跳交接卡的「任务：」行——同一
    // 标题在接力里重复出现才算数（只出现一次的多是文档名/段名）。
    fn tally_title(counts: &mut Vec<(String, usize)>, inner: &str) {
        let t = inner.trim();
        if t.chars().count() < 6 {
            return; // 《母稿》《图文包》这种段名不是标题
        }
        if let Some(entry) = counts.iter_mut().find(|(k, _)| k == t) {
            entry.1 += 1;
        } else {
            counts.push((t.to_owned(), 1));
        }
    }
    let mut title_counts: Vec<(String, usize)> = Vec::new();
    for row in hops {
        for text in hop_texts(row) {
            for inner in book_titles(text) {
                tally_title(&mut title_counts, &inner);
            }
        }
    }
    for row in &watch_rows {
        if let Some(text) = row.1.as_deref() {
            for inner in book_titles(text) {
                tally_title(&mut title_counts, &inner);
            }
        }
    }
    let mut formal_title = String::new();
    let mut best_n = 1usize; // 门槛：同一标题至少出现 2 次
    for (t, n) in &title_counts {
        if *n >= 2 && *n > best_n {
            formal_title = t.clone();
            best_n = *n;
        }
    }

    // ── 候选标题 + 五轴总分：定题卡的「候选N 名字 分数」──
    let mut candidates: Vec<(String, u32, bool)> = Vec::new();
    for row in hops {
        for (name, score, champion) in extract_candidates(&hop_blob(row)) {
            // 用下标而不是 &mut：get_mut 的 None 分支要 push，同一个 map 上
            // 借用会打架（NLL 不覆盖这个形状）。
            match candidates.iter().position(|(t, _, _)| t == &name) {
                Some(idx) => {
                    // 同一候选在不同跳里分数一样；真不一样时取高分。
                    if score > candidates[idx].1 {
                        candidates[idx].1 = score;
                    }
                    candidates[idx].2 |= champion;
                }
                None => candidates.push((name, score, champion)),
            }
        }
    }
    // 没有显式 Top 1 标记时，用已定的正式标题反认：谁是钦定标题里出现的那一个。
    if !formal_title.is_empty() && !candidates.iter().any(|(_, _, c)| *c) {
        if let Some(entry) = candidates.iter_mut().find(|(t, _, _)| formal_title.contains(t.as_str())) {
            entry.2 = true;
        }
    }

    // ── 天权判词 + 打回记录：末次判词赢（打回在前、复审 PASS 在后）──
    // 标签不止一种写法：2026-10-20 真机 BM-2602 天权写的是
    // 「【审查结论】初审 PASS。…」，而这里原来只认「【天权二审结论】」——
    // 结果跑完整轮，深潜舱中栏一句判词都没有（Leo 截图："怎么还是只显示个开头"）。
    let mut verdict_text = String::new();
    let mut verdict_by = String::new();
    let mut strikes: Vec<serde_json::Value> = Vec::new();
    for row in hops {
        let blob = hop_blob(row);
        for (label, body) in label_segments(&blob) {
            // 二审 / 复审 / 初审 / 链路异常通报都算判词位；标签必须带「结论」或
            // 「裁定」这种判词词根，别把随便一个「审查」小标题当判词。
            let is_verdict_slot = label.contains("天权二审结论")
                || label.contains("审查结论")
                || label.contains("初审结论")
                || label.contains("复审结论")
                || label.contains("天权结论");
            if !is_verdict_slot {
                continue;
            }
            let line = body
                .lines()
                .map(str::trim)
                .find(|l| !l.is_empty())
                .unwrap_or("")
                .to_owned();
            if line.is_empty() {
                continue;
            }
            let at = hop_verdict_ms(row);
            // 同一跳里贴了【复审报告】= 这是复审判词；只有【二审报告】= 二审判词；
            // 明写「初审」= 门禁一的判词。
            let is_recheck = blob.contains("复审报告");
            let round = if label.contains("初审") || line.contains("初审") {
                "初审"
            } else if is_recheck {
                "复审"
            } else {
                "二审"
            };
            verdict_text = line.clone();
            verdict_by = format!("天权 · {round}判词 · {}", fmt_ts(at));
            if line.contains("打回") {
                let (level, sev) = strike_level_and_sev(&line);
                let detail = strike_elaboration(&watch_rows);
                let note = if detail.is_empty() {
                    format!("天权二审结论：{line}")
                } else {
                    format!("天权二审结论：{line}——{detail}")
                };
                strikes.push(serde_json::json!({
                    "verdict": if level.is_empty() {
                        "FAIL".to_owned()
                    } else {
                        format!("FAIL · {level}")
                    },
                    "sev": sev,
                    "at": fmt_ts(at),
                    "note": clip(&note, 120),
                }));
            }
        }
    }

    // ── 天璇研究编号注：看门狗摘录里的截断 ID ──
    let research_note = research_id_note(&watch_rows);

    // ── 入口模式：建档卡写的 task_mode（自主寻题 / 派单定题） ──
    let entry_mode = entry_mode_of(hops, &watch_rows);

    // ── 产出时间线：接力跳 + 看门狗动作行 ──
    let mut timeline: Vec<serde_json::Value> = Vec::new();
    // ① 接力跳：只收提到本案的跳（同段里别人的闲话不进来），空转轮不收
    //    （watchdog 自己写 NO_REPLY / 无可执行内容的那种）。
    for row in hops {
        let blob = hop_blob(row);
        if !blob.contains(case_id) {
            continue;
        }
        let trimmed = blob.trim();
        if trimmed.is_empty() || trimmed == "NO_REPLY" || trimmed.contains("无可执行内容") {
            continue;
        }
        let what = timeline_what(&blob);
        if what.is_empty() {
            continue;
        }
        let start = row.5.unwrap_or_else(|| row.6.unwrap_or(0));
        let end = row.6.unwrap_or(start);
        timeline.push(serde_json::json!({
            "at": fmt_ts(hop_at_ms(row)),
            // atMs 只作合并排序的键，前端读 at/star/what/dur 四列
            "atMs": hop_at_ms(row),
            "star": row.1.clone().unwrap_or_default(),
            "what": what,
            "dur": fmt_dur(end - start),
        }));
    }
    // ② 看门狗动作行：判定分支（关单/漏派/超时/异常）。「无事」轮不记——
    //    watchdog 自己说没动作。同一分支 30 分钟内连续命中只记一笔
    //    （真机 17:49/18:09 两轮都命中漏派，时间线不复读）。
    let mut last_branch: Option<(String, i64)> = None;
    for row in &watch_rows {
        let Some(text) = row.1.as_deref() else {
            continue;
        };
        if !text.contains(case_id) {
            continue;
        }
        let Some(branch) = watchdog_branch(text) else {
            continue;
        };
        let at = row.3.unwrap_or_else(|| row.2.unwrap_or(0));
        if let Some((prev, prev_at)) = &last_branch {
            if *prev == branch && (at - prev_at).abs() < 30 * 60 * 1000 {
                continue;
            }
        }
        last_branch = Some((branch.clone(), at));
        timeline.push(serde_json::json!({
            "at": fmt_ts(at),
            "atMs": at,
            "star": row.0.clone().unwrap_or_default(),
            "what": format!("看门狗巡检：{branch}"),
            "dur": "—",
        }));
    }

    // ── 母稿冻结：复审跳明写「母稿（已 FROZEN 冻结，只读，严禁修改正文）」，
    //    看门狗行写 master_doc_status=FROZEN。两种都认，只升不降。──
    let frozen_text = hops.iter().any(|row| hop_blob(row).contains("FROZEN"))
        || watch_rows
            .iter()
            .any(|row| row.1.as_deref().unwrap_or("").contains("FROZEN"));
    if frozen_text {
        connection.execute(
            "UPDATE beidou_cases SET master_frozen = 1, updated_at_ms = ?2
             WHERE case_id = ?1 AND master_frozen = 0",
            rusqlite::params![case_id, now],
        )?;
    }
    // ── 打回次数：以段内数出来的为准，只增不减。──
    if !strikes.is_empty() {
        connection.execute(
            "UPDATE beidou_cases SET second_strike = MAX(second_strike, ?2), updated_at_ms = ?3
             WHERE case_id = ?1",
            rusqlite::params![case_id, strikes.len() as i64, now],
        )?;
    }

    // ── 关单自愈：只看最新一条证据（历史行不参与）──
    // 2026-10-20 01:29 真机事故：watchdog 写「阶段=玉衡出图中，非已关单」，
    // 旧规则 contains("已关单") 命中，把还在出图的 BM-2602 关成了已关单。
    // 关单是终态、只进不退，误关之后永远翻不回来——所以补这条窄自愈：
    // **最新证据**明说进行中/出图中、且没有任何肯定关单话术时，退回 05_母稿，
    // 随后的 promote_stage 会按星跳把它推回真实列。其余情况一律不动。
    let latest_hop_blob = hops.last().map(|row| hop_blob(row)).unwrap_or_default();
    let latest_watch_blob = watch_rows
        .last()
        .and_then(|row| row.1.as_deref())
        .unwrap_or("")
        .to_owned();
    let inflight = latest_hop_blob.contains("进行中")
        || latest_hop_blob.contains("出图中")
        || latest_watch_blob.contains("进行中")
        || latest_watch_blob.contains("出图中");
    if inflight && !says_closed(&latest_hop_blob) && !says_closed(&latest_watch_blob) {
        connection.execute(
            "UPDATE beidou_cases SET stage = '05_母稿', updated_at_ms = ?2
             WHERE case_id = ?1 AND stage IN ('08_已关单', '08_关单完成')",
            rusqlite::params![case_id, now],
        )?;
    }

    // ── 合并旧值：同一案可能有多轮 episode（追投视频会再跑一轮），新提取为
    //    非空的标量字段赢，旧值只补新一遍没看到的部分；打回记录按时刻合并
    //    （新的替换同时刻的旧记录）；时间线按 (时刻, 内容) 去重合并后排序，
    //    上限 60 行。空产物不写列。──
    let existing: String = connection
        .query_row(
            "SELECT COALESCE(content_json, '') FROM beidou_cases WHERE case_id = ?1",
            rusqlite::params![case_id],
            |row| row.get(0),
        )
        .optional()?
        .unwrap_or_default();
    let old: serde_json::Value = serde_json::from_str(&existing).unwrap_or(serde_json::Value::Null);
    let pick = |new_val: &str, key: &str| -> String {
        if !new_val.is_empty() {
            return new_val.to_owned();
        }
        old.get(key)
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned()
    };
    // 正式标题还有第二种写法：天权交接卡把标题直接写在标签正文里，不带《》——
    // 【正式标题（已回写任务表「内容标题」，不得自拟）】
    // 进门第一眼决定家的秩序：玄关收…
    // 真机 BM-2603 就是这种；只认《》的话这一单永远没有案名。
    let labelled_title = hops
        .iter()
        .filter_map(|row| {
            let segs = label_segments(&hop_blob(row));
            let body = segs
                .into_iter()
                .find(|(label, _)| label.contains("正式标题"))
                .map(|(_, body)| body)?;
            let line = body
                .lines()
                .map(str::trim)
                .find(|l| !l.is_empty())
                .unwrap_or("")
                .trim_matches(|c: char| c == '《' || c == '》' || c == '*' || c == ' ')
                .to_owned();
            if line.chars().count() >= 6 {
                Some(line)
            } else {
                None
            }
        })
        .next()
        .unwrap_or_default();
    let formal_title = {
        let raw = if formal_title.is_empty() {
            labelled_title
        } else {
            formal_title
        };
        pick(&raw, "formalTitle")
    };
    // 案名回填：兜底归案的占位标题就是案号本身（"BM-2603"）。两种情形才改写：
    // ① 标题还是占位案号；② 标题正挂着**别的案**的正式标题——混段时代串过去的
    // （BM-2603 一度顶着 BM-2602 的名字），这一条把它改回自己的。发车/主表
    // 写进来的独立标题两个条件都不满足，不会被覆盖。
    if !formal_title.is_empty() {
        connection.execute(
            "UPDATE beidou_cases SET title = ?2, updated_at_ms = ?3
             WHERE case_id = ?1
               AND (title = ?1
                    OR title IN (SELECT title FROM beidou_cases WHERE case_id != ?1))",
            rusqlite::params![case_id, formal_title, now],
        )?;
    }
    let verdict_text = pick(&verdict_text, "verdictText");
    let verdict_by = pick(&verdict_by, "verdictBy");
    let research_note = pick(&research_note, "researchIdNote");
    let mut strike_rows: Vec<Value> = old
        .get("strikes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    for s in strikes {
        let at = s.get("at").and_then(Value::as_str);
        strike_rows.retain(|o| o.get("at").and_then(Value::as_str) != at);
        strike_rows.push(s);
    }
    let mut tl_rows: Vec<Value> = old
        .get("timeline")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    for row in timeline {
        let at = row.get("atMs").and_then(Value::as_i64);
        let what = row.get("what").and_then(Value::as_str);
        tl_rows.retain(|o| {
            o.get("atMs").and_then(Value::as_i64) != at
                || o.get("what").and_then(Value::as_str) != what
        });
        tl_rows.push(row);
    }
    tl_rows.sort_by(|a, b| {
        a.get("atMs")
            .and_then(Value::as_i64)
            .unwrap_or(0)
            .cmp(&b.get("atMs").and_then(Value::as_i64).unwrap_or(0))
    });
    tl_rows.truncate(60);
    let mut content = serde_json::Map::new();
    if !formal_title.is_empty() {
        content.insert("formalTitle".into(), Value::String(formal_title));
    }
    let mut candidate_rows: Vec<Value> = candidates
        .iter()
        .map(|(title, score, champion)| {
            serde_json::json!({ "title": title, "score": score, "champion": champion })
        })
        .collect();
    if candidate_rows.is_empty() {
        // 这一轮没解析出候选：沿用旧值（同一案换段重跑时，上一段可能解析到过）。
        candidate_rows = old
            .get("candidates")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
    }
    if !candidate_rows.is_empty() {
        content.insert("candidates".into(), Value::Array(candidate_rows));
    }
    if !verdict_text.is_empty() {
        content.insert("verdictText".into(), Value::String(verdict_text));
    }
    if !verdict_by.is_empty() {
        content.insert("verdictBy".into(), Value::String(verdict_by));
    }
    if !strike_rows.is_empty() {
        content.insert("strikes".into(), Value::Array(strike_rows));
    }
    if !research_note.is_empty() {
        content.insert("researchIdNote".into(), Value::String(research_note));
    }
    if !entry_mode.is_empty() {
        content.insert("entryMode".into(), Value::String(entry_mode));
    }
    if !tl_rows.is_empty() {
        content.insert("timeline".into(), Value::Array(tl_rows));
    }
    if content.is_empty() {
        return Ok(()); // 没提炼出东西：不动这一列（保留前值）
    }
    let payload = Value::Object(content).to_string();
    if payload == existing {
        return Ok(()); // 没变：不写
    }
    connection.execute(
        "UPDATE beidou_cases SET content_json = ?2, updated_at_ms = ?3 WHERE case_id = ?1",
        rusqlite::params![case_id, payload, now],
    )?;
    Ok(())
}

/// 捞出文本里所有 《…》 内容（正式标题的刚性形态）。按 char 走：书名号
/// 是单码点，字节下标会在中文前导段上错位（regex_lite_capture 的教训）。
fn book_titles(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '《' {
            let mut j = i + 1;
            let mut inner = String::new();
            while j < chars.len() && chars[j] != '》' {
                inner.push(chars[j]);
                j += 1;
            }
            if j < chars.len() && !inner.trim().is_empty() {
                out.push(inner);
            }
            i = j + 1;
            continue;
        }
        i += 1;
    }
    out
}

/// 文本里有没有**肯定**的关单话术。
///
/// 2026-10-20 01:29 真机现场：watchdog 巡检写的是
/// 「分支1 未命中：阶段=玉衡出图中，**非**已关单」——旧规则 `contains("已关单")`
/// 直接命中，把还在出图的 BM-2602 关成了「已关单」，而且一关就贴在泳道外面
/// （Leo 一分钟后就在看这个案）。所以否定前缀必须挡掉：非 / 未 / 不 / 没。
fn says_closed(text: &str) -> bool {
    let chars: Vec<char> = text.chars().collect();
    for needle in ["已关单", "关单完成"] {
        let mut i = 0usize;
        while i + needle.chars().count() <= chars.len() {
            let hit = needle
                .chars()
                .enumerate()
                .all(|(k, c)| chars[i + k] == c);
            if hit {
                // 往前看 3 个字符，出现否定词就当这句在说"还没关单"。
                let start = i.saturating_sub(3);
                let negated = chars[start..i]
                    .iter()
                    .any(|c| matches!(c, '非' | '未' | '不' | '没'));
                if !negated {
                    return true;
                }
            }
            i += 1;
        }
    }
    false
}

/// 阶段 → 泳道列号（0..=6）。与前端 cockpit.js 的 STAGE_TO_STEP 同一套语义
/// 顺序：建档 0、研究 1、定题 2、母稿 3、二审 4、视听并行 5、分发关单 6。
/// **不能按字符串前缀数字比**：真机库里的编号本身就是错位的
/// （05_母稿 / 06_二审 / 07_关单 / 08_已关单 对应列 3/4/6/-）。
fn stage_step(stage: &str) -> u8 {
    let body: String = stage
        .trim()
        .trim_start_matches(|c: char| c.is_ascii_digit() || matches!(c, '_' | '-' | '.' | ' '))
        .to_owned();
    if body.contains("建档") || body.contains("接单") {
        return 0;
    }
    if body.contains("二审") || body.contains("审稿") || body.contains("冻结") {
        return 4;
    }
    if body.contains("审题") || body.contains("定题") || body.contains("五轴") {
        return 2;
    }
    if body.contains("研究") || body.contains("选题") {
        return 1;
    }
    if body.contains("母稿") || body.contains("创作") {
        return 3;
    }
    if body.contains("视觉")
        || body.contains("配图")
        || body.contains("视频")
        || body.contains("生图")
        || body.contains("并行")
    {
        return 5;
    }
    if body.contains("分发") || body.contains("运营") || body.contains("关单") {
        return 6;
    }
    0
}

/// 阶段推进（只进不退）。账本原先只有「建档」和「已关单」两个写入点，中间六列
/// 从来没人写过——飞书里跑到玉衡的案，泳道还挂在「01 建档」。Leo 2026-10-20
/// 截图实锤："我 BM-2602 那轮都跑完了，app 怎么还是只显示个开头"。
///
/// 只用接力文本里的硬证据往后推，推不动就不推：
///   · 有玉衡/开阳跳，或文本写到视听并行/图文包/出图 → 07_视听并行
///   · 写「二审 PASS」「复审 PASS」或「天权阶段已全部完成」 → 06_二审
///   · 写「母稿…完成/收尾/落盘/定稿/FROZEN」 → 05_母稿
/// 关单仍由原来的话术规则推 08_已关单，这里不会把它降级。
fn promote_stage(
    connection: &Connection,
    case_id: &str,
    hops: &[&SessionHarvestRow],
    now_ms: i64,
) -> rusqlite::Result<()> {
    // 玉衡/开阳真在这一段里跑过 = 已经进视听并行（最硬的证据，比话术可靠）。
    let production_star = hops
        .iter()
        .any(|row| matches!(row.1.as_deref(), Some("yuheng") | Some("kaiyang")));
    let mut target = 0u8;
    for row in hops {
        let blob = hop_blob(row);
        if blob.contains("视听并行") || blob.contains("图文包") || blob.contains("出图") {
            target = target.max(5);
        }
        if (blob.contains("二审") && blob.contains("PASS"))
            || (blob.contains("复审") && blob.contains("PASS"))
            || blob.contains("天权阶段已全部完成")
        {
            target = target.max(4);
        }
        if blob.contains("初审 PASS") || blob.contains("初审PASS") {
            // 初审 PASS = 定题完成、进母稿创作（泳道没有单独"初审"列，定题那一列
            // 由研究/定题证据覆盖，这里直接推下一步）。
            target = target.max(3);
        }
        if blob.contains("母稿")
            && (blob.contains("已完成")
                || blob.contains("已收尾")
                || blob.contains("落盘")
                || blob.contains("定稿")
                || blob.contains("FROZEN"))
        {
            target = target.max(3);
        }
    }
    if production_star {
        target = target.max(5);
    }
    let next = match target {
        5 => "07_视听并行",
        4 => "06_二审",
        3 => "05_母稿",
        _ => return Ok(()),
    };
    let current: String = connection
        .query_row(
            "SELECT COALESCE(stage, '') FROM beidou_cases WHERE case_id = ?1",
            rusqlite::params![case_id],
            |row| row.get(0),
        )
        .optional()?
        .unwrap_or_default();
    if stage_step(&current) >= stage_step(next) {
        return Ok(());
    }
    // `COALESCE(stage,'') = ?4`：同一批账本重复收割时不重复写（幂等）；
    // 老库 stage 可能是 NULL，直接 `stage = ?4` 会漏写。
    connection.execute(
        "UPDATE beidou_cases SET stage = ?2, updated_at_ms = ?3
         WHERE case_id = ?1 AND COALESCE(stage, '') = ?4",
        rusqlite::params![case_id, next, now_ms, current],
    )?;
    Ok(())
}

/// 候选标题与五轴总分（天权定题卡）。
///
/// 2026-10-20 真机 BM-2602 天权写的是：
///   「4 个候选打分：候选1 家务动线 455（Top 1）、候选2 五行色系 418、
///     候选3 阳台禅意 404、候选4 适宠化 393，全部五轴 ≥60」
/// 账本此前**根本没有候选这条线**，所以深潜舱左栏「定题结论」永远是那句
/// 「候选标题与五轴定题分都存在飞书主表」的空态——数据就在眼前却没人取。
///
/// 只在「候选N + 名字 + 三位数总分」三件齐时收：另一种写法
/// 「五轴评分 Top 1：候选1 = 455」只有序号没名字，收进来就是一行对不上标题
/// 的分数，比不收更糟。名字取 2..=12 个非数字非标点字符。
fn extract_candidates(text: &str) -> Vec<(String, u32, bool)> {
    let chars: Vec<char> = text.chars().collect();
    let mut out: Vec<(String, u32, bool)> = Vec::new();
    let mut i = 0usize;
    while i + 2 < chars.len() {
        if !(chars[i] == '候' && chars[i + 1] == '选') {
            i += 1;
            continue;
        }
        let mut j = i + 2;
        let num_start = j;
        while j < chars.len() && chars[j].is_ascii_digit() {
            j += 1;
        }
        if j == num_start {
            i += 2; // 「候选」后面不跟序号：不是打分行
            continue;
        }
        while j < chars.len()
            && (chars[j].is_whitespace() || chars[j] == '=' || chars[j] == '：' || chars[j] == ':')
        {
            j += 1;
        }
        let mut name = String::new();
        while j < chars.len() && name.chars().count() < 12 {
            let ch = chars[j];
            if ch.is_ascii_digit()
                || ch.is_whitespace()
                || matches!(ch, '（' | '(' | '、' | '，' | ',' | '。' | '.' | '；' | ';' | '|' | '｜')
            {
                break;
            }
            name.push(ch);
            j += 1;
        }
        if name.chars().count() < 2 {
            i += 2;
            continue;
        }
        while j < chars.len() && (chars[j].is_whitespace() || chars[j] == '=') {
            j += 1;
        }
        let score_start = j;
        let mut score = 0u32;
        while j < chars.len() && chars[j].is_ascii_digit() && j - score_start < 4 {
            score = score * 10 + chars[j].to_digit(10).unwrap_or(0);
            j += 1;
        }
        if j == score_start || !(100..=999).contains(&score) {
            i += 2; // 没分数就是没打分，别硬凑
            continue;
        }
        let tail: String = chars[j..(j + 10).min(chars.len())].iter().collect();
        let champion = tail.to_ascii_lowercase().contains("top 1");
        if !out.iter().any(|(t, _, _)| t == &name) {
            out.push((name, score, champion));
        }
        i = j;
    }
    out
}

/// 打回结论 → (级别, 必改处数)。真机形如「打回（小改，3 处必改）」：括号
/// 第一段是级别（小改/中改/重写），「N 处必改」是处数。取不到就空着——
/// 徽标少一格比假一格好。
fn strike_level_and_sev(line: &str) -> (String, String) {
    let mut level = String::new();
    if let Some(open) = line.find('（') {
        let rest = &line[open + '（'.len_utf8()..];
        if let Some(close) = rest.find('）') {
            for part in rest[..close].split(['，', ',']) {
                let p = part.trim();
                if matches!(p, "小改" | "中改" | "重写") {
                    level = p.to_owned();
                    break;
                }
            }
        }
    }
    let mut sev = String::new();
    if let Some(at) = line.find("处必改") {
        // 往前找数字（「处必改」前面只允许空格）
        let head = line[..at].trim_end();
        let digits: String = head
            .chars()
            .rev()
            .take_while(|c| c.is_ascii_digit())
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        if !digits.is_empty() {
            sev = format!("{digits} 处必改");
        }
    }
    (level, sev)
}

/// 打回详述：看门狗巡检摘录里会把三处必改逐条列出来（真机 16:29 那轮：
/// 「天权二审结论为**打回（小改，3 处必改）**：场景五标题与正文方向相反…」）。
/// 打回卡上只写结论一行，详述在这——取冒号后到句号那一句。判定行里的
/// 「打回：未命中」不是详述（以未/不开头的跳过）。
fn strike_elaboration(watch_rows: &[WatchRow]) -> String {
    for row in watch_rows {
        let Some(text) = row.1.as_deref() else {
            continue;
        };
        let mut from = 0;
        while let Some(rel) = text[from..].find("打回") {
            let at = from + rel;
            from = at + "打回".len();
            let tail = &text[from..];
            let Some(colon) = tail.find('：') else {
                continue;
            };
            let detail = tail[colon + '：'.len_utf8()..]
                .lines()
                .next()
                .unwrap_or("")
                .trim();
            if detail.is_empty() || detail.starts_with('未') || detail.starts_with('不') {
                continue;
            }
            let cut = detail.split('。').next().unwrap_or(detail).trim();
            if !cut.is_empty() {
                return cut.to_owned();
            }
        }
    }
    String::new()
}

/// 天璇研究编号注：完整 docx 链接从来没回传过，本地只留下看门狗摘录里的
/// 截断编号（真机 16:29 巡检行：「| 天璇产出 | 适我主义与家的能量场（DDyLd0z…） |」）。
/// 研究槽没有链接时，这条注是唯一诚实的说明——比写死的样板句强。
fn research_id_note(watch_rows: &[WatchRow]) -> String {
    for row in watch_rows {
        let Some(text) = row.1.as_deref() else {
            continue;
        };
        let mut from = 0;
        while let Some(rel) = text[from..].find("天璇产出") {
            let at = from + rel;
            from = at + "天璇产出".len();
            let window: String = text[from..].chars().take(60).collect();
            let Some(open) = window.find('（') else {
                continue;
            };
            let after = &window[open + '（'.len_utf8()..];
            let Some(close) = after.find('）') else {
                continue;
            };
            let id = after[..close].trim();
            // 截断编号：6 位以上字母数字，以省略号收尾（完整 ID 不带省略号）
            let base = id.trim_end_matches('…');
            if base.chars().count() < 6
                || !base.chars().all(|c| c.is_ascii_alphanumeric())
                || !id.ends_with('…')
            {
                continue;
            }
            let title = window[..open]
                .trim_matches(|c: char| {
                    c.is_whitespace() || matches!(c, '|' | '：' | ':' | '》' | '《')
                })
                .to_owned();
            if title.is_empty() {
                continue;
            }
            return format!(
                "天璇产出《{title}》：本地只留下截断编号 {id}（看门狗巡检摘录），完整 docx 链接未随任务回传。"
            );
        }
    }
    String::new()
}

/// 一段文本里的 task_mode 值。真机天枢建档跳的终态摘要写
/// 「`task_mode = AUTO_DISCOVERY`（派单未给标题，标题留空待天权五轴定题）」。
/// 等号后跳过空白和 markdown 记号，收连续标识符字符；等号后不是标识符
/// （表格里换了行那种）就当没写，继续往前找。只认两个已知值，别的返回空串
/// ——左栏「🧭 自主寻题」徽标据此显隐，猜错等于把派单给定题的案标成自主寻题。
fn entry_mode_in(text: &str) -> String {
    let mut from = 0;
    while let Some(rel) = text[from..].find("task_mode") {
        let at = from + rel;
        from = at + "task_mode".len();
        let window: String = text[from..].chars().take(48).collect();
        let Some(eq) = window.find('=') else { continue };
        let value: String = window[eq + 1..]
            .chars()
            .skip_while(|c| c.is_whitespace() || matches!(c, '`' | '*' | '|' | ':' | '：'))
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
            .collect();
        if value == "AUTO_DISCOVERY" {
            return value;
        }
        if value == "DIRECT_TITLE" || value == "DIRECT" {
            return "DIRECT_TITLE".to_owned();
        }
    }
    String::new()
}

/// 本案的入口模式：先看接力跳（建档卡在 session_run），再看看门狗巡检摘录。
/// 提不出来就空串——徽标不挂，不猜。
fn entry_mode_of(hops: &[&SessionHarvestRow], watch_rows: &[WatchRow]) -> String {
    for row in hops {
        for text in hop_texts(row) {
            let mode = entry_mode_in(text);
            if !mode.is_empty() {
                return mode;
            }
        }
    }
    for row in watch_rows {
        if let Some(text) = row.1.as_deref() {
            let mode = entry_mode_in(text);
            if !mode.is_empty() {
                return mode;
            }
        }
    }
    String::new()
}

/// 时间线的一句话：优先「当前阶段：」行（交接卡的刚性行），其次【…完成
/// 汇总】段名（星位收尾自报的事件名），最后首行——剥掉【段名】前缀和
/// 「BM-xxxx 」案号前缀（账本口径不是事件），方括号标记行（[CASE_ID: …]）
/// 整行跳过。超过 28 字截断：时间线是一行一条的小字，长了把深潜舱撑爆。
fn timeline_what(blob: &str) -> String {
    // ① 当前阶段行（「当前阶段：天玑创作中（二审打回修改，小改）」）
    for line in blob.lines() {
        let t = line.trim();
        let Some(rest) = t.strip_prefix("当前阶段").map(|s| {
            s.trim_start_matches(|c: char| c == '：' || c == ':' || c == '=' || c.is_whitespace())
        }) else {
            continue;
        };
        if !rest.is_empty() {
            return clip(rest, 28);
        }
    }
    // ② 汇总段名（「【玉衡阶段完成汇总】BM-2601 家的气场…」→「玉衡阶段完成汇总」）
    for (label, _) in label_segments(blob) {
        if !label.is_empty() && label.contains("汇总") {
            return clip(&label, 28);
        }
    }
    // ③ 首行
    for line in blob.lines() {
        let mut t = line.trim().to_owned();
        if t.is_empty() {
            continue;
        }
        if t.starts_with('[') && t.ends_with(']') {
            continue; // [CASE_ID: …] / [DELIVERABLE: …] 这类标记行
        }
        while t.starts_with('【') {
            match t.find('】') {
                Some(close) => t = t[close + '】'.len_utf8()..].trim().to_owned(),
                None => break,
            }
        }
        t = strip_case_prefix(&t);
        if !t.is_empty() {
            return clip(&t, 28);
        }
    }
    String::new()
}

/// 行首案号前缀（「BM-2601 xxx」→「xxx」）：时间线每一行都挂着同一个案号
/// 是噪声——整张深潜舱就在讲这一案。编号后必须跟分隔符，否则这是单词尾巴。
fn strip_case_prefix(s: &str) -> String {
    let chars: Vec<char> = s.chars().collect();
    if chars.len() >= 4
        && chars[0].eq_ignore_ascii_case(&'B')
        && chars[1].eq_ignore_ascii_case(&'M')
        && chars[2] == '-'
    {
        let mut i = 3;
        let mut digits = 0;
        while i < chars.len() && chars[i].is_ascii_alphanumeric() && digits < 6 {
            i += 1;
            digits += 1;
        }
        if digits >= 3 && i < chars.len() && matches!(chars[i], ' ' | '：' | ':' | '|') {
            return chars[i..].iter().collect::<String>().trim().to_owned();
        }
    }
    s.to_owned()
}

/// 看门狗巡检行的动作分支：认「命中」二字，在它后面 15 字内找分支名
/// （关单/漏派/超时/异常/无事），找不到再紧贴它前面 6 字找。分支名必须
/// "活着"——被未/不否定过的（「关单：未命中」「未关单」「关单分支不成立」）
/// 不算。命中的是「无事」轮也跳过：watchdog 自己说没动作，时间线不记空转轮。
/// 真机五轮全中：17:49/18:09 漏派、18:29 超时、19:09 关单（16:29/17:09/
/// 18:49 三轮无事或未命中，全部正确跳过）。
fn watchdog_branch(text: &str) -> Option<String> {
    const BRANCHES: [&str; 5] = ["关单", "漏派", "超时", "异常", "无事"];
    let chars: Vec<char> = text.chars().collect();
    // 分支名在 at 处是否"活着"（没被未/不/没否定）
    let live = |at: usize, len: usize| -> bool {
        let prev: String = chars[at.saturating_sub(2)..at].iter().collect();
        if prev.contains('未') || prev.contains('不') || prev.contains('没') {
            return false;
        }
        let after: String = chars[(at + len)..(at + len + 4).min(chars.len())]
            .iter()
            .collect();
        !(after.contains('未') || after.contains('不') || after.contains('没'))
    };
    // 窗口 [lo, hi) 里第一个活着的分支名
    let scan = |lo: usize, hi: usize| -> Option<&'static str> {
        for b in BRANCHES {
            let blen = b.chars().count();
            let mut at = lo;
            while at + blen <= hi {
                let window: String = chars[at..at + blen].iter().collect();
                if window == b && live(at, blen) {
                    return Some(b);
                }
                at += 1;
            }
        }
        None
    };
    let mut idx = 0;
    while idx + 1 < chars.len() {
        // 找下一个「命中」
        let hit = (idx..chars.len() - 1).find(|&k| chars[k] == '命' && chars[k + 1] == '中')?;
        idx = hit + 2;
        // 否定的命中（未命中/不命中/没命中）不是动作
        let prev: String = chars[hit.saturating_sub(2)..hit].iter().collect();
        if prev.contains('未') || prev.contains('不') || prev.contains('没') {
            continue;
        }
        // 先贴脸看命中前面 6 字（「无事分支命中」「分支 1 关单命中」——主语
        // 贴在命中前面），找不到再看后面 15 字（「本轮命中分支】漏派分支」
        // 「已命中并执行超时分支」）。顺序反了会把后面枚举项当成这一命中的
        // 主语——真机形态「本轮无事分支命中。① 关单：…不命中」里，那个
        // 关单属于下一节且写明不命中（CI 实测实锤）。
        let branch =
            scan(hit.saturating_sub(6), hit).or_else(|| scan(hit + 2, (hit + 17).min(chars.len())));
        if let Some(b) = branch {
            if b == "无事" {
                continue;
            }
            return Some(b.to_owned());
        }
    }
    None
}

/// 时间线用的一跳时刻：一般是开跑时刻；跨 24 小时的 rebound 会话改用结束
/// 时刻（真机建档跳的 started_at 是 10-13 建会话那天，晚了 4.85 天才跑）。
fn hop_at_ms(row: &SessionHarvestRow) -> i64 {
    let start = row.5.unwrap_or_else(|| row.6.unwrap_or(0));
    let end = row.6.unwrap_or(start);
    if end - start > 24 * 3600 * 1000 {
        end
    } else {
        start
    }
}

/// 判词/打回用的一跳时刻：交接卡是跑完才贴出来的，结束时刻更接近判词
/// 落笔（真机打回跳 16:18 开跑、16:42 贴卡，打回记录记 16:42）。
fn hop_verdict_ms(row: &SessionHarvestRow) -> i64 {
    row.6.unwrap_or_else(|| row.5.unwrap_or(0))
}

/// 时长人话：秒→"Ns"、分→"Nm"；超 24 小时或没记结束→"—"（不知道多久
/// 就不编——rebound 会话的 started_at 是建会话那天，能算出 4.85 天来）。
fn fmt_dur(ms: i64) -> String {
    if ms <= 0 || ms > 24 * 3600 * 1000 {
        return "—".to_owned();
    }
    let secs = ms / 1000;
    if secs < 60 {
        format!("{secs}s")
    } else {
        format!("{}m", secs / 60)
    }
}

/// 时刻格式 MM-DD HH:MM（东八区——账本存 UTC ms，Leo 在东八区）。
/// 固定 +8 而不是本机时区：CI 跑在 UTC，用本地时间会让断言随机器漂移。
fn fmt_ts(ms: i64) -> String {
    let offset = chrono::FixedOffset::east_opt(8 * 3600).expect("东八区是合法固定偏移");
    chrono::DateTime::from_timestamp_millis(ms)
        .map(|dt| dt.with_timezone(&offset).format("%m-%d %H:%M").to_string())
        .unwrap_or_default()
}

/// 截到 n 个字符（超出加省略号）。按 char 数不按字节——中文一字 3 字节。
fn clip(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        return s.to_owned();
    }
    format!("{}…", s.chars().take(n).collect::<String>())
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
                // 连续的点是截断标记（半截链以 … 或 ... 收尾）：点在 URL 里
                // 是合法字符，不在这里断的话 "…docx/abc..." 的尾巴会被整段
                // 吃进 URL，后面的 starts_with("...") 永远看不到它
                // （CI 实测：三个点的截断链漏成了 25 位死链）。
                if ch == b'.' && bytes.get(j + 1) == Some(&b'.') {
                    break;
                }
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
            // 截断的链接不认：真机摘要里的半截链以省略号结尾（「…docx/
            // GfNndXZsUojtghxtMBCc…」）——URL 扫描到省略号就收，收到的 25 位
            // 短 ID 点不开。2026-10-21 真机实锤：旧版把这种死链当母稿链接
            // 存进了 master_doc_url，深潜舱里点进去 404。
            let truncated = text[j..].starts_with('…') || text[j..].starts_with("...");
            // 只留飞书域（本层只关心飞书产物；别的链接不塞进云盘入口）
            let host = raw
                .trim_start_matches("https://")
                .trim_start_matches("http://")
                .split('/')
                .next()
                .unwrap_or("");
            // 且路径里必须有产物段（docx/drive/wiki/sheets/base/file）。真机
            // terminal_summary 常被截断——"https://my.feishu.cn/doc" 这种半截
            // 链放进来就是垃圾数据（2026-10-18 真机预演实锤：它占了运营槽）。
            const FEISHU_PATH_MARKERS: [&str; 6] = [
                "/docx/", "/drive/", "/wiki/", "/sheets/", "/base/", "/file/",
            ];
            let has_artifact_path = FEISHU_PATH_MARKERS
                .iter()
                .any(|marker| raw.contains(marker));
            if has_artifact_path
                && !truncated
                && (host.ends_with("feishu.cn") || host.ends_with("larksuite.com"))
            {
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
    /// episode 内容提取产物（JSON）：正式标题/天权判词/打回记录/研究编号注/时间线。
    /// 空串 = 这一案还没提出内容（前端走各自的诚实空态）。
    pub content_json: String,
    /// 复审报告链接（天权第二份审稿文档）；二审报告在 review_doc_url。
    pub recheck_doc_url: String,
}

/// 列全部案件：按最后活动倒序（新案在上）。limit 缺省 200，上限 500。
/// 这就是指挥舱卷宗的真读入口——此前只有 load_case（按 ID 单取），
/// 前端没有任何一处在调，所以看板永远兜底在 DEMO_CASES 上。
pub fn list_cases(
    connection: &Connection,
    limit: Option<u32>,
) -> rusqlite::Result<Vec<CaseListRow>> {
    let limit = limit.unwrap_or(200).min(500);
    let sql = format!(
        "SELECT case_id, title, task_type, stage, owner_star, live_action,
                first_strike, second_strike, master_frozen,
                folder_url, research_doc_url, master_doc_url, review_doc_url,
                visual_url, video_url, ops_doc_url, last_activity_ms, updated_at_ms,
                content_json, recheck_doc_url
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
            content_json: text(18).unwrap_or_default(),
            recheck_doc_url: text(19).unwrap_or_default(),
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
        // 内容提取要读 gateway_task（看门狗巡检行）；没有它整个 session
        // 收割线会崩，所以测试库里照真机 schema 建上。
        db.execute_batch(
            "CREATE TABLE IF NOT EXISTS gateway_task (
                task_id TEXT NOT NULL,
                gateway TEXT NOT NULL,
                agent_id TEXT,
                terminal_summary TEXT,
                started_at_ms INTEGER,
                ended_at_ms INTEGER,
                PRIMARY KEY (task_id, gateway)
            )",
        )
        .expect("gateway_task table");
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

    /// 带 ended_at 的插入（时长/判词时刻断言要用——真机打回跳 16:18 开跑、
    /// 16:42 贴卡，打回记录记的是贴卡时刻）。
    fn insert_session_span(
        db: &Connection,
        session_key: &str,
        agent_id: &str,
        title: &str,
        terminal: Option<&str>,
        started_ms: i64,
        ended_ms: i64,
    ) {
        db.execute(
            "INSERT INTO session_run (gateway, session_key, agent_id, title, status,
                                     terminal_summary, started_at_ms, ended_at_ms,
                                     first_seen_ms, last_seen_ms)
             VALUES ('vps', ?1, ?2, ?3, 'done', ?4, ?5, ?6, ?5, ?6)",
            rusqlite::params![session_key, agent_id, title, terminal, started_ms, ended_ms],
        )
        .expect("insert session span");
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
        // 2 条链接按段名归槽（案行本身由 ensure_case_row 兜底建出，
        // 不计 harvested）。
        assert_eq!(harvest_links_from_sessions(&db).expect("harvest"), 2);
        let list = list_cases(&db, None).expect("list");
        assert_eq!(list.len(), 1);
        let row = &list[0];
        assert_eq!(row.case_id, "BM-9999");
        // 标签归槽：标题写「二审报告」的落 review 槽，写「母稿」的落 master
        // 槽——不再按 URL 出现顺序猜（旧版把二审报告的链接塞进研究槽，
        // 真机 BM-2601 截图实锤）。没有研究文档段名，研究槽留空。
        assert_eq!(row.review_doc_url, "https://my.feishu.cn/docx/ZPkVdNh9abc");
        assert_eq!(row.master_doc_url, "https://my.feishu.cn/docx/GfNndXZsdef");
        assert_eq!(row.research_doc_url, "");
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
    fn session_harvest_is_idempotent_across_repeated_reads() {
        // 前端账本改成 15 秒一拍重读（Leo 2026-10-20 实测：飞书里跑完的案
        // 泳道不出现，因为账本只在启动读一次）。收割线挂在读取命令里，于是
        // 它会每分钟被调 4 次——**第二遍起必须一个字节都不写**，否则
        // last_activity_ms / updated_at_ms 被顶到"此刻"，卷宗排序永远钉死。
        let db = session_run_db();
        let base = 1_800_000_000_000i64;
        let min = 60_000i64;
        insert_session(
            &db,
            "cli:main:group:oc_beidou",
            "tianshu",
            "派发天玑创作 [CASE_ID: BM-8888]",
            None,
            base,
        );
        insert_session(
            &db,
            "cli:main:group:oc_beidou",
            "tianji",
            "母稿",
            Some("母稿已冻结 https://my.feishu.cn/docx/GfNndXZsdef"),
            base + 5 * min,
        );
        assert!(
            harvest_links_from_sessions(&db).expect("first") > 0,
            "第一遍要有动作"
        );
        let list = list_cases(&db, None).expect("list");
        let activity = list[0].last_activity_ms;
        let updated = list[0].updated_at_ms;
        assert!(
            activity.unwrap_or(0) >= base + 5 * min,
            "活动时间取轮内最新一跳的结束（或更新的建案时刻），不是'此刻'"
        );
        // 第二遍：同一批零新信息的行，必须零动作、零写入。
        assert_eq!(
            harvest_links_from_sessions(&db).expect("second"),
            0,
            "同一批账本重复收割不该再有动作"
        );
        let again = list_cases(&db, None).expect("list");
        assert_eq!(again[0].last_activity_ms, activity, "活动时间不许被重复读顶到此刻");
        assert_eq!(again[0].updated_at_ms, updated, "updated_at_ms 不许被重复读刷新");
    }

    #[test]
    fn mixed_episode_does_not_leak_the_other_case_into_this_one() {
        // 真机 2026-10-20 01:30：同一段里 BM-2602 的巡检汇报 + 玉衡跳，
        // 紧挨着 BM-2603 的交接卡。不切跳的话：BM-2603 被 BM-2602 的玉衡跳
        // 推到「视听并行」，案名被 BM-2602 的《》顶掉（线上实际发生）。
        let db = session_run_db();
        let base = 1_800_000_000_000i64;
        let min = 60_000i64;
        insert_session(
            &db,
            "cli:main:group:oc_beidou",
            "tianshu",
            "",
            Some("【北斗任务 watchdog｜BM-2602 全链路落盘实测】阶段：玉衡出图中（进行中）"),
            base,
        );
        insert_session(
            &db,
            "cli:main:group:oc_beidou",
            "yuheng",
            "",
            Some("exec"),
            base + 3 * min,
        );
        insert_session(
            &db,
            "cli:main:group:oc_beidou",
            "tianquan",
            "",
            Some(
                "【交接卡｜天权 → 天玑｜BM-2603 落盘实测第二轮】\n\
                 【审查结论】初审 PASS。三个候选按五轴竞优打分，无一票否决项。\n\
                 【正式标题（已回写任务表「内容标题」，不得自拟）】\n\
                 进门第一眼决定家的秩序：玄关收纳",
            ),
            base + 10 * min,
        );
        harvest_links_from_sessions(&db).expect("harvest");
        let list = list_cases(&db, None).expect("list");
        assert_eq!(list.len(), 1, "这一段只归最后一单");
        let row = &list[0];
        assert_eq!(row.case_id, "BM-2603");
        assert_eq!(
            row.title.as_deref(),
            Some("进门第一眼决定家的秩序：玄关收纳"),
            "案名认【正式标题】标签（不带《》），且不许被上一单顶掉"
        );
        assert_eq!(
            row.stage, "05_母稿",
            "初审 PASS 推进到母稿；不能被 BM-2602 的玉衡跳推成视听并行"
        );
    }

    #[test]
    fn handoff_task_line_wins_over_stale_case_id_in_the_same_episode() {
        // 2026-10-20 01:30 真机：这一轮里同时压着上一单 BM-2602 的巡检汇报和
        // 新单 BM-2603 的交接卡。旧规则「全段只有一个裸编号才归案」直接放弃，
        // 于是新开的单永远进不了泳道。交接卡的「任务：」行才是这一跳在办哪一单。
        let db = session_run_db();
        let base = 1_800_000_000_000i64;
        let min = 60_000i64;
        insert_session(
            &db,
            "cli:main:group:oc_beidou",
            "tianshu",
            "重新测试一个",
            None,
            base,
        );
        insert_session(
            &db,
            "cli:main:group:oc_beidou",
            "tianshu",
            "",
            Some("【任务状态】BM-2602 全链路落盘实测 / 玉衡出图中（进行中）"),
            base + 2 * min,
        );
        insert_session(
            &db,
            "cli:main:group:oc_beidou",
            "tianxuan",
            "",
            Some(
                "【交接卡】@天权\n任务：BM-2603 落盘实测第二轮\n当前阶段：天权初审中\n\n\
                 【天璇产出】研究 docx：https://my.feishu.cn/docx/VUOabc123",
            ),
            base + 5 * min,
        );
        harvest_links_from_sessions(&db).expect("harvest");
        let list = list_cases(&db, None).expect("list");
        assert_eq!(list.len(), 1, "只归这一单");
        assert_eq!(
            list[0].case_id, "BM-2603",
            "交接卡的任务行赢过巡检里的旧案号"
        );
        assert_eq!(
            list[0].research_doc_url, "https://my.feishu.cn/docx/VUOabc123"
        );
    }

    #[test]
    fn closed_wording_ignores_negation() {
        // 2026-10-20 01:29 真机事故：巡检写「阶段=玉衡出图中，非已关单」，
        // contains("已关单") 命中，把在跑的案关了单。
        assert!(says_closed("BM-2601｜已关单：reset 6 个群会话"));
        assert!(says_closed("关单完成，归档"));
        assert!(!says_closed("阶段=玉衡出图中，非已关单"), "非已关单不是关单");
        assert!(!says_closed("尚未关单"), "尚未关单不是关单");
        assert!(!says_closed("还没关单，继续跑"), "还没关单不是关单");
        assert!(
            says_closed("分支1 未命中：阶段=玉衡出图中，非已关单。分支5 已关单，已归档"),
            "同一段里只要有一句肯定关单就算"
        );
        assert!(!says_closed("玉衡出图中"));
    }

    #[test]
    fn harvest_promotes_stage_and_reads_candidates() {
        // 真机 BM-2602 形态（Leo 2026-10-20 截图：跑到玉衡了泳道还写「01 建档」）：
        // 天权写「【审查结论】初审 PASS」+ 候选打分，天玑母稿收尾，玉衡进场出图。
        let db = session_run_db();
        let base = 1_800_000_000_000i64;
        let min = 60_000i64;
        insert_session(
            &db,
            "cli:main:group:oc_beidou",
            "tianquan",
            "初审 [CASE_ID: BM-9001]",
            Some(
                "【审查结论】初审 PASS。五轴竞优自动定题完成，无一票否决项。\n\n\
                 4 个候选打分：候选1 家务动线 455（Top 1）、候选2 五行色系 418、\
                 候选3 阳台禅意 404，全部五轴 ≥60。",
            ),
            base,
        );
        insert_session(
            &db,
            "cli:main:group:oc_beidou",
            "tianji",
            "母稿",
            Some("BM-9001 母稿环节已完成收尾，落盘 docx。"),
            base + 10 * min,
        );
        harvest_links_from_sessions(&db).expect("harvest");
        let list = list_cases(&db, None).expect("list");
        assert_eq!(list.len(), 1);
        let row = &list[0];
        assert_eq!(row.case_id, "BM-9001");
        assert_eq!(row.stage, "05_母稿", "母稿收尾要推进阶段，不能停在 01_建档");
        let content: serde_json::Value =
            serde_json::from_str(&row.content_json).expect("content json");
        assert!(
            content["verdictText"]
                .as_str()
                .unwrap_or("")
                .contains("初审 PASS"),
            "【审查结论】也是判词位"
        );
        let cands = content["candidates"].as_array().expect("candidates");
        assert_eq!(cands.len(), 3, "只收「候选N + 名字 + 分数」三件齐的行");
        assert_eq!(cands[0]["title"], "家务动线");
        assert_eq!(cands[0]["score"], 455);
        assert_eq!(cands[0]["champion"], true, "（Top 1）就是钦定");
        assert_eq!(cands[1]["champion"], false);
        // 玉衡进场 = 视听并行（星跳比话术硬）。
        insert_session(
            &db,
            "cli:main:group:oc_beidou",
            "yuheng",
            "出图中",
            None,
            base + 20 * min,
        );
        harvest_links_from_sessions(&db).expect("harvest again");
        let list = list_cases(&db, None).expect("list");
        assert_eq!(list[0].stage, "07_视听并行");
    }

    fn gateway_task_db() -> Connection {
        let db = memory_db();
        db.execute_batch(
            "CREATE TABLE gateway_task (
                task_id TEXT NOT NULL,
                gateway TEXT NOT NULL,
                agent_id TEXT,
                terminal_summary TEXT,
                progress_summary TEXT,
                PRIMARY KEY (task_id, gateway)
            )",
        )
        .expect("gateway_task table");
        db
    }

    #[test]
    fn task_harvest_takes_bare_bm_summary_for_close_and_links() {
        // VPS 侧不注入 [CASE_ID] 标签（Leo 2026-10-18 明确）：watchdog 巡检/
        // 关单摘要只写裸「CASE BM-9996 …已关单」。本地必须吃裸案号——
        // 唯一 BM-\d 编号 + 案已在账本才归拢，关单话术推进 stage。
        let db = gateway_task_db();
        let row = serde_json::json!({
            "record_id": "BM-9996", "title": "甲案", "deliverable_mode": "IMAGE_ONLY",
            "stage": "05_母稿"
        });
        upsert_case_from_master_row(&db, &row).expect("upsert");
        db.execute(
            "INSERT INTO gateway_task (task_id, gateway, agent_id, terminal_summary)
             VALUES ('cronrun:w1', 'vps', 'tianshu',
                     '本轮巡检完成。CASE BM-9996 已关单：reset 6 个群会话、删除 job。 运营方案 https://my.feishu.cn/docx/LENQdQaiabc')",
            [],
        )
        .expect("insert task");
        assert!(harvest_links_from_tasks(&db).expect("harvest") >= 1);
        let list = list_cases(&db, None).expect("list");
        assert_eq!(list.len(), 1, "裸案号不建新案，只归拢账本里已有的案");
        assert_eq!(list[0].stage, "08_已关单", "关单话术推进 stage");
        // 摘要里的运营方案链接落槽（第一个空 docx 槽）。
        assert_eq!(
            list[0].research_doc_url,
            "https://my.feishu.cn/docx/LENQdQaiabc"
        );
    }

    #[test]
    fn task_harvest_ignores_bare_bm_for_unknown_case() {
        // 账本里从没见过的裸编号：不建空案行（防误拢），也不动任何案。
        let db = gateway_task_db();
        db.execute(
            "INSERT INTO gateway_task (task_id, gateway, agent_id, terminal_summary)
             VALUES ('cronrun:w2', 'vps', 'tianshu',
                     'CASE BM-8888 已关单。https://my.feishu.cn/docx/Whatever123')",
            [],
        )
        .expect("insert task");
        assert_eq!(harvest_links_from_tasks(&db).expect("harvest"), 0);
        assert!(list_cases(&db, None).expect("list").is_empty());
    }

    #[test]
    fn bare_case_harvest_picks_watchdog_backticked_ids() {
        // watchdog 关单摘要只贴裸 docx ID（反引号），不贴 URL——真机 19:12
        // 实锤：【交付物留痕】玉衡图文包 `UiXMdOn…`；摇光发布运营方案
        // `LENQdQai…`；文件夹 `QlkyfW…`。按标签拼 URL 归槽。
        let db = gateway_task_db();
        let row = serde_json::json!({
            "record_id": "BM-9993", "title": "甲案", "deliverable_mode": "IMAGE_ONLY",
            "stage": "07_关单"
        });
        upsert_case_from_master_row(&db, &row).expect("upsert");
        db.execute(
            "INSERT INTO gateway_task (task_id, gateway, terminal_summary)
             VALUES ('cronrun:w9', 'vps',
                     '【任务状态】BM-9993｜已关单。【交付物留痕】玉衡图文包 `UiXMdOnEDouQzAxw1Yjc1XFRnqP`；摇光发布运营方案 `LENQdQaiaoBWiTxrzGGcoxTfnNh`；文件夹 `QlkyfWDZalOFUXdztyAcYRu2nVe`。')",
            [],
        )
        .expect("insert task");
        assert!(harvest_links_from_tasks(&db).expect("harvest") >= 1);
        let list = list_cases(&db, None).expect("list");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].stage, "08_已关单");
        assert_eq!(
            list[0].visual_url,
            "https://my.feishu.cn/docx/UiXMdOnEDouQzAxw1Yjc1XFRnqP"
        );
        assert_eq!(
            list[0].ops_doc_url,
            "https://my.feishu.cn/docx/LENQdQaiaoBWiTxrzGGcoxTfnNh"
        );
        assert_eq!(
            list[0].folder_url,
            "https://my.feishu.cn/drive/folder/QlkyfWDZalOFUXdztyAcYRu2nVe"
        );
    }

    #[test]
    fn backticked_id_after_needs_label_ticks_and_length() {
        // 反引号锚定 + 长度区间：没有反引号、ID 太短、或标签后 60 字符内
        // 没有反引号，都返回 None——不硬猜。
        assert_eq!(
            backticked_id_after("图文包 `UiXMdOnEDouQzAxw1Yjc1XFRnqP` 落盘", "图文包").as_deref(),
            Some("UiXMdOnEDouQzAxw1Yjc1XFRnqP")
        );
        // 段外的长间距形态不认（12 字符窗）：巡检正文「文件夹内已出现
        // …docx（`ID`」的 ID 不是文件夹自己的——预演 v3 实锤它占过 folder 槽。
        assert_eq!(
            backticked_id_after(
                "文件夹内已出现「玉衡-图文包-BM-2601」docx（`UiXMdOnEDouQzAxw1Yjc1XFRnqP`",
                "文件夹"
            ),
            None
        );
        // 段内（交付物留痕）的贴脸形态照认。
        assert_eq!(
            backticked_id_after(
                "交付物留痕】玉衡图文包 `UiXMdOnEDouQzAxw1Yjc1XFRnqP`；",
                "图文包"
            )
            .as_deref(),
            Some("UiXMdOnEDouQzAxw1Yjc1XFRnqP")
        );
        assert_eq!(
            backticked_id_after("图文包已落盘（docx UiXMdOn，无反引号", "图文包"),
            None
        );
        assert_eq!(backticked_id_after("文件夹 `abc` 太短", "文件夹"), None);
        assert_eq!(
            backticked_id_after("玉衡图文包 `UiXMdOnEDouQzAxw1Yjc1XFRnqP`", "运营方案"),
            None
        );
    }

    #[test]
    fn extract_bm_case_ids_only_takes_bm_digit_shape() {
        // 只认 BM + 3-6 位数字：LARK-CLI / QWEN-IMAGE 这类字母-字母工具名
        // （extract_case_id 注释记录的误拢教训）在这个形状下不存在。
        assert_eq!(extract_bm_case_ids("CASE BM-2601｜已关单"), vec!["BM-2601"]);
        assert_eq!(extract_bm_case_ids("小写 bm-2602 也认"), vec!["BM-2602"]);
        assert!(extract_bm_case_ids("LARK-CLI QWEN-IMAGE SDXL-API").is_empty());
        assert_eq!(
            extract_bm_case_ids("BM-2601 和 bm-2603 两个编号"),
            vec!["BM-2601", "BM-2603"]
        );
        // 编号前后贴字母数字的不认（abcBM-2601 / BM-2601abc）。
        assert!(extract_bm_case_ids("abcBM-2601").is_empty());
        assert!(extract_bm_case_ids("BM-2601abc").is_empty());
    }

    #[test]
    fn extract_feishu_links_rejects_truncated() {
        // 真机 terminal_summary 里的半截链（"https://my.feishu.cn/doc"）曾经
        // 占掉运营槽——必须要求路径里有产物段。
        assert!(extract_feishu_links("看这个 https://my.feishu.cn/doc 截断了").is_empty());
        assert!(extract_feishu_links("https://my.fei").is_empty());
        let links = extract_feishu_links("母稿 https://my.feishu.cn/docx/AbCdEf123456** 好了");
        assert_eq!(links, vec!["https://my.feishu.cn/docx/AbCdEf123456"]);
        let folder = extract_feishu_links("文件夹 https://my.feishu.cn/drive/folder/Rbpj123abc");
        assert_eq!(folder.len(), 1);
    }

    #[test]
    fn bare_case_ignores_watchdog_mentions_outside_artifact_segment() {
        // 巡检摘要（无「交付物留痕」段）里提「文件夹内已出现…docx（`ID`」：
        // 那个 ID 是图文包不是文件夹——folder 槽不许被占（预演 v3 实锤）。
        // 摘要里也没有任何 URL，所以这一拍什么槽都不该动。
        let db = gateway_task_db();
        let row = serde_json::json!({
            "record_id": "BM-9992", "title": "甲案", "deliverable_mode": "IMAGE_ONLY",
            "stage": "07_关单"
        });
        upsert_case_from_master_row(&db, &row).expect("upsert");
        db.execute(
            "INSERT INTO gateway_task (task_id, gateway, terminal_summary)
             VALUES ('cronrun:w8', 'vps',
                     '判据：文件夹内已出现「玉衡-图文包-BM-9992」docx（`UiXMdOnEDouQzAxw1Yjc1XFRnqP`，创建 17:40），阶段推进。')",
            [],
        )
        .expect("insert task");
        harvest_links_from_tasks(&db).expect("harvest");
        let list = list_cases(&db, None).expect("list");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].folder_url, "", "段外提及不归拢 folder");
        assert_eq!(list[0].visual_url, "", "段外提及不归拢 visual");
    }

    #[test]
    fn image_only_case_skips_video_slot() {
        // 图文案（IMAGE_ONLY）没有视频产物：docx 链跳过 video 槽——真机
        // KTuydsjklonilHxFrAGcpqnunob 这种不明文档占住「视频」位比空着糟。
        let db = gateway_task_db();
        let row = serde_json::json!({
            "record_id": "BM-9991", "title": "甲案", "deliverable_mode": "IMAGE_ONLY",
            "stage": "01_建档"
        });
        upsert_case_from_master_row(&db, &row).expect("upsert");
        // 摘要里唯一裸编号 + 一条真 docx 链接（SIM 前缀过形状检查）。
        db.execute(
            "INSERT INTO gateway_task (task_id, gateway, terminal_summary)
             VALUES ('cronrun:w7', 'vps',
                     'CASE BM-9991 巡检：母稿 https://my.feishu.cn/docx/AbCdEf123456 落盘')",
            [],
        )
        .expect("insert task");
        harvest_links_from_tasks(&db).expect("harvest");
        let list = list_cases(&db, None).expect("list");
        // 第一个空 docx 槽是 research；video 槽全程不碰。
        assert_eq!(
            list[0].research_doc_url,
            "https://my.feishu.cn/docx/AbCdEf123456"
        );
        assert_eq!(list[0].video_url, "", "IMAGE_ONLY 案不占 video 槽");
    }

    #[test]
    fn session_harvest_dedupes_repeated_links() {
        // 同一母稿链接在二审跳和母稿跳各贴一次（真机形态）：不去重会连锁
        // 占掉后面的空槽——段级去重后一个链接只占一个槽。
        let db = session_run_db();
        let base = 1_800_000_000_000i64;
        let master = "https://my.feishu.cn/docx/GfNndXZsUojtghxtMBCc";
        insert_session(
            &db,
            "cli:main:group:oc_beidou",
            "tianshu",
            "派发天权初审 [CASE_ID: BM-9995]",
            Some(&format!("母稿 {master}")),
            base,
        );
        insert_session(
            &db,
            "cli:main:group:oc_beidou",
            "tianji",
            "母稿",
            Some(&format!("母稿定稿 {master}")),
            base + 10 * 60_000,
        );
        // 1 个唯一链接落 1 个槽（去重前同一链接会占 research 又占 master）。
        assert_eq!(harvest_links_from_sessions(&db).expect("harvest"), 1);
        let list = list_cases(&db, None).expect("list");
        // 两跳文本都点名「母稿」：按标签语义归母稿槽，不按 URL 出现顺序
        // 猜——旧版会把同一个链接先塞 research 再连锁占 master。
        assert_eq!(list[0].master_doc_url, master);
        assert_eq!(list[0].research_doc_url, "", "同一链接不占两个槽");
    }

    #[test]
    fn repair_clears_mis_slotted_link() {
        // 旧版盲填的错槽：二审报告的链接躺在"研究文档"槽里（真机 BM-2601
        // 实锤——深潜舱研究位点进去是二审报告）。标签归槽后必须清掉：
        // 同一份文档不占两个槽，研究槽留给真正的研究文档。
        let db = session_run_db();
        let base = 1_800_000_000_000i64;
        let review = "https://my.feishu.cn/docx/ZPkVdNh9eoWwyYxN1hScbfCYnhh";
        upsert_case_from_master_row(
            &db,
            &serde_json::json!({
                "record_id": "BM-7778", "title": "甲案", "deliverable_mode": "IMAGE_ONLY",
                "stage": "06_二审", "research_doc_id": review
            }),
        )
        .expect("upsert");
        insert_session(
            &db,
            "cli:main:group:oc_repair",
            "tianshu",
            "派发 [CASE_ID: BM-7778]",
            None,
            base,
        );
        insert_session(
            &db,
            "cli:main:group:oc_repair",
            "tianquan",
            "",
            Some(
                "【交接卡】@天玑\n任务：BM-7778《甲案的正式标题》\n当前阶段：天玑创作中\n\n【天权二审结论】PASS\n【二审报告】https://my.feishu.cn/docx/ZPkVdNh9eoWwyYxN1hScbfCYnhh",
            ),
            base + 10 * 60_000,
        );
        harvest_links_from_sessions(&db).expect("harvest");
        let list = list_cases(&db, None).expect("list");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].review_doc_url, review, "二审报告的链接归 review 槽");
        assert_eq!(list[0].research_doc_url, "", "错槽的研究链接被清掉");
    }

    #[test]
    fn truncated_links_are_rejected() {
        // 真机摘要里的半截链以省略号结尾——25 位短 ID 点不开，旧版把它当
        // 母稿链接存进了 master_doc_url（深潜舱点进去 404）。
        assert!(
            extract_feishu_links("【母稿】https://my.feishu.cn/docx/GfNndXZsUojtghxtMBCc…")
                .is_empty()
        );
        assert!(extract_feishu_links("图文包链接：https://my.fei…").is_empty());
        assert!(extract_feishu_links(
            "最终交付链接：`https://www.feishu.cn/docx/LENQdQaiaoBWiTxrzGGcoxT…`"
        )
        .is_empty());
        // 三个点也算截断标记
        assert!(
            extract_feishu_links("母稿 https://my.feishu.cn/docx/GfNndXZsUojtghxtMBCc...")
                .is_empty()
        );
        // 完整的照认（省略号规则只治半截链）
        assert_eq!(
            extract_feishu_links(
                "【二审报告】https://my.feishu.cn/docx/ZPkVdNh9eoWwyYxN1hScbfCYnhh"
            ),
            vec!["https://my.feishu.cn/docx/ZPkVdNh9eoWwyYxN1hScbfCYnhh"]
        );
    }

    #[test]
    fn episode_content_extracts_title_verdict_strikes_and_timeline() {
        // 真机 BM-2601 缩比：派单卡（标签）→ 天权交接卡（打回 + 《标题》）→
        // 天玑交接卡（母稿链接）→ 天权复审交接卡（PASS + FROZEN）。深潜舱
        // 三栏要的标题/判词/打回/时间线都该从这些跳里提出来。
        let db = session_run_db();
        let base = 1_800_000_000_000i64;
        let min = 60_000i64;
        insert_session_span(
            &db,
            "cli:main:group:oc_content",
            "tianshu",
            "派发天权初审 [CASE_ID: BM-7777]",
            None,
            base,
            base + 5 * min,
        );
        insert_session_span(
            &db,
            "cli:main:group:oc_content",
            "tianquan",
            "",
            Some(
                "【交接卡】@天玑\n任务：BM-7777《我家的气场是我调出来的》\n当前阶段：天玑创作中（二审打回修改，小改）\n\n【天权二审结论】打回（小改，3 处必改）\n【二审报告】https://my.feishu.cn/docx/ZPkVdNh9eoWwyYxN1hScbfCYnhh",
            ),
            base + 10 * min,
            base + 34 * min,
        );
        insert_session_span(
            &db,
            "cli:main:group:oc_content",
            "tianji",
            "",
            Some(
                "【交接卡】@天权\n任务：BM-7777《我家的气场是我调出来的》\n当前阶段：天玑母稿已完成，待二审\n\n【天玑产出】母稿 docx：https://my.feishu.cn/docx/GfNndXZsUojtghxtMBCcwvaZnKd",
            ),
            base + 25 * min,
            base + 32 * min,
        );
        insert_session_span(
            &db,
            "cli:main:group:oc_content",
            "tianquan",
            "",
            Some(
                "【交接卡】@玉衡\n任务：BM-7777《我家的气场是我调出来的》\n当前阶段：玉衡出图中\n\n【天权二审结论】PASS（3 处必改项全部落实，无新增问题）\n【复审报告】https://my.feishu.cn/docx/KTuydsjklonilHxFrAGcpqnunob\n【母稿（已 FROZEN 冻结，只读，严禁修改正文）】https://my.feishu.cn/doc…",
            ),
            base + 31 * min,
            base + 47 * min,
        );
        assert_eq!(harvest_links_from_sessions(&db).expect("harvest"), 3);
        let list = list_cases(&db, None).expect("list");
        assert_eq!(list.len(), 1);
        let row = &list[0];
        // 链接按段名归槽
        assert_eq!(
            row.review_doc_url,
            "https://my.feishu.cn/docx/ZPkVdNh9eoWwyYxN1hScbfCYnhh"
        );
        assert_eq!(
            row.master_doc_url,
            "https://my.feishu.cn/docx/GfNndXZsUojtghxtMBCcwvaZnKd"
        );
        assert_eq!(
            row.recheck_doc_url,
            "https://my.feishu.cn/docx/KTuydsjklonilHxFrAGcpqnunob"
        );
        assert_eq!(row.research_doc_url, "", "没有研究文档段名，研究槽留空");
        assert_eq!(row.second_strikes, 1, "打回一次");
        assert!(row.master_frozen, "复审跳写明 FROZEN");
        let content: serde_json::Value =
            serde_json::from_str(&row.content_json).expect("content json");
        assert_eq!(content["formalTitle"], "我家的气场是我调出来的");
        // 兜底归案建出来的占位标题就是案号，真案名在交接卡的《》里——
        // 不换掉的话泳道上摆着的就是一行「BM-7777」，看不出这是哪单活。
        assert_eq!(
            row.title.as_deref(),
            Some("我家的气场是我调出来的"),
            "占位标题被交接卡的真案名换掉"
        );
        assert_eq!(
            content["verdictText"],
            "PASS（3 处必改项全部落实，无新增问题）"
        );
        assert!(
            content["verdictBy"].as_str().unwrap_or("").contains("复审"),
            "贴了复审报告的跳 = 复审判词"
        );
        let strikes = content["strikes"].as_array().expect("strikes");
        assert_eq!(strikes.len(), 1);
        assert_eq!(strikes[0]["verdict"], "FAIL · 小改");
        assert_eq!(strikes[0]["sev"], "3 处必改");
        assert!(strikes[0]["note"]
            .as_str()
            .unwrap_or("")
            .contains("天权二审结论"));
        let tl = content["timeline"].as_array().expect("timeline");
        assert_eq!(tl.len(), 4, "四跳全进时间线");
        let whats: Vec<&str> = tl
            .iter()
            .map(|r| r["what"].as_str().unwrap_or(""))
            .collect();
        assert!(
            whats.iter().any(|w| w.contains("二审打回修改")),
            "当前阶段行进时间线: {whats:?}"
        );
        assert!(
            whats.iter().any(|w| w.contains("母稿已完成")),
            "母稿跳: {whats:?}"
        );
        assert!(
            whats.iter().any(|w| w.contains("玉衡出图")),
            "复审跳: {whats:?}"
        );
        // 时间线按时刻升序
        let keys: Vec<i64> = tl.iter().map(|r| r["atMs"].as_i64().unwrap_or(0)).collect();
        assert!(keys.windows(2).all(|w| w[0] <= w[1]), "时间线按时刻升序");
    }

    #[test]
    fn episode_content_extracts_entry_mode_from_dispatch_card() {
        // 天枢建档那一跳的终态摘要写「task_mode = AUTO_DISCOVERY」——左栏
        // 「🧭 自主寻题」徽标只在这个证据存在时才挂。派单给定题的案（摘要写
        // DIRECT_TITLE，或根本没写）不许挂：没证据不认，猜错是给案贴假标签。
        let db = session_run_db();
        let base = 1_800_000_000_000i64;
        insert_session(
            &db,
            "cli:main:group:oc_entry",
            "tianshu",
            "建档并派单 [CASE_ID: BM-7779]",
            Some(
                "BM-7779 建档与首派已完成。\n- `task_mode = AUTO_DISCOVERY`（派单未给标题，标题留空待天权五轴定题）\n- `deliverable_mode = 图文`",
            ),
            base,
        );
        insert_session(
            &db,
            "cli:main:group:oc_entry",
            "tianxuan",
            "",
            Some("【交接卡】@天权\n任务：BM-7779《我家的气场是我调出来的》\n当前阶段：天璇已定题\n\n【天璇产出】研究 docx：https://my.feishu.cn/docx/DDyLd0zUojtghxtMBCcwvaZnKd"),
            base + 10 * 60_000,
        );
        let _ = harvest_links_from_sessions(&db).expect("harvest");
        let list = list_cases(&db, None).expect("list");
        assert_eq!(list.len(), 1);
        let content: serde_json::Value =
            serde_json::from_str(&list[0].content_json).expect("content json");
        assert_eq!(
            content["entryMode"], "AUTO_DISCOVERY",
            "建档卡写了 task_mode 才认自主寻题"
        );
    }

    #[test]
    fn entry_mode_in_only_accepts_known_values() {
        // 等号后是 markdown 记号和空白也要收到；未知值/没有等号不当真。
        assert_eq!(
            entry_mode_in("- `task_mode = AUTO_DISCOVERY`（派单未给标题）"),
            "AUTO_DISCOVERY"
        );
        assert_eq!(entry_mode_in("task_mode = DIRECT_TITLE"), "DIRECT_TITLE");
        assert_eq!(entry_mode_in("task_mode=DIRECT"), "DIRECT_TITLE");
        assert_eq!(entry_mode_in("task_mode = SOMETHING_ELSE"), "");
        assert_eq!(entry_mode_in("这一段没提到入口模式"), "");
        // 表格里等号在很远的下文：48 字窗口外不当真
        let far = format!("task_mode {}", "x".repeat(80));
        assert_eq!(entry_mode_in(&far), "");
    }

    #[test]
    fn episode_content_merges_without_losing_previous_round() {
        // 同一案跑第二轮（追投视频后再接一轮）：新提取非空的字段赢，旧值
        // 只补新一遍没看到的部分——第一轮的判词/时间线不许被抹掉。
        let db = session_run_db();
        let base = 1_800_000_000_000i64;
        let min = 60_000i64;
        let handoff = "【交接卡】@下一位\n任务：BM-7779《第二轮的正式标题》\n当前阶段：第二轮进行中\n\n【天权二审结论】PASS（无新问题）";
        insert_session_span(
            &db,
            "cli:main:group:oc_merge",
            "tianshu",
            "派发 [CASE_ID: BM-7779]《第二轮的正式标题》",
            None,
            base,
            base + min,
        );
        insert_session_span(
            &db,
            "cli:main:group:oc_merge",
            "tianquan",
            "",
            Some(handoff),
            base + 10 * min,
            base + 20 * min,
        );
        harvest_links_from_sessions(&db).expect("first round");
        let first = list_cases(&db, None).expect("list")[0].content_json.clone();
        assert!(first.contains("第二轮的正式标题"));
        assert!(first.contains("PASS（无新问题）"));
        // 第二轮：沉默超过 60 分钟切成新段，只有派单卡 + 一个空跳
        insert_session_span(
            &db,
            "cli:main:group:oc_merge",
            "kaiyang",
            "",
            Some("【开阳产出】视频包落盘"),
            base + 200 * min,
            base + 210 * min,
        );
        harvest_links_from_sessions(&db).expect("second round");
        let row = &list_cases(&db, None).expect("list")[0];
        // 第二段没有标签也没有交接卡 → 归属不到案，内容列保留第一轮的
        assert_eq!(row.content_json, first, "没人认领的段不动内容列");
    }

    #[test]
    fn episode_attribution_falls_back_to_handoff_card() {
        // 派单卡那一跳没落进本地账本（app 当时没开）时，段里有交接卡 +
        // 全段唯一裸案号也要能归属——VPS 侧不会注入 [CASE_ID] 标签
        // （Leo 2026-10-18 明确）。
        let db = session_run_db();
        let base = 1_800_000_000_000i64;
        insert_session(
            &db,
            "cli:main:group:oc_fallback",
            "tianquan",
            "",
            Some("【交接卡】@天玑\n任务：BM-7775《兜底归属的案》\n当前阶段：天玑创作中"),
            base,
        );
        insert_session(
            &db,
            "cli:main:group:oc_fallback",
            "tianji",
            "",
            Some("【母稿】https://my.feishu.cn/docx/GfNndXZsUojtghxtMBCcwvaZnKd"),
            base + 10 * 60_000,
        );
        assert_eq!(harvest_links_from_sessions(&db).expect("harvest"), 1);
        let list = list_cases(&db, None).expect("list");
        assert_eq!(list.len(), 1, "交接卡 + 唯一裸案号 = 归属");
        assert_eq!(list[0].case_id, "BM-7775");
        assert_eq!(
            list[0].master_doc_url,
            "https://my.feishu.cn/docx/GfNndXZsUojtghxtMBCcwvaZnKd"
        );
    }

    #[test]
    fn episode_without_handoff_card_is_not_attributed() {
        // 没有标签、也没有交接卡的段（Leo 在群里提问那种）不归属——
        // 哪怕段里提到案号。猜错是把别人的话挂到本案名下。
        let db = session_run_db();
        let base = 1_800_000_000_000i64;
        insert_session(
            &db,
            "cli:main:group:oc_qa",
            "tianshu",
            "你看看下午那单跑完了吗",
            Some("BM-7774 那单已关单了。母稿 https://my.feishu.cn/docx/Whatever123abc"),
            base,
        );
        assert_eq!(harvest_links_from_sessions(&db).expect("harvest"), 0);
        assert!(list_cases(&db, None).expect("list").is_empty());
    }

    #[test]
    fn watchdog_branch_picks_action_rounds_only() {
        // 无事轮/未命中不记；动作轮记分支名。真机五轮全中。
        assert_eq!(
            watchdog_branch("判定：无事分支 + 状态纠正。本轮未派发、未重发、未触发自愈。5. **无事**：命中（在完成下述纠正后）。"),
            None
        );
        assert_eq!(
            watchdog_branch(
                "本轮巡检完成，判定**无事分支**（未派发、未报群、未 reset）。→ 关单分支不成立。"
            ),
            None
        );
        assert_eq!(
            watchdog_branch("巡检完成，本轮无事分支命中。① 关单：任务表「当前阶段」= 摇光发布中，非已关单 → 不命中"),
            None
        );
        assert_eq!(
            watchdog_branch("【本轮命中分支】漏派分支（SOP 9.2 第 2 分支）").as_deref(),
            Some("漏派")
        );
        assert_eq!(
            watchdog_branch("本轮巡检命中**漏派分支**（分支 2）").as_deref(),
            Some("漏派")
        );
        assert_eq!(
            watchdog_branch("本轮已命中并执行超时分支。").as_deref(),
            Some("超时")
        );
        assert_eq!(
            watchdog_branch("① 关单不命中（非「已关单」）；④ 超时命中。").as_deref(),
            Some("超时"),
            "贴脸的才是这一命中的主语，远处的分支名属于别的句子"
        );
        assert_eq!(
            watchdog_branch("分支 1 关单命中，任务全链路收尾。").as_deref(),
            Some("关单")
        );
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
            // 案号必须跟第一跳一致：这条线现在按案号切跳，写成别的案号
            // 就等于"用别人的关单话术关这一单"（串案），不该再算数。
            Some("BM-9997｜已关单：reset 6 个群会话、删除 watchdog job"),
            base + 10 * 60_000,
        );
        harvest_links_from_sessions(&db).expect("harvest");
        let list = list_cases(&db, None).expect("list");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].stage, "08_已关单");
    }
}
