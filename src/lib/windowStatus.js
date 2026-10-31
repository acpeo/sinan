


/// 状态灯的含义：绿 = 数据正常，黄（呼吸）= 正在更新，红 = 读取失败。
/// 灯本身只是装饰，含义必须悬浮可见，否则用户永远猜不到。
export function statusDotTitle(loading, loadError) {
  if (loadError) return "数据读取失败，仍显示上次成功的数据";
  return loading ? "正在更新数据…" : "数据正常";
}
export let windowActionQueue = Promise.resolve();
export let latestWindowCorrection = 0;

export function runWindowAction(action) {
  // hide/move/zoom/resize/show 是一条事务；并发执行时旧屏幕 factor 算出的迟到
  // resize 会覆盖新屏幕上的修正。统一排队，失败后也让后续操作继续。
  windowActionQueue = windowActionQueue.then(action).catch((error) => {
    console.warn("Unable to update the desktop window.", error);
  });
  return windowActionQueue;
}

export function runLatestWindowCorrection(action) {
  const correction = ++latestWindowCorrection;
  return runWindowAction(() => {
    if (correction !== latestWindowCorrection) return undefined;
    return action(() => correction === latestWindowCorrection);
  });
}

/// 标题栏的主题快捷键：单击在亮/暗之间切换，右键（或长按）弹出含「自动」的
/// 三选菜单——单击不进「自动」是刻意的：一次点击只该有一个确定结果，
/// 而「自动」的结果取决于系统当前是什么。
