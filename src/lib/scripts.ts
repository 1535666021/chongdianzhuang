/* ============================================================
 * 话术模板层：场景/变量清单 + 默认品牌话术 + 模板渲染（含条件块）
 * 规范：话术模板数据与渲染逻辑只此一处，
 *      页面/组件经 storage.ts 读取模板后调用本模块纯函数渲染
 * 依赖铁则：本模块禁止 import storage（storage.ts → scripts.ts 单向，
 *      DEFAULT_BRAND_SCRIPTS 由 storage 单向引用，与 costMapping 同模式）
 * v27 任务Q：5 条真实模板逐字内置（替换占位）；渲染引擎支持条件块
 *      {#if key}…{/if}（变量非空才输出）与 {#if key="值"}…{/if}（相等才输出），
 *      条件求值与变量代入全部在本 lib 层，视图层只调用
 * ============================================================ */

import type { BrandScript, MaterialItem, Order, ScriptScene } from "@/types";
import {
  buildCableOverFeeText,
  buildCableOverFeeTextV2,
  cableChargeAmount,
  CABLE_ADDON_ROW_NAME,
  resolveOrderPackageMeters,
} from "@/lib/packageMeters";

/* ------------------------------------------------------------
 * 一、场景与变量清单（SettingsPage 展示/编辑用）
 * ------------------------------------------------------------ */

/** 话术场景清单（顺序即展示顺序） */
export const SCRIPT_SCENES: { key: ScriptScene; label: string }[] = [
  { key: "preVisit", label: "上门前" },
  { key: "surveyComplete", label: "勘测完成" },
  { key: "installComplete", label: "安装完成" },
];

/** 模板可用变量清单（SettingsPage 变量提示展示用，书写格式 {key}） */
export const SCRIPT_VARIABLES: { key: string; label: string }[] = [
  { key: "customerName", label: "客户姓名" },
  { key: "customerPhone", label: "联系电话" },
  { key: "address", label: "地址" },
  { key: "city", label: "安装城市（从地址解析）" },
  { key: "brand", label: "品牌名" },
  { key: "cableDistance", label: "电缆距离" },
  { key: "surveyDate", label: "勘测日期" },
  { key: "completeDate", label: "完工日期" },
  { key: "engineerName", label: "工程师姓名" },
  { key: "engineerPhone", label: "工程师电话" },
  { key: "powerSource", label: "用电方式/电源点性质" },
  { key: "installType", label: "安装方式/勘测详情" },
  { key: "meterStatus", label: "电表状态" },
  { key: "needPlanDoc", label: "物业需要施工方案图" },
  { key: "surveyResult", label: "勘测结果" },
  { key: "propertyAllow", label: "物业是否允许施工" },
  { key: "surveyNote", label: "勘测备注" },
  { key: "addonItems", label: "增项辅材明细（逐行）" },
  { key: "addonTotal", label: "增项合计" },
  { key: "addonFee", label: "增项费用" },
  { key: "installDetail", label: "安装详情" },
  { key: "actualCable", label: "实际线缆用量" },
  { key: "overMeters", label: "超套包米数" },
  { key: "overPrice", label: "超米单价" },
  { key: "overFee", label: "超米费用" },
  { key: "appointmentDate", label: "预约日期" },
  { key: "timeSlot", label: "时段" },
  { key: "materials", label: "物料清单" },
  { key: "totalCost", label: "预估费用" },
  { key: "installerName", label: "安装师傅" },
  { key: "brandName", label: "品牌（brandId）" },
  { key: "platformBrand", label: "平台+品牌（一空格连写，v36）" },
  { key: "addonSummary", label: "增项合计/实收（智能两行，v36）" },
];

/* ------------------------------------------------------------
 * 二、默认品牌话术（5 条真实模板逐字内置，含"直在"等原有字样；
 *    条件块 {#if} 为渲染引擎语法，不属于展示文本）
 * ------------------------------------------------------------ */

/** 默认品牌话术（用户未配置时 storage 层回退用，SettingsPage 可改；"default" 为其他品牌兜底） */
export const DEFAULT_BRAND_SCRIPTS: BrandScript[] = [
  {
    brandId: "default",
    scene: "surveyComplete",
    content: `勘测完成时间：{surveyDate}
勘测详情：{installType}
勘测工程师及电话：{engineerName} / {engineerPhone}
用电方式：{powerSource}
电表状态：{meterStatus}
布线距离：{cableDistance} 米

预计增项辅材明细：
{addonItems}
预计增项合计：¥{addonTotal}元（以实际使用为准）
物业需要施工方案图：{needPlanDoc}
勘测结果：{surveyResult}
（电缆上有准确的米标刻度）
勘测备注：{surveyNote}
以上勘测情况请您回复"确认"，谢谢`,
  },
  {
    brandId: "default",
    scene: "installComplete",
    content: `完工总结：已完成安装
完工时间：{completeDate}
品牌：{platformBrand}
用户信息：{customerName}
联系电话：{customerPhone}
地址：{address}
取电方式：{powerSource}
安装详情：{installDetail}
使用电缆 {actualCable} 米。{addonSummary}
安装工程师：{engineerName}
电话：{engineerPhone}`,
  },
  {
    brandId: "lixiang",
    scene: "preVisit",
    content: `尊敬的理想车主您好，如我们所约{appointmentDate}{timeSlot}上门为您勘测
安装工程师：{engineerName}
电话：{engineerPhone}
预计{appointmentDate}{timeSlot}左右到达，请您知悉，如遇到堵车、交通意外或者其他突发情况我们会第一时间与您联系告知，若有任何问题，请随时联系我们`,
  },
  {
    brandId: "lixiang",
    scene: "surveyComplete",
    content: `勘测总结：理想
勘测时间：{surveyDate}
车主姓名:{customerName}
联系电话：{customerPhone}
勘测地址:{address}
电源点性质：{powerSource}
安装方式：{installType}
材料预估: 国标 YJV-3*6mm²阻燃铜芯电缆{cableDistance}米
{#if hasOverFee}增项费用:布线{cableDistance}米，超出套餐{overMeters}米×¥{overPrice}=¥{overFee}
{/if}物业是否允许施工：{propertyAllow}
备注：{surveyNote}。
{#if meterStatus="未安装"}温馨提示：因电表未安装，本次勘测记录的布线长度仅作为初步参考，非最终施工标准。正式安装前，我们将安排专业人员再次实地勘测确认实际线缆长度，具体收费将以最终安装的实际用量为准，鉴于现场环境的复杂性，勘测数据与实际安装距离可能存在偏差，此情况属于正常现象，特此提前说明。
{/if}尊敬的 理想车主您好！这是您本次的勘测信息，麻烦您确认一下。回复"确认"即可，谢谢！`,
  },
  {
    brandId: "lixiang",
    scene: "installComplete",
    content: `【安装总结】：已完成安装
安装时间：{completeDate}
客户姓名：{customerName}
客户手机：{customerPhone}
安装城市：{city}
品牌：{platformBrand}
安装地址：{address}
电源点性质：{powerSource}
安装方式：{installType}
材料用量: 国标 YJV-3*6mm²阻燃铜芯电缆 ：{actualCable}米
{addonSummary}
尊敬的 客户您好！您的充电桩已经安装完成，安装完成并不代表服务结束，您的桩和安装质保期为 4 年，后期充电桩出现任何故障您可以直在群内联系，我们将竭诚为您服务，祝您用车愉快`,
  },
];

/**
 * 旧占位模板快照（v27 之前的 DEFAULT_BRAND_SCRIPTS 原文）。
 * 仅 storage.loadBrandScripts 升级合并用：已落 localStorage 的内容若与
 * 此处逐字一致，说明用户没改过、是占位残留 → 自动升级为新版真实模板；
 * 不一致（用户改过）→ 保留用户内容不覆盖。禁止删改本常量。
 */
export const LEGACY_PLACEHOLDER_SCRIPTS: BrandScript[] = [
  {
    brandId: "lixiang",
    scene: "preVisit",
    content:
      "您好 {customerName}，我是理想充电桩安装师傅{installerName}，已预约 {appointmentDate} {timeSlot} 上门安装（地址：{address}）。请提前确认车位可正常进出，电表箱钥匙备好，有事随时联系我。",
  },
  {
    brandId: "lixiang",
    scene: "surveyComplete",
    content:
      "您好 {customerName}，您家电表到桩位距离约 {cableDistance} 米，勘测已完成。预估物料：{materials}，预估费用 {totalCost}。确认无误后我们将尽快为您安排安装。",
  },
  {
    brandId: "lixiang",
    scene: "installComplete",
    content:
      "您好 {customerName}，您的理想充电桩已安装完成并验收。使用物料：{materials}。如有任何使用问题欢迎随时联系，祝您用车愉快！",
  },
  {
    brandId: "default",
    scene: "surveyComplete",
    content:
      "您好 {customerName}，现场勘测已完成，电表到桩位约 {cableDistance} 米。预估物料：{materials}，预估费用 {totalCost}，确认后安排安装。",
  },
  {
    brandId: "default",
    scene: "installComplete",
    content:
      "您好 {customerName}，充电桩安装已完成。使用物料：{materials}。有问题随时联系。",
  },
];

/* ------------------------------------------------------------
 * 三、模板渲染与变量构造（纯函数，不读存储）
 * ------------------------------------------------------------ */

/**
 * 模板渲染：先求值条件块，再代入变量（均在 lib 层，视图层只调用）。
 * 条件块语法（非嵌套）：
 *   {#if key}…{/if}          —— vars[key] 非空才输出块内容
 *   {#if key="值"}…{/if}      —— vars[key] 与给定值完全相等才输出块内容
 * 变量替换：{key} → vars[key]，未知变量原样保留
 */
export function renderScript(
  template: string,
  vars: Record<string, string>,
): string {
  const conditional = template.replace(
    /\{#if\s+(\w+)(?:="([^"]*)")?\}([\s\S]*?)\{\/if\}/g,
    (raw, key: string, expect: string | undefined, body: string) => {
      const actual = vars[key] ?? "";
      if (expect !== undefined) return actual === expect ? body : "";
      return actual !== "" ? body : "";
    },
  );
  return conditional.replace(/\{(\w+)\}/g, (raw, key: string) =>
    key in vars ? vars[key] : raw,
  );
}

/** 从地址解析"省-市-区/县"（如 安徽-合肥-巢湖）；解析不出给空串，不抛错 */
export function parseCityFromAddress(address: string): string {
  if (!address) return "";
  let rest = address.trim();
  const parts: string[] = [];
  const province = rest.match(/^(.{2,3}?)(?:省|自治区)/);
  if (province) {
    parts.push(province[1]);
    rest = rest.slice(province[0].length);
  }
  const city = rest.match(/^(.{2,4}?)(?:市|自治州|盟|地区)/);
  if (city) {
    parts.push(city[1]);
    rest = rest.slice(city[0].length);
  }
  const district = rest.match(/^(.{2,4}?)(?:区|县|市|旗)/);
  if (district) {
    parts.push(district[1]);
  }
  return parts.join("-");
}

/**
 * 增项辅材明细逐行渲染（任务Q 规则）：
 * - 套包内材料行（无单价）：只列"名称 数量"
 * - 收费增项行（有单价）："名称 数量 × ¥单价 = ¥小计"
 * - 合计只汇总收费行
 */
export function buildAddonItemsText(
  materials: MaterialItem[],
  cable?: { baseLength: number; packageMeters?: number },
): {
  addonItems: string;
  addonTotal: string;
} {
  const valid = materials.filter((m) => m.name.trim() !== "");
  if (valid.length === 0) {
    return { addonItems: "按现场勘测确定", addonTotal: "0" };
  }
  let total = 0;
  const lines = valid.map((m) => {
    const name = m.name.trim();
    const qty = `${m.quantity}${m.unit}`;
    /* v35.1 套包账目：「线缆敷设」行且套包米数有效 → V2 话术
     * 「布线X米，套包免费Y米，超出Z米×¥单价=¥W」（未超出=「套包内，无线缆增项」），
     * 合计按 (基准长度−套包)×单价 计（cableChargeAmount 口径，≤套包=0）；
     * 套包米数缺省时回退 v35 格式（现状兼容），套包内明细不对客户展开 */
    if (
      name === CABLE_ADDON_ROW_NAME &&
      cable != null &&
      cable.packageMeters != null &&
      Number.isFinite(cable.packageMeters) &&
      cable.packageMeters > 0
    ) {
      total += cableChargeAmount(
        { ...m, quantity: cable.baseLength },
        cable.packageMeters,
      );
      return buildCableOverFeeTextV2(
        cable.baseLength,
        cable.packageMeters,
        m.unitPrice ?? 0,
      );
    }
    if (m.unitPrice != null && m.unitPrice > 0) {
      const subtotal = Math.round(m.quantity * m.unitPrice * 100) / 100;
      total += subtotal;
      /* v35 套包账目：「线缆敷设」行对客户呈现为超出租金计算格式
       * 「布线X米，超出套餐Y米×¥单价=¥Z」；套包内明细不对客户展开 */
      if (name === CABLE_ADDON_ROW_NAME && cable != null) {
        return buildCableOverFeeText(
          cable.baseLength,
          m.quantity,
          m.unitPrice,
        );
      }
      return `${name} ${qty} × ¥${m.unitPrice} = ¥${subtotal}`;
    }
    return `${name} ${qty}`;
  });
  return {
    addonItems: lines.join("\n"),
    addonTotal: String(Math.round(total * 100) / 100),
  };
}

/** buildScriptVars 的补充入参（全部由调用方计算后传入，本函数不读存储） */
export interface ScriptVarsExtras {
  materialsText?: string;
  totalCostText?: string;
  installerName?: string;
  /** 表单内尚未保存的电缆距离（勘测提交前场景），优先于 survey.cableDistance */
  cableDistance?: number;
  /* ---- v27 任务Q 增量（全部可选，缺省从订单数据回退） ---- */
  /** 渲染场景（影响超米计费基准长度：安装完成用实际线缆） */
  scene?: ScriptScene;
  /** 品牌显示名（缺省回退 brandId） */
  brandName?: string;
  engineerName?: string;
  engineerPhone?: string;
  surveyDate?: string;
  surveyNote?: string;
  powerSource?: string;
  installType?: string;
  meterStatus?: string;
  needPlanDoc?: string;
  surveyResult?: string;
  propertyAllow?: string;
  completeDate?: string;
  installDetail?: string;
  addonFee?: number;
  actualCable?: number;
  /** 勘测/完工物料明细（增项行渲染用） */
  materials?: MaterialItem[];
  /** 品牌套包米数（缺省 30） */
  packageMeters?: number;
  /** 超米单价（缺省 45 元/米） */
  overMeterPrice?: number;
  /* ---- 任务v36 完工话术增量（addonSummary/platformBrand 变量） ---- */
  /** 客户实收（元；与 addonTotal 均有效且不等 → addonSummary 两行） */
  actualReceived?: number;
  /** 客户增项应收合计（元，addonTotalWithCable 口径） */
  addonTotal?: number;
  /** 平台+品牌连写覆盖值（缺省按 order.platform/platformType + 品牌名自算） */
  platformBrand?: string;
}

/**
 * 从订单构造变量表（缺省值一律给空字符串，不得抛错）：
 * - 表单未保存值由 extras 优先提供，回退订单 survey/completion/appointment 已存数据
 * - 超米计费：基准长度（安装完成场景取 actualCable，其余取 cableDistance）- packageMeters；
 *   overMeters≤0 时 hasOverFee 为空（模板 {#if hasOverFee} 整行不显示）
 */
export function buildScriptVars(
  order: Order,
  extras?: ScriptVarsExtras,
): Record<string, string> {
  const cableDistance =
    extras?.cableDistance != null
      ? extras.cableDistance
      : order.survey?.cableDistance;
  const actualCable =
    extras?.actualCable != null
      ? extras.actualCable
      : order.completion?.actualCable;
  const packageMeters =
    extras?.packageMeters ?? resolveOrderPackageMeters(order) ?? 30;
  const overPrice = extras?.overMeterPrice ?? 45;
  /* 超米计费基准：安装完成场景优先实际线缆，其余场景用勘测距离 */
  const baseLength =
    extras?.scene === "installComplete"
      ? (actualCable ?? cableDistance)
      : cableDistance;
  const overMeters =
    baseLength != null ? Math.round((baseLength - packageMeters) * 100) / 100 : 0;
  const overFee =
    overMeters > 0 ? Math.round(overMeters * overPrice * 100) / 100 : 0;

  const materials = extras?.materials ?? order.survey?.materials ?? [];
  const addon = buildAddonItemsText(
    materials,
    baseLength != null ? { baseLength, packageMeters } : undefined,
  );

  const addonFee =
    extras?.addonFee != null ? extras.addonFee : order.completion?.addonFee;

  /* 任务v36：平台+品牌一空格连写（平台为空时无前导空格，纯品牌）。
   * 平台名取数链：order.platform 全称 ?? platformType 两档（jd→京东/other→其他），
   * 品牌名取 extras.brandName ?? order.brandId；extras.platformBrand 优先覆盖 */
  const platformName =
    order.platform && order.platform.trim() !== ""
      ? order.platform.trim()
      : order.platformType === "jd"
        ? "京东"
        : order.platformType === "other"
          ? "其他"
          : "";
  const brandDisplay = extras?.brandName ?? order.brandId ?? "";
  const platformBrand =
    extras?.platformBrand ??
    (platformName ? `${platformName} ${brandDisplay}` : brandDisplay);

  /* 任务v36：增项合计/实收智能两行（分位防浮点；只摆合计与实收，不摆减免金额）：
   * 实收与合计均有效且不等 → 「客户增项合计 ¥X\n实收 ¥Y」；
   * 否则单行「客户增项合计 ¥Z」（Z=合计 ?? 实收 ?? 0） */
  const addonTotalNum = extras?.addonTotal;
  const actualReceivedNum = extras?.actualReceived;
  const addonTotalValid =
    addonTotalNum != null && Number.isFinite(addonTotalNum);
  const actualReceivedValid =
    actualReceivedNum != null && Number.isFinite(actualReceivedNum);
  const round2 = (n: number): number => Math.round(n * 100) / 100;
  const addonSummary =
    addonTotalValid &&
    actualReceivedValid &&
    (actualReceivedNum as number) !== (addonTotalNum as number)
      ? `客户增项合计 ¥${round2(addonTotalNum as number)}\n实收 ¥${round2(actualReceivedNum as number)}`
      : `客户增项合计 ¥${round2(
          addonTotalValid
            ? (addonTotalNum as number)
            : actualReceivedValid
              ? (actualReceivedNum as number)
              : 0,
        )}`;

  return {
    customerName: order.customerName ?? "",
    customerPhone: order.customerPhone ?? "",
    address: order.address ?? "",
    city: parseCityFromAddress(order.address ?? ""),
    brand: extras?.brandName ?? order.brandId ?? "",
    brandName: order.brandId ?? "",
    cableDistance: cableDistance != null ? String(cableDistance) : "",
    appointmentDate: order.appointment?.appointmentDate ?? "",
    timeSlot: order.appointment?.timeSlot ?? "",
    installerName:
      extras?.installerName ??
      order.completion?.installer ??
      order.appointment?.installer ??
      "",
    engineerName:
      extras?.engineerName ??
      extras?.installerName ??
      order.completion?.installer ??
      order.survey?.surveyor ??
      order.appointment?.installer ??
      "",
    engineerPhone: extras?.engineerPhone ?? "",
    surveyDate: extras?.surveyDate ?? order.survey?.surveyDate ?? "",
    surveyNote: extras?.surveyNote ?? order.survey?.note ?? "",
    powerSource: extras?.powerSource ?? order.survey?.powerSource ?? "",
    installType: extras?.installType ?? order.survey?.installType ?? "",
    meterStatus: extras?.meterStatus ?? order.survey?.meterStatus ?? "",
    needPlanDoc: extras?.needPlanDoc ?? order.survey?.needPlanDoc ?? "",
    surveyResult: extras?.surveyResult ?? order.survey?.surveyResult ?? "",
    propertyAllow: extras?.propertyAllow ?? order.survey?.propertyAllow ?? "",
    completeDate: extras?.completeDate ?? order.completion?.completeDate ?? "",
    installDetail:
      extras?.installDetail ?? order.completion?.installDetail ?? "",
    addonFee: addonFee != null ? String(addonFee) : "",
    actualCable: actualCable != null ? String(actualCable) : "",
    addonItems: addon.addonItems,
    addonTotal: addon.addonTotal,
    overMeters: overMeters > 0 ? String(overMeters) : "",
    overPrice: String(overPrice),
    overFee: overMeters > 0 ? String(overFee) : "",
    hasOverFee: overMeters > 0 ? "1" : "",
    materials: extras?.materialsText ?? "",
    totalCost: extras?.totalCostText ?? "",
    platformBrand,
    addonSummary,
  };
}

/** 取模板：精确匹配 brandId+scene；无则回退 brandId==="default"+scene；再无则返回空字符串 */
export function getScript(
  brandId: string,
  scene: ScriptScene,
  scripts: BrandScript[],
): string {
  const exact = scripts.find(
    (s) => s.brandId === brandId && s.scene === scene,
  );
  if (exact) return exact.content;
  const fallback = scripts.find(
    (s) => s.brandId === "default" && s.scene === scene,
  );
  return fallback?.content ?? "";
}
