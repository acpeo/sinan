import { glassShellAppearance } from "../lib/glassAppearance.js";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { expandRoundDetails, onAgentNames } from "../lib/windowClient";
import { isTauriRuntime, loadMonitorConfig, loadSessionRuns } from "../lib/taskClient.js";
import { detectRoundNotifications } from "../lib/taskChains.js";
import { IS_MAC } from "../lib/platformFlags.js";
import { PREVIEW_EAGER } from "../lib/preview.js";
import { runWindowAction } from "../lib/windowStatus.js";


/// 自绘提醒角标窗（六案 B·自绘壳，Leo 拍板）：屏幕右下角玻璃小卡堆。
/// 触发层 = detectRoundNotifications 纯函数（本窗每拍跑台账 diff），壳只管
/// 倒计时/悬停暂停/点击跳转（A 案：点卡展开任务面板，Rust 仲裁兜底主窗）。
/// 窗口显隐自管（卡堆空自藏、来卡自弹），总开关在设置（notifyEnabled）。
export function NotificationWindow({ transparent, glassMode, glassTint, glassInk, glassAlpha, onClose }) {
  const shellAppearance = glassShellAppearance("widget", {
    transparent,
    glassMode,
    glassTint,
    glassInk,
    isMac: IS_MAC,
    loading: false,
  });
  // 星名映射：真机走主窗的定期广播（各窗口 localStorage 不共享）；浏览器
  // 预览没有事件总线，用 localStorage 种子兜底。
  const [agentNames, setAgentNames] = useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem("metrik:agentNames") || "{}");
      return raw && typeof raw === "object" ? raw : {};
    } catch {
      return {};
    }
  });
  useEffect(() => {
    let unlistenPromise;
    onAgentNames((map) => setAgentNames(map));
    return () => {
      unlistenPromise?.then((unlisten) => unlisten());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const snapshotRef = useRef({ failedSeen: {}, rounds: {} });
  const rootRef = useRef(null);
  const [toasts, setToasts] = useState([]);

  // 同步拍：台账 diff → 纯函数出提醒 → 按开关过滤入栈（最多 3 张，新的顶上）。
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (!alive) return;
      if (!PREVIEW_EAGER && document.visibilityState === "hidden") return;
      const monitor = loadMonitorConfig();
      if (!monitor.notifyEnabled) return;
      const data = await loadSessionRuns().catch(() => null);
      if (!alive || !data) return;
      const { toasts: fresh, next } = detectRoundNotifications(
        data.runs ?? [],
        snapshotRef.current,
        {
          episodeGapMin: monitor.episodeGapMin,
          quietOn: monitor.notifyQuietOn,
          quietStart: monitor.notifyQuietStart,
          quietEnd: monitor.notifyQuietEnd,
          aggregateMin: monitor.notifyAggregateMin,
          agentNames,
        },
        Date.now(),
      );
      snapshotRef.current = next;
      const allowed = fresh.filter((toast) =>
        toast.kind === "ok" ? monitor.notifyOnComplete : monitor.notifyOnFailure,
      );
      if (!allowed.length) return;
      const stayMs = monitor.notifyStaySec * 1000;
      setToasts((current) => {
        const known = new Set(current.map((toast) => toast.id));
        const added = allowed
          .filter((toast) => !known.has(toast.id))
          .map((toast) => ({ ...toast, totalMs: stayMs, leftMs: stayMs, paused: false }));
        return [...current, ...added].slice(-3);
      });
    };
    tick();
    const timer = window.setInterval(tick, Math.max(1, loadMonitorConfig().refreshIntervalSec) * 1000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 倒计时节拍：未暂停的卡每 250ms 掉一格，走完即出栈。
  useEffect(() => {
    if (!toasts.length) return undefined;
    const timer = window.setInterval(() => {
      setToasts((current) => current
        .map((toast) => (toast.paused ? toast : { ...toast, leftMs: toast.leftMs - 250 }))
        .filter((toast) => toast.leftMs > 0));
    }, 250);
    return () => window.clearInterval(timer);
  }, [toasts.length]);

  // 窗口自管显隐 + 底边锚定改高（setSize 默认向下长，必须重钉底边）。
  useLayoutEffect(() => {
    if (!isTauriRuntime()) return;
    const height = rootRef.current?.offsetHeight ?? 1;
    runWindowAction(() => repinNotificationWindow(height));
    runWindowAction(() => setSelfWindowVisible(toasts.length > 0));
  }, [toasts]);

  const dismiss = (id) => setToasts((current) => current.filter((toast) => toast.id !== id));
  const setPaused = (id, paused) =>
    setToasts((current) => current.map((toast) => (toast.id === id ? { ...toast, paused } : toast)));

  return (
    <main
      ref={rootRef}
      className={`${shellAppearance.className} badge-window`}
      style={{ ...shellAppearance.style, width: "344px" }}
    >
      <h1 className="sr-only">司南 提醒</h1>
      {toasts.length === 0 ? (
        <p className="badge-empty">提醒角标待命…（真失败/完成的轮次会在这里弹出，总开关在 任务台 → 提醒与预警）</p>
      ) : (
        <div className="badge-stack">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`badge-toast badge-toast--${toast.kind}`}
              role="button"
              tabIndex={0}
              onClick={() => {
                expandRoundDetails();
                dismiss(toast.id);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  expandRoundDetails();
                  dismiss(toast.id);
                }
              }}
              onMouseEnter={() => setPaused(toast.id, true)}
              onMouseLeave={() => setPaused(toast.id, false)}
            >
              <span className="badge-glyph" aria-hidden="true">
                {toast.kind === "ok" ? "✓" : toast.kind === "merge" ? "!" : "✕"}
              </span>
              <span className="badge-main">
                <span className="badge-title">{toast.title}</span>
                <span className="badge-body">{toast.body}</span>
                {toast.meta ? <span className="badge-meta">{toast.meta}</span> : null}
              </span>
              <button
                type="button"
                className="badge-x"
                aria-label="清除这条提醒"
                onClick={(event) => {
                  event.stopPropagation();
                  dismiss(toast.id);
                }}
              >
                ✕
              </button>
              <i
                className="badge-countdown"
                style={{ width: `${Math.max(0, Math.min(100, (toast.leftMs / toast.totalMs) * 100))}%` }}
                aria-hidden="true"
              />
            </div>
          ))}
        </div>
      )}
      <footer className="badge-footer">
        <button type="button" className="badge-close" onClick={onClose} aria-label="关闭提醒角标">
          关闭提醒
        </button>
      </footer>
    </main>
  );
}

/// 历史轮次的时间标签：今天/昨天带时刻，更早带日期。
