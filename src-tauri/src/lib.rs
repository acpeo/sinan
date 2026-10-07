//! 司南（Sinan）— 北斗任务台。
//!
//! 从 Metrik 分叉里整搬出来的任务追踪体：
//! - 网关任务台账 + cron 镜像 + 会话工作台账（gateway_tasks 模块，原样）；
//! - 任务小组件窗（tasks-widget）、自绘提醒角标窗（notifications）两个常驻窗；
//! - 主窗 = 任务台（任务页 + 监控/网关/外观设置）。
//!
//! 用量统计留在 Metrik 本尊，两边互不依赖，只共读同一个 openclaw 网关。

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
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create app data directory {}: {error}", parent.display()))?;
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
    .map_err(|error| format!("failed to open task ledger read-only {}: {error}", path.display()))?;
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
    for root in [data_root.join(LEGACY_APP_IDENTIFIER), PathBuf::from(LEGACY_APP_IDENTIFIER)] {
        let legacy = root.join(LEGACY_DATABASE_FILE_NAME);
        if !legacy.exists() {
            continue;
        }
        if std::fs::copy(&legacy, target).is_ok() {
            eprintln!("sinan imported legacy task ledger from {}", legacy.display());
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
static TASKS_WIDGET_MENU: std::sync::OnceLock<Mutex<Option<tauri::menu::CheckMenuItem<tauri::Wry>>>> = std::sync::OnceLock::new();

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
    set_tasks_widget_menu_checked(visible);
    app.emit(TASK_WIDGET_VISIBILITY, visible).map_err(|error| error.to_string())?;
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
    app.emit(NOTIFICATION_VISIBILITY, visible).map_err(|error| error.to_string())?;
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

/// 单个 Gateway 的拉取结果视图（成功/失败 + 原因）。
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayTaskView {
    pub gateway: String,
    pub ok: bool,
    pub task_count: usize,
    pub error: Option<String>,
}

/// gateway_agents_snapshot 的返回：Agent 活动卡 + 会话级用量明细。
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayAgentsPayload {
    pub agents: Vec<gateway_tasks::AgentActivity>,
    pub sessions: Vec<gateway_tasks::SessionUsage>,
}

fn gateway_target(target: &GatewayTargetConfig) -> gateway_tasks::GatewayTarget {
    gateway_tasks::GatewayTarget {
        label: target.label.clone(),
        url: target.url.clone(),
        token: target.token.clone(),
        identity_dir: target.identity_dir.clone(),
    }
}

/// 拉一次 Gateway 任务台账并落本地账本（突破官方 7 天保留）。
#[tauri::command]
async fn gateway_task_snapshot(
    gateways: Vec<GatewayTargetConfig>,
    state: State<'_, AppState>,
) -> Result<Vec<GatewayTaskView>, String> {
    let database_path = state.database_path.clone();
    let scan_gate = Arc::clone(&state.scan_gate);
    tauri::async_runtime::spawn_blocking(move || {
        let _gate = scan_gate
            .lock()
            .map_err(|_| "scan lock poisoned".to_owned())?;
        let connection = open_database(&database_path)?;
        let mut views = Vec::new();
        // 节流状态：同一网关 2.5 秒内的重复快照直接复用上一拍结果。
        let mut last_fetch: Option<(String, std::time::Instant)> = None;
        for target in &gateways {
            let gw = gateway_target(target);
            match gateway_tasks::snapshot_gateway_tasks_throttled(&connection, &gw, &mut last_fetch)
            {
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
    .map_err(|error| format!("gateway task snapshot failed: {error}"))?
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

/// 拉一次定时任务列表并落本地镜像（cron.list，operator.read 即可读）。
/// 60 秒节流：看板数据变化以分钟计，不值得按 3 秒拍握手。
#[tauri::command]
async fn gateway_cron_snapshot(
    gateways: Vec<GatewayTargetConfig>,
    state: State<'_, AppState>,
) -> Result<Vec<GatewayTaskView>, String> {
    let database_path = state.database_path.clone();
    let scan_gate = Arc::clone(&state.scan_gate);
    tauri::async_runtime::spawn_blocking(move || {
        let _gate = scan_gate
            .lock()
            .map_err(|_| "scan lock poisoned".to_owned())?;
        let connection = open_database(&database_path)?;
        let mut views = Vec::new();
        let mut last_fetch: Option<(String, std::time::Instant)> = None;
        for target in &gateways {
            let gw = gateway_target(target);
            match gateway_tasks::snapshot_gateway_crons_throttled(&connection, &gw, &mut last_fetch)
            {
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
/// 同时返回会话级用量明细（sessions，B 链路 token/上下文数据源）。
/// 带 2.5s 节流，与前端 3s 刷新节奏对齐。
#[tauri::command]
async fn gateway_agents_snapshot(
    app: tauri::AppHandle,
    gateways: Vec<GatewayTargetConfig>,
    ledger: Option<SessionLedgerParams>,
    state: State<'_, AppState>,
) -> Result<GatewayAgentsPayload, String> {
    let database_path = state.database_path.clone();
    let scan_gate = Arc::clone(&state.scan_gate);
    let ledger_options = session_ledger_options(ledger.unwrap_or_default());

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
            for target in &gateways {
                let gw = gateway_target(target);
                // 复用任务快照的节流逻辑：agents 快照与任务快照共享同一网关连接
                // 成本，这里独立节流窗口。带连接 → 顺带把会话 run 记入本地台账。
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
                    }
                    Err(_) => { /* 单网关失败不阻塞其它网关 */ }
                }
            }
            Ok(GatewayAgentsPayload {
                agents: merged,
                sessions: merged_sessions,
            })
        })
        .await
        .map_err(|error| format!("agents snapshot failed: {error}"))?;
    // spawn_blocking 闭包自身也返回 Result（内部有 ?）：上一行 ? 只解了
    // JoinHandle 外层，这里解内层——错误同为 String，直接透传。
    let payload = payload?;
    // 星名映射广播：提醒窗是独立 webview（localStorage 不共享），失败文案
    // 要中文名——权威源就在本快照里，顺手广播（小载荷、幂等）。
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
    let tasks_widget = tauri::menu::CheckMenuItem::with_id(app, "tasks-widget", "任务小组件", true, false, None::<&str>)?;
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
            HWND(std::ptr::null_mut()),
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
            gateway_task_snapshot,
            gateway_task_list,
            gateway_cron_snapshot,
            gateway_cron_list,
            gateway_agents_snapshot,
            session_run_list,
            set_tasks_widget_window,
            set_notification_window,
            expand_round_details,
            show_main_expanded,
            set_taskbar_button,
            set_native_theme,
            set_window_bounds
        ])
        .run(tauri::generate_context!())
        .expect("error while running sinan");
}
