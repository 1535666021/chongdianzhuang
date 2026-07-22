/* ============================================================
 * 空状态占位（各列表页复用）
 * ============================================================ */

import type { ReactNode } from "react";
import { Icon } from "@/components/common/Icon";

interface EmptyStateProps {
  /** 图标（统一 SVG Icon 节点，如 <Icon name="box" size={48} />） */
  icon?: ReactNode;
  text: string;
  /** 可选操作区，如"新建订单"按钮 */
  action?: ReactNode;
}

export function EmptyState({ icon, text, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="empty-state__icon text-tertiary">
        {icon ?? <Icon name="box" size={48} />}
      </div>
      <div className="empty-state__text">{text}</div>
      {action}
    </div>
  );
}
