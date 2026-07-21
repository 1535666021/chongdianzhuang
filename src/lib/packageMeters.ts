/* ============================================================
 * 套包账目逻辑（任务v35 一 · 业务逻辑唯一收敛处；v35.1 计费改造）
 * 职责：套包米数识别（A 原文 / B 手填兜底由调用方持久化到 order.packageMeters）
 *      / 超出米数计算 / 增项线缆敷设行同步 / 话术超出行文本
 * 口径：超出米数 = 布线总距离 − 该单套包米数（≤0 按 0=无超出）；
 *      套包内明细不对客户展开，话术只摆超出部分价格计算
 * v35.1：线缆敷设行常驻（quantity=布线总量，≤套包无单价=不计费），
 *      计费按 (总量−套包)×单价；新增 syncCableRowV2 / cableChargeAmount /
 *      addonTotalWithCable / buildCableOverFeeTextV2（v35 旧导出全保留）
 * ============================================================ */

import type { MaterialItem, Order } from "@/types";

/** 增项区「线缆敷设」行名（自动同步识别依据；用户改名后视为普通增项不再同步） */
export const CABLE_ADDON_ROW_NAME = "线缆敷设";

/* ------------------------------------------------------------
 * A·套包米数识别（从订单原文）
 * 覆盖模式（按优先级首个命中）：
 *   「套包米数:30米」（v7 原文标准字段）/「30米套包」「30米套餐」/
 *   「套包30米」「套餐30米」/「含40米线」/「免费30米」「30米免费」
 * ------------------------------------------------------------ */
const PACKAGE_PATTERNS: RegExp[] = [
  /套包米数[:：]\s*(\d+(?:\.\d+)?)\s*米/,
  /(\d+(?:\.\d+)?)\s*米\s*(?:套包|套餐)/,
  /(?:套包|套餐)\s*(?:含|内|免费)?\s*(\d+(?:\.\d+)?)\s*米/,
  /含\s*(\d+(?:\.\d+)?)\s*米\s*线/,
  /免费\s*(\d+(?:\.\d+)?)\s*米/,
  /(\d+(?:\.\d+)?)\s*米\s*免费/,
];

/** 从 originalText 识别套包免费米数；识别不到返回 null（调用方走 B 手填兜底） */
export function parsePackageMetersFromText(
  originalText: string,
): number | null {
  for (const re of PACKAGE_PATTERNS) {
    const m = originalText.match(re);
    if (m) {
      const v = Number(m[1]);
      if (Number.isFinite(v) && v > 0) return v;
    }
  }
  return null;
}

/** 该单套包米数取数链：已持久化值 → 原文识别 → null（=无套包信息，手填兜底） */
export function resolveOrderPackageMeters(order: Order): number | null {
  if (typeof order.packageMeters === "number" && order.packageMeters > 0) {
    return order.packageMeters;
  }
  return parsePackageMetersFromText(order.originalText ?? "");
}

/* ------------------------------------------------------------
 * 超出计算与增项行同步
 * ------------------------------------------------------------ */

/** 超出米数 = 布线总距离 − 套包米数（≤0 按 0=无超出；布线未填按 0） */
export function getOverMeters(
  packageMeters: number,
  cableDistance: number | undefined | null,
): number {
  if (cableDistance == null || !Number.isFinite(cableDistance)) return 0;
  const over = Math.round((cableDistance - packageMeters) * 100) / 100;
  return over > 0 ? over : 0;
}

/**
 * 布线距离 → 同步「线缆敷设」增项行（与 v29 syncOverFeeRow 同语义、v35 行名）：
 * - 超出 > 0：移除既有同名行后按最新值追加
 *   （name=线缆敷设 / quantity=超出米数 / unit=米 / unitPrice=单价）；
 * - 超出 ≤0 或布线未填：移除同名行（不出现）；
 * - 其他增项行（含用户手调/新增）一律原样保留；
 * - 用户把该行改名后视为普通增项，不再参与自动同步
 */
export function syncCableAddonRow(
  materials: MaterialItem[],
  cableDistance: number | undefined,
  packageMeters: number,
  unitPrice: number,
): MaterialItem[] {
  const others = materials.filter(
    (m) => m.name.trim() !== CABLE_ADDON_ROW_NAME,
  );
  const overMeters = getOverMeters(packageMeters, cableDistance);
  if (overMeters <= 0) return others;
  return [
    ...others,
    {
      name: CABLE_ADDON_ROW_NAME,
      spec: "",
      quantity: overMeters,
      unit: "米",
      unitPrice,
    },
  ];
}

/* ------------------------------------------------------------
 * 话术文本（只摆超出部分价格计算）
 * ------------------------------------------------------------ */

/** 超出行话术格式：布线X米，超出套餐Y米×¥单价=¥Z（金额分位防浮点） */
export function buildCableOverFeeText(
  cableDistance: number,
  overMeters: number,
  unitPrice: number,
): string {
  const fee = Math.round(overMeters * unitPrice * 100) / 100;
  return `布线${cableDistance}米，超出套餐${overMeters}米×¥${unitPrice}=¥${fee}`;
}

/* ------------------------------------------------------------
 * v35.1 计费改造：线缆行常驻 + 按 (总量−套包)×单价 计费
 * ------------------------------------------------------------ */

/**
 * 布线总量 → 同步「线缆敷设」增项行 V2（行常驻）：
 * - 总量有效(>0)：移除既有同名行后按最新值重插到首行
 *   （name=线缆敷设 / spec="" / quantity=布线总量 / unit=米；
 *   总量>套包米数 才带 unitPrice，≤套包无单价=不计费）；
 * - 总量为空/非数/≤0：移除同名行；
 * - 其他增项行（含用户手调/新增）一律原样保留、相对顺序不变；
 * - 用户把该行改名后视为普通增项，不再参与自动同步
 */
export function syncCableRowV2(
  materials: MaterialItem[],
  totalCable: number | undefined,
  packageMeters: number,
  unitPrice: number,
): MaterialItem[] {
  const others = materials.filter(
    (m) => m.name.trim() !== CABLE_ADDON_ROW_NAME,
  );
  if (totalCable == null || !Number.isFinite(totalCable) || totalCable <= 0) {
    return others;
  }
  const row: MaterialItem = {
    name: CABLE_ADDON_ROW_NAME,
    spec: "",
    quantity: totalCable,
    unit: "米",
    unitPrice: totalCable > packageMeters ? unitPrice : undefined,
  };
  return [row, ...others];
}

/**
 * 该行的客户线缆计费：row 是「线缆敷设」行且 quantity>套包米数且 unitPrice
 * 有效 → (quantity−套包米数)×unitPrice（分位防浮点）；否则 0
 */
export function cableChargeAmount(
  row: MaterialItem | undefined,
  packageMeters: number,
): number {
  if (!row || row.name.trim() !== CABLE_ADDON_ROW_NAME) return 0;
  if (!Number.isFinite(row.quantity) || row.quantity <= packageMeters) return 0;
  if (row.unitPrice == null || !Number.isFinite(row.unitPrice)) return 0;
  return (
    Math.round((row.quantity - packageMeters) * row.unitPrice * 100) / 100
  );
}

/**
 * 增项合计：「线缆敷设」行按 cableChargeAmount 计，
 * 其他行按 quantity×unitPrice 计（无单价=0），分位防浮点
 */
export function addonTotalWithCable(
  materials: MaterialItem[],
  packageMeters: number,
): number {
  const sum = materials.reduce((acc, m) => {
    if (m.name.trim() === CABLE_ADDON_ROW_NAME) {
      return acc + cableChargeAmount(m, packageMeters);
    }
    const qty = Number.isFinite(m.quantity) ? m.quantity : 0;
    const price =
      m.unitPrice != null && Number.isFinite(m.unitPrice) ? m.unitPrice : 0;
    return acc + Math.round(qty * price * 100) / 100;
  }, 0);
  return Math.round(sum * 100) / 100;
}

/**
 * 超出行话术格式 V2（金额分位防浮点）：
 * - 超出：布线X米，套包免费Y米，超出Z米×¥单价=¥W（Z=X−Y，W=Z×单价）
 * - 未超出（X≤Y）：布线X米，套包内，无线缆增项
 */
export function buildCableOverFeeTextV2(
  totalCable: number,
  packageMeters: number,
  unitPrice: number,
): string {
  if (totalCable > packageMeters) {
    const over = Math.round((totalCable - packageMeters) * 100) / 100;
    const fee = Math.round(over * unitPrice * 100) / 100;
    return `布线${totalCable}米，套包免费${packageMeters}米，超出${over}米×¥${unitPrice}=¥${fee}`;
  }
  return `布线${totalCable}米，套包内，无线缆增项`;
}
