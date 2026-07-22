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

/* 🛡️ 渲染完成后隐藏离线加载提示（双重保险：立即+延迟） */
const hideLoading = () => {
  const el = document.getElementById("loading-screen");
  if (el) el.style.display = "none";
};
hideLoading();                    // 第1次：立即尝试
setTimeout(hideLoading, 100);     // 第2次：100ms后确保（React渲染已完成）
