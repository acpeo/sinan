import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/newsreader/400.css";
import { App } from "./App.jsx";
import { installExternalLinkHandler } from "./lib/externalLinks.js";
import "./styles/index.css";

document.documentElement.dataset.runtime = window.__TAURI_INTERNALS__ ? "desktop" : "browser";
// 文档链接在 Tauri 里必须走 opener（裸 target="_blank" 会被 webview 丢掉）。
installExternalLinkHandler();

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
