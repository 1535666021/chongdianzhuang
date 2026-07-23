/* ============================================================
 * 固定辅材逻辑层（v36.2-P3）：漏保规格默认 / 成本表价格查询
 * 规范：业务逻辑收敛 src/lib；
 * 依赖铁则：本模块禁止 import storage（成本表由调用方读取后传入）
 * ============================================================ */

import type { FixedAuxSelection, Order } from "@/types";
import { findCostSheetPrice } from "./costMapping";
import type { CostSheetItem } from "@/types";

/* ------------------------------------------------------------
 * 一、漏保规格档位
 * ------------------------------------------------------------ */

/** 漏保规格档位（固定三档，FixedMaterialsDialog 下拉数据源） */
export const BREAKER_SPECS = ["C25", "C40", "C40A"] as const;

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
 * 三、成本表漏保价查询
 * ------------------------------------------------------------ */

/**
 * 从成本表查询漏保价（v36.2-P3：唯一对接成本表）
 * 无命中返回 null（成本按 0 计）
 */
export function findBreakerPriceFromCostSheet(
  spec: string,
  costSheet: CostSheetItem[],
): number | null {
  return findCostSheetPrice(`漏保 ${spec}`, costSheet);
}

/* ------------------------------------------------------------
 * 四、默认固定辅材选择（弹窗初始化用）
 * ------------------------------------------------------------ */

/**
 * 默认固定辅材选择：漏保规格按功率/品牌默认，漏保价查成本表。
 * 无命中 → breakerPrice=null（由子窗口置空并提示去设置页成本表绑定）。
 * PVC 米数默认=用线米数。
 * 成本表由调用方读取后传入（本模块铁则不 import storage）。
 */
export function defaultFixedAux(
  order: Order,
  brandName: string,
  cableMeters: number,
  costSheet: CostSheetItem[],
): FixedAuxSelection {
  const breakerSpec = defaultBreakerSpec(order.powerKw, brandName);
  const breakerPrice = findBreakerPriceFromCostSheet(breakerSpec, costSheet);
  const leakBoxPrice = findCostSheetPrice("漏保盒", costSheet);
  return {
    breakerSpec,
    breakerPrice,
    pvcMeters: cableMeters,
    leakBoxPrice,
  };
}

/* ------------------------------------------------------------
 * 五、固定辅材成本（v36.2-P3：全部走成本表）
 * ------------------------------------------------------------ */

/**
 * 固定辅材成本 = 漏保单价×1 + PVC米数×PVC成本表单价 + 漏保盒成本表单价
 * 无命中项按 0 计，结果 round2 分位防浮点
 */
export function calcFixedAuxCostV2(
  sel: FixedAuxSelection,
  costSheet: CostSheetItem[],
): number {
  const pvcUnitPrice = sel.pvcPrice ?? findCostSheetPrice("PVC管", costSheet) ?? 0;
  const leakBoxUnitPrice = sel.leakBoxPrice ?? findCostSheetPrice("漏保盒", costSheet) ?? 0;
  return round2(
    (sel.breakerPrice ?? 0) * 1 +
      sel.pvcMeters * pvcUnitPrice +
      leakBoxUnitPrice,
  );
}
