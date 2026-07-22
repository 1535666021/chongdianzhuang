/* ============================================================
 * 单单利润真实计算层：单个订单的 增项费 / 平台扣点 / 材料成本 / 利润 逐步核算
 * 规范：财务计算唯一入口是 statistics.ts（月度）与本模块（单单），
 *      页面/组件禁止手写任何财务公式，一律调用本模块纯函数
 * 依赖铁则：本模块禁止 import storage（费率/映射/成本表由调用方从 storage 读取后传入）
 * ============================================================ */

import type {
  BrandRateConfig,
  CalculationStep,
  MaterialItem,
  Order,
  PlatformRateConfig,
  PlatformConfig,
  CostSheetItem,
} from "@/types";
import {
  findMaterialPrice,
  findCostSheetPrice,
  type MatLibEntry,
} from "@/lib/costMapping";
import { getPlatformRate } from "@/lib/platforms";
import { formatMoney } from "@/lib/utils";

/* ------------------------------------------------------------
 * 一、默认费率与服务类型识别
 * ------------------------------------------------------------ */

/** 品牌费率默认值：用户未配置品牌费率时由调用方回退使用（套包 30 米） */
export const DEFAULT_RATE_CONFIG: Omit<BrandRateConfig, "brandId"> = {
  packageMeters: 30,
  installFee: 300,
  repairFee: 60,
  surveyFee: 0,
};

/** 服务类型：安装 / 维修 / 勘测 */
export type ServiceKind = "install" | "repair" | "survey";

/**
 * 从订单备注 remark 识别服务类型（与 statistics.ts 口径一致，兼容全角冒号）：
 * "服务:维修" → repair，"服务:勘测" → survey，其余一律 install
 */
export function getServiceKind(order: Order): ServiceKind {
  const remark = order.remark ?? "";
  if (remark.includes("服务:维修") || remark.includes("服务：维修")) {
    return "repair";
  }
  if (remark.includes("服务:勘测") || remark.includes("服务：勘测")) {
    return "survey";
  }
  return "install";
}

/* ------------------------------------------------------------
 * 二、材料成本（增项材料映射成本 + 固定辅材）
 * ------------------------------------------------------------ */

/** 套包材料名：套包米数内客户免费（成本照计），超出部分另计 */
const PACKAGE_MATERIAL_NAMES = ["电缆", "PVC管"] as const;

/** 是否套包材料：精确或 includes 匹配（与 costMapping.findMapping 同一口径） */
function isPackageMaterial(name: string): boolean {
  if (!name) return false;
  return PACKAGE_MATERIAL_NAMES.some(
    (pkg) => name === pkg || name.includes(pkg) || pkg.includes(name),
  );
}

/** 是否命中材料库价格 */
function hasMaterialPrice(name: string, lib: MatLibEntry[]): boolean {
  return findMaterialPrice(name, lib) !== null;
}

/** 金额保留两位小数（内部计算用 number，出口字段统一 round2） */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * v36.2-P3：成本结算统一走成本表（增项材料）
 * @param costSheet 成本表（有值时优先查成本表，无值 fallback 材料库）
 */
export function calcMaterialCost(
  materials: MaterialItem[],
  lib: MatLibEntry[],
  costSheet?: CostSheetItem[],
): { total: number; unmapped: string[] } {
  let total = 0;
  const unmapped: string[] = [];
  for (const item of materials) {
    /* 优先查成本表 */
    let price: number | null = null;
    if (costSheet && costSheet.length > 0) {
      price = findCostSheetPrice(item.name, costSheet);
    }
    /* fallback 材料库 */
    if (price === null) {
      price = findMaterialPrice(item.name, lib);
    }
    if (price === null) {
      if (!unmapped.includes(item.name)) unmapped.push(item.name);
      continue; // 未命中：成本计 0
    }
    total += price * item.quantity;
  }
  return { total: round2(total), unmapped };
}

/** 固定辅材成本（v36.2-P3：全部走成本表） */
function calcFixedAuxCost(costSheet?: CostSheetItem[]): number {
  if (!costSheet || costSheet.length === 0) return 0;
  const breaker = findCostSheetPrice("漏保 C40", costSheet) ?? 0;
  const pvc = findCostSheetPrice("PVC管", costSheet) ?? 0;
  const leakBox = findCostSheetPrice("漏保盒", costSheet) ?? 0;
  return round2(breaker * 1 + pvc * 30 + leakBox); // 默认30米PVC
}

/* ------------------------------------------------------------
 * 三、单单利润主入口
 * ------------------------------------------------------------ */

/** calcOrderProfit 入参 */
export interface CalcProfitParams {
  /** 订单（remark 识别服务类型，platformType 判定扣点率） */
  order: Order;
  /** 本单增项材料清单（完工实际物料） */
  materials: MaterialItem[];
  /** 品牌费率配置（套包米数 + 各服务类型费用） */
  rateConfig: BrandRateConfig;
  /** 平台扣点率配置（jd / other，向后兼容兜底） */
  platformRates: PlatformRateConfig;
  /** 多平台配置（任务B）：订单 platform 全称取扣点用，缺省走旧两档 */
  platforms?: PlatformConfig[];
  /** 材料库 */
  lib: MatLibEntry[];
  /** 成本表（v36.2-P3：成本结算统一走成本表） */
  costSheet?: CostSheetItem[];
  /** 重新核算：单单扣点率覆盖（小数），不传按平台类型 */
  platformRateOverride?: number;
}

/** calcOrderProfit 出参（金额字段均保留两位小数；platformRate 为实际使用扣点率，原样返回） */
export interface OrderProfitResult {
  /** 服务类型（remark "服务:xxx" 识别，兼容全角冒号） */
  serviceKind: ServiceKind;
  /** 客户增项费（元）：套包超米费 + 其他增项材料费 */
  customerAddonFee: number;
  /** 实际使用扣点率（小数）：platformRateOverride 优先，否则按平台类型 */
  platformRate: number;
  /** 平台扣点金额（元）：只扣客户增项费 */
  platformDeduction: number;
  /** 材料成本（元）：全部增项材料（含套包免费部分）+ 固定辅材一份 */
  materialCost: number;
  /** 服务费（元）：安装费/维修费/勘测费，不扣点 */
  serviceFee: number;
  /** 预估到手利润（元）：增项费扣点后 + 服务费 - 材料成本 */
  profit: number;
  /** 计算过程步骤（页面逐步展示，金额 formatMoney 千分位） */
  steps: CalculationStep[];
  /** 未命中成本映射的材料名（成本计 0，需用户补配映射） */
  unmappedMaterials: string[];
}

/** 扣点率展示：至少两位小数且不损失精度（0.1 → "0.10"，0.065 → "0.065"） */
function formatRate(rate: number): string {
  const raw = String(rate);
  const fracLen = raw.includes(".") ? raw.split(".")[1].length : 0;
  return rate.toFixed(Math.max(2, fracLen));
}

/**
 * 单单利润 = 客户增项费扣点后 + 服务费 - 材料成本
 * - 客户增项费：套包材料（电缆/PVC管）仅超米部分收费，其他材料按 unitPrice×quantity 全额收费
 * - 平台扣点：只对客户增项费计（维修/安装/勘测费不扣点；维修单增项材料费同样扣点且计成本）
 * - 材料成本：全部增项材料（含套包免费部分）+ 固定辅材一份，未命中映射计 0
 * v36.2-P3：成本结算统一走成本表
 */
export function calcOrderProfit(params: CalcProfitParams): OrderProfitResult {
  const {
    order,
    materials,
    rateConfig,
    platformRates,
    platforms,
    lib,
    costSheet,
    platformRateOverride,
  } = params;

  /* 1. 服务类型 → 服务费（安装费/维修费/勘测费，不扣点） */
  const serviceKind = getServiceKind(order);
  const serviceFee = round2(
    serviceKind === "repair"
      ? rateConfig.repairFee
      : serviceKind === "survey"
        ? rateConfig.surveyFee
        : rateConfig.installFee,
  );
  const kindLabel =
    serviceKind === "repair"
      ? "维修"
      : serviceKind === "survey"
        ? "勘测"
        : "安装";

  /* 2. 客户增项费：套包材料仅超米部分收费，其他材料全额收费（固定辅材不收费） */
  const addonLines: string[] = [];
  let addonRaw = 0;
  for (const item of materials) {
    const unitPrice = item.unitPrice ?? 0;
    if (unitPrice <= 0) continue; // 无单价材料不向客户收费（成本仍照计）
    if (isPackageMaterial(item.name)) {
      // 逐行判断：套包米数内客户免费（成本照计），超出部分按 unitPrice × 超出数量 收费
      const excess = Math.max(0, item.quantity - rateConfig.packageMeters);
      if (excess > 0) {
        const line = unitPrice * excess;
        addonRaw += line;
        addonLines.push(
          `${item.name} 超套包 ${excess}${item.unit} = ${formatMoney(unitPrice)} × ${excess} = ${formatMoney(line)}`,
        );
      }
    } else {
      const line = unitPrice * item.quantity;
      addonRaw += line;
      addonLines.push(
        `${item.name} = ${formatMoney(unitPrice)} × ${item.quantity} = ${formatMoney(line)}`,
      );
    }
  }
  const customerAddonFee = round2(addonRaw);

  /* 3. 平台扣点：只对客户增项费计；支持单单覆盖。
   * 取率优先级：platformRateOverride > 订单 platform 全称（多平台体系，platforms 入参）
   * > 旧 platformType 两档（jd/other，向后兼容） */
  const platformRate =
    platformRateOverride ??
    (order.platform && platforms
      ? getPlatformRate(order.platform, platforms)
      : order.platformType === "jd"
        ? platformRates.jd
        : platformRates.other);
  const platformDeduction = round2(customerAddonFee * platformRate);

  /* 4. 材料成本：全部增项材料（含套包免费部分）+ 固定辅材一份
   * v36.2-P3：优先走成本表 */
  const { total: addonMaterialCost, unmapped } = calcMaterialCost(
    materials,
    lib,
    costSheet,
  );
  const fixedAuxCost = round2(calcFixedAuxCost(costSheet));
  const materialCost = round2(addonMaterialCost + fixedAuxCost);

  /* 5. 利润 = 客户增项费扣点后 + 服务费 - 材料成本 */
  const profit = round2(
    customerAddonFee - platformDeduction + serviceFee - materialCost,
  );

  /* 6. 计算步骤（金额统一 formatMoney 千分位，页面逐步展示公式与明细） */
  const costLines = materials.map((item) => {
    let price: number | null = null;
    if (costSheet && costSheet.length > 0) {
      price = findCostSheetPrice(item.name, costSheet);
    }
    if (price === null) {
      price = findMaterialPrice(item.name, lib);
    }
    return price !== null
      ? `${item.name} = ${formatMoney(price)} × ${item.quantity} = ${formatMoney(price * item.quantity)}`
      : `${item.name} 未命中成本表/材料库，成本计 ${formatMoney(0)}`;
  });

  const steps: CalculationStep[] = [
    {
      label: "客户增项费",
      formula: "套包超米费 + 其他增项材料费",
      details:
        addonLines.length > 0
          ? [...addonLines, `= ${formatMoney(customerAddonFee)}`]
          : ["无增项材料收费", `= ${formatMoney(customerAddonFee)}`],
      result: customerAddonFee,
    },
    {
      label: "平台扣点",
      formula: "客户增项费 × 扣点率（服务费不扣点）",
      details: [
        `= ${formatMoney(customerAddonFee)} × ${formatRate(platformRate)}`,
        `= ${formatMoney(platformDeduction)}`,
      ],
      result: platformDeduction,
    },
    {
      label: "材料成本",
      formula: "增项材料成本（含免费部分）+ 固定辅材（漏保盒）",
      details: [
        ...costLines,
        `固定辅材（漏保盒）= ${formatMoney(fixedAuxCost)}`,
        `= ${formatMoney(materialCost)}`,
      ],
      result: materialCost,
    },
    {
      label: "服务费",
      formula: `${kindLabel}费（${kindLabel}单固定费用，不扣点）`,
      details: [`= ${formatMoney(serviceFee)}`],
      result: serviceFee,
    },
    {
      label: "预估到手利润",
      formula: "客户增项费扣点后 + 服务费 - 材料成本",
      details: [
        `= ${formatMoney(customerAddonFee)} - ${formatMoney(platformDeduction)} + ${formatMoney(serviceFee)} - ${formatMoney(materialCost)}`,
        `= ${formatMoney(profit)}`,
      ],
      result: profit,
    },
  ];

  return {
    serviceKind,
    customerAddonFee,
    platformRate,
    platformDeduction,
    materialCost,
    serviceFee,
    profit,
    steps,
    unmappedMaterials: unmapped,
  };
}
