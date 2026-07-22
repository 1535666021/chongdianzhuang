/* ============================================================
 * 月度财务统计 · 唯一入口（快照优先三级链版）
 * 铁则：页面/组件禁止编写任何财务计算，一律调用本模块取数。
 *
 * 逐单取值三级链（每单四项科目各自独立下探）：
 *   结算费 baseFee      = completion.legacyProfit?.baseFee      ?? completion.profitData?.baseFee      ?? calcOrderProfit(...).serviceFee
 *   客户增项 customerPaid = completion.legacyProfit?.customerPaid ?? completion.profitData?.customerPaid ?? calcOrderProfit(...).customerAddonFee
 *   材料成本 materialCost = completion.legacyProfit?.materialCost ?? completion.profitData?.materialCost ?? calcOrderProfit(...).materialCost
 *   利润 profit         = completion.legacyProfit?.profit       ?? completion.profitData?.profit       ?? calcOrderProfit(...).profit
 *   平台扣点 deduction  = completion.platformDeduction ?? calc.platformDeduction（v7 老单无快照时走 calcOrderProfit 按平台类型自动计算扣点）
 * legacyProfit / profitData 快照数值只读，禁止重算；Number() 转换 + 有限数防御，
 * 非法值按 undefined 继续下探。calcOrderProfit 兜底链仍按 brandId 查费率配置、
 * 缺省回退 DEFAULT_RATE_CONFIG（finance.ts 口径）。
 *
 * 利润双口径（BUG1 修复：两口径禁止写成同一表达式）：
 * - 对账利润 = 结算费 + 客户增项付费 - 平台扣点 - 材料成本（明面对账口径）
 * - 实际利润 = Σ 各单利润快照（含空开/漏保/PVC 等辅材隐性成本，故与对账利润不同）
 *
 * 服务类型判定：v7 老单 type 原文（legacyExtra.serviceType）优先，
 * 缺省走 finance.getServiceKind（remark "服务:xxx" 前缀，migrate 已把 v7 type 落入 remark），
 * 未标注服务类型的订单默认计入安装单。
 *
 * exportExcelReconciliation 为 async（Promise<Blob>）：
 * xlsx 动态加载保持主包瘦身，禁止顶部静态导入；调用方 await 使用。
 *
 * 阶段3扩展（只增量加函数，不动已有签名；统计页展示接线由主控收口）：
 * - getUnpaidStats：未回款统计（无 payment 或 paid!==true 视为未回款）
 * - getPlatformStats：平台维度 单数+利润（逐单 calcOrderProfit，口径同 getMonthlyFinanceStats）
 * - getMaterialUsageSummary：完工物料按 name 聚合（成本走 findCostSheetPrice / findMaterialPrice）+ cp_material_usage 领用合计
 * ============================================================ */

import dayjs from "dayjs";
import type {
  CalculationStep,
  MonthlyFinanceData,
  MonthSubject,
  MonthSubjectEntry,
  Order,
} from "@/types";
import { ORDER_STATUS_LABEL, OrderStatus } from "@/types";
import { formatDate, formatMoney } from "@/lib/utils";
import {
  calcOrderProfit,
  DEFAULT_RATE_CONFIG,
  getServiceKind,
} from "@/lib/finance";
import type { OrderProfitResult, ServiceKind } from "@/lib/finance";
import { findMaterialPrice, findCostSheetPrice } from "@/lib/costMapping";
import {
  loadCostSheet,
  loadMaterialUsage,
  loadMaterialsLib,
  loadPlatformRates,
  loadPlatforms,
  loadRateConfigs,
} from "@/lib/storage";

/* 旧估算常量（安装/维修/勘测单价、平台扣点率、基础利润、其他调整项）已删除：
 * 费率与扣点率改由 storage 配置承载；金额取数走快照优先三级链（见文件头），
 * 仅无快照订单才回退 finance.ts 逐单真实计算。 */

/** 金额保留两位小数（与 finance.ts round2 同口径，逐单结果汇总后统一归一） */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 快照数值防御：Number() 转换 + 有限数校验，非法按 undefined 继续下探三级链 */
function pickNum(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** 服务类型中文名 */
const KIND_LABEL: Record<ServiceKind, string> = {
  install: "安装",
  repair: "维修",
  survey: "勘测",
};

/**
 * 服务类型判定：v7 老单 type 原文（legacyExtra.serviceType，中/英文均可）优先；
 * 缺省走 getServiceKind(remark)——migrate 已把 v7 type 落成 remark "服务:xxx" 前缀。
 */
function resolveServiceKind(order: Order): ServiceKind {
  const raw = order.legacyExtra?.serviceType;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (t === "维修" || t === "repair") return "repair";
    if (t === "勘测" || t === "survey") return "survey";
    if (t === "安装" || t === "install") return "install";
  }
  return getServiceKind(order);
}

/** 逐单取数行（三级链落定后的单值，汇总与科目明细共用） */
interface OrderFinanceRow {
  order: Order;
  kind: ServiceKind;
  /** 归月日期（completeDate 优先，YYYY-MM-DD） */
  date: string;
  /** 结算费（快照 baseFee 优先） */
  baseFee: number;
  /** 客户增项付费（快照 customerPaid 优先） */
  customerPaid: number;
  /** 平台扣点（completion.platformDeduction 优先，缺省走 calcOrderProfit 按平台类型自动计算） */
  deduction: number;
  /** 材料成本（快照 materialCost 优先） */
  materialCost: number;
  /** 利润（快照 profit 优先） */
  profit: number;
}

/** 公式文本里的金额展示（round2 后去浮点长尾，非千分位——公式内联用） */
function numText(n: number): string {
  return String(round2(n));
}

/**
 * 月度汇总私有实现：逐单三级链取数（快照优先，calcOrderProfit 兜底）后求和。
 * 配置（品牌费率 / 成本映射 / 平台扣点率）在此一次性读取，避免逐单重复读 storage。
 */
function calcMonthlyFromOrders(
  yearMonth: string,
  monthOrders: Order[],
): MonthlyFinanceData {
  /* 1. 配置一次读取（品牌费率 / 材料库 / 平台扣点率 / 多平台扣点） */
  const rateConfigs = loadRateConfigs();
  const lib = loadMaterialsLib();
  const costSheet = loadCostSheet();
  const platformRates = loadPlatformRates();
  const platforms = loadPlatforms();

  /* 2. 逐单三级链取数：legacyProfit（v7 快照，只读）→ profitData（新完工快照）
   *    → calcOrderProfit 兜底；扣点取 completion.platformDeduction，缺省走 calc.platformDeduction */
  const rows: OrderFinanceRow[] = monthOrders.map((order) => {
    const rateConfig = rateConfigs.find(
      (c) => c.brandId === order.brandId,
    ) ?? { brandId: order.brandId, ...DEFAULT_RATE_CONFIG };
    const calc: OrderProfitResult = calcOrderProfit({
      order,
      materials: order.completion?.materials ?? order.survey?.materials ?? [],
      rateConfig,
      platformRates,
      platforms,
      lib,
    });
    const completion = order.completion;
    const legacy = completion?.legacyProfit;
    const snap = completion?.profitData;
    const rawDate = completion?.completeDate ?? order.createdAt;
    const d = dayjs(rawDate);
    return {
      order,
      kind: resolveServiceKind(order),
      date: d.isValid() ? d.format("YYYY-MM-DD") : String(rawDate ?? ""),
      baseFee: pickNum(legacy?.baseFee) ?? pickNum(snap?.baseFee) ?? calc.serviceFee,
      customerPaid:
        pickNum(legacy?.customerPaid) ??
        pickNum(snap?.customerPaid) ??
        calc.customerAddonFee,
      deduction: pickNum(completion?.platformDeduction) ?? calc.platformDeduction,
      materialCost:
        pickNum(legacy?.materialCost) ??
        pickNum(snap?.materialCost) ??
        calc.materialCost,
      profit: pickNum(legacy?.profit) ?? pickNum(snap?.profit) ?? calc.profit,
    };
  });

  /* 3. 逐单汇总：单量与结算费按服务类型归属 */
  let installCount = 0;
  let repairCount = 0;
  let surveyCount = 0;
  let installFee = 0;
  let repairFee = 0;
  let surveyFee = 0;
  let settlementTotal = 0;
  let addonTotal = 0;
  let deductionTotal = 0;
  let materialTotal = 0;
  let profitTotal = 0;

  for (const r of rows) {
    if (r.kind === "repair") {
      repairCount += 1;
      repairFee += r.baseFee;
    } else if (r.kind === "survey") {
      surveyCount += 1;
      surveyFee += r.baseFee;
    } else {
      installCount += 1;
      installFee += r.baseFee;
    }
    settlementTotal += r.baseFee;
    addonTotal += r.customerPaid;
    deductionTotal += r.deduction;
    materialTotal += r.materialCost;
    profitTotal += r.profit;
  }

  settlementTotal = round2(settlementTotal);
  addonTotal = round2(addonTotal);
  deductionTotal = round2(deductionTotal);
  materialTotal = round2(materialTotal);
  installFee = round2(installFee);
  repairFee = round2(repairFee);
  surveyFee = round2(surveyFee);

  const totalCompleted = rows.length;
  const serviceFeeTotal = round2(installFee + repairFee + surveyFee);
  const totalIncome = round2(addonTotal + serviceFeeTotal);

  /* 4. 利润双口径（BUG1 修复：禁止同值）：
   * 对账利润 = 结算费 + 客户增项付费 - 平台扣点 - 材料成本（明面对账口径）
   * 实际利润 = Σ 各单利润快照（含空开/漏保/PVC 等辅材隐性成本，故与对账利润不同） */
  const incomeAfterDeduction = round2(addonTotal - deductionTotal);
  const reconciliationProfit = round2(
    settlementTotal + addonTotal - deductionTotal - materialTotal,
  );
  const actualProfit = round2(profitTotal);
  const averageProfit =
    totalCompleted > 0 ? round2(actualProfit / totalCompleted) : 0;
  const averageAddon =
    totalCompleted > 0 ? round2(addonTotal / totalCompleted) : 0;

  /* 5. 八科目对账单：entries 为构成该科目的逐单明细（金额科目滤掉 0 值行，派生科目可空） */
  const toEntry = (
    r: OrderFinanceRow,
    amount: number,
    note?: string,
  ): MonthSubjectEntry => ({
    orderId: r.order.id,
    customerName: r.order.customerName,
    date: r.date,
    amount: round2(amount),
    ...(note ? { note } : {}),
  });
  const moneyEntries = (
    pick: (r: OrderFinanceRow) => number,
    note?: (r: OrderFinanceRow) => string | undefined,
  ): MonthSubjectEntry[] =>
    rows
      .filter((r) => pick(r) !== 0)
      .map((r) => toEntry(r, pick(r), note?.(r)));

  const subjects: MonthSubject[] = [
    {
      key: "volume",
      label: "当月单量",
      amount: totalCompleted,
      amountText: `${totalCompleted} 单（装${installCount}/修${repairCount}/勘${surveyCount}）`,
      formula: `当月完工订单按服务类型分档计数：安装 ${installCount} + 维修 ${repairCount} + 勘测 ${surveyCount} = ${totalCompleted} 单（按完工日期归月）`,
      entries: rows.map((r) => toEntry(r, 1, KIND_LABEL[r.kind])),
    },
    {
      key: "settlement",
      label: "结算费",
      amount: settlementTotal,
      formula: `安装/维修/勘测结算费合计（老单取 profitData.baseFee 快照，新单取完工快照）= ${numText(settlementTotal)}`,
      entries: moneyEntries((r) => r.baseFee, (r) => KIND_LABEL[r.kind]),
    },
    {
      key: "addon",
      label: "客户增项付费",
      amount: addonTotal,
      formula: `客户增项付费合计（套包超米费 + 增项材料费；老单取 profitData.customerPaid 快照，新单取完工快照）= ${numText(addonTotal)}`,
      entries: moneyEntries((r) => r.customerPaid),
    },
    {
      key: "deduction",
      label: "平台扣点",
      amount: deductionTotal,
      formula: `平台扣点合计（只扣客户增项付费；老单无快照时走 calcOrderProfit 按平台类型自动计算）= ${numText(deductionTotal)}`,
      entries: moneyEntries((r) => r.deduction),
    },
    {
      key: "material",
      label: "材料成本",
      amount: materialTotal,
      formula: `材料成本合计（老单取 profitData.materialCost 快照，新单取完工快照）= ${numText(materialTotal)}`,
      entries: moneyEntries((r) => r.materialCost),
    },
    {
      key: "reconciliation",
      label: "对账利润",
      amount: reconciliationProfit,
      formula: `明面对账口径：结算费 + 客户增项付费 - 平台扣点 - 材料成本 = ${numText(settlementTotal)} + ${numText(addonTotal)} - ${numText(deductionTotal)} - ${numText(materialTotal)} = ${numText(reconciliationProfit)}`,
      entries: [],
    },
    {
      key: "actual",
      label: "实际利润",
      amount: actualProfit,
      formula: `快照实算口径：Σ 各单利润快照（含空开/漏保/PVC 等辅材隐性成本，故与对账利润不同）= ${numText(actualProfit)}`,
      entries: moneyEntries((r) => r.profit, (r) => KIND_LABEL[r.kind]),
    },
    {
      key: "average",
      label: "平均利润",
      amount: averageProfit,
      formula:
        totalCompleted > 0
          ? `实际利润 ÷ 总单量 = ${numText(actualProfit)} ÷ ${totalCompleted} = ${numText(averageProfit)}`
          : "实际利润 ÷ 总单量（当月无完工单）= 0",
      entries: [],
    },
  ];

  /* 6. 计算步骤（动态生成，金额统一 formatMoney 千分位） */
  const reconciliationSteps: CalculationStep[] = [
    {
      label: "扣点后收入",
      formula: "Σ客户增项付费 - Σ平台扣点",
      details: [
        `= ${formatMoney(addonTotal)} - ${formatMoney(deductionTotal)}`,
        `= ${formatMoney(incomeAfterDeduction)}`,
      ],
      result: incomeAfterDeduction,
    },
    {
      label: "对账利润",
      formula: "扣点后收入 + 结算费（安装+维修+勘测） - 材料成本",
      details: [
        `= ${formatMoney(incomeAfterDeduction)} + ${formatMoney(serviceFeeTotal)}`,
        `- ${formatMoney(materialTotal)}`,
        `= ${formatMoney(reconciliationProfit)}`,
      ],
      result: reconciliationProfit,
    },
  ];

  const actualSteps: CalculationStep[] = [
    {
      label: "实际利润",
      formula: "Σ 各单利润快照（含空开/漏保/PVC 等辅材隐性成本，与对账口径不同）",
      details: [`= Σ（各单 profit 快照）`, `= ${formatMoney(actualProfit)}`],
      result: actualProfit,
    },
  ];

  const costDescription =
    "材料成本（快照优先：老单 profitData.materialCost / 新单完工快照；无快照按增项→成本映射逐单核算，含固定辅材）";

  return {
    overview: {
      yearMonth,
      totalCompleted,
      installCount,
      repairCount,
      surveyCount,
      customerTotalPaid: round2(addonTotal + settlementTotal),
      incomeAfterDeduction,
      reconciliationProfit,
      actualProfit,
      averageProfit,
      averageAddon,
      repairIncome: repairFee,
      surveyIncome: surveyFee,
    },
    reconciliationDetail: {
      income: {
        customerAddonFee: addonTotal,
        repairFee,
        repairCount,
        installFee,
        surveyFee,
        surveyCount,
        totalIncome,
      },
      platformDeduction: { amount: -deductionTotal },
      cost: {
        materialCost: -materialTotal,
        description: costDescription,
      },
      additionalCosts: 0,
      calculationSteps: reconciliationSteps,
    },
    actualDetail: {
      income: {
        customerAddonFee: addonTotal,
        repairFee,
        repairCount,
        installFee,
        surveyFee,
        surveyCount,
        totalIncome,
      },
      platformDeduction: { amount: -deductionTotal },
      cost: {
        materialCost: -materialTotal,
        description: costDescription,
      },
      additionalCosts: 0,
      calculationSteps: actualSteps,
    },
    subjects,
  };
}

/**
 * 月度财务统计主入口（全部指标基于 orders 逐单真实计算，无写死值）
 */
export function getMonthlyFinanceStats(
  yearMonth: string,
  orders: Order[],
): MonthlyFinanceData {
  /* 过滤当月完工订单（任务G4：财务口径只计完成单，按真实完工月落位）：
   * 归月优先级 completion.completeDate > createdAt；非完成单一律不计 */
  const monthOrders = orders.filter((o) => {
    if (o.status !== OrderStatus.Completed) return false;
    const dateStr = o.completion?.completeDate ?? o.createdAt;
    return dayjs(dateStr).isValid() && dayjs(dateStr).format("YYYY-MM") === yearMonth;
  });
  return calcMonthlyFromOrders(yearMonth, monthOrders);
}

/**
 * 可选月份列表：归月口径 completion.completeDate 优先、createdAt 兜底（G4），去重降序；
 * G1：一律先过 dayjs.isValid() 校验，非法日期直接跳过，
 * 避免 "Invalid Date" 混进月份下拉选项；无有效月份时回退当前月，保证页面有默认选中项。
 */
export function getAvailableMonths(orders: Order[]): string[] {
  const months = new Set<string>();
  for (const o of orders) {
    const dateStr = o.completion?.completeDate ?? o.createdAt;
    if (!dateStr) continue;
    const d = dayjs(dateStr);
    if (!d.isValid()) continue; // G1：非法日期（空串/脏数据）不产出月份选项
    months.add(d.format("YYYY-MM"));
  }
  const result = [...months].sort((a, b) => b.localeCompare(a));
  if (result.length === 0) result.push(dayjs().format("YYYY-MM"));
  return result;
}

/**
 * 导出月度对账单（xlsx 工作簿 → Blob，双 Sheet：概览 + 订单明细）。
 * 金额为逐单真实计算口径（取自 getMonthlyFinanceStats）。
 * 为保持 xlsx 动态加载主包不膨胀，本函数为异步，调用方 await 使用。
 */
export async function exportExcelReconciliation(
  yearMonth: string,
  orders: Order[],
): Promise<Blob> {
  const data = getMonthlyFinanceStats(yearMonth, orders);
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();

  /* Sheet1 对账概览 */
  const overviewRows: (string | number)[][] = [
    [`充电桩订单助手 · ${yearMonth} 月度对账单`],
    [],
    ["月份", data.overview.yearMonth],
    ["当月完成数", data.overview.totalCompleted],
    ["安装单数", data.overview.installCount],
    ["维修单数", data.overview.repairCount],
    ["勘测单数", data.overview.surveyCount],
    ["客户增项费", data.reconciliationDetail.income.customerAddonFee],
    ["维修费", data.reconciliationDetail.income.repairFee],
    ["安装费", data.reconciliationDetail.income.installFee],
    ["勘测费", data.reconciliationDetail.income.surveyFee],
    ["收入小计", data.reconciliationDetail.income.totalIncome],
    ["平台扣点", data.reconciliationDetail.platformDeduction.amount],
    ["材料领用成本", data.reconciliationDetail.cost.materialCost],
    ["扣点后收入", data.overview.incomeAfterDeduction],
    ["对账利润", data.overview.reconciliationProfit],
    ["实际利润", data.overview.actualProfit],
    ["平均利润", data.overview.averageProfit],
    ["台均增项", data.overview.averageAddon],
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(overviewRows);
  ws1["!cols"] = [{ wch: 22 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, ws1, "对账概览");

  /* Sheet2 当月订单明细（真实过滤结果） */
  const monthOrders = orders.filter((o) => {
    const dateStr = o.completion?.completeDate ?? o.createdAt;
    return dayjs(dateStr).format("YYYY-MM") === yearMonth;
  });
  const detailRows = monthOrders.map((order) => ({
    订单ID: order.id,
    客户姓名: order.customerName,
    客户电话: order.customerPhone,
    安装地址: order.address,
    状态: ORDER_STATUS_LABEL[order.status],
    创建日期: formatDate(order.createdAt),
    完工日期: order.completion?.completeDate ?? "",
    安装师傅: order.completion?.installer ?? order.appointment?.installer ?? "",
    功率kW: order.powerKw,
    备注: order.remark,
  }));
  const ws2 = XLSX.utils.json_to_sheet(detailRows);
  XLSX.utils.book_append_sheet(wb, ws2, "订单明细");

  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return new Blob([wbout], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/** 从八科目对账单取某科目金额（卡片明细用；缺科目按 0 兜底） */
function subjectAmount(data: MonthlyFinanceData, key: string): number {
  return data.subjects.find((s) => s.key === key)?.amount ?? 0;
}

/**
 * 构建各财务卡片的计算明细步骤（供弹窗展示；统计页唯一取数口）
 */
export function buildStepsForCard(
  type: string,
  data: MonthlyFinanceData,
): CalculationStep[] {
  switch (type) {
    case "totalCompleted":
      return [
        {
          label: "当月完成",
          formula: "安装 + 维修 + 勘测",
          details: [
            `= ${data.overview.installCount} + ${data.overview.repairCount} + ${data.overview.surveyCount}`,
            `= ${data.overview.totalCompleted}`,
          ],
          result: data.overview.totalCompleted,
        },
      ];
    case "customerPaid":
      return [
        {
          label: "客户总付费",
          formula: "Σ 各单（结算费 + 客户增项付费）",
          details: [`= ${formatMoney(data.overview.customerTotalPaid)}`],
          result: data.overview.customerTotalPaid,
        },
      ];
    case "incomeAfter":
      return [
        {
          label: "扣点后收入",
          formula: "客户增项付费 - 平台扣点",
          details: [
            `= ${formatMoney(subjectAmount(data, "addon"))} - ${formatMoney(Math.abs(data.reconciliationDetail.platformDeduction.amount))}`,
            `= ${formatMoney(data.overview.incomeAfterDeduction)}`,
          ],
          result: data.overview.incomeAfterDeduction,
        },
      ];
    case "reconciliation":
      return data.reconciliationDetail.calculationSteps;
    case "actual":
      return data.actualDetail.calculationSteps;
    case "averageProfit":
      return [
        {
          label: "平均利润",
          formula: "实际利润 / 完成数",
          details: [
            `= ${formatMoney(data.overview.actualProfit)} / ${data.overview.totalCompleted}`,
            `= ${formatMoney(data.overview.averageProfit)}`,
          ],
          result: data.overview.averageProfit,
        },
      ];
    case "averageAddon":
      return [
        {
          label: "台均增项",
          formula: "客户增项付费 / 完成数",
          details: [
            `= ${formatMoney(subjectAmount(data, "addon"))} / ${data.overview.totalCompleted}`,
            `= ${formatMoney(data.overview.averageAddon)}`,
          ],
          result: data.overview.averageAddon,
        },
      ];
    default:
      return [];
  }
}

/* ------------------------------------------------------------
 * 二、阶段3 扩展统计（统计页增量取数口：只增函数，不动已有签名；
 *    配置均在函数内一次读取，禁止逐单重复读 storage）
 * ------------------------------------------------------------ */

/**
 * 未回款统计：无 payment 或 paid!==true 视为未回款；
 * amount 缺失按 0 计并计入 missingAmount 单数
 */
export function getUnpaidStats(orders: Order[]): {
  count: number;
  amount: number;
  missingAmount: number;
} {
  let count = 0;
  let amount = 0;
  let missingAmount = 0;
  for (const o of orders) {
    if (o.payment?.paid === true) continue;
    count += 1;
    const amt = o.payment?.amount;
    if (typeof amt === "number" && Number.isFinite(amt)) {
      amount += amt;
    } else {
      missingAmount += 1;
    }
  }
  return { count, amount: round2(amount), missingAmount };
}

/**
 * 平台维度统计（完成单）：按 order.platform（缺省"未标注"）分组，
 * 单数 + 利润合计（利润用 calcOrderProfit 逐单真实计算，口径同 getMonthlyFinanceStats）
 */
export function getPlatformStats(
  orders: Order[],
): { platform: string; count: number; profit: number }[] {
  /* 配置一次读取（品牌费率 / 材料库 / 平台扣点率 / 多平台扣点） */
  const rateConfigs = loadRateConfigs();
  const lib = loadMaterialsLib();
  const costSheet = loadCostSheet();
  const platformRates = loadPlatformRates();
  const platforms = loadPlatforms();

  const byPlatform = new Map<
    string,
    { platform: string; count: number; profit: number }
  >();
  for (const order of orders) {
    if (order.status !== OrderStatus.Completed) continue; // 完成单口径
    const key = order.platform?.trim() || "未标注";
    const rateConfig = rateConfigs.find(
      (c) => c.brandId === order.brandId,
    ) ?? { brandId: order.brandId, ...DEFAULT_RATE_CONFIG };
    const r = calcOrderProfit({
      order,
      materials: order.completion?.materials ?? order.survey?.materials ?? [],
      rateConfig,
      platformRates,
      platforms,
      lib,
    });
    const entry = byPlatform.get(key) ?? { platform: key, count: 0, profit: 0 };
    entry.count += 1;
    entry.profit += r.profit;
    byPlatform.set(key, entry);
  }
  return [...byPlatform.values()].map((e) => ({
    ...e,
    profit: round2(e.profit),
  }));
}

/**
 * 物料用量汇总（材料库口径）：完成单 completion.materials 按 name 聚合 数量/成本
 *（成本走 findCostSheetPrice / findMaterialPrice，未命中 0），另附 cp_material_usage 领用记录的合计条数与总金额
 */
export function getMaterialUsageSummary(orders: Order[]): {
  byMaterial: { name: string; quantity: number; cost: number }[];
  usageRecordCount: number;
  usageRecordTotal: number;
} {
  /* 配置一次读取：材料库（findMaterialPrice 取数）/ 领用记录 */
  const lib = loadMaterialsLib();
  const usageRecords = loadMaterialUsage();
  const costSheet = loadCostSheet();
  const byName = new Map<
    string,
    { name: string; quantity: number; cost: number }
  >();
  for (const o of orders) {
    if (o.status !== OrderStatus.Completed) continue; // 完成单口径
    for (const m of o.completion?.materials ?? []) {
      const entry = byName.get(m.name) ?? { name: m.name, quantity: 0, cost: 0 };
      entry.quantity += m.quantity;
      entry.cost += (findCostSheetPrice(m.name, costSheet) ?? 0) * m.quantity;
      byName.set(m.name, entry);
    }
  }
  const byMaterial = [...byName.values()].map((e) => ({
    name: e.name,
    quantity: round2(e.quantity),
    cost: round2(e.cost),
  }));
  const usageRecordTotal = round2(
    usageRecords.reduce((sum, u) => sum + u.total, 0),
  );
  return {
    byMaterial,
    usageRecordCount: usageRecords.length,
    usageRecordTotal,
  };
}
