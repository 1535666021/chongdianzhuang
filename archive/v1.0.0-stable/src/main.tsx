/* ============================================================
 * 应用入口
 * 挂载顺序：index.css 全局样式 → AppProvider 全局状态 → App 根布局
 * ============================================================ */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/index.css";
import { AppProvider } from "@/context/AppContext";
import { App } from "@/App";
import { initPwa } from "@/pwa";

const container = document.getElementById("root");
if (!container) {
  throw new Error("未找到 #root 挂载点，请检查 index.html");
}

createRoot(container).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>,
);

/* 根渲染完成后初始化 PWA（SW 注册 + 版本升级检测） */
initPwa();
