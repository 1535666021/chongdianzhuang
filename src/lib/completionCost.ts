/* ============================================================
 * 完工成本 / 利润快照取数链（任务v36 + v36.2-P2 扩展：成本结算统一走成本表）
 * 背景：finance.calcOrderProfit 锁定不可动，且对 v35.1「线缆敷设」行名
 *      双向 includes 均不中（客户费按总量全额错算、成本映射不中计 0）。
 *      本模块不走该链：完工时直接调用本模块算材料成本与利润快照，
 *      由调用方写入 completion.profitData（statistics 三级链吃快照不重算）。
 * 红线：与客户收费无关——电缆按总量全额进成本；
 * 依赖铁则：本模块禁止 import storage（成本映射/材料库/成本表由调用方读取后传入，
 *      与 finance.ts / costMapping.ts 同一规则，保证纯函数可测）
 * ============================================================ */

import type {
  FixedAuxSelection,
  MaterialItem,
  CostSheetItem,
} from "@/types";
import {
  FIXED_AUX_MATERIALS,
  findMaterialPrice,
  findCostSheetPrice,
  type MatLibEntry,
} from "@/lib/costMapping";
import { calcMaterialCost } from "@/lib/finance";
import { calcFixedAuxCostV2, TIE_TAPE_PACK_PRICE } from "@/lib/fixedAux";

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
  /** 材料库（调用方 loadMaterialsLib() 读取后传入；v36.2-P2 后成本结算优先走 costSheet） */
  lib: MatLibEntry[];
  /** 成本表（v36.2-P2 新增：成本结算统一走成本表；有值时优先查成本表，无值 fallback 材料库） */
  costSheet?: CostSheetItem[];
  /** 固定辅材选择（Order.fixedAux 快照取值源；无值按 FIXED_AUX_MATERIALS 原样一份） */
  fixedAux?: FixedAuxSelection;
}

/** 固定辅材逐项成本拆解（任务v36.2：三行拆分——漏保/PVC管/扎带+胶带，
 *  三项合计=固定辅材总额，逐分对平） */
export interface FixedAuxItemsDetail {
  /** 漏保规格，如 "C40" */
  breakerSpec: string;
  /** 漏保行显示文本：未匹配→「漏保 未绑定」，否则「漏保 规格」 */
  breakerLabel: string;
  /** 漏保单价（元；null=材料库/成本表未匹配→不计价） */
  breakerUnitPrice: number | null;
  /** 漏保成本（元）= breakerPrice×1，未匹配计 0 */
  breakerCost: number;
  /** PVC管米数 */
  pvcMeters: number;
  /** PVC管单价（元/米） */
  pvcUnitPrice: number;
  /** PVC管成本（元）= pvcMeters × pvcUnitPrice */
  pvcCost: number;
  /** 扎带+胶带辅材包成本（元），固定价 */
  tieTapeCost: number;
  /** 三项合计（元）= breakerCost + pvcCost + tieTapeCost */
  total: number;
}

/** 材料成本拆解（任务v36.1 FAIL-5：预估到手可溯源，电缆/固定辅材/其他三类必拆） */
export interface CompletionMaterialCostDetail {
  /** 合计 = cable + other + fixedAux（分位防浮点） */
  total: number;
  /** 电缆全额成本（cableTotalMeters × 成本表/材料库"电缆"进价） */
  cable: number;
  /** 固定辅材（fixedAux 快照按 V2 算 / 无值按 FIXED_AUX_MATERIALS 原样一份） */
  fixedAux: number;
  /** 固定辅材逐项拆解（任务v36.2：三行拆分，用于展示层渲染） */
  fixedAuxItems?: FixedAuxItemsDetail;
  /** 其他增项映射成本（非「线缆敷设」行，finance.calcMaterialCost 口径） */
  other: number;
}

/**
 * 完工材料成本拆解 =
 *   电缆全额成本（cableTotalMeters × 查成本表/材料库"电缆"进价）
 * + 增项映射成本（非「线缆敷设」行，复用 finance.calcMaterialCost 口径）
 * + 固定辅材（fixedAux 有值→calcFixedAuxCostV2；无值→FIXED_AUX_MATERIALS）
 */
export function calcCompletionMaterialCostDetail(
  params: CompletionMaterialCostParams,
): CompletionMaterialCostDetail {
  const { materials, cableTotalMeters, lib, costSheet, fixedAux } = params;

  /* v36.2-P2：优先查成本表，无成本表 fallback 材料库 */
  const findPrice = (name: string): number | null => {
    if (costSheet && costSheet.length > 0) {
      const cp = findCostSheetPrice(name, costSheet);
      if (cp !== null) return cp;
    }
    return findMaterialPrice(name, lib);
  };

  /* 1. 电缆全额成本（套包内也计成本，与客户收费口径无关） */
  const cableUnitPrice = findPrice("电缆") ?? 0;
  const cable = round2(cableTotalMeters * cableUnitPrice);

  /* 2. 非「线缆敷设」行的增项映射成本（未命中映射计 0，与 finance 同口径） */
  const addonRows = materials.filter(
    (m) => !m.name.includes(CABLE_TOTAL_ROW_NAME),
  );
  const { total: otherCost } = calcMaterialCost(addonRows, lib);

  /* 3. 固定辅材：有快照取值源按 V2 算，无值按 FIXED_AUX_MATERIALS 原样一份 */
  const pvcUnitPriceRaw = findPrice("PVC管") ?? 0;
  const auxCost = fixedAux
    ? calcFixedAuxCostV2(fixedAux, pvcUnitPriceRaw)
    : FIXED_AUX_MATERIALS.reduce(
        (sum, item) => sum + (item.unitPrice ?? 0) * item.quantity,
        0,
      );

  /* 任务v36.2：固定辅材逐项拆解（三行——漏保/PVC管/扎带+胶带，供展示层渲染） */
  let fixedAuxItems: FixedAuxItemsDetail | undefined;
  if (fixedAux) {
    const breakerCost = fixedAux.breakerPrice != null ? fixedAux.breakerPrice : 0;
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
      tieTapeCost: TIE_TAPE_PACK_PRICE,
      total: round2(auxCost),
    };
  } else {
    /* 无 fixedAux 取值源：回退 FIXED_AUX_MATERIALS 固定三项 */
    const breakerItem = FIXED_AUX_MATERIALS[0];
    const pvcItem = FIXED_AUX_MATERIALS[1];
    const tieItem = FIXED_AUX_MATERIALS[2];
    fixedAuxItems = {
      breakerSpec: String(breakerItem.spec ?? ""),
      breakerLabel: `漏保 ${breakerItem.spec ?? ""}`,
      breakerUnitPrice: breakerItem.unitPrice ?? null,
      breakerCost: round2((breakerItem.unitPrice ?? 0) * breakerItem.quantity),
      pvcMeters: pvcItem.quantity,
      pvcUnitPrice: round2(pvcItem.unitPrice ?? 0),
      pvcCost: round2((pvcItem.unitPrice ?? 0) * pvcItem.quantity),
      tieTapeCost: (tieItem.unitPrice ?? 0) * tieItem.quantity,
      total: round2(auxCost),
    };
  }

  return {
    total: round2(cable + otherCost + auxCost),
    cable,
    fixedAux: round2(auxCost),
    fixedAuxItems,
    other: round2(otherCost),
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
