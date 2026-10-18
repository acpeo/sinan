//! 司南（Sinan）— 北斗任务台。
//!
//! 从 Metrik 分叉里整搬出来的任务追踪体：
//! - 网关任务台账 + cron 镜像 + 会话工作台账（gateway_tasks 模块，原样）；
//! - 任务小组件窗（tasks-widget）、自绘提醒角标窗（notifications）两个常驻窗；
//! - 主窗 = 任务台（任务页 + 监控/网关/外观设置）。
//!
//! 用量统计留在 Metrik 本尊，两边互不依赖，只共读同一个 openclaw 网关。

mod beidou_cases;
mod beidou_dispatch;
mod gateway_tasks;

use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager, State};

const DATABASE_FILE_NAME: &str = "sinan.sqlite3";
/// 旧 Metrik 的数据目录与账本名：首启时把旧任务台账搬过来，历史不断档。
const LEGACY_APP_IDENTIFIER: &str = "app.metrik.desktop";
const LEGACY_DATABASE_FILE_NAME: &str = "metrik.sqlite3";

struct AppState {
    database_path: PathBuf,
    /// 网关快照互斥：任务/cron/agents 三路快照共享一把闸，避免并发握手。
    scan_gate: Arc<Mutex<()>>,
}

// ---------------------------------------------------------------------------
// 本地账本连接（与 Metrik storage.rs 同一套语义的精简版）
// ---------------------------------------------------------------------------

fn open_database(path: &Path) -> Result<Connection, String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create app data directory {}: {error}",
                parent.display()
            )
        })?;
    }
    let connection = Connection::open(path)
        .map_err(|error| format!("failed to open task ledger {}: {error}", path.display()))?;
    connection
        .pragma_update(None, "busy_timeout", 5_000_i64)
        .map_err(|error| error.to_string())?;
    Ok(connection)
}

/// 只读连接：绝不建库、绝不跑迁移写——账本还没落盘时显式报错，
/// 而不是悄悄造一个空账本。
fn open_database_read_only(path: &Path) -> Result<Connection, String> {
    use rusqlite::OpenFlags;
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| {
        format!(
            "failed to open task ledger read-only {}: {error}",
            path.display()
        )
    })?;
    connection
        .pragma_update(None, "busy_timeout", 5_000_i64)
        .map_err(|error| error.to_string())?;
    Ok(connection)
}

/// 首启搬迁：sinan 账本不存在而旧 Metrik 账本存在时，整文件拷过来。
/// 表结构同源（gateway_task/session_run/gateway_cron 建表语句一致），
/// 拷贝即兼容；缺列由 gateway_tasks 的 ensure 兜底补齐。
fn import_legacy_ledger(local_dir: &Path, target: &Path) {
    if target.exists() {
        return;
    }
    let data_root = match local_dir.parent() {
        Some(root) => root.to_path_buf(),
        None => return,
    };
    for root in [
        data_root.join(LEGACY_APP_IDENTIFIER),
        PathBuf::from(LEGACY_APP_IDENTIFIER),
    ] {
        let legacy = root.join(LEGACY_DATABASE_FILE_NAME);
        if !legacy.exists() {
            continue;
        }
        if std::fs::copy(&legacy, target).is_ok() {
            eprintln!(
                "sinan imported legacy task ledger from {}",
                legacy.display()
            );
            for suffix in ["-wal", "-shm"] {
                let source = legacy.with_file_name(format!("{LEGACY_DATABASE_FILE_NAME}{suffix}"));
                if source.exists() {
                    let _ = std::fs::copy(
                        &source,
                        target.with_file_name(format!("{DATABASE_FILE_NAME}{suffix}")),
                    );
                }
            }
            return;
        }
    }
}

// ---------------------------------------------------------------------------
// 窗口生命周期：任务小组件 / 提醒角标（与 Metrik 同一套纪律）
// ---------------------------------------------------------------------------

/// 任务小组件显隐广播：托盘/设置/自身关闭三条路都汇到这里广播，前端据以
/// 同步勾选（监听方要幂等——emit 会回到发送方）。
const TASK_WIDGET_VISIBILITY: &str = "tasks://tasks-widget-visibility";

/// 托盘「任务小组件」勾选态句柄：set_tasks_widget_window 每次显隐后回写，
/// 菜单勾选 = 窗实际可见性（Leo 2026-10-06：托盘项看不出开关 = 逻辑毛病之一）。
static TASKS_WIDGET_MENU: std::sync::OnceLock<
    Mutex<Option<tauri::menu::CheckMenuItem<tauri::Wry>>>,
> = std::sync::OnceLock::new();

fn set_tasks_widget_menu_checked(checked: bool) {
    if let Some(cell) = TASKS_WIDGET_MENU.get() {
        if let Ok(guard) = cell.lock() {
            if let Some(item) = guard.as_ref() {
                let _ = item.set_checked(checked);
            }
        }
    }
}

/// 首次创建任务小组件窗（仅在 label 未被占用时调用）。
fn spawn_tasks_widget_window(app: &tauri::AppHandle) -> Result<(), String> {
    let mut builder = tauri::WebviewWindowBuilder::new(
        app,
        "tasks-widget",
        tauri::WebviewUrl::App("index.html?view=tasks".into()),
    )
    .title("司南 · 任务小组件")
    .inner_size(320.0, 384.0)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    // 展开面板允许拖拽调宽高（JS 侧在展开/折叠时动态开合尺寸边界）。
    .resizable(true)
    .skip_taskbar(true)
    .focused(false);
    // 锚在任务台窗右缘外 8px 同一高度；贴右/贴下时按当前显示器收口。
    if let Some(main) = app.get_webview_window("main") {
        if let (Ok(outer), Ok(outer_size)) = (main.outer_position(), main.outer_size()) {
            let scale = main.scale_factor().unwrap_or(1.0);
            let mut x = outer.x as f64 / scale + outer_size.width as f64 / scale + 8.0;
            let mut y = outer.y as f64 / scale;
            if let Ok(Some(monitor)) = main.current_monitor() {
                let screen_w = monitor.size().width as f64 / scale;
                let screen_h = monitor.size().height as f64 / scale;
                let origin_x = monitor.position().x as f64 / scale;
                let origin_y = monitor.position().y as f64 / scale;
                x = x.clamp(origin_x, (origin_x + screen_w - 320.0).max(origin_x));
                y = y.clamp(origin_y, (origin_y + screen_h - 384.0).max(origin_y));
            }
            builder = builder.position(x, y);
        }
    }
    builder.build().map_err(|error| error.to_string())?;
    Ok(())
}

/// 任务小组件显隐开关（幂等）：窗已存在就只 show/hide，绝不销毁重建——
/// 同一 label 首建成功后关掉再建就再也弹不出来（Metrik 0.20.6 实测坑）。
/// 必须 async command：sync command 建窗在 Windows 上经典死锁（0.20.5 教训）。
#[tauri::command]
async fn set_tasks_widget_window(app: tauri::AppHandle, visible: bool) -> Result<(), String> {
    match app.get_webview_window("tasks-widget") {
        Some(window) => {
            if visible {
                let _ = window.unminimize();
                let _ = window.show();
            } else {
                let _ = window.hide();
            }
        }
        None => {
            if visible {
                spawn_tasks_widget_window(&app)?;
            }
        }
    }
    if visible {
        // 星卡伴随窗跟小组件同生死：组件窗起来就备好（隐藏待命），首次悬停
        // 才建会有 WebView 冷启动延迟，首卡弹不出来。
        let _ = ensure_hop_card_window(&app);
    } else {
        // 组件收起时星卡必须跟着走，别让它孤悬屏上变成"幽灵卡"。
        if let Some(hop_card) = app.get_webview_window(HOP_CARD_WINDOW) {
            let _ = hop_card.hide();
        }
    }
    set_tasks_widget_menu_checked(visible);
    app.emit(TASK_WIDGET_VISIBILITY, visible)
        .map_err(|error| error.to_string())?;
    Ok(())
}

/// 任务台窗唤到前台（提醒卡点击的兜底跳转目标）。
fn focus_main_window(app: &tauri::AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.unminimize();
        let _ = main.set_focus();
    }
}

// ---------------------------------------------------------------------------
// 悬停星卡伴随窗（tasks-hopcard）：独立置顶穿透小窗
// ---------------------------------------------------------------------------

const HOP_CARD_WINDOW: &str = "tasks-hopcard";
const HOP_CARD_POLL: &str = "hopcard://poll";
const HOP_CARD_HEIGHT_EVENT: &str = "hopcard://height";

/// 待渲染卡载荷（JSON 串）。胶囊 invoke show_hop_card 存入 → 卡窗 take 走
/// （take 即清空：poll 信号与挂载兜底两条路只送达一次，不重不漏）。
static HOP_CARD_PAYLOAD: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

/// 卡窗最近实测内容高（逻辑 px）：横条上下放卡按它定窗高，估计越准
/// 卡与条的 6px 间隙越贴脸。经 hopcard://height 回传胶囊窗记忆。
static HOP_CARD_LAST_HEIGHT: std::sync::Mutex<f64> = std::sync::Mutex::new(0.0);

/// 建（或复用）悬停星卡窗：隐藏待命、鼠标穿透、置顶。悬停期间胶囊窗
/// 零 resize——WebView2 重排滞后一帧的伪影失去物理载体（b23d4b6 方向
/// 修正只能消位移消不掉 resize 本身，Leo 装机三轮实锤后的根治）。
fn ensure_hop_card_window(
    app: &tauri::AppHandle,
) -> Result<tauri::WebviewWindow<tauri::Wry>, String> {
    if let Some(window) = app.get_webview_window(HOP_CARD_WINDOW) {
        return Ok(window);
    }
    let window = tauri::WebviewWindowBuilder::new(
        app,
        HOP_CARD_WINDOW,
        tauri::WebviewUrl::App("index.html?view=hopcard".into()),
    )
    .title("司南 · 星卡")
    .inner_size(224.0, 460.0)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .resizable(false)
    .skip_taskbar(true)
    .focused(false)
    .always_on_top(true)
    // 创建后隐藏待命：悬停时先在隐藏态定位/定尺寸/喂载荷，画完一帧才显形。
    .visible(false)
    .build()
    .map_err(|error| error.to_string())?;
    let _ = window.set_ignore_cursor_events(true);
    #[cfg(windows)]
    make_hop_card_unactivatable(&window);
    Ok(window)
}

/// WS_EX_NOACTIVATE|WS_EX_TOOLWINDOW：show() 绝不抢焦点——Leo 正在打字/
/// 操作别的窗时悬停弹卡不能把前台打掉。focused(false) 只管首建一瞬，
/// show 仍会激活，必须补样式位。
#[cfg(windows)]
fn make_hop_card_unactivatable(window: &tauri::WebviewWindow<tauri::Wry>) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
    };
    if let Ok(hwnd) = window.hwnd() {
        unsafe {
            let handle = HWND(hwnd.0 as *mut _);
            let ex = GetWindowLongPtrW(handle, GWL_EXSTYLE) as u32;
            SetWindowLongPtrW(
                handle,
                GWL_EXSTYLE,
                (ex | WS_EX_NOACTIVATE.0 | WS_EX_TOOLWINDOW.0) as isize,
            );
        }
    }
}

/// 胶囊侧悬停开卡：定位+定尺寸（隐藏态下改，零伪影）→ 存载荷 → 通知卡窗
/// 来取。不在此处 show——等卡窗画完一帧回 hop_card_ready 再显形，杜绝
/// "闪一张上一颗星的旧卡"。
#[tauri::command]
async fn show_hop_card(
    app: tauri::AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    payload: String,
) -> Result<(), String> {
    let window = ensure_hop_card_window(&app)?;
    let _ = window.set_size(tauri::LogicalSize::new(width, height));
    let _ = window.set_position(tauri::LogicalPosition::new(x, y));
    if let Ok(mut cell) = HOP_CARD_PAYLOAD.lock() {
        *cell = Some(payload);
    }
    app.emit_to(HOP_CARD_WINDOW, HOP_CARD_POLL, ())
        .map_err(|error| error.to_string())?;
    Ok(())
}

/// 卡窗取载荷：挂载与 poll 两条路都走这里，take 即清空，恰好一次送达。
#[tauri::command]
fn hop_card_take_payload() -> Option<String> {
    let mut cell = HOP_CARD_PAYLOAD.lock().ok()?;
    cell.take()
}

/// 卡窗画好一帧的回执：此刻才显形。对已可见的窗什么都不做——数据活刷新
/// 会重复走 show→取载荷→ready，重断言置顶只会搅动 z 序。
#[tauri::command]
async fn hop_card_ready(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(HOP_CARD_WINDOW) {
        let already_visible = window.is_visible().unwrap_or(false);
        if !already_visible {
            let _ = window.set_ignore_cursor_events(true);
            let _ = window.show();
            let _ = window.set_always_on_top(true);
        }
    }
    Ok(())
}

#[tauri::command]
async fn hide_hop_card(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(HOP_CARD_WINDOW) {
        let _ = window.hide();
    }
    Ok(())
}

/// 卡窗实测内容高回传：横条上下放卡按它定窗高。
#[tauri::command]
fn hop_card_report_height(app: tauri::AppHandle, height: f64) -> Result<(), String> {
    if let Ok(mut cell) = HOP_CARD_LAST_HEIGHT.lock() {
        *cell = height;
    }
    app.emit_to("tasks-widget", HOP_CARD_HEIGHT_EVENT, height)
        .map_err(|error| error.to_string())
}

/// 前端探测卡窗命令面是否可用：真机 Tauri=true；浏览器预览与复现台
/// （invoke 桩没有这些命令）回 false → 悬停卡走窗内 Portal 预览路径。
#[tauri::command]
fn hop_card_ping() -> bool {
    true
}

// ---------------------------------------------------------------------------
// 自绘提醒角标窗
// ---------------------------------------------------------------------------

const NOTIFICATION_VISIBILITY: &str = "tasks://notification-visibility";
const NOTIFICATION_WINDOW_W: f64 = 344.0;
const NOTIFICATION_WINDOW_H: f64 = 330.0;

fn spawn_notification_window(app: &tauri::AppHandle) -> Result<(), String> {
    let builder = tauri::WebviewWindowBuilder::new(
        app,
        "notifications",
        tauri::WebviewUrl::App("index.html?view=notifications".into()),
    )
    .title("司南 · 提醒")
    .inner_size(NOTIFICATION_WINDOW_W, NOTIFICATION_WINDOW_H)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .resizable(false)
    .skip_taskbar(true)
    .focused(false)
    .always_on_top(true)
    // 创建后隐藏待命：卡堆由前端自管显隐（空=藏、来卡=弹），总开关只管生死。
    .visible(false);
    let builder = if let Some(main) = app.get_webview_window("main") {
        let scale = main.scale_factor().unwrap_or(1.0);
        if let Ok(Some(monitor)) = main.current_monitor() {
            let screen_w = monitor.size().width as f64 / scale;
            let screen_h = monitor.size().height as f64 / scale;
            let origin_x = monitor.position().x as f64 / scale;
            let origin_y = monitor.position().y as f64 / scale;
            let x = (origin_x + screen_w - NOTIFICATION_WINDOW_W - 16.0).max(origin_x);
            let y = (origin_y + screen_h - NOTIFICATION_WINDOW_H - 50.0).max(origin_y);
            builder.position(x, y)
        } else {
            builder
        }
    } else {
        builder
    };
    builder.build().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
async fn set_notification_window(app: tauri::AppHandle, visible: bool) -> Result<(), String> {
    match app.get_webview_window("notifications") {
        Some(window) => {
            // 显隐由前端按卡堆自管（空=藏、来卡=弹）；总开关只负责"藏"和
            // "确保窗已创建"，不主动 show 空窗。
            if !visible {
                let _ = window.hide();
            }
        }
        None => {
            if visible {
                spawn_notification_window(&app)?;
            }
        }
    }
    app.emit(NOTIFICATION_VISIBILITY, visible)
        .map_err(|error| error.to_string())?;
    Ok(())
}

/// 提醒卡点击的跳转仲裁：任务小组件窗在 → 广播展开面板；
/// 不在 → 唤任务台。监听方各自幂等。
#[tauri::command]
fn expand_round_details(app: tauri::AppHandle) -> Result<(), String> {
    match app.get_webview_window("tasks-widget") {
        Some(widget) => {
            let _ = widget.show();
            let _ = widget.unminimize();
            let _ = app.emit("tasks://panel-expand", ());
        }
        None => {
            focus_main_window(&app);
            let _ = app.emit("tasks://nav-tasks", ());
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// 网关命令：任务台账 / cron 镜像 / 会话台账
// ---------------------------------------------------------------------------

/// 一个被追踪的 Gateway 连接配置（设置面板下发）。
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayTargetConfig {
    pub label: String,
    pub url: String,
    pub token: String,
    /// 本机身份可省略（用默认 state 目录）；VPS 为其单独生成一套。
    #[serde(default)]
    pub identity_dir: Option<PathBuf>,
}

/// 单个 Gateway 的拉取结果视图（成功/失败 + 原因）。cron 快照与星位快照
/// 共用：前端的连接灯只认这些 results，不再绑任务快照空壳。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayTaskView {
    pub gateway: String,
    pub ok: bool,
    pub task_count: usize,
    pub error: Option<String>,
}

/// gateway_agents_snapshot 的返回：Agent 活动卡 + 会话级用量明细 +
/// 分网关成败（连接灯的真话来源——2026-10-08 前 live 绑在
/// gateway_task_snapshot 空壳上，主窗与胶囊各说各话）。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayAgentsPayload {
    pub agents: Vec<gateway_tasks::AgentActivity>,
    pub sessions: Vec<gateway_tasks::SessionUsage>,
    pub results: Vec<GatewayTaskView>,
}

/// 星位快照的全局合并缓存：主窗与小组件两路 3 秒轮询共享——2.5 秒内
/// 第二个到达的调用直接回放上一份载荷，不再真连网关。此前两窗各拉各的
/// 全量（握手+会话清单+审计+聊天），scan_gate 常年饱和，排队超看门狗就
/// 被误判断线（胶囊假"未同步"的土壤，也是"胶囊比主窗慢"的旧病根）。
/// key 含网关标签与账本口径，配置一换缓存自动失效；force=手动同步直通。
struct CachedAgentsSnapshot {
    key: String,
    at: std::time::Instant,
    payload: GatewayAgentsPayload,
}

static AGENTS_SNAPSHOT_CACHE: std::sync::LazyLock<Mutex<Option<CachedAgentsSnapshot>>> =
    std::sync::LazyLock::new(|| Mutex::new(None));

const AGENTS_SNAPSHOT_MIN_INTERVAL_MS: u128 = 2_500;

fn gateway_target(target: &GatewayTargetConfig) -> gateway_tasks::GatewayTarget {
    gateway_tasks::GatewayTarget {
        label: target.label.clone(),
        url: target.url.clone(),
        token: target.token.clone(),
        identity_dir: target.identity_dir.clone(),
    }
}

/// 拉一次定时任务列表并落本地镜像（cron.list，operator.read 即可读）。
/// 60 秒全局合并节流（按网关标签记时，两窗共享）：看板数据变化以分钟计，
/// 不值得让两路轮询各自握手。force=手动同步时直通。
#[tauri::command]
async fn gateway_cron_snapshot(
    gateways: Vec<GatewayTargetConfig>,
    force: Option<bool>,
    state: State<'_, AppState>,
) -> Result<Vec<GatewayTaskView>, String> {
    let database_path = state.database_path.clone();
    let scan_gate = Arc::clone(&state.scan_gate);
    let force = force.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || {
        let _gate = scan_gate
            .lock()
            .map_err(|_| "scan lock poisoned".to_owned())?;
        let connection = open_database(&database_path)?;
        let mut views = Vec::new();
        for target in &gateways {
            let gw = gateway_target(target);
            match gateway_tasks::snapshot_gateway_crons_throttled(&connection, &gw, force) {
                Ok(_) => views.push(GatewayTaskView {
                    gateway: target.label.clone(),
                    ok: true,
                    task_count: 0,
                    error: None,
                }),
                Err(error) => views.push(GatewayTaskView {
                    gateway: target.label.clone(),
                    ok: false,
                    task_count: 0,
                    error: Some(error.to_string()),
                }),
            }
        }
        Ok(views)
    })
    .await
    .map_err(|error| format!("gateway cron snapshot failed: {error}"))?
}

/// 读本地任务账本（不联网）：任务页数据源。按 first_seen 倒序，可选状态过滤。
#[tauri::command]
fn gateway_task_list(
    status: Option<String>,
    limit: Option<u32>,
    state: State<'_, AppState>,
) -> Result<Vec<gateway_tasks::GatewayTaskRow>, String> {
    let connection = open_database_read_only(&state.database_path)?;
    gateway_tasks::list_tasks(&connection, status.as_deref(), limit)
        .map_err(|error| error.to_string())
}

/// 读本地会话工作台账（不联网）：群聊派活等会话 run 的结构化记录。
#[tauri::command]
fn session_run_list(
    limit: Option<u32>,
    state: State<'_, AppState>,
) -> Result<Vec<gateway_tasks::SessionRunRow>, String> {
    let connection = open_database_read_only(&state.database_path)?;
    gateway_tasks::list_session_runs(&connection, limit).map_err(|error| error.to_string())
}

// ---------------------------------------------------------------------------
// 北斗全自动派发（指挥舱「命题直通发车」与「一键追投视频」）
//
// 两个命令都是薄壳：参数校验与 payload 组装在 beidou_dispatch 里（纯函数，
// node 侧已同口径复算 37 例），这里只负责落本地账本 + 转给网关。
// 真机 sessions_send 走 gateway_tasks 的 WS 客户端，群消息仅作留痕。
// ---------------------------------------------------------------------------

/// direct-launch 回包：主理人要看到「车发出去了」的凭据，不是一个空 200。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DirectLaunchResult {
    case_id: String,
    title: String,
    deliverable_mode: String,
    entry_mode: String,
    /// 已落到本地账本的案件行数（0 = 只算了参数没落库，属于失败）
    mirrored_rows: usize,
    /// 主表行预览（写飞书前的 payload，出问题能照着查）
    master_row: serde_json::Value,
    /// 是否真发到了网关（false = 只落了本地流水，前端要如实说"没发出去"）
    sent: bool,
    /// 网关回执的 runId：出了问题照这个查是哪一次唤醒。
    run_id: Option<String>,
    /// 发送失败的原因（sent=false 时非空）。
    send_error: Option<String>,
}

/// direct-launch 入参。deliverable_mode 缺省按仅图文（前端三态胶囊的默认态）。
#[derive(serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DirectLaunchParams {
    title: String,
    deliverable_mode: Option<String>,
    /// 目标平台（小红书/公众号…）。现在只作主表留痕不参与路由，但字段要
    /// 收着——前端已经发了，后端悄悄丢掉会让"我明明选了平台"变成幻觉。
    #[serde(default)]
    #[allow(dead_code)]
    target_platforms: Vec<String>,
    /// 要连的网关（设置面板那份配置原样下发）。缺省 = 不真发，
    /// 只落本地流水——浏览器/无配置时不能假装车发出去了。
    #[serde(default)]
    gateways: Vec<GatewayTargetConfig>,
}

/// 命题直通发车：标题 + 交付模式 → 本地镜像 + 唤醒天枢。
/// 标题末尾的 +视频/双出 标记词在这里二次剥离并强制升 DUAL——
/// 前端剥一次是给眼睛看的，后端再剥一次是保证写进主表的标题干净。
#[tauri::command]
fn beidou_direct_launch(
    params: DirectLaunchParams,
    state: State<'_, AppState>,
) -> Result<DirectLaunchResult, String> {
    let plan = beidou_dispatch::parse_launch(&params.title, params.deliverable_mode.as_deref());
    if !plan.is_ready() {
        return Err("标题为空：剥掉视频标记词后没有可发车的内容".to_owned());
    }
    // 案件号由本地账本分配（飞书 record_id 回填前先用 BM-xxxx 桥接主键）。
    let case_id = {
        let connection = open_database_read_only(&state.database_path)?;
        beidou_cases::next_case_id(&connection).map_err(|error| error.to_string())?
    };
    let master_row = beidou_dispatch::master_table_row(&plan, &case_id);
    let mirrored = {
        let connection = open_database(&state.database_path).map_err(|error| error.to_string())?;
        beidou_cases::ensure_case_tables(&connection).map_err(|error| error.to_string())?;
        beidou_cases::upsert_case_from_master_row(&connection, &master_row)
            .map_err(|error| error.to_string())?
    };
    // 唤醒天枢走 sessions_send（铁律一）：群消息仅作留痕，@bot 不唤醒。
    let wakeup = beidou_dispatch::build_wakeup_payload(
        "tianshu",
        &case_id,
        "建档并派单：按 SOP 建任务文件夹、写主表、派发天璇",
        plan.deliverable_mode,
    )
    .map_err(|error| error.to_string())?;
    // 铁律二：写飞书主表的 lark-cli 必须带本星位身份，缺一个就整个派发失败。
    // 不拦的后果是回落成默认天枢身份——等于用天枢的手去建这一案的文件夹。
    beidou_dispatch::assert_lark_identity(&[
        "drive".to_owned(),
        "--profile".to_owned(),
        "tianshu".to_owned(),
        "--as".to_owned(),
        "bot".to_owned(),
    ])
    .map_err(|error| error.to_string())?;
    // 落一条派发流水（本地可见的"已唤醒"凭据；真发送在下一段）。
    {
        let connection = open_database(&state.database_path).map_err(|error| error.to_string())?;
        beidou_cases::record_wakeup(&connection, &case_id, &wakeup)
            .map_err(|error| error.to_string())?;
    }
    // 真发送：向天枢的群会话发 sessions.send（2026-10-15 实测真形）。
    // 失败不回滚本地流水——账本留痕 + 如实上报，让主理人知道要重试。
    let (sent, run_id, send_error) = send_wakeup_to_star(
        &params.gateways,
        "tianshu",
        &case_id,
        wakeup
            .get("text")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default(),
    );
    Ok(DirectLaunchResult {
        case_id,
        title: plan.title.clone(),
        deliverable_mode: plan.deliverable_mode.as_str().to_owned(),
        entry_mode: plan.entry_mode.as_str().to_owned(),
        mirrored_rows: mirrored,
        master_row,
        sent,
        run_id,
        send_error,
    })
}

/// 把一条唤醒真正发到某颗星位的群会话。
///
/// 返回 (是否发出, runId, 失败原因)。三类"没发"都如实区分：
/// - 没配网关 → 前端显示"未连接网关"，别让人以为车发出去了；
/// - 该星位在网关上找不到群会话 → 键解析失败，报出星位名；
/// - 网关真拒 → 原样透传它的错误文案（那是唯一的线索）。
///
/// 多网关时取第一个配了的——北斗只有一套，配多个是 Metrik 多机追踪的形态，
/// 唤醒不能群发（一发就是全舰队同时开工）。
fn send_wakeup_to_star(
    gateways: &[GatewayTargetConfig],
    agent_id: &str,
    case_id: &str,
    instruction: &str,
) -> (bool, Option<String>, Option<String>) {
    let Some(target) = gateways.iter().find(|entry| !entry.url.trim().is_empty()) else {
        return (
            false,
            None,
            Some("未配置网关：只在本地落了派发流水，没有真发出去".to_owned()),
        );
    };
    let gw = gateway_target(target);
    let message = format!("[CASE_ID: {case_id}]\n{instruction}");
    let sent = (|| -> Result<String, String> {
        let identity_dir = gw
            .identity_dir
            .clone()
            .unwrap_or_else(gateway_tasks::default_state_dir_for_probe);
        let identity =
            gateway_tasks::load_probe_identity(&identity_dir).map_err(|error| error.to_string())?;
        let mut client = gateway_tasks::GatewayClient::connect(&gw, &identity)
            .map_err(|error| error.to_string())?;
        let sessions = client
            .call("sessions.list", serde_json::json!({}))
            .map_err(|error| error.to_string())?;
        let list = sessions
            .get("sessions")
            .and_then(serde_json::Value::as_array)
            .ok_or_else(|| "sessions.list 没回 sessions 数组".to_owned())?;
        let key = beidou_dispatch::group_session_key_of(list, agent_id)
            .ok_or_else(|| {
                format!("网关上看不到 {agent_id} 的群会话（sessions.list 里没有 :group: 键）")
            })?
            .to_owned();
        let params = beidou_dispatch::sessions_send_params(&key, &message)
            .map_err(|error| error.to_string())?;
        client
            .call("sessions.send", params)
            .map_err(|error| error.to_string())?
            .get("runId")
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| "网关没回 runId：不知道这一发算没算".to_owned())
    })();
    match sent {
        Ok(run_id) => (true, Some(run_id), None),
        Err(error) => (false, None, Some(error)),
    }
}

/// append-video 入参：只给案件号，母稿链接从本地账本读（不让前端传链接，
/// 防止指错文档——追错稿比不追糟）。
#[derive(serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AppendVideoParams {
    case_id: String,
    /// 同 direct-launch：要连的网关。缺省 = 只落本地流水。
    #[serde(default)]
    gateways: Vec<GatewayTargetConfig>,
}

/// auto-heal 入参：案件号 + 要重置的会话键。
/// 会话键由调用方给——真机干活的是群会话（agent:tianji:feishu:group:oc_xxx），
/// 不是 :main。受保护的键（main/cron）在命令里直接拒。
#[derive(serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AutoHealParams {
    case_id: String,
    session_key: String,
    #[serde(default)]
    gateways: Vec<GatewayTargetConfig>,
}

/// 一键追投视频：仅图文案 + 母稿已冻结 → 模式升 DUAL → 唤醒开阳。
/// 没冻结就追投 = 让开阳基于一份还会改的母稿干活，白做一遍。
#[tauri::command]
fn beidou_append_video(
    params: AppendVideoParams,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let (mode, master_url) = {
        let connection = open_database_read_only(&state.database_path)?;
        let row = beidou_cases::load_case(&connection, &params.case_id)
            .map_err(|error| error.to_string())?
            .ok_or_else(|| format!("案件 {} 不在本地账本", params.case_id))?;
        (row.deliverable_mode, row.master_doc_url)
    };
    let current = beidou_dispatch::DeliverableMode::from_raw(Some(mode.as_str()));
    if !beidou_dispatch::can_append_video(current, &row_status(&state, &params.case_id)?) {
        return Err("母稿未冻结或本案不是仅图文模式：不能追投".to_owned());
    }
    let wakeup = beidou_dispatch::append_video_payload(&params.case_id, &master_url)
        .map_err(|error| error.to_string())?;
    // 铁律二：唤醒开阳同样要带开阳身份——追投是开阳的活，回落成天枢身份
    // 会让天枢以别人的手写视频包。
    beidou_dispatch::assert_lark_identity(&[
        "drive".to_owned(),
        "--profile".to_owned(),
        "kaiyang".to_owned(),
        "--as".to_owned(),
        "bot".to_owned(),
    ])
    .map_err(|error| error.to_string())?;
    {
        let connection = open_database(&state.database_path).map_err(|error| error.to_string())?;
        beidou_cases::record_wakeup(&connection, &params.case_id, &wakeup)
            .map_err(|error| error.to_string())?;
        beidou_cases::set_deliverable_mode(&connection, &params.case_id, "DUAL")
            .map_err(|error| error.to_string())?;
    }
    let (sent, run_id, send_error) = send_wakeup_to_star(
        &params.gateways,
        "kaiyang",
        &params.case_id,
        wakeup
            .get("text")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default(),
    );
    Ok(serde_json::json!({
        "caseId": params.case_id,
        "deliverableMode": "DUAL",
        "wakeup": wakeup,
        "sent": sent,
        "runId": run_id,
        "sendError": send_error,
    }))
}

/// 读母稿状态（FROZEN/NONE/REJECTED）——追投门槛的判据。
fn row_status(state: &State<'_, AppState>, case_id: &str) -> Result<String, String> {
    let connection = open_database_read_only(&state.database_path)?;
    beidou_cases::master_doc_status(&connection, case_id).map_err(|error| error.to_string())
}

/// 天枢自动自愈：3/3 熔断时重置天玑会话并派发局部重修。
/// 全自动架构下没有人工裁决这一步——Watchdog 数到 3 就直接自愈。
/// 铁律三在这里落地：只准 reset 不准 compact，且 main/cron 两类会话
/// 硬编码保护不被重置（那是舵和锚，重置了整条链路失联）。
///
/// 会话键由调用方给（真机形态 agent:tianji:feishu:group:oc_xxx——干活的
/// 是群会话，不是 :main）。受保护的键直接拒，别等 reset 发出去才发现
/// 打的是舵。
#[tauri::command]
fn beidou_auto_heal(
    params: AutoHealParams,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    if beidou_dispatch::is_protected_session(&params.session_key) {
        return Err(format!("会话 {} 受保护，不能被重置", params.session_key));
    }
    // 铁律三之一：自愈只走 reset。compact 会留着旧的错误判词上下文，
    // 天玑重修时还在照着错的结论写。
    beidou_dispatch::assert_reset_not_compact("RESET").map_err(|error| error.to_string())?;
    let mode = beidou_dispatch::DeliverableMode::from_raw(Some("IMAGE_ONLY"));
    let wakeup = beidou_dispatch::build_wakeup_payload(
        "tianji",
        &params.case_id,
        "局部重修：仅重写打回段落，母稿骨架与已通过小节不动",
        mode,
    )
    .map_err(|error| error.to_string())?;
    {
        let connection = open_database(&state.database_path).map_err(|error| error.to_string())?;
        beidou_cases::record_wakeup(&connection, &params.case_id, &wakeup)
            .map_err(|error| error.to_string())?;
    }
    // 真发送：局部重修是给天玑的活计，发到天玑的群会话。注意：这里发的是
    // 「按原结论重修」而不是「reset 会话」——reset 本身是网关侧会话管理，
    // 铁律三只管"要清就 reset 别 compact"，清的时机由北斗 watchdog 定。
    let (sent, run_id, send_error) = send_wakeup_to_star(
        &params.gateways,
        "tianji",
        &params.case_id,
        wakeup
            .get("text")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default(),
    );
    Ok(serde_json::json!({
        "caseId": params.case_id,
        "action": "RESET",
        "session": params.session_key,
        "wakeup": wakeup,
        "sent": sent,
        "runId": run_id,
        "sendError": send_error,
    }))
}

/// 指挥舱卷宗列表（本地账本全量案件）：App.jsx 此前只传三个空回调、
/// 从来没读过这张表，看板因此永远兜底在 DEMO_CASES。现在补真读入口。
#[tauri::command]
fn beidou_case_list(
    limit: Option<u32>,
    state: State<'_, AppState>,
) -> Result<Vec<beidou_cases::CaseListRow>, String> {
    // 链接兜底收割（写连接）：把任务摘要里带 [CASE_ID] 的飞书链接归进案。
    // 放在读取前跑，UI 每次刷新账本都是最新归拢结果；表是几十行级，成本可忽略。
    // 收割失败不阻塞读取（比如库被别的进程锁了一瞬）——宁可这轮少几条链接。
    // 两条收割线分工（2026-10-18 Leo 实机核查，VPS 侧不注入标签）：
    //   gateway_task 线——任务卡（北斗 SOP 规定任务卡带标签）；
    //   session_run  线——整条 relay 其实走群聊会话，任务卡反而不带标签
    //                   （真机 BM-2601：0/23 条带标签），按 UI 同款 episode
    //                   链把派单卡的案号传播给同轮所有跳，再收各跳链接。
    match open_database(&state.database_path) {
        Ok(connection) => {
            // 建表也是幂等的（CREATE TABLE IF NOT EXISTS）：没发过车的库这里
            // 第一次把 beidou_cases / beidou_case_tasks 建出来。
            let harvested = beidou_cases::ensure_case_tables(&connection)
                .and_then(|_| beidou_cases::harvest_links_from_tasks(&connection))
                .and_then(|_| beidou_cases::harvest_links_from_sessions(&connection));
            if let Err(error) = harvested {
                eprintln!("sinan link harvest skipped: {error}");
            }
        }
        Err(error) => eprintln!("sinan link harvest skipped: {error}"),
    }
    let connection = open_database_read_only(&state.database_path)?;
    beidou_cases::list_cases(&connection, limit).map_err(|error| error.to_string())
}

/// 读本地定时任务镜像（不联网）：任务台"定时任务"看板数据源。
#[tauri::command]
fn gateway_cron_list(
    limit: Option<u32>,
    state: State<'_, AppState>,
) -> Result<Vec<gateway_tasks::GatewayCronRow>, String> {
    let connection = open_database_read_only(&state.database_path)?;
    gateway_tasks::list_crons(&connection, limit).map_err(|error| error.to_string())
}

/// 会话台账口径（设置页"实时监控参数"下发）：保留期 1–90 天、漏采补记 1–72 小时。
#[derive(serde::Deserialize, Clone, Copy, Default)]
struct SessionLedgerParams {
    retention_days: Option<i64>,
    missed_window_hours: Option<i64>,
}

fn session_ledger_options(params: SessionLedgerParams) -> gateway_tasks::SessionLedgerOptions {
    let clamp = |value: Option<i64>, default: i64, min: i64, max: i64| {
        value.map(|v| v.clamp(min, max)).unwrap_or(default)
    };
    gateway_tasks::SessionLedgerOptions {
        retention_ms: clamp(params.retention_days, 7, 1, 90) * 24 * 60 * 60 * 1000,
        missed_window_ms: clamp(params.missed_window_hours, 1, 1, 72) * 60 * 60 * 1000,
    }
}

/// 拉 Agent 会话活动快照（实时监控北斗等多 Agent 协作）：
/// 数据源 = sessions.list（各星位会话 status/hasActiveRun/updatedAt）+ agents.list。
/// 同时返回会话级用量明细（sessions，B 链路 token/上下文数据源）与分网关
/// 成败（results，前端连接灯的真话来源）。2.5s 全局合并缓存对齐前端 3s
/// 节拍：两窗同拍只真连一次；force=手动同步直通。
#[tauri::command]
async fn gateway_agents_snapshot(
    app: tauri::AppHandle,
    gateways: Vec<GatewayTargetConfig>,
    ledger: Option<SessionLedgerParams>,
    force: Option<bool>,
    state: State<'_, AppState>,
) -> Result<GatewayAgentsPayload, String> {
    let ledger_options = session_ledger_options(ledger.unwrap_or_default());
    // 缓存键含网关标签与账本口径：配置一换自动失效。
    let cache_key = format!(
        "{}|r{}|m{}",
        gateways
            .iter()
            .map(|gateway| gateway.label.as_str())
            .collect::<Vec<_>>()
            .join("|"),
        ledger_options.retention_ms,
        ledger_options.missed_window_ms,
    );
    // 命中即回放（短锁快查，绝不在锁内拉网）。失败结果也缓存 2.5s——
    // 网关真断时两窗看到的都是同一份失败，重试按钮走 force 直通。
    if !force.unwrap_or(false) {
        let cached = AGENTS_SNAPSHOT_CACHE.lock().ok().and_then(|guard| {
            guard.as_ref().and_then(|cache| {
                (cache.key == cache_key
                    && cache.at.elapsed().as_millis() < AGENTS_SNAPSHOT_MIN_INTERVAL_MS)
                    .then(|| cache.payload.clone())
            })
        });
        if let Some(payload) = cached {
            return Ok(payload);
        }
    }

    let database_path = state.database_path.clone();
    let scan_gate = Arc::clone(&state.scan_gate);

    // 闭包显式标注错误类型：拆成 let 绑定后外层返回类型不再参与推断，
    // 内层 Result<E> 悬空（E0282/E0283），锚成 String。
    let payload =
        tauri::async_runtime::spawn_blocking(move || -> Result<GatewayAgentsPayload, String> {
            let _gate = scan_gate
                .lock()
                .map_err(|_| "scan lock poisoned".to_owned())?;
            let connection = open_database(&database_path)?;
            let mut merged: Vec<gateway_tasks::AgentActivity> = Vec::new();
            let mut merged_sessions: Vec<gateway_tasks::SessionUsage> = Vec::new();
            let mut results: Vec<GatewayTaskView> = Vec::new();
            for target in &gateways {
                let gw = gateway_target(target);
                // 带连接 → 顺带把会话 run 记入本地台账。
                match gateway_tasks::fetch_agents_snapshot(&gw, Some(&connection), &ledger_options)
                {
                    Ok(snapshot) => {
                        for mut agent in snapshot.agents {
                            agent.agent_id = format!("{}:{}", target.label, agent.agent_id);
                            if let Some(existing) = merged
                                .iter_mut()
                                .find(|existing| existing.agent_id == agent.agent_id)
                            {
                                existing.running_tasks += agent.running_tasks;
                                existing.session_count += agent.session_count;
                                if agent
                                    .last_active_ms
                                    .map(|new| {
                                        existing.last_active_ms.map(|old| new > old).unwrap_or(true)
                                    })
                                    .unwrap_or(false)
                                {
                                    existing.last_active_ms = agent.last_active_ms;
                                }
                                existing.active = existing.active || agent.active;
                            } else {
                                merged.push(agent);
                            }
                        }
                        for mut session in snapshot.sessions {
                            // 跨网关 key 防撞：会话 key 加网关标签前缀。
                            session.key = format!("{}:{}", target.label, session.key);
                            merged_sessions.push(session);
                        }
                        results.push(GatewayTaskView {
                            gateway: target.label.clone(),
                            ok: true,
                            task_count: 0,
                            error: None,
                        });
                    }
                    Err(error) => {
                        // 单网关失败不阻塞其它网关，但要如实上报给连接灯。
                        results.push(GatewayTaskView {
                            gateway: target.label.clone(),
                            ok: false,
                            task_count: 0,
                            error: Some(error.to_string()),
                        });
                    }
                }
            }
            Ok(GatewayAgentsPayload {
                agents: merged,
                sessions: merged_sessions,
                results,
            })
        })
        .await
        .map_err(|error| format!("agents snapshot failed: {error}"))?;
    // spawn_blocking 闭包自身也返回 Result（内部有 ?）：上一行 ? 只解了
    // JoinHandle 外层，这里解内层——错误同为 String，直接透传。
    let payload = payload?;
    // 星名映射广播：提醒窗是独立 webview（localStorage 不共享），失败文案
    // 要中文名——权威源就在本快照里，顺手广播（小载荷、幂等）。缓存回放
    // 路径不重复广播（载荷没变）。
    {
        let mut names = std::collections::HashMap::new();
        for agent in &payload.agents {
            if let Some(name) = &agent.name {
                names
                    .entry(agent.agent_id.clone())
                    .or_insert_with(|| name.clone());
                if let Some(suffix) = agent.agent_id.rsplit(':').next() {
                    names.insert(suffix.to_string(), name.clone());
                }
            }
        }
        let _ = app.emit("tasks://agent-names", names);
    }
    // 回填缓存（尽力而为：锁毒化时下次直拉，不影响正确性）。
    if let Ok(mut guard) = AGENTS_SNAPSHOT_CACHE.lock() {
        *guard = Some(CachedAgentsSnapshot {
            key: cache_key,
            at: std::time::Instant::now(),
            payload: payload.clone(),
        });
    }
    Ok(payload)
}

// ---------------------------------------------------------------------------
// 兼容命令：windowClient 的共用路径会调到，司南里是纯 no-op
// ---------------------------------------------------------------------------

/// Metrik 用量窗的任务栏按钮开关；司南的窗口没有这条路径，保持命令面兼容。
#[tauri::command]
async fn set_taskbar_button(window: tauri::WebviewWindow, visible: bool) -> Result<(), String> {
    let _ = (window, visible);
    Ok(())
}

/// 原生标题栏明暗跟随（macOS 专属语义）；司南窗全部无边框自绘，no-op。
#[tauri::command]
fn set_native_theme(window: tauri::WebviewWindow, theme: Option<String>) -> Result<(), String> {
    let _ = (window, theme);
    Ok(())
}

/// 任务小组件底栏的"打开任务台"：把任务台窗唤到前台。
#[tauri::command]
fn show_main_expanded(app: tauri::AppHandle) -> Result<(), String> {
    focus_main_window(&app);
    Ok(())
}

// ---------------------------------------------------------------------------
// 托盘
// ---------------------------------------------------------------------------

#[cfg(all(desktop, not(target_os = "macos")))]
fn toggle_main_window(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let minimized = window.is_minimized().unwrap_or(false);
    let visible = window.is_visible().unwrap_or(false);
    if visible && !minimized {
        let _ = window.hide();
    } else {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg(all(desktop, not(target_os = "macos")))]
fn setup_tray(app: &mut tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let toggle = MenuItem::with_id(app, "toggle", "显示 / 隐藏 任务台", true, None::<&str>)?;
    let tasks_widget = tauri::menu::CheckMenuItem::with_id(
        app,
        "tasks-widget",
        "任务小组件",
        true,
        false,
        None::<&str>,
    )?;
    if TASKS_WIDGET_MENU.get().is_none() {
        let _ = TASKS_WIDGET_MENU.set(Mutex::new(Some(tasks_widget.clone())));
    }
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出司南", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle, &tasks_widget, &separator, &quit])?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("司南")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle" => toggle_main_window(app),
            // 任务小组件是独立常驻窗，托盘做显隐切换。建窗不能在托盘回调
            // （主线程事件循环内）同步做——扔进异步运行时；set 内部已存在
            // 只显隐、不存在才建，并广播可见性给前端同步勾选。
            "tasks-widget" => {
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    let visible = handle
                        .get_webview_window("tasks-widget")
                        .map(|window| window.is_visible().unwrap_or(false))
                        .unwrap_or(false);
                    let _ = set_tasks_widget_window(handle, !visible).await;
                });
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// 启动
// ---------------------------------------------------------------------------

/// Windows 关掉系统给无边框窗口画的圆角：玻璃外壳自绘圆角，双层圆角会破皮。
#[cfg(windows)]
fn disable_system_corner_rounding(hwnd: isize) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_DONOTROUND,
    };
    let preference = DWMWCP_DONOTROUND.0;
    unsafe {
        let _ = DwmSetWindowAttribute(
            HWND(hwnd as *mut _),
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &preference as *const i32 as *const _,
            std::mem::size_of::<i32>() as u32,
        );
    }
}

/// 悬停扩窗/收窗的位置+尺寸一次原子落：JS 侧 setSize、setPosition 是两笔 IPC，
/// Windows 改尺寸默认锚死左上角——第一帧窗口停在旧位新尺寸（CSS 钉边跟着错位），
/// 第二帧才归位，整条"抖一下"（Leo 实锤）。单次 SetWindowPos 四值同帧生效。
#[cfg(windows)]
#[tauri::command]
async fn set_window_bounds(
    window: tauri::WebviewWindow,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> Result<(), String> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{SetWindowPos, SWP_NOACTIVATE, SWP_NOZORDER};
    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    unsafe {
        SetWindowPos(
            HWND(hwnd.0 as *mut _),
            Some(HWND(std::ptr::null_mut())),
            x,
            y,
            width,
            height,
            SWP_NOZORDER | SWP_NOACTIVATE,
        )
        .map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// 非 Windows 平台占位：调用方在 JS 侧已按平台分流，这里只为编译通过。
#[cfg(not(windows))]
#[tauri::command]
async fn set_window_bounds(
    _window: tauri::WebviewWindow,
    _x: i32,
    _y: i32,
    _width: i32,
    _height: i32,
) -> Result<(), String> {
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init());

    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        focus_main_window(app);
    }));

    // 开机启动由用户在设置里 opt-in；这里只注册能力，不默认启用。
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_autostart::init(
        tauri_plugin_autostart::MacosLauncher::LaunchAgent,
        None,
    ));

    builder
        .setup(|app| {
            #[cfg(all(desktop, not(target_os = "macos")))]
            setup_tray(app)?;

            #[cfg(windows)]
            if let Some(window) = app.get_webview_window("main") {
                if let Ok(hwnd) = window.hwnd() {
                    disable_system_corner_rounding(hwnd.0 as isize);
                }
            }

            let local_dir = app
                .path()
                .app_local_data_dir()
                .map_err(|error| error.to_string())?;
            let database_path = local_dir.join(DATABASE_FILE_NAME);
            import_legacy_ledger(&local_dir, &database_path);
            // 启动即补列：快照写路径可能长期失败（如网关摘除 tasks.list），只读
            // 路径又跑不了 ALTER——三张表的补列在启动时用可写连接一次跑齐，
            // 搬迁进来的老库才不会在读路径撞 no such column。
            match open_database(&database_path) {
                Ok(connection) => {
                    let migrated = gateway_tasks::ensure_gateway_task_table(&connection)
                        .and_then(|_| gateway_tasks::ensure_session_run_table(&connection))
                        .and_then(|_| gateway_tasks::ensure_gateway_cron_table(&connection));
                    if let Err(error) = migrated {
                        eprintln!("sinan could not migrate its task ledger: {error}");
                    }
                }
                Err(error) => eprintln!("sinan could not open its task ledger: {error}"),
            }

            app.manage(AppState {
                database_path,
                scan_gate: Arc::new(Mutex::new(())),
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // 关闭收进托盘常驻，退出走托盘菜单。
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            gateway_task_list,
            gateway_cron_snapshot,
            gateway_cron_list,
            gateway_agents_snapshot,
            session_run_list,
            beidou_direct_launch,
            beidou_append_video,
            beidou_auto_heal,
            beidou_case_list,
            set_tasks_widget_window,
            set_notification_window,
            expand_round_details,
            show_main_expanded,
            set_taskbar_button,
            set_native_theme,
            set_window_bounds,
            show_hop_card,
            hop_card_take_payload,
            hop_card_ready,
            hide_hop_card,
            hop_card_report_height,
            hop_card_ping
        ])
        .run(tauri::generate_context!())
        .expect("error while running sinan");
}
