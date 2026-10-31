// 全站外链出口。
//
// Tauri 的 webview 会把 <a target="_blank"> 的新窗口请求直接丢掉——不弹系统
// 浏览器、也不报错，点下去就是没反应。2026-10-19 Leo 实测深潜舱七个文档
// 按钮全哑，根因就是这里：项目里从来没有一处 openUrl。
//
// 用捕获阶段的全局委托，而不是给每个 <a> 挂 onClick：以后新加链接不会再踩
// 同一个坑（这是"一处生效"的不变式，不是魔法）。
import { isTauriRuntime } from "./taskClient.js";

export async function openExternal(url) {
  const target = String(url ?? "").trim();
  if (!target) return false;
  if (isTauriRuntime()) {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(target);
      return true;
    } catch (error) {
      // 失败必须显形。静默失败正是这次要修的毛病，别把错咽回去。
      console.error("[openExternal] 打开失败", target, error);
      return false;
    }
  }
  window.open(target, "_blank", "noopener,noreferrer");
  return true;
}

/// 装上全局外链委托，返回卸载函数。只接管 http(s) 左键无修饰键的点击，
/// 其余（锚点、内部路由、右键、Ctrl 点击）一律放行。
export function installExternalLinkHandler(doc) {
  const target = doc ?? (typeof document === "undefined" ? null : document);
  if (!target) return () => {};
  const onClick = (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const node = event.target;
    const anchor = node && node.closest ? node.closest("a[href]") : null;
    if (!anchor) return;
    const href = anchor.getAttribute("href") ?? "";
    if (!/^https?:\/\//i.test(href)) return;
    event.preventDefault();
    void openExternal(href);
  };
  target.addEventListener("click", onClick, true);
  return () => target.removeEventListener("click", onClick, true);
}
