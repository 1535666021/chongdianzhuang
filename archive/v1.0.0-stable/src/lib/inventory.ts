/* ============================================================
 * 桩库存唯一数据层（cp_inventory / StockItem[]，total 允许负数=超发挂账）
 * 规范：库存的查询、增减、格式化统一走本模块，页面/组件禁止自算；
 *      完工 -1 / 取消回库的调用钩子由主控接 AppContext
 *      （本模块为纯函数，不碰 context / storage，调用方负责
 *        loadInventory 读入、saveInventory 写回）
 * ============================================================ */

import type { StockItem } from "@/types";

/**
 * 查询某品牌当前库存总数；无该品牌条目按 0 计
 */
export function getStock(brand: string, inventory: StockItem[]): number {
  return inventory.find((item) => item.brand === brand)?.total ?? 0;
}

/**
 * 调整某品牌库存（delta 可正可负：完工 -1 / 取消回库 +1）
 * - 无该品牌条目则新建（初始 0 + delta）
 * - 返回新数组，不修改入参（调用方 saveInventory 写回）
 */
export function adjustStock(
  brand: string,
  delta: number,
  inventory: StockItem[],
): StockItem[] {
  const index = inventory.findIndex((item) => item.brand === brand);
  if (index < 0) {
    return [...inventory, { brand, total: delta }];
  }
  return inventory.map((item, i) =>
    i === index ? { ...item, total: item.total + delta } : item,
  );
}

/**
 * 库存展示：带符号字符串（正数 +3 / 零 0 / 负数 -2）
 * 负数红色等语义样式由视图层处理，这里只返回带符号字符串
 */
export function formatStock(total: number): string {
  return total > 0 ? `+${total}` : String(total);
}
