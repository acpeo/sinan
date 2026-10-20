export const GLASS_MODES = Object.freeze({
  off: "off",
  css: "css",
  native: "native",
  alpha: "alpha",
});

const USER_GLASS_TINTS = Object.freeze(["dark", "light", "clear"]);

export function nextGlassTint(tintStyle) {
  const index = USER_GLASS_TINTS.indexOf(tintStyle);
  return USER_GLASS_TINTS[(index + 1) % USER_GLASS_TINTS.length];
}

export function resolveGlassMode({
  enabled,
  tintStyle = "dark",
  nativeAvailable = false,
  trueAlphaAvailable = false,
}) {
  if (!enabled) return GLASS_MODES.off;
  if (trueAlphaAvailable) return GLASS_MODES.alpha;
  return nativeAvailable ? GLASS_MODES.native : GLASS_MODES.css;
}

export function resolveWindowsGlassComposition({
  enabled,
  tintStyle = "dark",
}) {
  return {
    mode: resolveGlassMode({
      enabled,
      tintStyle,
      nativeAvailable: false,
      trueAlphaAvailable: true,
    }),
    resetWebviewBackground: false,
    mutateNativeBackdrop: false,
  };
}

export function glassShellAppearance(
  kind,
  {
    transparent = false,
    glassMode = GLASS_MODES.css,
    glassTint = "dark",
    glassInk = "dark",
    glassAlpha = 0.82,
    isMac = false,
    vertical = false,
    loading = false,
  } = {},
) {
  if (kind !== "widget" && kind !== "strip" && kind !== "console") {
    throw new TypeError(`Unsupported glass shell kind: ${kind}`);
  }

  // 主窗（console）与小组件/胶囊同一只锅：同一套 tint 档、同一个浓度变量、
  // 同一组前景规则。四窗摆在一起必须是同一块玻璃，不是"另一种玻璃"。
  const prefix =
    kind === "widget" ? "widget-shell" : kind === "strip" ? "strip-shell" : "console-shell";
  const classes = [prefix];
  if (kind === "strip") {
    classes.push(`${prefix}--${vertical ? "vertical" : "horizontal"}`);
  }
  if (transparent) {
    classes.push(`${prefix}--transparent`);
    if (glassMode === GLASS_MODES.css) classes.push(`${prefix}--glass-css`);
    // 透明档的文字颜色用户可选，两种颜色各自要配一种底：
    //   深色字 → 白霜（沿用浅色档那整套前景规则）
    //   白色字 → 深色薄 scrim（沿用深色档那套白色前景）
    // 不能混搭：白字压在白霜上实测 1.10:1，把霜从 0.28 加到 0.44 也只到 1.12:1。
    const clearInkLight = glassTint === "clear" && glassInk === "light";
    if (!isMac && (glassTint === "light" || (glassTint === "clear" && !clearInkLight))) {
      classes.push(`${prefix}--glass-light`);
    }
    if (!isMac && glassTint === "clear") {
      classes.push(`${prefix}--glass-clear`);
      if (clearInkLight) classes.push(`${prefix}--glass-ink-light`);
    }
  }
  if (isMac) classes.push(`${prefix}--mac`);
  if (kind === "widget" && loading) classes.push("is-loading");

  // 主窗是常驻工作区，不是氛围层：透明档不做边缘穿透（edgeInteractive），
  // 也不声称 true-alpha——大窗要完整接收指针事件（点空白也要能拖窗/选中），
  // clear 档只换材质不换交互。这是 console 与 widget/strip 唯一的实质差异。
  const edgeInteractive =
    kind !== "console"
    && transparent
    && !isMac
    && glassTint === "clear";
  const trueAlpha =
    kind !== "console"
    && edgeInteractive
    && glassMode === GLASS_MODES.alpha;

  return {
    className: classes.join(" "),
    style: transparent
      ? {
          "--glass-alpha": glassAlpha,
        }
      : {},
    edgeInteractive,
    trueAlpha,
  };
}
