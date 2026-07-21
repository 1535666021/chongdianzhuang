/* ============================================================
 * 成本映射层：固定辅材清单 + 增项→成本映射（完工成本自动计算用）
 * 规范：成本映射数据与查询逻辑只此一处，
 *      页面/组件经 storage.ts 读取映射后调用本模块纯函数查询
 * 依赖铁则：本模块禁止 import storage（storage.ts → costMapping.ts 单向）
 * ============================================================ */

import type { CostMapping, MaterialItem } from "@/types";

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
 * 二、默认增项→成本映射
 * ------------------------------------------------------------ */

/** 默认增项→成本映射（用户未配置时 storage 层回退用，SettingsPage 可改） */
export const DEFAULT_COST_MAPPINGS: CostMapping[] = [
  { addonName: "电缆", costName: "电缆YJV-3×6", unitPrice: 18 },
  { addonName: "PVC管", costName: "PVC管Φ32", unitPrice: 3.5 },
  { addonName: "漏保开关", costName: "漏保40A", unitPrice: 45 },
  { addonName: "空气开关", costName: "空开63A", unitPrice: 35 },
  { addonName: "接地装置", costName: "接地极+接地线", unitPrice: 80 },
  { addonName: "打孔", costName: "墙体打孔", unitPrice: 50 },
  { addonName: "立柱", costName: "充电桩立柱", unitPrice: 150 },
];

/* ------------------------------------------------------------
 * 三、映射查询（先精确匹配，再 includes 模糊匹配，mappings 顺序优先）
 * ------------------------------------------------------------ */

/** 按增项名查找映射：先精确匹配 addonName，再 includes 模糊匹配（mappings 顺序优先） */
function findMapping(
  addonName: string,
  mappings: CostMapping[],
): CostMapping | undefined {
  const exact = mappings.find((m) => m.addonName === addonName);
  if (exact) return exact;
  return mappings.find(
    (m) => addonName.includes(m.addonName) || m.addonName.includes(addonName),
  );
}

/** 增项名 → 成本名（查不到原样返回 addonName） */
export function getCostName(
  addonName: string,
  mappings: CostMapping[],
): string {
  return findMapping(addonName, mappings)?.costName ?? addonName;
}

/** 增项名 → 成本单价（查不到返回 0） */
export function queryCostPrice(
  addonName: string,
  mappings: CostMapping[],
): number {
  return findMapping(addonName, mappings)?.unitPrice ?? 0;
}
