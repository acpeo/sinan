import { Fragment, useLayoutEffect, useRef } from "react";
import { stripGestureOwner } from "../lib/windowGeometry";
import { agentDisplayName, hopGlyphOf, hopToneOf } from "../lib/taskChains.js";
import { formatCompactDuration } from "../lib/format.js";


/// 任务链路 stepper：链上每跳 = agent 名 + 状态符（✓ 完成 / ● 进行中 / ○ 待跑），
/// 完成跳带耗时。单跳不成链不渲染——没有链路信息的行保持干净。
/// 链从 runId 分组与 childSessionKey→sessionKey 父子边拼出（见 taskChains.js）。
/// 跑马灯链路胶卷：当前执行 agent 恒定居中，链条两侧延伸出屏，
/// 滚轮左右滑看前后跳（用户点名交互）。数据变化时重新居中，手动滚后尊重用户
/// 位置直到下一次数据变化。边缘渐隐提示还有内容。
export function ChainFilmstrip({ hops, currentTaskId, agentNameMap, vertical = false, onExpand, onHopHover }) {  const stripRef = useRef(null);
  const currentRef = useRef(null);
  const currentKey = `${currentTaskId ?? ""}:${hops.length}`;
  useLayoutEffect(() => {
    const strip = stripRef.current;
    const current = currentRef.current;
    if (!strip || !current) return;
    const centre = () => {
      if (vertical) {
        strip.scrollTop = current.offsetTop + current.offsetHeight / 2 - strip.clientHeight / 2;
      } else {
        strip.scrollLeft = current.offsetLeft + current.offsetWidth / 2 - strip.clientWidth / 2;
      }
    };
    centre();
    // 换形态（横↔竖）会跟着改原生窗尺寸，WebView2 的视口落地晚于布局效果一两
    // 帧：此刻量到的 clientHeight 还是旧外形的，居中算出来是歪的。补一帧重算，
    // 尺寸落定即精确（Leo 2026-10-13 第三轮："运行中的星要自动在中间"）。
    const raf = requestAnimationFrame(centre);
    return () => cancelAnimationFrame(raf);
  }, [currentKey, vertical]);
  // 按住拖拽滚动（鼠标左键 / 触屏）：按下记录起点，移动 4px 起算拖动，
  // 松开时若拖动过则吞掉紧随的 click——迷你条上点击=展开，拖完不该展开。
  const dragRef = useRef(null);
  const onStripPointerDown = (event) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    const target = event.currentTarget;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: target.scrollLeft,
      scrollTop: target.scrollTop,
      moved: false,
    };
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      /* 旧运行时无 capture 也能靠后续 pointermove 工作 */
    }
  };
  const onStripPointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    // 没按键就不算拖拽（Leo 2026-10-11 实锤"鼠标放上去就自动上下滑"）：
    // OS 拖窗的模态循环会吞掉 pointerup（本文件别处已为此加了 window 级兜底），
    // 胶卷的 dragRef 却没人清——残留记录让之后的纯悬停移动也在改 scrollTop，
    // 表现为"鼠标放上去内容就跟着跑"。首个无按键的 move 即丢弃这次拖拽。
    if ((event.buttons ?? 0) === 0) {
      dragRef.current = null;
      delete event.currentTarget.dataset.stripDragging;
      return;
    }
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    // 与壳层同一个判定源（Leo 2026-10-11）：横条一律让给拖窗（条身纵向实测
    // 17.5px，沿条/跨条分不开，硬分就是"怎么拖都在滚内容"——横条的翻链交给
    // 滚轮，胶卷 onWheel 照旧横滑）；竖条按方向分家，纵向为主才认领滚内容。
    // 没过死区谁都别动（等更多位移再判，避免手抖把点击吃掉）。
    if (stripGestureOwner({ vertical, dx, dy }) !== "scroll") return;
    drag.moved = true;
    // 手势标记：壳层据此判"这条拖拽已被内容滚动认领"，不再启动 OS 挪窗。
    event.currentTarget.dataset.stripDragging = "1";
    const target = event.currentTarget;
    if (vertical) target.scrollTop = drag.scrollTop - dy;
    else target.scrollLeft = drag.scrollLeft - dx;
  };
  const onStripPointerEnd = (event) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    dragRef.current = null;
    delete event.currentTarget.dataset.stripDragging;
    if (!drag.moved) return;
    const target = event.currentTarget;
    const swallow = (e) => {
      e.stopPropagation();
      e.preventDefault();
    };
    target.addEventListener("click", swallow, { capture: true, once: true });
    window.setTimeout(() => target.removeEventListener("click", swallow, { capture: true }), 120);
  };
  return (
    <span
      role={onExpand ? "button" : undefined}
      tabIndex={onExpand ? 0 : undefined}
      aria-label={onExpand ? "任务链路，点击展开任务追踪" : undefined}
      className={`tasks-mini-strip${vertical ? " tasks-mini-strip--vertical" : ""}`}
      ref={stripRef}
      onClick={onExpand}
      onPointerDown={onStripPointerDown}
      onPointerMove={onStripPointerMove}
      onPointerUp={onStripPointerEnd}
      onPointerCancel={onStripPointerEnd}
      onKeyDown={
        onExpand
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onExpand();
              }
            }
          : undefined
      }
      title={
        onHopHover
          ? undefined
          : "点击展开任务追踪 · 滚轮或按住拖动查看链路"
      }
      onWheel={(event) => {
        const target = event.currentTarget;
        // 行模式滚轮（deltaMode 1，deltaY≈3）按行高归一，否则一格只挪 3px；
        // 像素模式一格 ~100px ≈ 2 跳，钳到 60px = 正好一个跳位
        const unit = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? target.clientHeight : 1;
        const delta = (event.deltaY + event.deltaX) * unit;
        const step = Math.sign(delta) * Math.min(Math.abs(delta), 60);
        if (vertical) target.scrollTop += step;
        else target.scrollLeft += step;
      }}
    >
      {hops.map((hop, index) => {
        const { tone, state, current } = hopToneOf(hop, currentTaskId);
        const name = agentDisplayName(agentNameMap, hop.agentId) || hop.agentId || "?";
        const duration = formatCompactDuration(hop.startedAtMs, hop.endedAtMs);
        return (
          <Fragment key={`${hop.gateway ?? ""}:${hop.taskId}`}>
            {index > 0 && <i className="task-chain-link" aria-hidden="true" />}
            <span
              // 居中锚点只认"真的是当前任务"这一条（Leo 2026-10-13 第三轮："运行
              // 执行任务的 agent 应该自动显示在中间位置"）。不能拿 tone 判——tone
              // 的 current 是兜底档，词汇表里没枚举过的状态（aborted、空串…）也会
              // 落成 "current"，于是这些格子也挂上 ref，最后一个胜出，把真正在跑
              // 那颗星的居中位抢走。灯牌上一眼扫过去， running 的星偏到边上去。
              ref={current ? currentRef : undefined}
              className={`task-chain-hop task-chain-hop--${tone}`}
              // 悬停详情卡接管提示时撤掉原生 title，避免两层气泡叠出
              title={
                onHopHover
                  ? undefined
                  : `${name} · ${state}${duration ? ` · ${duration}` : ""}`
              }
              onPointerEnter={onHopHover ? (event) => onHopHover(hop, index, hops.length, event) : undefined}
            >
              <span className="task-chain-glyph" aria-hidden="true">{hopGlyphOf(tone)}</span>
              <span className="task-chain-agent">{name}</span>
              {duration && !vertical && <small>{duration}</small>}
            </span>
          </Fragment>
        );
      })}
    </span>
  );
}

/// 星卡伴随窗（?view=hopcard）：载荷驱动渲染悬停星卡本体。收到载荷 →
/// 渲染 → 双 rAF（保证画完一帧）→ 回 ready，Rust 才显形——窗在隐藏态下
/// 完成定位与首绘，显形即成品，无中间帧。载荷 take 即清空；挂载兜底取
/// 一次（首建竞态时 poll 信号可能早于监听建立）。窗固定 224×460、内容盒
/// 垂直居中（竖条）；横条按 side 钳到贴条缘（above=底对齐/below=顶对齐）。
