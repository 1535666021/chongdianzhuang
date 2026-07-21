/* ============================================================
 * 成本映射层：固定辅材清单 + 材料库价格查询（完工成本自动计算用）
 * 规范：成本映射数据与查询逻辑只此一处，
 *      页面/组件经 storage.ts 读取映射后调用本模块纯函数查询
 * 依赖铁则：本模块禁止 import storage（storage.ts → costMapping.ts 单向）
 * ============================================================ */

import type { MaterialItem } from "@/types";

/* ------------------------------------------------------------
 * 一、固定辅材清单
 * ------------------------------------------------------------ */

/** 固定辅材清单：套包内不向客户收费、但内部要计成本的辅材（完工成本自动计算用） */
export const FIXED_AUX_MATERIALS: MaterialItem[] = [
  { name: "漏保开关", spec: "40A", quantity: 1, unit: "个", unitPrice: 45 },
  { name: "PVC管", spec: "Φ32", quantity: 6, unit: "米", unitPrice: 3.5 },
  { name: "扎带+胶带辅材包", spec: "标准", quantity: 1, unit: "包", unitPrice: 10 },
];

/* ------------------------------------------------------------
 * 二、默认漏保价格映射
 * ------------------------------------------------------------ */

/** 默认漏保价格映射：规格 → 单价 */
export const DEFAULT_BREAKER_PRICE_MAP: Record<string, number> = {
  C25: 35,
  C40: 45,
  C40A: 55,
};

/* ------------------------------------------------------------
 * 三、材料库价格查询
 * ------------------------------------------------------------ */

/** 材料库条目最小契约 */
export interface MatLibEntry {
  name: string;
  costPrice?: number;
  salePrice?: number;
  spec?: string;
  unit?: string;
}

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
