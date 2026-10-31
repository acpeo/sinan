import { useEffect, useRef, useState } from "react";
import { hopCardReady, onHopCardSignal, reportHopCardHeight, takeHopCardPayload } from "../lib/windowClient";
import { HopHoverCard } from "../components/HopHoverCard.jsx";


/// 星卡伴随窗（?view=hopcard）：载荷驱动渲染悬停星卡本体。收到载荷 →
/// 渲染 → 双 rAF（保证画完一帧）→ 回 ready，Rust 才显形——窗在隐藏态下
/// 完成定位与首绘，显形即成品，无中间帧。载荷 take 即清空；挂载兜底取
/// 一次（首建竞态时 poll 信号可能早于监听建立）。窗固定 224×460、内容盒
/// 垂直居中（竖条）；横条按 side 钳到贴条缘（above=底对齐/below=顶对齐）。
export function HopCardWindow() {
  const [cardProps, setCardProps] = useState(null);
  const lastPayloadRef = useRef("");
  const lastHeightRef = useRef(0);
  useEffect(() => {
    let alive = true;
    let unlisten = null;
    const apply = (raw) => {
      if (!alive || typeof raw !== "string" || !raw) return;
      if (raw !== lastPayloadRef.current) {
        lastPayloadRef.current = raw;
        try {
          const data = JSON.parse(raw);
          setCardProps(
            data
              ? { ...data, agentNameMap: new Map(Object.entries(data.agentNames ?? {})) }
              : null,
          );
        } catch {
          setCardProps(null);
        }
      }
      // 内容同帧也回执：宿主可能正等 ready 显形（同载荷重开悬停）。
      requestAnimationFrame(() => requestAnimationFrame(() => hopCardReady()));
    };
    onHopCardSignal(() => {
      takeHopCardPayload().then(apply);
    }).then((stop) => {
      if (!alive) stop?.();
      else unlisten = stop;
    });
    takeHopCardPayload().then(apply);
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);
  // 实测高回传：横条上下放卡按它定窗高（值不变不回传，省 IPC）。
  const handleHeight = (height) => {
    if (!Number.isFinite(height) || height <= 0 || lastHeightRef.current === height) return;
    lastHeightRef.current = height;
    reportHopCardHeight(height);
  };
  const stageAlign = !cardProps?.orientation || cardProps.orientation === "vertical"
    ? "center"
    : cardProps.side === "above"
      ? "flex-end"
      : "flex-start";
  return (
    <div className="hopcard-stage" style={{ alignItems: stageAlign }}>
      {cardProps && (
        <HopHoverCard
          hop={cardProps.hop}
          index={cardProps.index}
          total={cardProps.total}
          records={cardProps.records ?? null}
          live={Boolean(cardProps.live)}
          nextRun={cardProps.nextRun ?? null}
          agentNameMap={cardProps.agentNameMap}
          currentTaskId={cardProps.currentTaskId}
          translate={cardProps.translate}
          light={Boolean(cardProps.light)}
          onHeight={handleHeight}
        />
      )}
    </div>
  );
}

/// 任务小组件悬停详情卡：跳名 + 状态徽标 + 进度摘要原话 + 星名/链路位置/耗时，
/// 底部可带"其他任务"节（首行链路之外的任务，竖条角标同一份数据）。
/// 竖条/横条两个迷你形态共用（onHopHover opt-in）。真机由独立星卡伴随窗
/// （tasks-hopcard）承载同一组件；浏览器预览走窗内 Portal（fixed 定位）。
/// pointer-events:none 纯展示，不截断胶卷的指针进出。light = 跟随胶囊浅色
/// 外观（卡片 Portal 在 body 下，壳的 glass-light 类够不到，得显式传）。
