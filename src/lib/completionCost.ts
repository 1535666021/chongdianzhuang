/* ============================================================
 * 完工成本 / 利润快照取数链（任务v36 + v36.2-P3：成本核算全面走成本表）
 * 背景：finance.calcOrderProfit 锁定不可动，且对 v35.1「线缆敷设」行名
 *      双向 includes 均不中（客户费按总量全额错算、成本映射不中计 0）。
 *      本模块不走该链：完工时直接调用本模块算材料成本与利润快照，
 *      由调用方写入 completion.profitData（statistics 三级链吃快照不重算）。
 * 红线：与客户收费无关——电缆按总量全额进成本；
 * 依赖铁则：本模块禁止 import storage（成本表由调用方读取后传入）
 * ============================================================ */

import type {
  FixedAuxSelection,
  MaterialItem,
  CostSheetItem,
} from "@/types";
import { findCostSheetPrice } from "@/lib/costMapping";
import { addonShortNameOf } from "@/lib/addonShortName";
import { calcMaterialCost } from "@/lib/finance";
import { calcFixedAuxCostV2 } from "@/lib/fixedAux";
import { getGlobalBinding } from "@/lib/globalMaterialConfig";

/* ------------------------------------------------------------
 * 一、兜底常量
 * ------------------------------------------------------------ */

/** 电缆总量行名（v35.1 完工物料行）：电缆成本由 cableTotalMeters 全额计，
 *  该行从增项映射成本中剔除，防重复计成本 */
const CABLE_TOTAL_ROW_NAME = "线缆敷设";

/** 金额保留两位小数（与 finance.round2 同口径，分位防浮点） */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/* ------------------------------------------------------------
 * 二、完工材料成本
 * ------------------------------------------------------------ */

/** calcCompletionMaterialCost 入参 */
export interface CompletionMaterialCostParams {
  /** 完工增项物料清单（含「线缆敷设」总量行，该行自动剔除防重计） */
  materials: MaterialItem[];
  /** 电缆总量（米）：全额计成本，与客户是否超米收费无关 */
  cableTotalMeters: number;
  /** 成本表（v36.2-P3：成本核算唯一对接成本表） */
  costSheet: CostSheetItem[];
  /** 固定辅材选择（Order.fixedAux 快照取值源；无值按成本表默认一份） */
  fixedAux?: FixedAuxSelection;
  /** 增项材料成本绑定（P13：手动绑定的成本价，key=增项名称） */
  addonCostBindings?: Record<string, number>;
}

/** 固定辅材逐项成本拆解（v36.2-P3：三行拆分——漏保/PVC管/漏保盒） */
export interface FixedAuxItemsDetail {
  /** 漏保规格，如 "C40" */
  breakerSpec: string;
  /** 漏保行显示文本：未匹配→「漏保 未绑定」，否则「漏保 规格」 */
  breakerLabel: string;
  /** 漏保单价（元；null=成本表未匹配→不计价） */
  breakerUnitPrice: number | null;
  /** 漏保成本（元）= breakerPrice×1，未匹配计 0 */
  breakerCost: number;
  /** PVC管米数 */
  pvcMeters: number;
  /** PVC管单价（元/米；成本表查询） */
  pvcUnitPrice: number;
  /** PVC管成本（元）= pvcMeters × pvcUnitPrice */
  pvcCost: number;
  /** 漏保盒单价（元；null=成本表未匹配） */
  leakBoxUnitPrice?: number | null;
  /** 漏保盒成本（元；leakBoxUnitPrice 或成本表查询，无命中计 0） */
  leakBoxCost: number;
  /** 三项合计（元）= breakerCost + pvcCost + leakBoxCost */
  total: number;
}

/** 材料成本拆解（v36.1 FAIL-5：预估到手可溯源，电缆/固定辅材/其他三类必拆） */
export interface AddonCostItem {
  /** 增项名称（原始全称） */
  name: string;
  /** 短名（展示用） */
  shortName: string;
  /** 数量 */
  quantity: number;
  /** 单位 */
  unit: string;
  /** 成本单价（元；null=未绑定） */
  unitPrice: number | null;
  /** 成本总价（元） */
  total: number;
}

export interface CompletionMaterialCostDetail {
  /** 合计 = cable + other + fixedAux（分位防浮点） */
  total: number;
  /** 电缆全额成本（cableTotalMeters × 成本表"电缆"进价） */
  cable: number;
  /** 固定辅材（fixedAux 快照按 V2 算 / 无值按成本表默认一份） */
  fixedAux: number;
  /** 固定辅材逐项拆解（v36.2-P3：三行拆分，用于展示层渲染） */
  fixedAuxItems?: FixedAuxItemsDetail;
  /** 其他增项映射成本（非「线缆敷设」行，finance.calcMaterialCost 口径） */
  other: number;
  /** 增项逐项成本明细（P13：每增项一行，展示层逐项渲染） */
  addonItems?: AddonCostItem[];
}

/**
 * 完工材料成本拆解 =
 *   电缆全额成本（cableTotalMeters × 查成本表"电缆"进价）
 * + 增项映射成本（非「线缆敷设」行，复用 finance.calcMaterialCost 口径）
 * + 固定辅材（fixedAux 有值→calcFixedAuxCostV2；无值→成本表默认一份）
 * v36.2-P3：所有成本项唯一对接成本表，无命中计 0
 */
export function calcCompletionMaterialCostDetail(
  params: CompletionMaterialCostParams,
): CompletionMaterialCostDetail {
  const { materials, cableTotalMeters, costSheet, fixedAux, addonCostBindings } = params;

  /* v36.2-P3：唯一对接成本表 */
  const findPrice = (name: string): number | null => {
    return findCostSheetPrice(name, costSheet);
  };

  /* 1. 电缆全额成本（套包内也计成本，与客户收费口径无关） */
  const cableUnitPrice = findPrice("电缆") ?? 0;
  const cable = round2(cableTotalMeters * cableUnitPrice);

  /* 2. 非「线缆敷设」行的增项逐项成本（P13：逐项查成本表/绑定，逐项计算） */
  const addonRows = materials.filter(
    (m) => !m.name.includes(CABLE_TOTAL_ROW_NAME),
  );
  const addonItems: AddonCostItem[] = [];
  let otherCost = 0;
  for (const item of addonRows) {
    let price: number | null = null;
    if (costSheet && costSheet.length > 0) {
      price = findCostSheetPrice(item.name, costSheet);
    }
    /* P13：成本表未命中，尝试手动绑定 */
    if (price === null && addonCostBindings) {
      price = addonCostBindings[item.name] ?? null;
    }
    const total = price != null ? round2(price * item.quantity) : 0;
    if (price != null) otherCost += total;
    addonItems.push({
      name: item.name,
      shortName: addonShortNameOf(item),
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: price,
      total,
    });
  }

  /* 3. 固定辅材：有快照取值源按 V2 算，无值按成本表默认一份 */
  const pvcUnitPriceRaw = findPrice("PVC管") ?? 0;
  const leakBoxPriceRaw = findPrice("漏保盒") ?? 0;
  const auxCost = fixedAux
    ? calcFixedAuxCostV2(fixedAux, costSheet)
    : round2(
        (findPrice("漏保 C40") ?? 0) * 1 +
          (findPrice("PVC管") ?? 0) * cableTotalMeters +
          leakBoxPriceRaw,
      );

  /* v36.2-P3：固定辅材逐项拆解（三行——漏保/PVC管/漏保盒） */
  let fixedAuxItems: FixedAuxItemsDetail | undefined;
  if (fixedAux) {
    const breakerCost = fixedAux.breakerPrice != null ? fixedAux.breakerPrice : 0;
    const leakBoxUnitPrice = fixedAux.leakBoxPrice ?? findCostSheetPrice("漏保盒", costSheet);
    fixedAuxItems = {
      breakerSpec: fixedAux.breakerSpec,
      breakerLabel:
        fixedAux.breakerPrice != null
          ? `漏保 ${fixedAux.breakerSpec}`
          : "漏保 未绑定",
      breakerUnitPrice: fixedAux.breakerPrice,
      breakerCost: round2(breakerCost),
      pvcMeters: fixedAux.pvcMeters,
      pvcUnitPrice: round2(pvcUnitPriceRaw),
      pvcCost: round2(fixedAux.pvcMeters * pvcUnitPriceRaw),
      leakBoxUnitPrice,
      leakBoxCost: round2(leakBoxUnitPrice ?? 0),
      total: round2(auxCost),
    };
  } else {
    /* 无 fixedAux 取值源：回退成本表默认三项 */
    const breakerDefault =
      getGlobalBinding("漏保")?.costPrice ?? findPrice("漏保 C40") ?? 0;
    const pvcDefault =
      getGlobalBinding("PVC管")?.costPrice ?? findPrice("PVC管") ?? 0;
    fixedAuxItems = {
      breakerSpec: "C40",
      breakerLabel: breakerDefault > 0 ? "漏保 C40" : "漏保 未绑定",
      breakerUnitPrice: breakerDefault > 0 ? breakerDefault : null,
      breakerCost: round2(breakerDefault * 1),
      pvcMeters: cableTotalMeters,
      pvcUnitPrice: round2(pvcDefault),
      pvcCost: round2(pvcDefault * cableTotalMeters),
      leakBoxUnitPrice: leakBoxPriceRaw,
      leakBoxCost: round2(leakBoxPriceRaw ?? 0),
      total: round2(auxCost),
    };
  }

  return {
    total: round2(cable + otherCost + auxCost),
    cable,
    fixedAux: round2(auxCost),
    fixedAuxItems,
    other: round2(otherCost),
    addonItems,
  };
}

/** 完工材料成本合计（= calcCompletionMaterialCostDetail(...).total；
 *  签名与 v36 口径不变，内部复用 detail 防双份逻辑漂移） */
export function calcCompletionMaterialCost(
  params: CompletionMaterialCostParams,
): number {
  return calcCompletionMaterialCostDetail(params).total;
}

/* ------------------------------------------------------------
 * 三、完工利润快照
 * ------------------------------------------------------------ */

/** buildCompletionProfitData 入参 */
export interface CompletionProfitParams {
  /** 服务费/结算费（元，不扣点） */
  serviceFee: number;
  /** 客户实收（元；未改=应收合计由调用方兜底传入） */
  actualReceived: number;
  /** 平台扣点率（小数，0.10 = 10%） */
  platformRate: number;
  /** 材料成本（元，calcCompletionMaterialCost 结果） */
  materialCost: number;
}

/** 完工利润快照（platformDeduction 供 CompletionInfo 同名字段写入；
 *  其余四字段与 ProfitSnapshot 对齐） */
export interface CompletionProfitData {
  /** 结算费（= serviceFee，不扣点） */
  baseFee: number;
  /** 客户实收（= actualReceived） */
  customerPaid: number;
  /** 平台扣点金额（元）：round2(实收 × 扣点率) */
  platformDeduction: number;
  /** 材料成本（元，原样返回入参） */
  materialCost: number;
  /** 利润（元）：round2(实收 − 扣点 + 服务费 − 材料成本) */
  profit: number;
}

/**
 * 完工利润快照：customerPaid=实收；platformDeduction=round2(实收×扣点率)；
 * profit=round2(实收 − 扣点 + 服务费 − 材料成本)
 */
export function buildCompletionProfitData(
  params: CompletionProfitParams,
): CompletionProfitData {
  const { serviceFee, actualReceived, platformRate, materialCost } = params;
  const platformDeduction = round2(actualReceived * platformRate);
  return {
    baseFee: serviceFee,
    customerPaid: actualReceived,
    platformDeduction,
    materialCost,
    profit: round2(actualReceived - platformDeduction + serviceFee - materialCost),
  };
}
