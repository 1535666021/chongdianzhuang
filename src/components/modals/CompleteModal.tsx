/* ============================================================
 * 完工登记弹窗（任务R2 改造 / v36 改版）
 * 勘测数据贯通：打开即预填——完工日期=当天 / 安装师傅=预约师傅或默认师傅 /
 *   实际用线=勘测米数 / 增项物料=勘测物料带出 / 完工备注=勘测备注带出 /
 *   安装详情=勘测安装方式（回退表单预设）；电源点/安装方式等勘测字段经
 *   buildScriptVars 从 order.survey 回退进入话术（extras 无需再传）
 * 增项下拉：与勘测页同一 getAddonOptions（契约§4，禁两份逻辑），
 *   选中带 salePrice 默认金额，行内可改；每行可改、可删
 * 任务v36 改版：
 *   ① 「实际工时」录入删除（CompletionInfo.workHours 类型保留，保存时口径补 0）
 *   ② 增项带出行即终态：actualCable 变更不再重建/联动「线缆敷设」行
 *   ③ 增项区底部：合计行（应收=addonTotalWithCable(materials, 套包值)，
 *      套包值=resolveOrderPackageMeters(order) ?? 品牌费率 packageMeters）
 *      + 实收输入（actualReceivedInput 字符串态）+「固定辅材」次按钮
 *      （FixedMaterialsDialog 子窗口，onSave → updateOrder fixedAux 持久化）
 *   ④ 利润取数链换芯 3号线 completionCost：保存时
 *      应收=addonTotalWithCable；实收=手填>0 且有限 ? 手填 : 应收；
 *      材料成本=calcCompletionMaterialCost（电缆全额+非电缆行映射+固定辅材）；
 *      扣点率现状链：order.platform 全称→getPlatformRate，回退 platformType 两档；
 *      快照=buildCompletionProfitData（customerPaid=实收，
 *      扣点=实收×率，利润=实收−扣点+服务费−材料）；completion 写入
 *      addonFee=应收 / platformDeduction / profitData 四字段
 * 平台扣点后台化：表单不再录入扣点率，利润直接按 loadPlatformRates()/platforms
 *   后台配置核算；profitData 快照字段与口径不变（统计不受影响）
 * ============================================================ */

import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/common/Modal";
import { FormField } from "@/components/common/FormField";
import { ScriptDialog } from "@/components/ScriptDialog";
import { FixedMaterialsDialog } from "@/components/FixedMaterialsDialog";
import { CostSheetPicker } from "@/components/CostSheetPicker";
import { CostBindField } from "@/components/CostBindField";
import { loadGlobalMaterialConfig } from "@/lib/globalMaterialConfig";
import { useApp } from "@/context/AppContext";
import { getAddonOptions } from "@/lib/addonOptions";
import { findBrand, mergeBrands } from "@/lib/brandMaterials";
/* 任务v36：完工成本/利润取数链（3号线 completionCost，替代 calcOrderProfit） */
import {
  buildCompletionProfitData,
  calcCompletionMaterialCost,
  calcCompletionMaterialCostDetail,
} from "@/lib/completionCost";
import type { FixedAuxItemsDetail } from "@/lib/completionCost";
import { DEFAULT_RATE_CONFIG, getServiceKind } from "@/lib/finance";
/* 任务v33：零跑增项触发判定与金额计算（业务逻辑收敛 lib，本组件只渲染） */
import {
  isLeapmotorBrand,
  leapmotorAddonLineAmount,
  leapmotorAddonsTotal,
} from "@/lib/leapmotorAddons";
import {
  addonTotalWithCable,
  buildCableOverFeeText,
  CABLE_ADDON_ROW_NAME,
  resolveOrderPackageMeters,
} from "@/lib/packageMeters";
import { getPlatformRate } from "@/lib/platforms";
import { getScript } from "@/lib/scripts";
import {
  loadBrandScripts,
  loadCostSheet,
  loadFormPresets,
  loadLeapmotorAddons,
  loadMaterialsLib,
  loadPlatformRates,
  loadPlatforms,
  loadRateConfigs,
  loadCostBindings,
} from "@/lib/storage";
import { formatMoney, todayStr } from "@/lib/utils";
import type { CompleteModalProps, MaterialItem, CostSheetItem } from "@/types";

interface CompleteErrors {
  completeDate?: string;
  installer?: string;
}

/** 扣点率小数 → 百分比文本（0.1 → "10"，0.075 → "7.5"，避免浮点长尾） */
function rateToPercentText(rate: number): string {
  return String(Number((rate * 100).toFixed(2)));
}

/**
 * 对比勘测物料与实际物料，生成修改记录：
 * 数量变化「电缆 30→35米」/ 新增「+ 打孔 ×2」/ 删除「- PVC管」
 */
function buildMaterialChangeRecords(
  before: MaterialItem[],
  after: MaterialItem[],
): string[] {
  const records: string[] = [];
  const afterMap = new Map(after.map((m) => [m.name.trim(), m]));
  const beforeKeys = new Set(before.map((m) => m.name.trim()));
  const afterKeys = new Set(after.map((m) => m.name.trim()));
  // 数量变化（按勘测清单顺序）
  for (const old of before) {
    const cur = afterMap.get(old.name.trim());
    if (cur && cur.quantity !== old.quantity) {
      records.push(
        `${cur.name.trim()} ${old.quantity}→${cur.quantity}${cur.unit || old.unit}`,
      );
    }
  }
  // 新增（按实际清单顺序）
  for (const cur of after) {
    if (!beforeKeys.has(cur.name.trim())) {
      records.push(`+ ${cur.name.trim()} ×${cur.quantity}`);
    }
  }
  // 删除（按勘测清单顺序）
  for (const old of before) {
    if (!afterKeys.has(old.name.trim())) {
      records.push(`- ${old.name.trim()}`);
    }
  }
  return records;
}

export function CompleteModal({ open, order, onClose }: CompleteModalProps) {
  const { settings, orders, customBrands, saveCompletion, showToast, updateOrder } =
    useApp();

  const [completeDate, setCompleteDate] = useState(todayStr());
  const [installer, setInstaller] = useState("");
  const [note, setNote] = useState("");
  const [materials, setMaterials] = useState<MaterialItem[]>([]);
  const [errors, setErrors] = useState<CompleteErrors>({});
  /** 安装完工话术弹窗开关（保存完工校验通过后先弹话术） */
  const [scriptOpen, setScriptOpen] = useState(false);
  /** 增项下拉当前选中值（选中追加行后复位，与勘测页同口径） */
  const [addonPick, setAddonPick] = useState("");
  /* 任务v33：零跑增项模板下拉选中值（同 addonPick 口径，选中追加后立即复位） */
  const [leapPick, setLeapPick] = useState("");
  /* 任务v36：固定辅材子窗口开关（固定辅材次按钮） */
  const [fixedAuxOpen, setFixedAuxOpen] = useState(false);

  /* 任务Q 话术变量可选字段（不强制；缺省话术对应变量为空/回退勘测值） */
  const [actualCable, setActualCable] = useState("");
  const [addonFee, setAddonFee] = useState("");
  const [installDetail, setInstallDetail] = useState("");
  /* 任务v36：客户实收（字符串态，空/>0 无效时保存按应收合计兜底） */
  const [actualReceivedInput, setActualReceivedInput] = useState("");
  /* 任务v36.1 FAIL-5：预估到手计算明细展开开关 */
  const [showCostDetail, setShowCostDetail] = useState(false);
  const [costSheet, setCostSheet] = useState<CostSheetItem[]>([]);
  const [showCostPicker, setShowCostPicker] = useState(false);
  const [pickerMaterialName, setPickerMaterialName] = useState("");

  /* 打开时初始化（勘测数据贯通预填）：
   * 完工日期=当天 / 安装师傅=预约师傅或默认师傅 /
   * 实际用线=勘测米数 / 增项物料=勘测物料带出（带出行即终态，不再联动重建）/
   * 完工备注=勘测备注带出（师傅可改）/ 安装详情=勘测安装方式（回退表单预设）/
   * 实收清空（默认按应收合计兜底） */
  useEffect(() => {
    if (!open || !order) return;
    setErrors({});
    setScriptOpen(false);
    setFixedAuxOpen(false);
    setAddonPick("");
    setLeapPick(""); // 任务v33：打开/order 变化时复位零跑模板下拉
    setCompleteDate(todayStr());
    /* 任务v36.1 FAIL-1：师傅带入加工程师姓名回退（与预约弹窗 v32.2 同口径）——
     * 老单 appointment.installer 空 + 人员默认未配时，回退工程师信息姓名，
     * 不再被「请填写安装师傅」校验拦截 */
    setInstaller(
      order.appointment?.installer ||
        settings.defaultInstaller ||
        settings.engineerName ||
        "",
    );
    setNote(order.survey?.note ?? "");
    const cable = order.survey?.cableDistance;
    setActualCable(cable != null ? String(cable) : "");
    /* 任务v35：套包米数未持久化且原文可识别 → 打开即写回持久化（识别依据见 lib/packageMeters） */
    const resolvedPm = resolveOrderPackageMeters(order);
    if (order.packageMeters == null && resolvedPm != null) {
      updateOrder(order.id, { ...order, packageMeters: resolvedPm });
    }
    /* 任务v36：增项物料=勘测物料原样带出（一行不少、每行可改可删可补），
     * 不再做任何自动行重建/联动 */
    const globalBindings = loadCostBindings();
    const initMaterials = (order.survey?.materials ?? []).map((item) => ({
      ...item,
      cost: globalBindings[item.name] ?? item.cost ?? 0,
    }));
    setMaterials(initMaterials);
    /* 任务v36.1 FAIL-4：「增项费用」框打开即带应收合计（所见即所得、可改）——
     * 打开时按带出物料与套包值预计算；无增项/合计 0 时留空 */
    {
      const initPm =
        resolvedPm ??
        loadRateConfigs().find((c) => c.brandId === order.brandId)
          ?.packageMeters ??
        30;
      const initTotal = addonTotalWithCable(initMaterials, initPm);
      setAddonFee(initTotal > 0 ? String(initTotal) : "");
    }
    setActualReceivedInput("");
    setInstallDetail(
      order.survey?.installType?.trim()
        ? order.survey.installType
        : loadFormPresets().installType,
    );
  }, [open, order, settings.defaultInstaller, settings.engineerName]);

  /* 任务v36 取数链换芯（3号线 lib/completionCost，不再走 finance.calcOrderProfit）：
   * 应收合计 = addonTotalWithCable(物料, 套包值)，套包值=resolveOrderPackageMeters
   *   ?? 品牌费率 packageMeters；
   * 实收 = 手填>0 且有限 ? 手填 : 应收合计；
   * 材料成本 = calcCompletionMaterialCost（电缆全额 + 非电缆行映射成本 + 固定辅材，
   *   fixedAux 有快照按快照、无则 FIXED_AUX 默认）；
   * 扣点率现状链（无单单覆盖）：order.platform 全称 → getPlatformRate(platforms)，
   *   回退 platformType 两档（jd/other → loadPlatformRates）；
   * 利润快照 = buildCompletionProfitData（实收 − 扣点 + 服务费 − 材料成本）。
   * 保存提交与预览共用本链，保证所见即所存 */
  const completionCalc = useMemo(() => {
    if (!open || !order) return null;
    const rateConfig = loadRateConfigs().find(
      (c) => c.brandId === order.brandId,
    ) ?? { brandId: order.brandId, ...DEFAULT_RATE_CONFIG };
    const packageMeters =
      resolveOrderPackageMeters(order) ?? rateConfig.packageMeters;
    const validMaterials = materials.filter((m) => m.name.trim() !== "");
    const addonTotal = addonTotalWithCable(validMaterials, packageMeters);
    const receivedNum = Number(actualReceivedInput);
    const actualReceived =
      actualReceivedInput.trim() !== "" &&
      Number.isFinite(receivedNum) &&
      receivedNum > 0
        ? receivedNum
        : addonTotal;
    /* 服务费按服务类型（与 finance 同口径：remark 识别安装/维修/勘测） */
    const serviceKind = getServiceKind(order);
    const serviceFee =
      serviceKind === "repair"
        ? rateConfig.repairFee
        : serviceKind === "survey"
          ? rateConfig.surveyFee
          : rateConfig.installFee;
    const platforms = loadPlatforms();
    const platformRates = loadPlatformRates();
    const platformRate =
      order.platform && platforms
        ? getPlatformRate(order.platform, platforms)
        : order.platformType === "jd"
          ? platformRates.jd
          : platformRates.other;
    /* 任务v36.1 FAIL-5：材料成本三拆（电缆/固定辅材/其他），明细可溯源 */
    const materialBreakdown = calcCompletionMaterialCostDetail({
      materials: validMaterials,
      cableTotalMeters:
        Number(actualCable) || Number(order.survey?.cableDistance) || 0,
      costSheet,
      fixedAux: order.fixedAux,
      addonCostBindings: order.addonCostBindings,
    });
    const materialCost = materialBreakdown.total;
    const profitData = buildCompletionProfitData({
      serviceFee,
      actualReceived,
      platformRate,
      materialCost,
    });
    return {
      addonTotal,
      actualReceived,
      platformRate,
      serviceFee,
      materialCost,
      materialBreakdown,
      profitData,
      cableTotalMeters:
        Number(actualCable) || Number(order.survey?.cableDistance) || 0,
    };
  /* P13-fix1: addonCostBindings 变化时强制重新计算 */
  }, [open, order, materials, actualCable, actualReceivedInput, JSON.stringify(order?.addonCostBindings ?? {})]);

  /* 增项下拉选项：与勘测页同一 getAddonOptions（契约§4，禁两份逻辑）；
   * 品牌名解析与 ScriptDialog 同口径（内置品牌 id → 品牌名，自定义品牌直接用名） */
  const addonOptions = useMemo(() => {
    if (!open || !order) return [];
    const brandName =
      findBrand(order.brandId, customBrands)?.name ?? order.brandId;
    return getAddonOptions(brandName, orders);
  }, [open, order, orders, customBrands]);

  /* 任务v33 零跑触发判定：品牌名解析与 AppContext 同口径
   * （mergeBrands 合并内置+自定义品牌按 id 查名，未命中回退 brandId） */
  const leapmotorBrandName =
    mergeBrands(customBrands).find((b) => b.id === order?.brandId)?.name ??
    order?.brandId ??
    "";
  const leapmotorActive = order ? isLeapmotorBrand(leapmotorBrandName) : false;

  /* 任务v33 零跑增项模板选项：仅零跑单加载（设置页可改价/增删，缺省默认36条） */
  const leapmotorTemplates = useMemo(
    () => (leapmotorActive ? loadLeapmotorAddons() : []),
    [leapmotorActive],
  );

  /* 增项行编辑：每行可改可删（与勘测页增项区同口径；
   * 金额清空 → 删除 unitPrice 回到不计价行，非法数字按 0 收） */
  const patchMaterial = (
    index: number,
    key: keyof MaterialItem,
    value: string,
  ) => {
    setMaterials((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item;
        if (key === "quantity") {
          const num = Number(value);
          return { ...item, quantity: Number.isFinite(num) ? num : 0 };
        }
        if (key === "unitPrice") {
          if (value.trim() === "") {
            const cleared = { ...item };
            delete cleared.unitPrice;
            return cleared;
          }
          const num = Number(value);
          return { ...item, unitPrice: Number.isFinite(num) ? num : 0 };
        }
        return { ...item, [key]: value };
      }),
    );
  };

  const removeMaterial = (index: number) => {
    setMaterials((prev) => prev.filter((_, i) => i !== index));
  };

  /* 增项下拉选中：追加一行（数量 1、金额=材料库出售单价，金额可改），随后复位下拉 */
  const addAddon = (name: string) => {
    setAddonPick("");
    const option = addonOptions.find((o) => o.name === name);
    if (!option) return;
    setMaterials((prev) => [
      ...prev,
      {
        name: option.name,
        spec: "",
        quantity: 1,
        unit: option.unit,
        unitPrice: option.salePrice,
      },
    ]);
  };

  const validate = (): boolean => {
    const next: CompleteErrors = {};
    if (!completeDate) next.completeDate = "请选择完工日期";
    if (!installer.trim()) next.installer = "请填写安装师傅";
    setErrors(next);
    /* 任务v36.1 FAIL-1：校验不过 toast 明示哪项不过——表单红字可能滚出
     * 弹窗视区，toast 保证用户必见，严禁无声卡死 */
    const first = next.completeDate ?? next.installer;
    if (first) showToast(first);
    return Object.keys(next).length === 0;
  };

  /* 真正提交（话术弹窗"复制并继续"或无模板跳过时调用） */
  const handleConfirmSubmit = () => {
    if (!order || !validate() || !completionCalc) return;
    const validMaterials = materials.filter((m) => m.name.trim() !== "");
    // 修改记录：对比勘测物料与实际物料（数量变化 / 新增 / 删除），有变更时拼到备注末尾
    const changeRecords = buildMaterialChangeRecords(
      order.survey?.materials ?? [],
      validMaterials,
    );
    const baseNote = note.trim();
    const finalNote =
      changeRecords.length > 0
        ? `${baseNote ? `${baseNote}\n` : ""}【修改记录】${changeRecords.join("；")}`
        : baseNote;
    saveCompletion(order.id, {
      completeDate,
      installer: installer.trim(),
      materials: validMaterials,
      /* 任务v36：弹窗已删工时录入，CompletionInfo.workHours 类型保留、口径补 0 */
      workHours: 0,
      note: finalNote,
      /* 任务Q 话术变量字段（可选，空串不入库） */
      ...(actualCable.trim() !== "" && Number.isFinite(Number(actualCable))
        ? { actualCable: Number(actualCable) }
        : {}),
      /* 任务v36：addonFee 写入应收合计（addonTotalWithCable 口径） */
      addonFee: completionCalc.addonTotal,
      ...(installDetail.trim() !== ""
        ? { installDetail: installDetail.trim() }
        : {}),
      /* 任务v36：完工单利润快照（3号线 buildCompletionProfitData 口径）：
       * 平台扣点=实收×扣点率；快照四项=结算费/客户实收/材料成本/利润，
       * 统计三级链第二级取数（v7 老单快照在 legacyProfit，此处禁碰） */
      platformDeduction: completionCalc.profitData.platformDeduction,
      profitData: {
        baseFee: completionCalc.profitData.baseFee,
        customerPaid: completionCalc.profitData.customerPaid,
        materialCost: completionCalc.profitData.materialCost,
        profit: completionCalc.profitData.profit,
      },
    });
    showToast("完工已登记，订单进入「已完成」");
    onClose();
  };

  /* 点「保存完工」：校验通过后先弹安装完工话术；该品牌无模板则跳过直接提交 */
  const handleSubmit = () => {
    if (!order || !validate()) return;
    const template = getScript(
      order.brandId,
      "installComplete",
      loadBrandScripts(),
    );
    if (!template) {
      handleConfirmSubmit();
      return;
    }
    setScriptOpen(true);
  };

  /* 话术变量：实际物料逐行「名称 规格 ×数量单位」/ 预估到手金额 / 安装师傅；
   * 「线缆敷设」行带单价时换 buildCableOverFeeText（总距离=实际用线
   * ?? 勘测米数，与 buildScriptVars 同口径），其余行自拼格式一字不动 */
  const scriptMaterials = materials.filter((m) => m.name.trim() !== "");
  const materialsText =
    scriptMaterials.length > 0
      ? scriptMaterials
          .map((m) => {
            if (m.name.trim() === CABLE_ADDON_ROW_NAME && m.unitPrice != null) {
              return buildCableOverFeeText(
                Number(actualCable) ||
                  Number(order?.survey?.cableDistance) ||
                  0,
                m.quantity,
                m.unitPrice,
              );
            }
            const spec = m.spec.trim();
            return `${m.name.trim()}${spec ? ` ${spec}` : ""} ×${m.quantity}${m.unit}`;
          })
          .join("\n")
      : "按现场勘测确定";

  if (!order) return null;

  return (
    <>
      <Modal
        open={open}
        title={`重新核算 · ${order.customerName}`}
        onClose={onClose}
        footer={null}
      >
        {/* ===== 【1】顶部概览栏 ===== */}
        {completionCalc && (
          <div
            style={{
              display: "flex",
              borderBottom: "1px solid var(--color-border)",
              padding: "16px 0",
              marginBottom: "16px",
            }}
          >
            <div style={{ flex: 1, textAlign: "center" }}>
              <div style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                客户付费
              </div>
              <div
                style={{
                  fontSize: "22px",
                  fontWeight: "bold",
                  color: "var(--color-success)",
                }}
              >
                ¥{formatMoney(completionCalc.actualReceived)}
              </div>
            </div>
            <div style={{ flex: 1, textAlign: "center" }}>
              <div style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                订单成本
              </div>
              <div
                style={{
                  fontSize: "22px",
                  fontWeight: "bold",
                  color: "var(--color-danger)",
                }}
              >
                ¥{formatMoney(completionCalc.materialCost + completionCalc.profitData.platformDeduction)}
              </div>
            </div>
            <div style={{ flex: 1, textAlign: "center" }}>
              <div style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                利润
              </div>
              <div
                style={{
                  fontSize: "22px",
                  fontWeight: "bold",
                  color: "var(--color-success)",
                }}
              >
                ¥{formatMoney(completionCalc.profitData.profit)}
              </div>
            </div>
          </div>
        )}

        {/* ===== 【2】【3】【4】【5】增项辅材区 ===== */}
        <div style={{ marginBottom: "16px" }}>
          {/* 标题栏 */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "12px",
            }}
          >
            <span style={{ fontSize: "16px", fontWeight: "bold" }}>增项辅材</span>
            <span style={{ fontSize: "14px", color: "#ff6b35" }}>
              客户超出付费：¥{formatMoney(completionCalc?.addonTotal ?? 0)}
            </span>
          </div>

          {/* 添加按钮 */}
          <select
            className="input"
            value={addonPick}
            aria-label="选择辅材加入清单"
            onChange={(e) => addAddon(e.target.value)}
            style={{ marginBottom: "12px", width: "100%" }}
          >
            <option value="">+选择辅材添加...</option>
            {addonOptions.map((option) => (
              <option key={option.name} value={option.name}>
                {option.name}（{option.unit}）¥{option.salePrice}
                {option.usageCount > 0 ? ` · 用过${option.usageCount}次` : ""}
              </option>
            ))}
          </select>

          {/* 零跑模板下拉（保留） */}
          {leapmotorActive && (
            <select
              className="input"
              value={leapPick}
              aria-label="从零跑增项模板选择添加"
              onChange={(e) => {
                const t = leapmotorTemplates.find(
                  (x) => x.id === e.target.value,
                );
                setLeapPick("");
                if (!t) return;
                setMaterials((prev) => [
                  ...prev,
                  {
                    name: t.name,
                    spec: "",
                    quantity: 1,
                    unit: t.unit,
                    unitPrice: t.price,
                  },
                ]);
              }}
              style={{ marginBottom: "12px", width: "100%" }}
            >
              <option value="">从零跑模板选择添加…</option>
              {leapmotorTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}（{t.price}元/{t.unit}）
                </option>
              ))}
            </select>
          )}

          {/* 增项列表 */}
          {materials.length === 0 ? (
            <div
              style={{
                padding: "24px",
                textAlign: "center",
                color: "var(--color-text-secondary)",
                background: "var(--color-bg-secondary)",
                borderRadius: "8px",
              }}
            >
              暂无增项辅材
            </div>
          ) : (
            materials.map((item, index) => (
              <div
                key={index}
                style={{
                  background: "var(--color-bg-base)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "8px",
                  padding: "12px",
                  marginBottom: "8px",
                }}
              >
                {/* 名称行（长名称换行显示规格） */}
                <div
                  style={{
                    fontSize: "14px",
                    fontWeight: 500,
                    marginBottom: "8px",
                    wordBreak: "break-all",
                    lineHeight: 1.4,
                  }}
                >
                  {item.name}
                  {item.spec ? (
                    <span
                      style={{
                        color: "var(--color-text-secondary)",
                        fontSize: "13px",
                      }}
                    >
                      （{item.spec}）
                    </span>
                  ) : null}
                </div>
                {/* 操作行 */}
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <span
                    style={{
                      fontSize: "13px",
                      color: "var(--color-text-secondary)",
                      minWidth: "20px",
                    }}
                  >
                    {item.unit}
                  </span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    className="input"
                    style={{
                      width: "56px",
                      padding: "4px 8px",
                      fontSize: "14px",
                      background: "#fff",
                    }}
                    value={String(item.quantity)}
                    onChange={(e) =>
                      patchMaterial(index, "quantity", e.target.value)
                    }
                  />
                  <span
                    style={{
                      fontSize: "11px",
                      color: "#ff6b35",
                      whiteSpace: "nowrap",
                      fontWeight: 500,
                    }}
                  >
                    超1成本
                  </span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    className="input"
                    placeholder="元"
                    style={{
                      width: "64px",
                      padding: "4px 8px",
                      fontSize: "14px",
                      background: "#fff",
                    }}
                    value={
                      order.addonCostBindings?.[item.name] != null
                        ? String(order.addonCostBindings[item.name])
                        : ""
                    }
                    onChange={(e) => {
                      const price =
                        e.target.value.trim() === ""
                          ? 0
                          : Number(e.target.value);
                      updateOrder(order.id, {
                        ...order,
                        addonCostBindings: {
                          ...(order.addonCostBindings ?? {}),
                          [item.name]: Number.isFinite(price) ? price : 0,
                        },
                      });
                    }}
                  />
                  <span
                    style={{
                      fontSize: "14px",
                      color: "var(--color-text-primary)",
                      fontWeight: 500,
                      whiteSpace: "nowrap",
                    }}
                  >
                    =¥
                    {formatMoney(
                      (order.addonCostBindings?.[item.name] ?? 0) *
                        item.quantity,
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeMaterial(index)}
                    style={{
                      marginLeft: "auto",
                      color: "#ff4d4f",
                      background: "none",
                      border: "none",
                      fontSize: "22px",
                      fontWeight: "bold",
                      cursor: "pointer",
                      padding: "0 4px",
                      lineHeight: 1,
                    }}
                    aria-label="删除"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))
          )}

          {/* 零跑合计（保留） */}
          {leapmotorActive && (
            <div
              style={{
                fontSize: "13px",
                color: "var(--color-text-secondary)",
                marginTop: "8px",
              }}
            >
              增项合计 ¥{leapmotorAddonsTotal(materials)}
            </div>
          )}

          {/* 实收输入 + 固定辅材按钮（保留） */}
          <div
            style={{
              display: "flex",
              gap: "8px",
              marginTop: "12px",
            }}
          >
            <input
              className="input flex-1"
              type="number"
              inputMode="decimal"
              min="0"
              placeholder="实收"
              aria-label="实收"
              value={actualReceivedInput}
              onChange={(e) => setActualReceivedInput(e.target.value)}
            />
            <button
              type="button"
              className="btn btn--outline"
              onClick={() => setFixedAuxOpen(true)}
            >
              固定辅材
            </button>
          </div>

          {/* 【5】增项合计 */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: "12px",
              paddingTop: "12px",
              borderTop: "1px solid var(--color-border)",
            }}
          >
            <span style={{ fontSize: "14px", fontWeight: 500 }}>
              增项辅材成本合计
            </span>
            <span
              style={{ fontSize: "16px", fontWeight: "bold", color: "#ff4d4f" }}
            >
              ¥
              {formatMoney(
                completionCalc?.materialBreakdown?.addonItems?.reduce(
                  (sum, item) => sum + (item.total ?? 0),
                  0,
                ) ?? 0,
              )}
            </span>
          </div>
        </div>

        {/* ===== 【6】【7】计算明细卡片（绿底圆角） ===== */}
        {completionCalc && (
          <div
            style={{
              background: "#e8f5e9",
              borderRadius: "12px",
              padding: "16px",
              marginBottom: "16px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "8px",
                fontSize: "14px",
              }}
            >
              <span>
                客户付费×
                {String((1 - completionCalc.platformRate).toFixed(1))}
              </span>
              <span>
                = ¥
                {formatMoney(
                  completionCalc.actualReceived *
                    (1 - completionCalc.platformRate),
                )}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "8px",
                fontSize: "14px",
              }}
            >
              <span>结算费</span>
              <span>
                ¥
                {formatMoney(
                  completionCalc.actualReceived -
                    completionCalc.profitData.platformDeduction,
                )}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "8px",
                fontSize: "14px",
                color: "#ff4d4f",
              }}
            >
              <span>增项辅材成本</span>
              <span>
                -¥
                {formatMoney(
                  completionCalc.materialBreakdown.addonItems?.reduce(
                    (sum, item) => sum + (item.total ?? 0),
                    0,
                  ) ?? 0,
                )}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "12px",
                fontSize: "14px",
                color: "#ff4d4f",
                fontWeight: "bold",
              }}
            >
              <span>总成本</span>
              <span>
                -¥
                {formatMoney(
                  completionCalc.materialCost +
                    completionCalc.profitData.platformDeduction,
                )}
              </span>
            </div>

            {/* 成本分项明细 */}
            <div
              style={{
                borderTop: "1px dashed #a5d6a7",
                paddingTop: "12px",
              }}
            >
              {/* 线缆 */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "8px",
                  fontSize: "13px",
                  flexWrap: "wrap",
                  gap: "4px",
                }}
              >
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    flexWrap: "wrap",
                  }}
                >
                  线缆（电缆×{completionCalc.cableTotalMeters}米×
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    className="input"
                    style={{
                      width: "56px",
                      padding: "2px 6px",
                      fontSize: "13px",
                      background: "#fff",
                    }}
                    value={
                      order.fixedAux?.cablePrice != null
                        ? String(order.fixedAux.cablePrice)
                        : ""
                    }
                    onChange={(e) => {
                      const price =
                        e.target.value.trim() === ""
                          ? null
                          : Number(e.target.value);
                      updateOrder(order.id, {
                        ...order,
                        fixedAux: {
                          ...(order.fixedAux ?? {
                            breakerSpec: "C40",
                            breakerPrice: null,
                            pvcMeters: 0,
                            leakBoxPrice: null,
                          }),
                          cablePrice: Number.isFinite(price) ? price : null,
                        },
                      });
                    }}
                  />
                  元）
                </span>
                <span style={{ color: "#ff4d4f", whiteSpace: "nowrap" }}>
                  = -¥
                  {formatMoney(
                    completionCalc.cableTotalMeters *
                      (order.fixedAux?.cablePrice ?? 0),
                  )}
                </span>
              </div>
              {/* PVC */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "8px",
                  fontSize: "13px",
                  flexWrap: "wrap",
                  gap: "4px",
                }}
              >
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    flexWrap: "wrap",
                  }}
                >
                  PVC（PVC×
                  {completionCalc.materialBreakdown.fixedAuxItems
                    ?.pvcMeters ?? 0}
                  米×
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    className="input"
                    style={{
                      width: "56px",
                      padding: "2px 6px",
                      fontSize: "13px",
                      background: "#fff",
                    }}
                    value={
                      order.fixedAux?.pvcPrice != null
                        ? String(order.fixedAux.pvcPrice)
                        : ""
                    }
                    onChange={(e) => {
                      const price =
                        e.target.value.trim() === ""
                          ? null
                          : Number(e.target.value);
                      updateOrder(order.id, {
                        ...order,
                        fixedAux: {
                          ...(order.fixedAux ?? {
                            breakerSpec: "C40",
                            breakerPrice: null,
                            pvcMeters: 0,
                            leakBoxPrice: null,
                          }),
                          pvcPrice: Number.isFinite(price) ? price : null,
                        },
                      });
                    }}
                  />
                  元）
                </span>
                <span style={{ color: "#ff4d4f", whiteSpace: "nowrap" }}>
                  = -¥
                  {formatMoney(
                    (completionCalc.materialBreakdown.fixedAuxItems
                      ?.pvcMeters ?? 0) *
                      (order.fixedAux?.pvcPrice ?? 0),
                  )}
                </span>
              </div>
              {/* 漏保 */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "8px",
                  fontSize: "13px",
                  flexWrap: "wrap",
                  gap: "4px",
                }}
              >
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    flexWrap: "wrap",
                  }}
                >
                  漏保（{order.fixedAux?.breakerSpec ?? "C40"}×1个×
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    className="input"
                    style={{
                      width: "56px",
                      padding: "2px 6px",
                      fontSize: "13px",
                      background: "#fff",
                    }}
                    value={
                      order.fixedAux?.breakerPrice != null
                        ? String(order.fixedAux.breakerPrice)
                        : ""
                    }
                    onChange={(e) => {
                      const price =
                        e.target.value.trim() === ""
                          ? null
                          : Number(e.target.value);
                      updateOrder(order.id, {
                        ...order,
                        fixedAux: {
                          ...(order.fixedAux ?? {
                            breakerSpec: "C40",
                            breakerPrice: null,
                            pvcMeters: 0,
                            leakBoxPrice: null,
                          }),
                          breakerPrice: Number.isFinite(price)
                            ? price
                            : null,
                        },
                      });
                    }}
                  />
                  元）
                </span>
                <span style={{ color: "#ff4d4f", whiteSpace: "nowrap" }}>
                  = -¥{formatMoney(order.fixedAux?.breakerPrice ?? 0)}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ===== 保留字段（完工日期、安装师傅等） ===== */}
        <div style={{ marginBottom: "16px" }}>
          <FormField label="完工日期" required error={errors.completeDate}>
            <input
              className="input"
              type="date"
              value={completeDate}
              onChange={(e) => setCompleteDate(e.target.value)}
            />
          </FormField>

          <FormField label="安装师傅" required error={errors.installer}>
            <input
              className={
                errors.installer ? "input input--error" : "input"
              }
              value={installer}
              placeholder="默认带出预约师傅，可修改"
              onChange={(e) => setInstaller(e.target.value)}
            />
          </FormField>

          <FormField label="实际线缆用量（米，默认带出勘测距离）">
            <input
              className="input"
              type="number"
              inputMode="decimal"
              min="0"
              value={actualCable}
              placeholder="默认带出勘测距离，按实际修改"
              onChange={(e) => setActualCable(e.target.value)}
            />
          </FormField>

          <FormField label="增项费用（元，话术用，可选）">
            <input
              className="input"
              type="number"
              inputMode="decimal"
              min="0"
              value={addonFee}
              placeholder="客户增项付费合计"
              onChange={(e) => setAddonFee(e.target.value)}
            />
          </FormField>

          <FormField label="安装详情（默认带出勘测安装方式，可改）">
            <input
              className="input"
              value={installDetail}
              placeholder="如 壁挂安装，PVC敷设"
              onChange={(e) => setInstallDetail(e.target.value)}
            />
          </FormField>

          <FormField label="完工备注（默认带出勘测备注，可改）">
            <textarea
              className="textarea"
              value={note}
              placeholder="验收情况、遗留事项等"
              onChange={(e) => setNote(e.target.value)}
            />
          </FormField>
        </div>

        {/* ===== 【8】保存按钮 ===== */}
        <button
          type="button"
          className="btn btn--primary btn--lg"
          onClick={handleSubmit}
          style={{
            width: "100%",
            padding: "16px",
            fontSize: "16px",
            fontWeight: "bold",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            background: "var(--color-success)",
            color: "#fff",
            border: "none",
            borderRadius: "8px",
          }}
        >
          <span style={{ fontSize: "20px" }}>✓</span>
          保存核算
        </button>
        <button
          type="button"
          className="btn btn--outline"
          onClick={onClose}
          style={{
            width: "100%",
            marginTop: "8px",
            padding: "12px",
          }}
        >
          取消
        </button>
      </Modal>

      {/* 安装完工话术弹窗（保留） */}
      <ScriptDialog
        open={scriptOpen}
        order={order}
        scene="installComplete"
        extras={{
          materialsText,
          totalCostText: completionCalc
            ? formatMoney(completionCalc.profitData.profit)
            : "以实际为准",
          installerName: installer.trim(),
          completeDate,
          installDetail: installDetail.trim(),
          addonFee:
            addonFee.trim() !== "" && Number.isFinite(Number(addonFee))
              ? Number(addonFee)
              : undefined,
          actualCable:
            actualCable.trim() !== "" &&
            Number.isFinite(Number(actualCable))
              ? Number(actualCable)
              : undefined,
          actualReceived: completionCalc?.actualReceived,
          addonTotal: completionCalc?.addonTotal,
          materials: scriptMaterials,
        }}
        onClose={() => setScriptOpen(false)}
        onConfirm={handleConfirmSubmit}
      />

      {/* 固定辅材子窗口（保留） */}
      <FixedMaterialsDialog
        open={fixedAuxOpen}
        order={order}
        brandName={leapmotorBrandName}
        cableMeters={
          Number(actualCable) || Number(order.survey?.cableDistance) || 0
        }
        onClose={() => setFixedAuxOpen(false)}
        onSave={(sel) => {
          updateOrder(order.id, { ...order, fixedAux: sel });
          setFixedAuxOpen(false);
          showToast("固定辅材已保存");
        }}
      />
    </>
  );
}
