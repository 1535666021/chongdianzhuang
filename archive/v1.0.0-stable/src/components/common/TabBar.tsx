/* ============================================================
 * 底部导航（App.tsx 根布局使用）
 * 5 个 Tab：首页 / 已预约 / 已完成 / 统计 / 设置
 * 阶段2-J1：emoji 全部替换为 Icon 线性图标（currentColor 色随文字，
 * 激活态由 .tab-bar__item--active 统一控制）；触控热区由
 * .tab-bar__item（min-height: var(--touch-target-min) = 44px）保证
 * 说明：材料库 Tab 从导航移除——TabKey.Materials 类型与 App.tsx 路由
 *      保留，入口迁至首页 page-header 右上角 .btn--icon 图标按钮
 * 首页角标：待勘测订单数（提醒待办）
 * 已预约角标（任务v32.2）：已预约订单数（提醒待上门），0 单不显示，
 *      与首页角标同位置同款 .tab-bar__badge
 * ============================================================ */

import { TabKey, TAB_LABEL, OrderStatus } from "@/types";
import { useApp } from "@/context/AppContext";
import { Icon } from "@/components/common/Icon";
import type { IconName } from "@/components/common/Icon";

interface TabBarProps {
  active: TabKey;
  onChange: (tab: TabKey) => void;
}

/** 导航 Tab（5 个）：TabKey + 图标名；材料库不在导航内 */
const NAV_TABS: ReadonlyArray<{ tab: TabKey; icon: IconName }> = [
  { tab: TabKey.Home, icon: "home" },
  { tab: TabKey.Appointment, icon: "calendar" },
  { tab: TabKey.Completed, icon: "check-circle" },
  { tab: TabKey.Stats, icon: "chart" },
  { tab: TabKey.Settings, icon: "settings" },
];

export function TabBar({ active, onChange }: TabBarProps) {
  const { orders } = useApp();
  const pendingCount = orders.filter(
    (o) => o.status === OrderStatus.Pending,
  ).length;
  /* 已预约角标（任务v32.2）：已预约订单数，0 单不显示 */
  const appointedCount = orders.filter(
    (o) => o.status === OrderStatus.Appointed,
  ).length;

  return (
    <nav className="tab-bar" aria-label="底部导航">
      {NAV_TABS.map(({ tab, icon }) => (
        <button
          key={tab}
          type="button"
          className={
            active === tab ? "tab-bar__item tab-bar__item--active" : "tab-bar__item"
          }
          onClick={() => onChange(tab)}
        >
          {/* 22px 对齐原 emoji 字号（--font-size-xxl），色随文字 currentColor */}
          <Icon name={icon} size={22} className="tab-bar__icon" />
          <span>{TAB_LABEL[tab]}</span>
          {tab === TabKey.Home && pendingCount > 0 ? (
            <span className="tab-bar__badge">{pendingCount}</span>
          ) : null}
          {tab === TabKey.Appointment && appointedCount > 0 ? (
            <span className="tab-bar__badge">{appointedCount}</span>
          ) : null}
        </button>
      ))}
    </nav>
  );
}
