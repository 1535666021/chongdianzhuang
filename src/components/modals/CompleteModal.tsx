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
    const initMaterials = (order.survey?.materials ?? []).map((item) => ({
      ...item,
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
    };
  }, [open, order, materials, actualCable, actualReceivedInput]);

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
      title={`登记完工 · ${order.customerName}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--outline" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn btn--primary btn--lg"
            onClick={handleSubmit}
          >
            保存完工
          </button>
        </>
      }
    >
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
          className={errors.installer ? "input input--error" : "input"}
          value={installer}
          placeholder="默认带出预约师傅，可修改"
          onChange={(e) => setInstaller(e.target.value)}
        />
      </FormField>

      {/* ---- 增项物料：默认带出勘测清单（带出行即终态，一行不少）；下拉选择
             （与勘测页同一 getAddonOptions），选中带出售单价为默认金额，
             可增可删可改金额 ---- */}
      <FormField label="实际使用物料（默认带出勘测清单，每行可改可删可补）">
        <div className="flex-column gap-sm">
          {materials.map((item, index) => (
            <div key={index} className="card card--flat">
              <div className="flex gap-sm">
                <input
                  className="input flex-1"
                  placeholder="物料名称"
                  value={item.name}
                  onChange={(e) => patchMaterial(index, "name", e.target.value)}
                />
                {/* 任务v33 零跑单行金额（仅零跑单渲染；无单价=套包内不计价） */}
                {leapmotorActive && (
                  <span className="text-sm text-secondary">
                    {item.unitPrice !== undefined
                      ? `¥${leapmotorAddonLineAmount(item.unitPrice, item.quantity)}`
                      : "套包内"}
                  </span>
                )}
                <button
                  type="button"
                  className="btn btn--danger-outline btn--sm"
                  aria-label="删除物料"
                  onClick={() => removeMaterial(index)}
                >
                  删
                </button>
              </div>
              <div className="flex gap-sm mt-sm">
                <input
                  className="input flex-1"
                  placeholder="规格"
                  value={item.spec}
                  onChange={(e) => patchMaterial(index, "spec", e.target.value)}
                />
                <input
                  className="input flex-1"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  placeholder="数量"
                  value={String(item.quantity)}
                  onChange={(e) =>
                    patchMaterial(index, "quantity", e.target.value)
                  }
                />
                <input
                  className="input flex-1"
                  placeholder="单位"
                  value={item.unit}
                  onChange={(e) => patchMaterial(index, "unit", e.target.value)}
                />
                <input
                  className="input flex-1"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  placeholder="金额(元)"
                  value={item.unitPrice != null ? String(item.unitPrice) : ""}
                  onChange={(e) =>
                    patchMaterial(index, "unitPrice", e.target.value)
                  }
                />
              </div>
            </div>
          ))}
          {/* 任务v33 零跑增项模板下拉（仅零跑单渲染，位于现有品牌增项下拉上方）：
              选中带出名称/单位/单价追加一行（数量默认1，行内可改），随后复位 */}
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
            >
              <option value="">从零跑模板选择添加…</option>
              {leapmotorTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}（{t.price}元/{t.unit}）
                </option>
              ))}
            </select>
          )}
          {/* 增项下拉：与勘测页完全一致（同一 getAddonOptions、同一交互），
              选中即追加一行并带默认金额，随后复位 */}
          <select
            className="input"
            value={addonPick}
            aria-label="选择增项加入清单"
            onChange={(e) => addAddon(e.target.value)}
          >
            <option value="">＋ 选择增项（按常用排序）…</option>
            {addonOptions.map((option) => (
              <option key={option.name} value={option.name}>
                {option.name}（{option.unit}）¥{option.salePrice}
                {option.usageCount > 0 ? ` · 用过${option.usageCount}次` : ""}
              </option>
            ))}
          </select>
          {/* 任务v33 零跑增项区底合计（仅零跑单渲染；只对带单价行计价） */}
          {leapmotorActive && (
            <div className="text-sm text-secondary">
              增项合计 ¥{leapmotorAddonsTotal(materials)}
            </div>
          )}
          {/* 任务v36 增项区底部：合计行（应收=addonTotalWithCable）+ 实收输入
              +「固定辅材」次按钮（打开 FixedMaterialsDialog 子窗口） */}
          <div className="flex-between text-sm">
            <span className="text-secondary">增项合计（应收）</span>
            <span className="text-bold">
              {formatMoney(completionCalc?.addonTotal ?? 0)}
            </span>
          </div>
          <div className="flex gap-sm">
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
        </div>
      </FormField>

      {completionCalc && (
        <div className="card card--flat mt-sm">
          <div className="flex-column gap-sm">
            <div className="text-sm text-bold">成本核算</div>
            <div className="flex-between text-sm">
              <span className="text-secondary">客户增项应收</span>
              <span>{formatMoney(completionCalc.addonTotal)}</span>
            </div>
            <div className="flex-between text-sm">
              <span className="text-secondary">客户实收</span>
              <span>{formatMoney(completionCalc.actualReceived)}</span>
            </div>
            <div className="flex-between text-sm">
              <span className="text-secondary">
                平台扣点（{rateToPercentText(completionCalc.platformRate)}%）
              </span>
              <span>
                -{" "}
                {formatMoney(
                  Math.abs(completionCalc.profitData.platformDeduction),
                )}
              </span>
            </div>
            {/* 任务v36.2：固定辅材行可点击→弹出子窗口修改 */}
            <div
              className="flex-between text-sm"
              style={{ cursor: "pointer" }}
              onClick={() => setFixedAuxOpen(true)}
              title="点击修改固定辅材"
            >
              <span className="text-secondary">材料成本（含固定辅材）</span>
              <span>- {formatMoney(Math.abs(completionCalc.materialCost))}</span>
            </div>
            <div className="flex-between text-sm">
              <span className="text-secondary">服务费（按服务类型）</span>
              <span>+ {formatMoney(completionCalc.serviceFee)}</span>
            </div>
            <div className="flex-between">
              <span className="text-sm text-bold">预估到手</span>
              <span className="text-lg text-bold text-primary-color">
                {formatMoney(completionCalc.profitData.profit)}
              </span>
            </div>
            {/* 任务v36.1 FAIL-5：预估到手可溯源——计算明细可展开，
                材料成本三拆（电缆/固定辅材/其他），负数一眼定位科目 */}
            <button
              type="button"
              className="btn btn--outline btn--sm"
              onClick={() => setShowCostDetail((v) => !v)}
            >
              {showCostDetail ? "收起明细" : "计算明细"}
            </button>
            {showCostDetail ? (
              <div className="flex-column gap-xs text-sm text-secondary">
                <div>服务费 +{formatMoney(completionCalc.serviceFee)}</div>
                <div>
                  增项费 +{formatMoney(completionCalc.actualReceived)}
                  （实收口径）
                </div>
                <div>
                  平台扣点 −
                  {formatMoney(
                    Math.abs(completionCalc.profitData.platformDeduction),
                  )}
                </div>
                {/* 任务v36.2-P3：固定辅材拆三行（漏保/PVC管/漏保盒），三项和=总额 */}
                <div>
                  材料成本 −{formatMoney(completionCalc.materialBreakdown.total)}
                  （电缆<CostBindField
                    materialName="电缆"
                    orderValue={order.fixedAux?.cablePrice}
                    quantity={completionCalc.cableTotalMeters}
                    onBind={(price, name) => {
                      updateOrder(order.id, {
                        ...order,
                        fixedAux: {
                          ...(order.fixedAux ?? {
                            breakerSpec: "C40",
                            breakerPrice: null,
                            pvcMeters: 0,
                            leakBoxPrice: null,
                          }),
                          cablePrice: price,
                          cableBoundName: name,
                        },
                      });
                    }}
                    showToast={showToast}
                  />
                  +其他{formatMoney(completionCalc.materialBreakdown.other)}）
                </div>
                {completionCalc.materialBreakdown.fixedAuxItems ? (
                  <div className="flex-column gap-xs" style={{ paddingLeft: 16 }}>
                    <div>
                      {completionCalc.materialBreakdown.fixedAuxItems.breakerLabel}
                      <CostBindField
                        materialName="漏保"
                        orderValue={order.fixedAux?.breakerPrice}
                        onBind={(price, name) => {
                          updateOrder(order.id, {
                            ...order,
                            fixedAux: {
                              ...(order.fixedAux ?? {
                                breakerSpec: "C40",
                                breakerPrice: null,
                                pvcMeters: 0,
                                leakBoxPrice: null,
                              }),
                              breakerPrice: price,
                            },
                          });
                        }}
                        showToast={showToast}
                      />
                    </div>
                    <div>
                      PVC管 {completionCalc.materialBreakdown.fixedAuxItems.pvcMeters}米{" "}
                      <CostBindField
                        materialName="PVC管"
                        orderValue={order.fixedAux?.pvcPrice}
                        quantity={completionCalc.materialBreakdown.fixedAuxItems.pvcMeters}
                        onBind={(price, name) => {
                          updateOrder(order.id, {
                            ...order,
                            fixedAux: {
                              ...(order.fixedAux ?? {
                                breakerSpec: "C40",
                                breakerPrice: null,
                                pvcMeters: 0,
                                leakBoxPrice: null,
                              }),
                              pvcPrice: price,
                              pvcBoundName: name,
                            },
                          });
                        }}
                        showToast={showToast}
                      />
                    </div>
                    <div>
                      漏保盒{" "}
                      <CostBindField
                        materialName="漏保盒"
                        orderValue={order.fixedAux?.leakBoxPrice}
                        onBind={(price, name) => {
                          updateOrder(order.id, {
                            ...order,
                            fixedAux: {
                              ...(order.fixedAux ?? {
                                breakerSpec: "C40",
                                breakerPrice: null,
                                pvcMeters: 0,
                                leakBoxPrice: null,
                              }),
                              leakBoxPrice: price,
                            },
                          });
                        }}
                        showToast={showToast}
                      />
                    </div>
                  </div>
                ) : null}
                <div className="text-bold">
                  = 预估到手 {formatMoney(completionCalc.profitData.profit)}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* 任务Q 话术变量可选字段：不强制，填了话术自动代入 */}
      <FormField label="实际线缆用量（米，默认带出勘测距离；带出行即终态，改动不再重建增项行）">
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
          placeholder="如 壁挂安装，PVC管敷设"
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
    </Modal>

    {/* 安装完工话术：复制后继续提交；onClose 仅关话术层，保留完工表单。
     * 电源点/安装方式等勘测字段不在 extras 传值，
     * 由 buildScriptVars 从 order.survey 回退带入（链路已确认）；
     * 任务v36：extras 补 actualReceived/addonTotal（addonSummary 变量用），
     * platformBrand 由 buildScriptVars 内部同口径自算，无需传 */}
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
          actualCable.trim() !== "" && Number.isFinite(Number(actualCable))
            ? Number(actualCable)
            : undefined,
        actualReceived: completionCalc?.actualReceived,
        addonTotal: completionCalc?.addonTotal,
        materials: scriptMaterials,
      }}
      onClose={() => setScriptOpen(false)}
      onConfirm={handleConfirmSubmit}
    />

    {/* 任务v36：固定辅材子窗口（漏保规格/单价 + PVC米数）；
     * onSave → updateOrder fixedAux 持久化 + toast（与 1号线同口径） */}
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
