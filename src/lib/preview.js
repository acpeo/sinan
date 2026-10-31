


// 预览豁免（?eager）：IAB 预览面板收起时 document.visibilityState 恒为 hidden
// 且被宿主钉死不可覆写（实例与 window.document 都 non-configurable），
// 演示数据全靠同步拍填充——带 eager 参数的预览页无视隐藏照常同步。
// 真机窗口不带此参数，行为不变。
export const PREVIEW_EAGER =
  typeof window !== "undefined"
  && new URLSearchParams(window.location.search).has("eager");
