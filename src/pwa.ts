/* ============================================================
 * PWA：Service Worker 注册 + 版本升级检测
 * 配合 vite.config.ts 的 VitePWA（registerType: "prompt"）：
 * - 检测到新版本 → 弹确认框，用户同意后立即刷新换新版
 * - 离线就绪 → 控制台提示（本地应用主要场景即离线使用）
 * ============================================================ */

import { registerSW } from "virtual:pwa-register";

/**
 * 初始化 PWA（在 main.tsx 中调用一次）
 * 仅在生产构建生效；开发环境 vite-plugin-pwa 未启用时自动跳过
 */
export function initPwa(): void {
  if (!("serviceWorker" in navigator)) return;

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      const ok = window.confirm(
        "检测到新版本，是否立即更新？\n（更新不会丢失本地订单数据）",
      );
      if (ok) {
        void updateSW(true);
      }
    },
    onOfflineReady() {
      console.info("[PWA] 应用已可离线使用");
    },
    onRegisterError(error) {
      console.error("[PWA] Service Worker 注册失败", error);
    },
  });
}
