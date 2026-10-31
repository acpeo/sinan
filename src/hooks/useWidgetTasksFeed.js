import { useEffect, useRef, useState } from "react";
import { isTauriRuntime, loadAgentsSnapshot, loadGatewayConfig, loadGatewayTasks, loadMonitorConfig, loadSessionRuns } from "../lib/taskClient.js";
import { gatewayResultsAllOk } from "../lib/taskChains.js";
import { PREVIEW_EAGER } from "../lib/preview.js";
import { withInvokeTimeout } from "../lib/rpc.js";
import { defuseSnapshotActivity } from "../lib/taskVisual.js";



export function useWidgetTasksFeed(gateways, enabled) {
  const [tasks, setTasks] = useState(null);
  const [agents, setAgents] = useState(null);
  const [sessionRuns, setSessionRuns] = useState([]);
  const [live, setLive] = useState(false);
  const [lastSync, setLastSync] = useState(0);
  const [intervalSec, setIntervalSec] = useState(() => loadMonitorConfig().refreshIntervalSec);
  const [refreshTick, setRefreshTick] = useState(0);
  // 设置页改监控参数（含保存开关触发的同一事件）后立即生效。
  useEffect(() => {
    const handler = () => setIntervalSec(loadMonitorConfig().refreshIntervalSec);
    window.addEventListener("metrik-monitor-changed", handler);
    return () => window.removeEventListener("metrik-monitor-changed", handler);
  }, []);

  const gatewayKey = gateways.map((gateway) => gateway.label).join("|");
  // 手动「重试」要立即真拉：下一拍带 force 绕过 Rust 的两窗合并缓存。
  const forceNextRef = useRef(false);
  useEffect(() => {
    // 只看 enabled，不看 gateways：任务小窗是独立 webview，主窗保存的 Gateway
    // 配置不会跨窗推事件（升级重建存储后"主窗重配、小窗先起于空配置"正是
    // 0.20.11 真机翻车现场，重试也空转）。每拍现读配置，配置晚到自动捡起。
    if (!enabled) return undefined;
    let alive = true;
    const tick = async () => {
      // 可见性闸只管浏览器（后台标签别空转）；Tauri 小组件窗绝不跳拍——
      // 跳过的每一拍都是灯牌数据冻结的一拍（Leo 实锤"胶囊比主窗慢"）。
      if (!isTauriRuntime() && !PREVIEW_EAGER && document.visibilityState === "hidden") return;
      const current = loadGatewayConfig();
      const force = forceNextRef.current;
      forceNextRef.current = false;
      // 本地读（毫秒级）全部先行，不排在网关 RPC 后面：RPC 排队/网络慢时
      // lastSync/卡片数据整拍冻死；网关 RPC 各自带看门狗，单拍挂起只损失
      // 它自己，下一拍照常。
      loadGatewayTasks(null)
        .then((data) => {
          if (!alive) return;
          setTasks(data);
          setLastSync(Date.now());
        })
        .catch(() => {});
      loadSessionRuns()
        .then((data) => {
          if (alive) setSessionRuns(data.runs ?? []);
        })
        .catch(() => {});
      // 连接灯只认星位快照的分网关成败——它是真正连网关、写账本的那条链路。
      // 空壳的 gateway_task_snapshot 已摘：它 2026.9.8 后不运数据却要排
      // 全局锁，排队超看门狗就被误判断线（胶囊假"未同步"的真凶）。
      if (current.length) {
        withInvokeTimeout(loadAgentsSnapshot(current, { force }))
          .then((snap) => {
            if (!alive) return;
            // 2026-10-23 Leo 实拍：网关不通（顶栏「未连接」）时，任务页/小组件/
            // 迷你胶囊仍亮着好几个「正在执行」。快照里 hasActiveRun 是断连前
            // 最后一拍的陈旧状态，灯牌却当实况用——灯和连接状态自相矛盾。
            // 口径：这一拍没连上网关，就不许拿快照点亮活跃；台账（本地 done）
            // 会接手，该亮的（真在跑的）仍然亮。
            const ok = gatewayResultsAllOk(snap?.results);
            setAgents(ok ? snap : defuseSnapshotActivity(snap));
            setLive(ok);
          })
          .catch(() => {
            if (alive) setLive(false);
          });
      } else {
        setLive(false);
      }
    };
    tick();
    const timer = setInterval(tick, Math.max(1, intervalSec) * 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, gatewayKey, intervalSec, refreshTick]);

  return {
    tasks,
    agents,
    sessionRuns,
    live,
    lastSync,
    // 底栏强制刷新/重试按钮：立即补一拍并带 force 真连网关（不嚼缓存）。
    refresh: () => {
      forceNextRef.current = true;
      setRefreshTick((tick) => tick + 1);
    },
  };
}

/// 任务行首的状态色竖条：与 Agent 行的彩色边条同一语言（绿=跑，红=败，灰=终态）。
