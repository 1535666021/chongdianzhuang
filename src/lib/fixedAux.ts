/* ============================================================
 * 固定辅材逻辑层（任务v36）：漏保规格默认 / 材料库漏保价模糊匹配 / 固定辅材成本
 * 规范：业务逻辑收敛 src/lib；
 * 依赖铁则：本模块禁止 import storage（材料库由调用方读取后传入，
 *      与 costMapping.ts / finance.ts 同一规则，保证纯函数可测）
 * ============================================================ */

import type { FixedAuxSelection, MaterialItemLib, Order } from "@/types";
import { DEFAULT_BREAKER_PRICE_MAP } from "./costMapping";

/* ------------------------------------------------------------
 * 一、漏保规格与兜底常量
 * ------------------------------------------------------------ */

/** 漏保规格档位（固定三档，FixedMaterialsDialog 下拉数据源） */
export const BREAKER_SPECS = ["C25", "C40", "C40A"] as const;

/** 漏保兜底价（元）：材料库模糊匹配不中时调用方使用，对齐 FIXED_AUX_MATERIALS 漏保开关 45 */
export const FALLBACK_BREAKER_PRICE = 45;

/** 扎带+胶带辅材包固定价（元）：沿用 FIXED_AUX_MATERIALS 第三项口径（×1 包） */
export const TIE_TAPE_PACK_PRICE = 10;

/** 金额保留两位小数（与 finance.round2 同口径，分位防浮点） */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/* ------------------------------------------------------------
 * 二、默认漏保规格
 * ------------------------------------------------------------ */

/**
 * 默认漏保规格：品牌名含"零跑"→"C40A"（A 型漏保）；
 * 否则按功率：<=3.5kW→"C25"，>3.5kW→"C40"（7kW→C40）
 */
export function defaultBreakerSpec(powerKw: number, brandName: string): string {
  if (brandName.includes("零跑")) return "C40A";
  return powerKw <= 3.5 ? "C25" : "C40";
}

/* ------------------------------------------------------------
 * 三、材料库漏保价模糊匹配
 * ------------------------------------------------------------ */

/** 条目成本口径单价：优先成本价 costPrice，无成本价（0/缺省）用销售价 salePrice */
function costBasisPrice(item: MaterialItemLib): number {
  return item.costPrice > 0 ? item.costPrice : item.salePrice;
}

/** 是否漏保条目：名称含"漏保"或"漏电保护" */
function isBreakerItem(name: string): boolean {
  return name.includes("漏保") || name.includes("漏电保护");
}

/**
 * 材料库模糊匹配漏保价（大小写不敏感），四级递退：
 * 1. 名称直接含规格串（如 "C40A"，零跑"漏电保护开关（2P C40A型…）"命中）；
 * 2. 漏保/漏电保护条目且名称含规格数字部分（25 / 40）；
 * 3. 首个漏保/漏电保护条目；
 * 4. v36.2-P1：前三级不中→查 DEFAULT_BREAKER_PRICE_MAP 兜底（C25=35, C40=45, C40A=55）；
 * 全不中返回 null（由子窗口置空并提示绑定）。
 * 价格口径：成本价优先，无成本价用销售价。
 */
export function findBreakerPrice(
  spec: string,
  lib: MaterialItemLib[],
): number | null {
  const specLower = spec.trim().toLowerCase();
  if (!specLower) return null;

  /* 1. 名称直接含规格串（大小写不敏感） */
  const direct = lib.find((m) => m.name.toLowerCase().includes(specLower));
  if (direct) return costBasisPrice(direct);

  /* 2. 漏保/漏电保护条目且含规格数字部分（如 "C25"→"25"、"C40"→"40"） */
  const digits = spec.replace(/\D/g, "");
  if (digits) {
    const byDigits = lib.find(
      (m) => isBreakerItem(m.name) && m.name.includes(digits),
    );
    if (byDigits) return costBasisPrice(byDigits);
  }

  /* 3. 首个漏保/漏电保护条目 */
  const anyBreaker = lib.find((m) => isBreakerItem(m.name));
  if (anyBreaker) return costBasisPrice(anyBreaker);

  /* 4. v36.2-P1：DEFAULT_BREAKER_PRICE_MAP 兜底（规格精确匹配） */
  const price = DEFAULT_BREAKER_PRICE_MAP[spec.trim()];
  if (price !== undefined) return price;

  return null;
}

/* ------------------------------------------------------------
 * 四、默认固定辅材选择（弹窗初始化用）
 * ------------------------------------------------------------ */

/**
 * 默认固定辅材选择：漏保规格按功率/品牌默认，漏保价材料库模糊匹配；
 * 任务v36.1 FAIL-3：未命中→breakerPrice=null（严禁自动填兜底数，
 * 由子窗口置空并提示「未匹配价格，请到设置页成本表绑定」），
 * PVC 米数默认=用线米数。材料库由调用方 loadMaterialsLib() 读取后传入。
 */
export function defaultFixedAux(
  order: Order,
  brandName: string,
  cableMeters: number,
  lib: MaterialItemLib[],
): FixedAuxSelection {
  const breakerSpec = defaultBreakerSpec(order.powerKw, brandName);
  return {
    breakerSpec,
    breakerPrice: findBreakerPrice(breakerSpec, lib),
    pvcMeters: cableMeters,
  };
}

/* ------------------------------------------------------------
 * 五、固定辅材成本（V2：按快照取值源计算）
 * ------------------------------------------------------------ */

/**
 * 固定辅材成本 = 漏保单价×1 + PVC米数×PVC单价 + 扎带+胶带辅材包 10
 * （扎带包沿用 FIXED_AUX_MATERIALS 第三项口径；结果 round2 分位防浮点；
 *  任务v36.1 FAIL-3：漏保价 null（未匹配）→ 漏保项计 0，不兜底乱价）
 */
export function calcFixedAuxCostV2(
  sel: FixedAuxSelection,
  pvcUnitPrice: number,
): number {
  return round2(
    (sel.breakerPrice ?? 0) * 1 +
      sel.pvcMeters * pvcUnitPrice +
      TIE_TAPE_PACK_PRICE,
  );
}
