/* ============================================================
 * 根布局
 * 结构：app-shell 居中容器 → 当前 Tab 页面 → 底部导航 → 全局 Toast
 * 说明：本地单页应用，采用 Tab 状态切换（无路由跳转），
 *      切换 Tab 不丢页面状态的诉求由 context 全局状态保证
 * 阶段2-J1：材料库从底部导航移除，首页经 onNavigate 透传拿到
 *      Tab 切换能力（page-header 右上角材料库入口使用）
 * ============================================================ */

import { useState } from "react";
import { TabKey } from "@/types";
import { TabBar } from "@/components/common/TabBar";
import { Toast } from "@/components/common/Toast";
import { HomePage } from "@/pages/HomePage";
import { AppointmentPage } from "@/pages/AppointmentPage";
import { CompletedPage } from "@/pages/CompletedPage";
import { StatsPage } from "@/pages/StatsPage";
import { MaterialsPage } from "@/pages/MaterialsPage";
import { SettingsPage } from "@/pages/SettingsPage";

export function App() {
  const [activeTab, setActiveTab] = useState<TabKey>(TabKey.Home);

  return (
    <div className="app-shell">
      {activeTab === TabKey.Home && <HomePage onNavigate={setActiveTab} />}
      {activeTab === TabKey.Appointment && <AppointmentPage />}
      {activeTab === TabKey.Completed && <CompletedPage />}
      {activeTab === TabKey.Stats && <StatsPage />}
      {activeTab === TabKey.Materials && <MaterialsPage />}
      {activeTab === TabKey.Settings && <SettingsPage />}

      <TabBar active={activeTab} onChange={setActiveTab} />
      <Toast />
    </div>
  );
}
