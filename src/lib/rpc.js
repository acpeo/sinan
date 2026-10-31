

// invoke 看门狗：Tauri invoke 没有客户端超时，Rust 侧 scan_gate 排队/网络
// 慢时 Promise 可能长期不归——2026-10-08 实锤：小组件 tick 第一 await 挂起，
// 后面三个本地读一个都不发，页脚 lastSync 冻在几分钟前而 live 还挂着上一拍
// 的 true（撒谎"已连接"）。超时按失败处理，下一拍重试：宁可短暂"未同步"，
// 不许静默冻结。
export const RPC_WATCHDOG_MS = 20_000;

export function withInvokeTimeout(promise, ms = RPC_WATCHDOG_MS) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("rpc watchdog timeout")), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}


