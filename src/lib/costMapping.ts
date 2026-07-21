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
 * 二增、从成本表查漏保价格（v36.2-P1 修正：查 cp_cost_sheet，非硬编码）
 *   保留作用：当 cp_cost_sheet 有数据（v7老备份）时可用，v1 备份不导出此表常为空
 * ------------------------------------------------------------
 * 二增2、从成本映射查漏保价格（v36.2-P1 二次修正：查 cp_cost_mappings）
 *   用途：成本映射表（设置页「成本映射」可编辑，v1 备份导出后可通过
 *         importBackup 恢复 DEFAULT_COST_MAPPINGS）作为主兜底；
 *   规则：addonName 含"漏保"类关键词 + 规格串或数字匹配
 *   匹配成功自动填入单价，匹配失败返回 null（提示去设置页成本映射绑定）
 * ------------------------------------------------------------
 *   查价顺序：材料库 → 成本映射（v1 备份可恢复+设置页可改）
 * ------------------------------------------------------------ */

/** 成本表条目最小契约（CostSheetItem 子集，本模块不入 storage 铁则） */
export interface CostTableEntry {
  name: string;
  costPrice: number;
}

/** 是否漏保类条目：name/addonName 含"漏保"或"漏电保护" */
function isBreakerName(name: string): boolean {
  return name.includes("漏保") || name.includes("漏电保护");
}

/** 是否漏保类映射：addonName 含"漏保"类关键词 */
function isBreakerMapping(addonName: string): boolean {
  return (
    addonName.includes("漏保") ||
    addonName.includes("漏电") ||
    addonName.includes("空气开关")
  );
}

/**
 * 在成本表中搜索漏保对应规格的价格（三级递退）：
 * 1. name 直接含规格串（如 "C40A"、"C25"）；
 * 2. 漏保类条目且 name 含规格数字部分（25/40）；
 * 3. 首个漏保类条目；
 * 全不中返回 null。
 */
export function findBreakerPriceInCostSheet(
  spec: string,
  costSheet: CostTableEntry[],
): number | null {
  const specLower = spec.trim().toLowerCase();
  if (!specLower) return null;

  /* 1. name 直接含规格串 */
  const direct = costSheet.find((c) =>
    c.name.toLowerCase().includes(specLower),
  );
  if (direct) return direct.costPrice;

  /* 2. 漏保类条目且 name 含规格数字 */
  const digits = spec.replace(/\D/g, "");
  if (digits) {
    const byDigits = costSheet.find(
      (c) => isBreakerName(c.name) && c.name.includes(digits),
    );
    if (byDigits) return byDigits.costPrice;
  }

  /* 3. 首个漏保类条目 */
  const any = costSheet.find((c) => isBreakerName(c.name));
  return any ? any.costPrice : null;
}

/**
 * v36.2-P1 二次修正：在成本映射表中搜索漏保价格（三级递退）：
 * 1. addonName 直接含规格串（如 "漏保 C40A"、含"C25"）；
 * 2. addonName 含"漏保/漏电/空气开关"关键词 + 规格数字（25/40）；
 * 3. 首个漏保/空开类映射；
 * 全不中返回 null（提示去设置页成本映射绑定）。
 *
 * 这张表是 v1 备份导入时由 DEFAULT_COST_MAPPINGS 兜底、设置页可编辑的，
 * 是所有用户都能访问的表，比 cp_cost_sheet 更适合做兜底。
 */
export function findBreakerPriceInCostMappings(
  spec: string,
  mappings: CostMapping[],
): number | null {
  const specLower = spec.trim().toLowerCase();
  if (!specLower) return null;

  /* 1. addonName 直接含规格串 */
  const direct = mappings.find((m) =>
    m.addonName.toLowerCase().includes(specLower),
  );
  if (direct) return direct.unitPrice;

  /* 2. 漏保/空开类映射且 addonName 含规格数字 */
  const digits = spec.replace(/\D/g, "");
  if (digits) {
    const byDigits = mappings.find(
      (m) => isBreakerMapping(m.addonName) && m.addonName.includes(digits),
    );
    if (byDigits) return byDigits.unitPrice;
  }

  /* 3. 首个漏保/空开类映射 */
  const any = mappings.find((m) => isBreakerMapping(m.addonName));
  return any ? any.unitPrice : null;
}

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
