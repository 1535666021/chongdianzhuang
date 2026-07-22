/* ============================================================
 * 成本映射层：成本表查询（完工成本自动计算用）
 * 规范：成本映射数据与查询逻辑只此一处，
 *      页面/组件经 storage.ts 读取映射后调用本模块纯函数查询
 * 依赖铁则：本模块禁止 import storage（storage.ts → costMapping.ts 单向）
 * ============================================================ */

import type { MaterialItem, CostSheetItem } from "@/types";

/* ------------------------------------------------------------
 * 一、材料库条目最小契约（兼容接口，保留用于非成本核算场景）
 * ------------------------------------------------------------ */

export interface MatLibEntry {
  name: string;
  costPrice?: number;
  salePrice?: number;
  spec?: string;
  unit?: string;
}

/* ------------------------------------------------------------
 * 二、材料库价格查询（保留用于非成本核算场景）
 * ------------------------------------------------------------ */

/**
 * 按名称在材料库中模糊匹配价格：
 * 1. 先精确匹配 name → 再 includes 双向模糊匹配
 * 2. 价格口径：成本价优先，无成本价用销售价
 * 3. 全不中返回 null
 */
export function findMaterialPrice(name: string, lib: MatLibEntry[]): number | null {
  if (!name || lib.length === 0) return null;
  const match = lib.find((m) => name.includes(m.name) || m.name.includes(name));
  if (!match) return null;
  const cp = typeof match.costPrice === "number" && match.costPrice > 0 ? match.costPrice : 0;
  const sp = typeof match.salePrice === "number" ? match.salePrice : 0;
  const price = cp > 0 ? cp : sp > 0 ? sp : null;
  return price !== null ? price : null;
}

/* ------------------------------------------------------------
 * 三、成本表查询（v36.2-P3：成本核算唯一对接成本表）
 * ------------------------------------------------------------ */

/**
 * 成本表转材料库格式（兼容现有 MatLibEntry 接口，零签名破坏）
 */
export function costSheetToMatLib(costSheet: CostSheetItem[]): MatLibEntry[] {
  return costSheet.map((c) => ({
    name: c.name,
    costPrice: c.costPrice,
    unit: c.unit,
  }));
}

/**
 * 按名称在成本表中模糊匹配价格（成本结算专用）
 * 全不中返回 null（由调用方提示「未绑定」并弹出选择弹窗）
 */
export function findCostSheetPrice(name: string, costSheet: CostSheetItem[]): number | null {
  if (!name || costSheet.length === 0) return null;
  const match = costSheet.find((c) => name.includes(c.name) || c.name.includes(name));
  if (!match) return null;
  const cp = typeof match.costPrice === "number" && match.costPrice > 0 ? match.costPrice : 0;
  return cp > 0 ? cp : null;
}
