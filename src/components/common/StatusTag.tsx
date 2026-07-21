/* ============================================================
 * 订单状态标签（全项目唯一实现）
 * 映射：types 的 OrderStatus → index.css 的 .tag--{status} 类
 * ============================================================ */

import { ORDER_STATUS_LABEL } from "@/types";
import type { OrderStatus } from "@/types";

interface StatusTagProps {
  status: OrderStatus;
}

export function StatusTag({ status }: StatusTagProps) {
  return <span className={`tag tag--${status}`}>{ORDER_STATUS_LABEL[status]}</span>;
}
