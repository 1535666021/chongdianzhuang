/* ============================================================
 * 通用工具：ID / 日期 / 校验 / 筛选 / 统计
 * 规范：相同逻辑出现 ≥2 次一律收编到本模块，页面不重复实现
 * ============================================================ */

import dayjs from "dayjs";
import { OrderStatus, ORDER_STATUS_LABEL } from "@/types";
import type {
  BrandStat,
  ChargeBrand,
  MaterialItem,
  MaterialUsageStat,
  MonthStat,
  Order,
  OrderFilter,
  OrderStats,
  StatusStat,
} from "@/types";

/* ------------------------------------------------------------
 * 一、ID 与时间
 * ------------------------------------------------------------ */

/** 生成订单唯一 ID：时间戳 + 随机段，本地应用足够唯一 */
export function generateId(): string {
  const time = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `o_${time}_${rand}`;
}

/** 当前时间 ISO 字符串（createdAt / updatedAt） */
export function nowIso(): string {
  return new Date().toISOString();
}

/** 今天日期，YYYY-MM-DD（弹窗默认日期用） */
export function todayStr(): string {
  return dayjs().format("YYYY-MM-DD");
}

/** 格式化 ISO/日期字符串 → YYYY-MM-DD；非法输入原样返回 */
export function formatDate(value: string): string {
  const d = dayjs(value);
  return d.isValid() ? d.format("YYYY-MM-DD") : value;
}

/** 格式化 ISO 字符串 → YYYY-MM-DD HH:mm（列表展示更新时间） */
export function formatDateTime(value: string): string {
  const d = dayjs(value);
  return d.isValid() ? d.format("YYYY-MM-DD HH:mm") : value;
}

/* ------------------------------------------------------------
 * 二、校验
 * ------------------------------------------------------------ */

/** 手机号校验：大陆 11 位手机号 */
export function isValidPhone(phone: string): boolean {
  return /^1[3-9]\d{9}$/.test(phone.trim());
}

/* ------------------------------------------------------------
 * 三、金额与物料
 * ------------------------------------------------------------ */

/** 单个物料小计（元）；无单价返回 0 */
export function materialCost(item: MaterialItem): number {
  if (typeof item.unitPrice !== "number") return 0;
  return item.unitPrice * item.quantity;
}

/** 金额展示：千分位 + 保留两位小数 + ¥（如 ¥5,590.00） */
export function formatMoney(amount: number): string {
  return `¥${amount.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/* ------------------------------------------------------------
 * 四、订单筛选与排序（首页搜索筛选、各状态页共用）
 * ------------------------------------------------------------ */

/**
 * 按筛选条件过滤订单：
 * - keyword：匹配 姓名 / 电话 / 地址（不区分大小写）
 * - statuses：空数组 = 全部状态
 * - brandId：空字符串 = 全部品牌
 * - dateFrom/dateTo：按创建日期 YYYY-MM-DD 闭区间
 */
export function filterOrders(orders: Order[], filter: OrderFilter): Order[] {
  const keyword = filter.keyword.trim().toLowerCase();
  return orders.filter((order) => {
    if (keyword) {
      const haystack =
        `${order.customerName} ${order.customerPhone} ${order.address}`.toLowerCase();
      if (!haystack.includes(keyword)) return false;
    }
    if (filter.statuses.length > 0 && !filter.statuses.includes(order.status)) {
      return false;
    }
    if (filter.brandId && order.brandId !== filter.brandId) {
      return false;
    }
    if (filter.dateFrom) {
      const created = formatDate(order.createdAt);
      if (created < filter.dateFrom) return false;
    }
    if (filter.dateTo) {
      const created = formatDate(order.createdAt);
      if (created > filter.dateTo) return false;
    }
    return true;
  });
}

/** 列表统一排序：按更新时间倒序（首页/已预约/已完成复用） */
export function sortOrdersByUpdated(orders: Order[]): Order[] {
  return [...orders].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** 已预约页排序：按预约日期+时间段升序（最近的在前） */
export function sortOrdersByAppointment(orders: Order[]): Order[] {
  return [...orders].sort((a, b) => {
    const aKey = `${a.appointment?.appointmentDate ?? "9999"} ${a.appointment?.timeSlot ?? ""}`;
    const bKey = `${b.appointment?.appointmentDate ?? "9999"} ${b.appointment?.timeSlot ?? ""}`;
    return aKey.localeCompare(bKey);
  });
}

/* ------------------------------------------------------------
 * 五、统计计算（StatsPage 唯一数据源）
 * ------------------------------------------------------------ */

/** 由订单列表 + 品牌列表计算全部统计指标 */
export function calcOrderStats(
  orders: Order[],
  brands: ChargeBrand[],
): OrderStats {
  // 状态维度
  const byStatus: StatusStat[] = (
    Object.values(OrderStatus) as OrderStatus[]
  ).map((status) => ({
    status,
    count: orders.filter((o) => o.status === status).length,
  }));

  // 品牌维度
  const byBrand: BrandStat[] = brands.map((brand) => {
    const brandOrders = orders.filter((o) => o.brandId === brand.id);
    return {
      brandId: brand.id,
      brandName: brand.name,
      count: brandOrders.length,
      completedCount: brandOrders.filter(
        (o) => o.status === OrderStatus.Completed,
      ).length,
    };
  });

  // 月度维度（按 YYYY-MM 聚合，升序）
  const monthMap = new Map<string, MonthStat>();
  for (const order of orders) {
    const createdMonth = dayjs(order.createdAt).format("YYYY-MM");
    const entry = monthMap.get(createdMonth) ?? {
      month: createdMonth,
      created: 0,
      completed: 0,
    };
    entry.created += 1;
    monthMap.set(createdMonth, entry);

    if (order.completion?.completeDate) {
      const doneMonth = dayjs(order.completion.completeDate).format("YYYY-MM");
      const doneEntry = monthMap.get(doneMonth) ?? {
        month: doneMonth,
        created: 0,
        completed: 0,
      };
      doneEntry.completed += 1;
      monthMap.set(doneMonth, doneEntry);
    }
  }
  const byMonth: MonthStat[] = [...monthMap.values()].sort((a, b) =>
    a.month.localeCompare(b.month),
  );

  // 物料用量（汇总所有完工订单的实际物料）
  const materialMap = new Map<string, MaterialUsageStat>();
  for (const order of orders) {
    const materials = order.completion?.materials ?? [];
    for (const item of materials) {
      const key = `${item.name}|${item.spec}|${item.unit}`;
      const entry = materialMap.get(key) ?? {
        name: item.name,
        spec: item.spec,
        unit: item.unit,
        totalQuantity: 0,
        totalAmount: 0,
      };
      entry.totalQuantity += item.quantity;
      entry.totalAmount += materialCost(item);
      materialMap.set(key, entry);
    }
  }
  const materialUsage = [...materialMap.values()].sort(
    (a, b) => b.totalQuantity - a.totalQuantity,
  );

  // 平均完工周期（天）：创建 → 完工
  const completedOrders = orders.filter((o) => o.completion?.completeDate);
  const avgCompleteDays =
    completedOrders.length === 0
      ? 0
      : Math.round(
          (completedOrders.reduce((sum, o) => {
            const days = dayjs(o.completion!.completeDate).diff(
              dayjs(o.createdAt),
              "day",
            );
            return sum + Math.max(days, 0);
          }, 0) /
            completedOrders.length) *
            10,
        ) / 10;

  return {
    totalCount: orders.length,
    byStatus,
    byBrand,
    byMonth,
    materialUsage,
    avgCompleteDays,
  };
}

/** 状态文案快捷取值（组件里不想引整个 Record 时用） */
export function statusLabel(status: OrderStatus): string {
  return ORDER_STATUS_LABEL[status];
}
