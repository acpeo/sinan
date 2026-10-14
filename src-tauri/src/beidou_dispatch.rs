//! 北斗全自动派发层（Leo 2026-10-14 指挥舱改造）。
//!
//! 这一层只管两件事：把主理人在指挥舱里的动作变成网关动作。
//! 两条路径：
//!
//! ```text
//!   POST /api/tasks/direct-launch   →  direct_launch
//!     标题 + 交付模式 → 写飞书主表 tblGWeeAWrYadALt → sessions_send 唤醒天枢
//!
//!   POST /api/tasks/:id/append-video →  append_video
//!     仅图文案 + 母稿已冻结 → 模式升 DUAL → sessions_send 唤醒开阳追投
//! ```
//!
//! 三条铁律都在这里落地（Leo 逐条定的，缺一条就回退成错身份或炸错会话）：
//! 1) 跨星位唤醒只能走 OpenClaw `sessions_send`——群消息只作留痕，群里
//!    `@bot` 没有唤醒效力（实测过，喊了不动）。
//! 2) 任何 lark-cli 命令必须带 `--profile <agent_id> --as bot`，缺一个就
//!    抛错拦截。不拦的后果是回落成默认天枢身份，等于用天枢的手改玉衡的稿。
//! 3) 自愈/关单清会话只能 `reset`，不能 `compact`；且硬编码保护 `main`
//!    与 `cron` 两类会话不被重置——那是舵和锚，重置了整条链路失联。
//!
//! 本机没有 MSVC linker（Git Bash 的 link.exe 会抢戏），Rust 侧编译只能靠
//! CI 兜，所以这里刻意只写薄壳：参数校验、身份校验、payload 组装都做成
//! 可被 node 复算的纯函数，真正的 RPC 只有 `sessions_send` 一次调用。

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// 飞书多维表格主表（真相源）：一案一 ID、当前阶段、打回次数、产物链接。
pub const FEISHU_MASTER_TABLE: &str = "tblGWeeAWrYadALt";

/// 交付模式三态。与前端 cockpit.js 的 DELIVERABLE_MODES 同序同值——
/// 两边各写一份枚举，值必须一致（前端选 DUAL，后端写 IMAGE_ONLY = 白选）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DeliverableMode {
    ImageOnly,
    Dual,
    VideoOnly,
}

impl DeliverableMode {
    pub fn as_str(self) -> &'static str {
        match self {
            DeliverableMode::ImageOnly => "IMAGE_ONLY",
            DeliverableMode::Dual => "DUAL",
            DeliverableMode::VideoOnly => "VIDEO_ONLY",
        }
    }

    /// 认不出的模式回落仅图文（默认态）。宁可少做视频，不能凭空多花钱。
    pub fn from_raw(raw: Option<&str>) -> Self {
        match raw.map(|value| value.trim().to_uppercase()).as_deref() {
            Some("DUAL") | Some("BOTH") | Some("IMAGE_VIDEO") => DeliverableMode::Dual,
            Some("VIDEO_ONLY") | Some("VIDEO") => DeliverableMode::VideoOnly,
            _ => DeliverableMode::ImageOnly,
        }
    }

    pub fn wants_video(self) -> bool {
        matches!(self, DeliverableMode::Dual | DeliverableMode::VideoOnly)
    }
}

/// 入口模式：直接给标题发车 / 自主寻题巡航。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EntryMode {
    DirectTitle,
    AutoDiscovery,
}

impl EntryMode {
    pub fn as_str(self) -> &'static str {
        match self {
            EntryMode::DirectTitle => "DIRECT_TITLE",
            EntryMode::AutoDiscovery => "AUTO_DISCOVERY",
        }
    }
}

/// 标题末尾的视频标记词。前端剥离一份，后端再剥一次——两份都剥不是重复，
/// 是防前端漏改时后端别把「+视频」写进主表脏字段。
pub fn strip_dual_marker(raw: &str) -> String {
    let mut text = raw.trim().to_owned();
    loop {
        let before = text.clone();
        for marker in ["+视频", "双出", "含视频", "视频版", "也要视频", "加视频"] {
            let trimmed = text.trim_end();
            if let Some(stripped) = trimmed.strip_suffix(marker) {
                text = stripped.to_owned();
                break;
            }
        }
        // 收尾孤立连接符：剩「标题 -」这种半截符号也要吃掉
        let trimmed = text.trim_end();
        let cut = trimmed
            .char_indices()
            .rev()
            .find(|(_, ch)| !matches!(ch, ' ' | ',' | '，' | '、' | '/' | '|' | '+' | '-' | '-'))
            .map(|(index, _)| index + 1)
            .unwrap_or(0);
        text = trimmed[..cut].trim().to_owned();
        if text == before {
            break;
        }
    }
    text
}

/// 标题里是否含视频诉求（驱动模式强制升 DUAL）。
pub fn text_wants_dual(raw: &str) -> bool {
    ["+视频", "双出", "含视频", "视频版", "也要视频", "加视频"]
        .iter()
        .any(|marker| raw.contains(marker))
}

/// 一次算清发车参数：正式标题 + 最终交付模式 + 入口模式。
/// 标记词优先于显式选择——Leo 规格：末尾输入 +视频 自动切双出并剥离。
pub fn parse_launch(raw_title: &str, picked: Option<&str>) -> LaunchPlan {
    let title = strip_dual_marker(raw_title);
    let forced_dual = text_wants_dual(raw_title);
    let mode = if forced_dual {
        DeliverableMode::Dual
    } else {
        DeliverableMode::from_raw(picked)
    };
    LaunchPlan {
        title,
        deliverable_mode: mode,
        entry_mode: if forced_dual || picked.is_some() {
            EntryMode::DirectTitle
        } else {
            EntryMode::AutoDiscovery
        },
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaunchPlan {
    pub title: String,
    pub deliverable_mode: DeliverableMode,
    pub entry_mode: EntryMode,
}

impl LaunchPlan {
    /// 没有标题就不发车（不能往主表里写一条只有模式没有题的空案）。
    pub fn is_ready(&self) -> bool {
        !self.title.is_empty()
    }
}

/// 写飞书主表的一行（direct-launch 的落表 payload）。
/// 字段名与主表列一一对应；doc_id 类字段留空，等对应星位回填。
pub fn master_table_row(plan: &LaunchPlan, case_id: &str) -> Value {
    json!({
        "record_id": case_id,
        "title": plan.title,
        "entry_mode": plan.entry_mode.as_str(),
        "deliverable_mode": plan.deliverable_mode.as_str(),
        "stage": "01_建档",
        "first_strike": 0,
        "second_strike": 0,
        "master_doc_status": "NONE",
        "folder_url": Value::Null,
        "research_doc_id": Value::Null,
        "master_doc_id": Value::Null,
        "visual_doc_id": Value::Null,
        "video_doc_id": Value::Null,
        "ops_doc_id": Value::Null,
    })
}

// ---------------------------------------------------------------------------
// sessions_send 铁律校验
// ---------------------------------------------------------------------------

/// 跨星位唤醒只能走 sessions_send；群消息仅作留痕，群内 @bot 不具备唤醒效力。
/// 这一步只校验 payload 形状，真正的发送在 send_sessions_wakeup。
pub fn build_wakeup_payload(
    to_agent: &str,
    case_id: &str,
    instruction: &str,
    deliverable_mode: DeliverableMode,
) -> Result<Value> {
    let agent = to_agent.trim();
    if agent.is_empty() {
        bail!("sessions_send requires a target agent");
    }
    // CASE_ID 必须是规范形（BM-xxxx）：beidou_cases::extract_case_id 只认
    // 带标签的规范编号，这里先卡一道，别把自由文本当案件号发出去。
    if !is_case_id(case_id) {
        bail!("case id must look like BM-xxxx, got {case_id:?}");
    }
    let mode_tag = deliverable_mode.as_str();
    Ok(json!({
        "to": agent,
        // CASE_ID 标签是本地归拢的唯一凭据（beidou_cases 的正则靠它）
        "text": format!("[CASE_ID: {case_id}] [DELIVERABLE: {mode_tag}]\n{instruction}"),
        "deliverable_mode": mode_tag,
        "case_id": case_id,
    }))
}

/// 案件编号规范形：BM- 后接 3-6 位字母数字。
/// 刻意不认裸编号——真机 70 行结论里裸兜底会命中 LARK-CLI / QWEN-IMAGE /
/// SDXL-API 这类工具名，误拢比拢不上更糟。
pub fn is_case_id(raw: &str) -> bool {
    let text = raw.trim();
    if !text.starts_with("BM-") {
        return false;
    }
    let tail = &text[3..];
    if tail.len() < 3 || tail.len() > 6 {
        return false;
    }
    tail.chars().all(|ch| ch.is_ascii_alphanumeric())
}

/// lark-cli 命令铁律：必须带 `--profile <agent_id> --as bot`。
/// 缺一个就抛错——回落默认身份等于用天枢的手改玉衡的稿。
pub fn assert_lark_identity(args: &[String]) -> Result<()> {
    let has_profile = args
        .iter()
        .position(|value| value == "--profile")
        .and_then(|index| args.get(index + 1))
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);
    if !has_profile {
        bail!("lark-cli must run with --profile <agent_id>: missing profile falls back to default tianshu identity");
    }
    let as_bot = args
        .iter()
        .position(|value| value == "--as")
        .and_then(|index| args.get(index + 1))
        .map(|value| value == "bot")
        .unwrap_or(false);
    if !as_bot {
        bail!("lark-cli must run with --as bot: user identity cannot write to the master table");
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Session reset 安全锁
// ---------------------------------------------------------------------------

/// 硬编码保护：这两类会话永不被 reset。main 是舵（对话救援入口），
/// cron 是锚（排程器本身）——重置任一个，整条北斗链路失联。
pub fn is_protected_session(session_key: &str) -> bool {
    let key = session_key.trim();
    if key.is_empty() {
        return true;
    }
    // agent:tianshu:main / agent:tianshu:cron:j1 两种形态都护
    key.ends_with(":main") || key.contains(":main:") || key.ends_with(":cron") || key.contains(":cron:")
}

/// 自愈/关单的会话清理：只准 reset，不准 compact。
/// compact 是压缩上下文留摘要，会话还连着旧的错误结论；reset 才真清干净。
pub fn assert_reset_not_compact(action: &str) -> Result<()> {
    match action.trim().to_uppercase().as_str() {
        "RESET" => Ok(()),
        "COMPACT" => bail!("auto-heal must reset the session, not compact: compact keeps the stale verdict context"),
        other => bail!("unknown session action {other:?}: expected RESET"),
    }
}

// ---------------------------------------------------------------------------
// 一键追投视频的前置校验
// ---------------------------------------------------------------------------

/// 追投视频的门槛：仅图文案 + 母稿已冻结（二审 PASS）。
/// 没冻结就追投 = 让开阳基于一份还会改的母稿干活，白做一遍。
pub fn can_append_video(deliverable_mode: DeliverableMode, master_doc_status: &str) -> bool {
    deliverable_mode == DeliverableMode::ImageOnly
        && matches!(master_doc_status.trim().to_uppercase().as_str(), "FROZEN" | "READONLY" | "PASS")
}

/// 追投 payload：模式升 DUAL + 读冻结母稿 docx 链接唤醒开阳。
pub fn append_video_payload(case_id: &str, master_doc_url: &str) -> Result<Value> {
    if !is_case_id(case_id) {
        bail!("case id must look like BM-xxxx, got {case_id:?}");
    }
    if master_doc_url.trim().is_empty() {
        bail!("cannot append video without the frozen master doc url");
    }
    build_wakeup_payload(
        "kaiyang",
        case_id,
        &format!("基于冻结母稿追投视频包（无需重跑前序节点）：{master_doc_url}"),
        DeliverableMode::Dual,
    )
}

// ---------------------------------------------------------------------------
// 单元测试（node 侧已复算一份；这里保 Rust 侧同口径）
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_dual_marker_and_keeps_title_clean() {
        assert_eq!(strip_dual_marker("玄关别堆杂物 +视频"), "玄关别堆杂物");
        assert_eq!(strip_dual_marker("餐边柜 双出"), "餐边柜");
        assert_eq!(strip_dual_marker("标题 -"), "标题");
        assert_eq!(strip_dual_marker("视频拍摄入门指南"), "视频拍摄入门指南");
        assert_eq!(strip_dual_marker(""), "");
    }

    #[test]
    fn marker_forces_dual_over_explicit_pick() {
        let plan = parse_launch("玄关 +视频", Some("IMAGE_ONLY"));
        assert_eq!(plan.title, "玄关");
        assert_eq!(plan.deliverable_mode, DeliverableMode::Dual);
        assert!(plan.is_ready());
    }

    #[test]
    fn empty_title_is_not_ready() {
        let plan = parse_launch("   ", Some("IMAGE_ONLY"));
        assert!(!plan.is_ready());
        let marker_only = parse_launch("+视频", None);
        assert_eq!(marker_only.title, "");
        assert!(!marker_only.is_ready());
    }

    #[test]
    fn unknown_mode_falls_back_to_image_only() {
        assert_eq!(DeliverableMode::from_raw(None), DeliverableMode::ImageOnly);
        assert_eq!(DeliverableMode::from_raw(Some("garbage")), DeliverableMode::ImageOnly);
        assert_eq!(DeliverableMode::from_raw(Some("dual")), DeliverableMode::Dual);
    }

    #[test]
    fn case_id_only_accepts_prefixed_form() {
        assert!(is_case_id("BM-2601"));
        assert!(is_case_id("bm-2601"));
        assert!(!is_case_id("LARK-CLI"));
        assert!(!is_case_id("QWEN-IMAGE"));
        assert!(!is_case_id("BM-1"));
        assert!(!is_case_id("BM-1234567"));
        assert!(!is_case_id(""));
    }

    #[test]
    fn wakeup_payload_carries_case_id_tag() {
        let payload = build_wakeup_payload(
            "tianshu",
            "BM-2601",
            "建档并派单",
            DeliverableMode::ImageOnly,
        )
        .expect("payload");
        let text = payload.get("text").and_then(Value::as_str).expect("text");
        assert!(text.contains("[CASE_ID: BM-2601]"));
        assert!(text.contains("[DELIVERABLE: IMAGE_ONLY]"));
    }

    #[test]
    fn wakeup_rejects_bad_case_id() {
        let error = build_wakeup_payload("tianshu", "TOOL-IMAGE", "x", DeliverableMode::ImageOnly)
            .expect_err("must reject");
        assert!(error.to_string().contains("BM-xxxx"));
    }

    #[test]
    fn lark_identity_is_mandatory() {
        let ok = vec!["drive".to_owned(), "--profile".to_owned(), "yuheng".to_owned(), "--as".to_owned(), "bot".to_owned()];
        assert!(assert_lark_identity(&ok).is_ok());

        let no_profile = vec!["drive".to_owned(), "--as".to_owned(), "bot".to_owned()];
        let error = assert_lark_identity(&no_profile).expect_err("missing profile");
        assert!(error.to_string().contains("--profile"));

        let no_bot = vec!["drive".to_owned(), "--profile".to_owned(), "yuheng".to_owned()];
        assert!(assert_lark_identity(&no_bot).is_err());
    }

    #[test]
    fn protected_sessions_are_never_reset() {
        assert!(is_protected_session("agent:tianshu:main"));
        assert!(is_protected_session("agent:tianshu:cron:j1"));
        assert!(is_protected_session(""));
        assert!(!is_protected_session("agent:tianji:feishu:group:oc_b15d1b110f2473c56fd31373fc88da6a"));
    }

    #[test]
    fn auto_heal_resets_but_never_compacts() {
        assert!(assert_reset_not_compact("RESET").is_ok());
        let error = assert_reset_not_compact("COMPACT").expect_err("compact not allowed");
        assert!(error.to_string().contains("not compact"));
        assert!(assert_reset_not_compact("DELETE").is_err());
    }

    #[test]
    fn append_video_requires_frozen_master_doc() {
        assert!(can_append_video(DeliverableMode::ImageOnly, "FROZEN"));
        assert!(!can_append_video(DeliverableMode::ImageOnly, "NONE"));
        assert!(!can_append_video(DeliverableMode::ImageOnly, "REJECTED"));
        // 已是双出的案子不用追投
        assert!(!can_append_video(DeliverableMode::Dual, "FROZEN"));
    }

    #[test]
    fn append_video_payload_wakes_kaiyang() {
        let payload = append_video_payload("BM-2605", "https://my.feishu.cn/docx/CYeOddF3UosU8Wx0a04cSBDMnBe")
            .expect("payload");
        assert_eq!(payload.get("to").and_then(Value::as_str), Some("kaiyang"));
        assert_eq!(payload.get("deliverable_mode").and_then(Value::as_str), Some("DUAL"));
        assert!(append_video_payload("BM-2605", "").is_err());
    }

    #[test]
    fn master_table_row_has_all_columns() {
        let plan = parse_launch("餐边柜别贴墙", None);
        let row = master_table_row(&plan, "BM-2604");
        assert_eq!(row.get("record_id").and_then(Value::as_str), Some("BM-2604"));
        assert_eq!(row.get("title").and_then(Value::as_str), Some("餐边柜别贴墙"));
        assert_eq!(row.get("entry_mode").and_then(Value::as_str), Some("AUTO_DISCOVERY"));
        assert_eq!(row.get("deliverable_mode").and_then(Value::as_str), Some("IMAGE_ONLY"));
        assert_eq!(row.get("master_doc_status").and_then(Value::as_str), Some("NONE"));
    }
}
