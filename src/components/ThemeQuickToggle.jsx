import { useEffect, useRef, useState } from "react";
import { Check, Moon, Sun } from "@phosphor-icons/react";
import { THEME_OPTIONS } from "../lib/glass.js";


/// 标题栏的主题快捷键：单击在亮/暗之间切换，右键（或长按）弹出含「自动」的
/// 三选菜单——单击不进「自动」是刻意的：一次点击只该有一个确定结果，
/// 而「自动」的结果取决于系统当前是什么。
export function ThemeQuickToggle({ theme, darkTheme, onThemeChange }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const dismiss = (event) => {
      if (!wrapRef.current?.contains(event.target)) setMenuOpen(false);
    };
    const onEscape = (event) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", onEscape);
    };
  }, [menuOpen]);

  const label = theme === "auto" ? "自动（跟随系统）" : theme === "dark" ? "暗色" : "亮色";
  return (
    <div className="theme-quick" ref={wrapRef}>
      <button
        type="button"
        className={`window-action ${menuOpen ? "window-action--active" : ""}`}
        onClick={() => onThemeChange(darkTheme ? "light" : "dark")}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenuOpen((open) => !open);
        }}
        aria-label={`切换明暗，当前${label}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title={`当前：${label}\n点击切换明暗 · 右键选择模式`}
      >
        {darkTheme ? (
          <Moon size={16} weight="light" aria-hidden="true" />
        ) : (
          <Sun size={16} weight="light" aria-hidden="true" />
        )}
      </button>
      {menuOpen && (
        <div className="theme-quick-menu" role="menu">
          {THEME_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="menuitemradio"
              aria-checked={theme === option.id}
              className={theme === option.id ? "is-selected" : ""}
              onClick={() => {
                onThemeChange(option.id);
                setMenuOpen(false);
              }}
            >
              {option.label}
              {theme === option.id && <Check size={13} weight="bold" aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

