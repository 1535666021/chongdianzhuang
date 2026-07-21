/* ============================================================
 * 勘测登记弹窗
 * 内含并导出 MaterialListEditor（完工弹窗仍在复用，该组件本身保持不动；
 * 勘测表单的增项区按任务R改为本文件内的"下拉选择"实现——
 * 选项来自 getAddonOptions（品牌增项清单按历史使用频率降序），
 * 选中后带出售单价为默认金额，可增可删可改金额）
 * 任务R：分区卡片（线缆信息 / 位置信息）+ 卡内双列网格（标签在上控件在下）；
 *      打开即全预设：勘测人=设置页工程师姓名（engineerName 联动）、
 *      勘测日期=当天，取电方式/线缆规格/勘测详情/电表状态/
 *      物业需要施工方案图/勘测结果 读 loadFormPresets()；
 *      电缆距离输入实时显示"预估增项"（套包米数/超米单价读品牌费率配置）
 * ============================================================ */

import { useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "@/components/common/Modal";
import { FormField } from "@/components/common/FormField";
import { Icon } from "@/components/common/Icon";
import { ScriptDialog } from "@/components/ScriptDialog";
/* 任务v36：固定辅材录入子窗口（漏保规格/单价/PVC米数 → order.fixedAux） */
import { FixedMaterialsDialog } from "@/components/FixedMaterialsDialog";
import { useApp } from "@/context/AppContext";
import {
  findBrand,
  getBrandMaterialPack,
  mergeBrands,
} from "@/lib/brandMaterials";
import { getAddonOptions } from "@/lib/addonOptions";
/* 任务v33：零跑增项触发判定与金额计算（业务逻辑收敛 lib，本组件只渲染） */
import {
  isLeapmotorBrand,
  leapmotorAddonLineAmount,
} from "@/lib/leapmotorAddons";
/* 任务v35.1：套包米数识别 / 增项「线缆敷设」行常驻同步 V2 /
 * 行计费与合计 / 超出行话术 V2（业务逻辑收敛 lib，本组件只渲染） */
import {
  addonTotalWithCable,
  buildCableOverFeeTextV2,
  CABLE_ADDON_ROW_NAME,
  cableChargeAmount,
  parsePackageMetersFromText,
  syncCableRowV2,
} from "@/lib/packageMeters";
/* 任务v35.1：增项短名（仅选择列表显示用；行内/话术/单据照旧全称） */
import { addonShortNameOf } from "@/lib/addonShortName";
import { getScript } from "@/lib/scripts";
import {
  loadBrandScripts,
  loadCostMappings,
  loadFormPresets,
  loadLeapmotorAddons,
  loadMaterialsLib,
  loadRateConfigs,
} from "@/lib/storage";
import { materialNames } from "@/lib/materials";
import { todayStr } from "@/lib/utils";
import type { MaterialItem, SurveyModalProps } from "@/types";

/* ------------------------------------------------------------
 * 物料清单编辑器（导出供 CompleteModal 复用，保持原实现不动）
 * ------------------------------------------------------------ */
export interface MaterialListEditorProps {
  items: MaterialItem[];
  onChange: (items: MaterialItem[]) => void;
}

const EMPTY_MATERIAL: MaterialItem = {
  name: "",
  spec: "",
  quantity: 1,
  unit: "个",
};

export function MaterialListEditor({ items, onChange }: MaterialListEditorProps) {
  const { orders } = useApp();

  /* 增项名称联想：按历史订单物料使用频率降序（同频保持映射表原顺序）。
   * 仅提供候选，选中后不回填 unitPrice（单价是客户价，由师傅定） */
  const nameOptions = useMemo(() => {
    const freq = new Map<string, number>();
    for (const order of orders) {
      const used = [
        ...(order.survey?.materials ?? []),
        ...(order.completion?.materials ?? []),
      ];
      for (const m of used) {
        freq.set(m.name, (freq.get(m.name) ?? 0) + 1);
      }
    }
    const fromMappings = loadCostMappings().map((m) => m.addonName);
    /* 任务D：候选 = 成本映射增项 ∪ 材料库名称（去重），按使用频率降序、同频按来源顺序 */
    const fromLib = materialNames(loadMaterialsLib());
    const all = [...new Set([...fromMappings, ...fromLib])];
    return all
      .map((name, index) => ({ name, index, count: freq.get(name) ?? 0 }))
      .sort((a, b) => b.count - a.count || a.index - b.index)
      .map((entry) => entry.name);
  }, [orders]);

  const patchItem = (
    index: number,
    key: keyof MaterialItem,
    value: string,
  ) => {
    const next = items.map((item, i) => {
      if (i !== index) return item;
      if (key === "quantity" || key === "unitPrice") {
        const num = Number(value);
        return { ...item, [key]: Number.isFinite(num) ? num : 0 };
      }
      return { ...item, [key]: value };
    });
    onChange(next);
  };

  const removeItem = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  const addItem = () => {
    onChange([...items, { ...EMPTY_MATERIAL }]);
  };

  return (
    <div className="flex-column gap-sm">
      {/* 增项候选（按使用频率降序），勘测/完工两弹窗共用此 datalist */}
      <datalist id="material-name-options">
        {nameOptions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      {items.map((item, index) => (
        <div key={index} className="card card--flat">
          <div className="flex gap-sm">
            <input
              className="input flex-1"
              placeholder="物料名称"
              list="material-name-options"
              value={item.name}
              onChange={(e) => patchItem(index, "name", e.target.value)}
            />
            <button
              type="button"
              className="btn btn--danger-outline btn--sm"
              aria-label="删除物料"
              onClick={() => removeItem(index)}
            >
              删
            </button>
          </div>
          <div className="flex gap-sm mt-sm">
            <input
              className="input flex-1"
              placeholder="规格"
              value={item.spec}
              onChange={(e) => patchItem(index, "spec", e.target.value)}
            />
            <input
              className="input flex-1"
              type="number"
              inputMode="decimal"
              min="0"
              placeholder="数量"
              value={String(item.quantity)}
              onChange={(e) => patchItem(index, "quantity", e.target.value)}
            />
            <input
              className="input flex-1"
              placeholder="单位"
              value={item.unit}
              onChange={(e) => patchItem(index, "unit", e.target.value)}
            />
          </div>
        </div>
      ))}
      <button
        type="button"
        className="btn btn--secondary btn--sm"
        onClick={addItem}
      >
        ＋ 添加物料
      </button>
    </div>
  );
}

/* ------------------------------------------------------------
 * 勘测弹窗主体
 * ------------------------------------------------------------ */
interface SurveyErrors {
  surveyDate?: string;
  surveyor?: string;
  cableDistance?: string;
}

/**
 * 超米预估缺省回退链（任务R：禁硬编码数字字面量，缺省集中在此并注释）：
 * 优先读设置页「费率配置」该品牌的 packageMeters / overMeterPrice，
 * 未配置时回退到下列缺省（与话术 buildScriptVars 的缺省口径一致）
 */
const FALLBACK_PACKAGE_METERS = 30; // 套包米数缺省（米）
const FALLBACK_OVER_METER_PRICE = 45; // 超米单价缺省（元/米）

/** 任务v35.1：勘测结果固定二选一下拉（presets 值不在两项内时回退第一项） */
const SURVEY_RESULT_OPTIONS = [
  "勘测完成符合安装",
  "勘测完成不符合安装条件",
] as const;

export function SurveyModal({ open, order, onClose }: SurveyModalProps) {
  const { settings, customBrands, orders, saveSurvey, showToast, updateOrder } =
    useApp();

  const [surveyDate, setSurveyDate] = useState(todayStr());
  const [surveyor, setSurveyor] = useState("");
  const [cableDistance, setCableDistance] = useState("30");
  /* 任务v35：套包米数（字符串态输入；保存时有值才持久化到 order.packageMeters） */
  const [packageMetersInput, setPackageMetersInput] = useState("");
  const [note, setNote] = useState("");
  const [materials, setMaterials] = useState<MaterialItem[]>([]);
  const [errors, setErrors] = useState<SurveyErrors>({});
  /** 勘测完成话术弹窗开关（保存勘测校验通过后先弹话术） */
  const [scriptOpen, setScriptOpen] = useState(false);
  /* 任务v35.1：线缆信息 / 位置信息两分区卡默认收起（点标题行展开/再点收起，
   * 纯显示折叠，字段/state/校验一概不动；增项物料、勘测备注常开） */
  const [cableInfoOpen, setCableInfoOpen] = useState(false);
  const [positionInfoOpen, setPositionInfoOpen] = useState(false);
  /* 任务Q 话术变量可选字段（不强制填写，缺省话术对应变量为空） */
  const [powerSource, setPowerSource] = useState("");
  const [installType, setInstallType] = useState("");
  const [meterStatus, setMeterStatus] = useState("");
  const [needPlanDoc, setNeedPlanDoc] = useState("");
  const [surveyResult, setSurveyResult] = useState<string>(
    SURVEY_RESULT_OPTIONS[0],
  );
  /* 任务v35.1：物业是否允许施工缺省「是」（表单预设无此字段，直接回退"是"） */
  const [propertyAllow, setPropertyAllow] = useState("是");
  /* 任务R 表单预设字段：线缆规格（保存进 SurveyInfo，不进话术模板） */
  const [cableSpec, setCableSpec] = useState("");
  /** 增项下拉的受控选中值（选中追加一行后立即复位，便于连续添加） */
  const [addonPick, setAddonPick] = useState("");
  /* 任务v33：零跑增项模板下拉选中值（同 addonPick 口径，选中追加后立即复位） */
  const [leapPick, setLeapPick] = useState("");
  /* 任务v36：固定辅材子窗口开关 */
  const [fixedAuxOpen, setFixedAuxOpen] = useState(false);
  /* 任务v36：增项区各行数量 input 引用（按 index 存）——
   * 电缆行点行聚焦 / 下拉追加行后聚焦新行数量框共用 */
  const quantityRefs = useRef<Array<HTMLInputElement | null>>([]);
  /** 聚焦指定行数量框（已聚焦则不重复触发） */
  const focusQuantity = (index: number) => {
    const el = quantityRefs.current[index];
    if (el && document.activeElement !== el) el.focus();
  };

  /* 打开时初始化：默认今天 / 勘测人联动设置页工程师姓名 /
   * 一键带入品牌物料包 / 6 项读表单预设（设置页「表单预设」区可改） */
  useEffect(() => {
    if (!open || !order) return;
    setErrors({});
    setScriptOpen(false);
    /* 任务v35.1：打开/换单时两分区卡回到默认收起态 */
    setCableInfoOpen(false);
    setPositionInfoOpen(false);
    /* 任务v36 回显：已存勘测快照 → 全字段从 order.survey 带出
     * （快照缺字段用表单预设/默认值补），随后 return 不走 presets 预填 */
    if (order.survey) {
      const snap = order.survey;
      const presets = loadFormPresets();
      setSurveyDate(snap.surveyDate || todayStr());
      setSurveyor(snap.surveyor || settings.engineerName || "");
      setCableDistance(
        Number.isFinite(snap.cableDistance) && snap.cableDistance > 0
          ? String(snap.cableDistance)
          : "30",
      );
      setNote(snap.note ?? "");
      /* 套包米数：已持久化 order.packageMeters 优先，其次原文识别（同下方预填口径） */
      setPackageMetersInput(
        order.packageMeters != null
          ? String(order.packageMeters)
          : String(parsePackageMetersFromText(order.originalText ?? "") ?? ""),
      );
      /* 增项物料（含线缆行）整段回显；
       * 任务v36.1 FAIL-2：回显后过一遍 syncCableRowV2——快照里若没有电缆行
       * （v35.1 前保存/异常数据），也必须无条件补回首行（v35.1 既定行为：
       *  含新单、无套包米数单、无布线距离单，线缆行常驻） */
      const snapPm =
        order.packageMeters ??
        parsePackageMetersFromText(order.originalText ?? "") ??
        loadRateConfigs().find((c) => c.brandId === order.brandId)
          ?.packageMeters ??
        30;
      setMaterials(
        syncCableRowV2(
          snap.materials ?? [],
          Number.isFinite(snap.cableDistance) && snap.cableDistance > 0
            ? snap.cableDistance
            : 30,
          snapPm,
          resolveCableUnitPrice(),
        ),
      );
      setPowerSource(snap.powerSource ?? presets.powerSource);
      setCableSpec(snap.cableSpec ?? presets.cableSpec);
      setInstallType(snap.installType ?? presets.installType);
      setMeterStatus(snap.meterStatus ?? presets.meterStatus);
      setNeedPlanDoc(snap.needPlanDoc ?? presets.needPlanDoc);
      setSurveyResult(
        (SURVEY_RESULT_OPTIONS as readonly string[]).includes(
          snap.surveyResult ?? "",
        )
          ? (snap.surveyResult as string)
          : SURVEY_RESULT_OPTIONS[0],
      );
      setPropertyAllow(snap.propertyAllow ?? "是");
      setAddonPick("");
      setLeapPick("");
      return;
    }
    setSurveyDate(todayStr());
    setSurveyor(settings.engineerName ?? "");
    setCableDistance("30");
    setNote("");
    /* 任务v35：套包米数预填——已持久化值 → 原文识别 → 空串（识别不到可手填） */
    const pmText =
      order.packageMeters != null
        ? String(order.packageMeters)
        : String(parsePackageMetersFromText(order.originalText ?? "") ?? "");
    setPackageMetersInput(pmText);
    /* 任务v35.1：品牌物料包带出后，「线缆敷设」行常驻首行
     * （数量=打开初始布线距离30；总量>套包才带单价，≤套包无单价不计费），他行保留 */
    const rateCfg = loadRateConfigs().find((r) => r.brandId === order.brandId);
    const initPm =
      Number(pmText) ||
      parsePackageMetersFromText(order.originalText ?? "") ||
      (rateCfg?.packageMeters ?? FALLBACK_PACKAGE_METERS);
    /* 任务v36：电缆行单价=增项材料库「线缆敷设」出售价优先，缺省回退品牌超米单价 */
    const initOverPrice =
      loadMaterialsLib().find((m) => m.name === CABLE_ADDON_ROW_NAME)
        ?.salePrice ??
      rateCfg?.overMeterPrice ??
      FALLBACK_OVER_METER_PRICE;
    setMaterials(
      syncCableRowV2(
        getBrandMaterialPack(order.brandId),
        30,
        initPm,
        initOverPrice,
      ),
    );
    const presets = loadFormPresets();
    setPowerSource(presets.powerSource);
    setCableSpec(presets.cableSpec);
    setInstallType(presets.installType);
    setMeterStatus(presets.meterStatus);
    setNeedPlanDoc(presets.needPlanDoc);
    /* 任务v35.1：勘测结果二选一——presets 值属于两项之一照用，否则回退「勘测完成符合安装」 */
    setSurveyResult(
      (SURVEY_RESULT_OPTIONS as readonly string[]).includes(
        presets.surveyResult,
      )
        ? presets.surveyResult
        : SURVEY_RESULT_OPTIONS[0],
    );
    /* 任务v35.1：物业是否允许施工缺省「是」 */
    setPropertyAllow("是");
    setAddonPick("");
    setLeapPick(""); // 任务v33：打开/order 变化时复位零跑模板下拉
  }, [open, order, settings.engineerName]);

  /* 品牌名解析：order.brandId 经 findBrand/mergeBrands 解析为 v7 口径品牌名 */
  const brandName = useMemo(() => {
    if (!order) return "";
    return findBrand(order.brandId, customBrands)?.name ?? order.brandId;
  }, [order, customBrands]);

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

  /* 增项下拉选项：品牌增项清单按历史使用频率降序（排序由 getAddonOptions 保证） */
  const addonOptions = useMemo(
    () => (order ? getAddonOptions(brandName, orders) : []),
    [order, brandName, orders],
  );

  /* 该品牌套包米数/超米单价：读设置页「费率配置」，未配置回退缺省常量 */
  const rateConfig = useMemo(
    () =>
      order
        ? loadRateConfigs().find((r) => r.brandId === order.brandId)
        : undefined,
    [order],
  );
  const packageMeters = rateConfig?.packageMeters ?? FALLBACK_PACKAGE_METERS;
  const overMeterPrice = rateConfig?.overMeterPrice ?? FALLBACK_OVER_METER_PRICE;

  /* 电缆距离 → 预估增项：(距离-套包米数)>0 才显示；(距离-套包)×超米单价 */
  const distanceNum = Number(cableDistance);
  const overMeters = Number.isFinite(distanceNum)
    ? Math.round((distanceNum - packageMeters) * 100) / 100
    : 0;
  const overEstimateFee =
    overMeters > 0 ? Math.round(overMeters * overMeterPrice * 100) / 100 : 0;

  const validate = (): boolean => {
    const next: SurveyErrors = {};
    if (!surveyDate) next.surveyDate = "请选择勘测日期";
    if (!surveyor.trim()) next.surveyor = "请填写勘测人";
    const distance = Number(cableDistance);
    if (!Number.isFinite(distance) || distance <= 0)
      next.cableDistance = "请填写正确的距离（米）";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  /* 任务v35.1 套包值取数链（沿 v35）：手填/预填 packageMetersInput →
   * 原文识别 → 品牌费率 packageMeters 兜底（渲染与行同步共用此口径） */
  const resolvePackageMeters = (): number =>
    (order
      ? Number(packageMetersInput) ||
        parsePackageMetersFromText(order.originalText ?? "")
      : 0) || packageMeters;

  /* 任务v36：电缆行单价取数链——增项材料库「线缆敷设」出售价优先，
   * 找不到回退品牌超米单价（syncCableRowV2 的 unitPrice 入参统一走此链，行内可手改） */
  const resolveCableUnitPrice = (): number =>
    loadMaterialsLib().find((m) => m.name === CABLE_ADDON_ROW_NAME)
      ?.salePrice ?? overMeterPrice;

  /* 任务v35.1：布线距离与「线缆敷设」行数量双向联动（last-write-wins，React 受控无循环）——
   * 布线距离 input 与电缆行数量 input 共用本处理器：
   * setCableDistance(同值) 后 syncCableRowV2 重算（行常驻首行、quantity=布线总量、
   * unitPrice 有无随套包切换）；总量空/非数/≤0 时线缆行移除，他行保留 */
  const handleCableDistanceChange = (value: string) => {
    setCableDistance(value);
    if (!order) return;
    const trimmed = value.trim();
    const parsed = trimmed === "" ? undefined : Number(trimmed);
    setMaterials((prev) =>
      syncCableRowV2(
        prev,
        parsed != null && Number.isFinite(parsed) ? parsed : undefined,
        resolvePackageMeters(),
        resolveCableUnitPrice(),
      ),
    );
  };

  /* 任务v35.1：套包米数 input 变更同样重算线缆行（unitPrice 有无随套包切换） */
  const handlePackageMetersInputChange = (value: string) => {
    setPackageMetersInput(value);
    if (!order) return;
    const pm =
      Number(value) ||
      parsePackageMetersFromText(order.originalText ?? "") ||
      packageMeters;
    const trimmed = cableDistance.trim();
    const parsed = trimmed === "" ? undefined : Number(trimmed);
    setMaterials((prev) =>
      syncCableRowV2(
        prev,
        parsed != null && Number.isFinite(parsed) ? parsed : undefined,
        pm,
        resolveCableUnitPrice(),
      ),
    );
  };

  /* ---- 增项区行编辑（勘测表单自实现，与导出的 MaterialListEditor 无关） ---- */
  const patchMaterial = (
    index: number,
    key: keyof MaterialItem,
    value: string,
  ) => {
    const next = materials.map((item, i) => {
      if (i !== index) return item;
      if (key === "quantity") {
        const num = Number(value);
        return { ...item, quantity: Number.isFinite(num) ? num : 0 };
      }
      if (key === "unitPrice") {
        /* 金额清空 → 回到套包内行（无单价，话术只列"名称 数量"不计价） */
        if (value.trim() === "") {
          const cleared = { ...item };
          delete cleared.unitPrice;
          return cleared;
        }
        const num = Number(value);
        return { ...item, unitPrice: Number.isFinite(num) ? num : 0 };
      }
      return { ...item, [key]: value };
    });
    setMaterials(next);
  };

  const removeMaterial = (index: number) => {
    setMaterials(materials.filter((_, i) => i !== index));
  };

  /* 下拉选中增项：追加一行（数量 1、金额=材料库出售单价，金额可改），随后复位下拉。
   * 任务v36：追加后 next tick 自动聚焦新追加行的数量 input */
  const addAddon = (name: string) => {
    setAddonPick("");
    const option = addonOptions.find((o) => o.name === name);
    if (!option) return;
    const newIndex = materials.length;
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
    setTimeout(() => focusQuantity(newIndex), 0);
  };

  /* 真正提交（话术弹窗"复制并继续"或无模板跳过时调用） */
  const handleConfirmSubmit = () => {
    if (!order || !validate()) return;
    /* 任务v35：套包米数为有限数且>0 → 先持久化到 order.packageMeters；
     * 空/非法则不写（不拦截，原提交流程照走） */
    const pm = Number(packageMetersInput);
    if (Number.isFinite(pm) && pm > 0) {
      updateOrder(order.id, { ...order, packageMeters: pm });
    }
    // 过滤掉名称为空的物料行
    const validMaterials = materials.filter((m) => m.name.trim() !== "");
    saveSurvey(order.id, {
      surveyDate,
      surveyor: surveyor.trim(),
      cableDistance: Number(cableDistance),
      note: note.trim(),
      materials: validMaterials,
      powerSource: powerSource.trim(),
      installType: installType.trim(),
      meterStatus,
      needPlanDoc,
      surveyResult: surveyResult.trim(),
      propertyAllow,
      cableSpec: cableSpec.trim(),
    });
    showToast("勘测已登记，订单进入「已勘测」");
    onClose();
  };

  /* 点「保存勘测」：校验通过后先弹勘测完成话术；该品牌无模板则跳过直接提交 */
  const handleSubmit = () => {
    if (!order || !validate()) return;
    const template = getScript(
      order.brandId,
      "surveyComplete",
      loadBrandScripts(),
    );
    if (!template) {
      handleConfirmSubmit();
      return;
    }
    setScriptOpen(true);
  };

  /* 话术变量：有效物料逐行「名称 规格 ×数量单位」，无物料按现场勘测确定；
   * 任务v35.1：「线缆敷设」行一律换 buildCableOverFeeTextV2（总距离=当前布线距离；
   * 超出=「布线X米，套包免费Y米，超出Z米×¥单价=¥W」；未超出=「布线X米，套包内，无线缆增项」；
   * 未超出行无单价，单价参数兜底品牌超米价不会参与文案）；
   * 任务v36：其余行名称用 addonShortNameOf 短名，规格/数量/单位自拼格式不动 */
  const scriptMaterials = materials.filter((m) => m.name.trim() !== "");
  const materialsText =
    scriptMaterials.length > 0
      ? scriptMaterials
          .map((m) => {
            if (m.name.trim() === CABLE_ADDON_ROW_NAME) {
              return buildCableOverFeeTextV2(
                Number(cableDistance) || 0,
                resolvePackageMeters(),
                m.unitPrice ?? overMeterPrice,
              );
            }
            /* 任务v36：其他增项行话术名称用短名（行内仍存全称，单据不受影响）；
             * 规格/数量/单位拼接格式不动 */
            const spec = m.spec.trim();
            const shortName = addonShortNameOf({ name: m.name.trim() });
            return `${shortName}${spec ? ` ${spec}` : ""} ×${m.quantity}${m.unit}`;
          })
          .join("\n")
      : "按现场勘测确定";

  if (!order) return null;

  return (
    <>
    <Modal
      open={open}
      title={`登记勘测 · ${order.customerName}`}
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
            保存勘测
          </button>
        </>
      }
    >
      {/* ---- 分区卡片①：线缆信息（双列网格，标签在上控件在下） ---- */}
      {/* 任务v35.1：默认收起，点标题行展开/再点收起（纯显示折叠） */}
      <div className="card card--flat">
        <div
          className="card__title flex-between copyable"
          onClick={() => setCableInfoOpen((v) => !v)}
        >
          线缆信息
          <Icon
            name={cableInfoOpen ? "chevron-down" : "chevron-right"}
            size={16}
            className="text-tertiary"
          />
        </div>
        {cableInfoOpen ? (
        <>
        <div className="form-grid-2col">
          <FormField
            label="电表到桩位距离（米）"
            required
            error={errors.cableDistance}
          >
            <input
              className={errors.cableDistance ? "input input--error" : "input"}
              type="number"
              inputMode="decimal"
              min="0"
              value={cableDistance}
              onChange={(e) => handleCableDistanceChange(e.target.value)}
            />
          </FormField>

          {/* 任务v35：套包米数（打开预填持久化值/原文识别值，识别不到可手填；
              保存时有值才写回 order.packageMeters） */}
          <FormField label="套包米数">
            <input
              className="input"
              type="number"
              inputMode="decimal"
              min="0"
              placeholder="未识别可手填，如 30"
              value={packageMetersInput}
              onChange={(e) => handlePackageMetersInputChange(e.target.value)}
            />
          </FormField>

          <FormField label="线缆规格">
            <input
              className="input"
              value={cableSpec}
              placeholder="如 3*6"
              onChange={(e) => setCableSpec(e.target.value)}
            />
          </FormField>

          <FormField label="取电方式">
            <input
              className="input"
              value={powerSource}
              placeholder="如 国网取电"
              onChange={(e) => setPowerSource(e.target.value)}
            />
          </FormField>

          <FormField label="勘测详情">
            <input
              className="input"
              value={installType}
              placeholder="如 壁挂安装"
              onChange={(e) => setInstallType(e.target.value)}
            />
          </FormField>
        </div>
        {/* 距离超出套包米数时实时提示预估增项费用 */}
        {overEstimateFee > 0 ? (
          <p className="text-sm text-secondary mt-sm">
            预估增项{" "}
            <span className="text-bold">
              ¥{overEstimateFee}
            </span>
            （超{overMeters}m × {overMeterPrice}元/米）
          </p>
        ) : null}
        </>
        ) : null}
      </div>

      {/* ---- 分区卡片②：位置信息（双列网格，标签在上控件在下） ---- */}
      {/* 任务v35.1：默认收起，点标题行展开/再点收起（纯显示折叠） */}
      <div className="card card--flat">
        <div
          className="card__title flex-between copyable"
          onClick={() => setPositionInfoOpen((v) => !v)}
        >
          位置信息
          <Icon
            name={positionInfoOpen ? "chevron-down" : "chevron-right"}
            size={16}
            className="text-tertiary"
          />
        </div>
        {positionInfoOpen ? (
        <div className="form-grid-2col">
          <FormField label="勘测日期" required error={errors.surveyDate}>
            <input
              className="input"
              type="date"
              value={surveyDate}
              onChange={(e) => setSurveyDate(e.target.value)}
            />
          </FormField>

          <FormField label="勘测人" required error={errors.surveyor}>
            <input
              className={errors.surveyor ? "input input--error" : "input"}
              value={surveyor}
              placeholder="可在设置页工程师信息配置"
              onChange={(e) => setSurveyor(e.target.value)}
            />
          </FormField>

          <FormField label="电表状态">
            <select
              className="input"
              value={meterStatus}
              onChange={(e) => setMeterStatus(e.target.value)}
            >
              <option value="">未选择</option>
              <option value="已安装">已安装</option>
              <option value="未安装">未安装</option>
            </select>
          </FormField>

          <FormField label="物业需要施工方案图">
            <select
              className="input"
              value={needPlanDoc}
              onChange={(e) => setNeedPlanDoc(e.target.value)}
            >
              <option value="">未选择</option>
              <option value="是">是</option>
              <option value="否">否</option>
            </select>
          </FormField>

          <FormField label="物业是否允许施工">
            <select
              className="input"
              value={propertyAllow}
              onChange={(e) => setPropertyAllow(e.target.value)}
            >
              <option value="">未选择</option>
              <option value="是">是</option>
              <option value="否">否</option>
            </select>
          </FormField>

          {/* 任务v35.1：勘测结果手输改固定二选一下拉（保存值照走 surveyResult.trim()） */}
          <FormField label="勘测结果">
            <select
              className="input"
              value={surveyResult}
              onChange={(e) => setSurveyResult(e.target.value)}
            >
              {SURVEY_RESULT_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </FormField>
        </div>
        ) : null}
      </div>

      {/* ---- 增项物料：下拉选择（该品牌清单按历史频率降序），
           选中带出售单价为默认金额，可增可删可改金额 ---- */}
      <FormField label="增项物料">
        <div className="flex-column gap-sm">
          {materials.map((item, index) => {
            /* 任务v35.1：「线缆敷设」行常驻（用户改名后视为普通增项，不再特判） */
            const isCableRow = item.name.trim() === CABLE_ADDON_ROW_NAME;
            return (
            /* 任务v36：电缆行点行任意处聚焦数量框（input 自身点击原生聚焦，不重复触发） */
            <div
              key={index}
              className="card card--flat"
              onClick={
                isCableRow ? () => focusQuantity(index) : undefined
              }
            >
              <div className="flex gap-sm">
                <input
                  className="input flex-1"
                  placeholder="物料名称"
                  value={item.name}
                  onChange={(e) => patchMaterial(index, "name", e.target.value)}
                />
                {/* 任务v33 零跑单行金额（仅零跑单渲染；无单价=套包内不计价）。
                    任务v35.1：线缆行特判 cableChargeAmount=(总量−套包)×单价（>0 显示金额，否则「套包内」） */}
                {leapmotorActive && (
                  <span className="text-sm text-secondary">
                    {isCableRow
                      ? cableChargeAmount(item, resolvePackageMeters()) > 0
                        ? `¥${cableChargeAmount(item, resolvePackageMeters())}`
                        : "套包内"
                      : item.unitPrice !== undefined
                        ? `¥${leapmotorAddonLineAmount(item.unitPrice, item.quantity)}`
                        : "套包内"}
                  </span>
                )}
                {/* 任务v35.1：电缆行常驻不渲染删除按钮；其他行删除照旧 */}
                {!isCableRow && (
                  <button
                    type="button"
                    className="btn btn--danger-outline btn--sm"
                    aria-label="删除物料"
                    onClick={() => removeMaterial(index)}
                  >
                    删
                  </button>
                )}
              </div>
              <div className="flex gap-sm mt-sm">
                <input
                  className="input flex-1"
                  placeholder="规格"
                  value={item.spec}
                  onChange={(e) => patchMaterial(index, "spec", e.target.value)}
                />
                <input
                  ref={(el) => {
                    quantityRefs.current[index] = el;
                  }}
                  className="input flex-1"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  placeholder="数量"
                  value={String(item.quantity)}
                  onChange={(e) =>
                    /* 任务v35.1：电缆行数量为主输入——同步布线距离并按总量重算；
                       其他增项行手填数量一概不动 */
                    isCableRow
                      ? handleCableDistanceChange(e.target.value)
                      : patchMaterial(index, "quantity", e.target.value)
                  }
                />
                <input
                  className="input flex-1"
                  placeholder="单位"
                  value={item.unit}
                  onChange={(e) => patchMaterial(index, "unit", e.target.value)}
                />
                {/* 电缆行单价 input 保留可改（师傅临时改价） */}
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
            );
          })}
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
                /* 任务v36：追加后 next tick 自动聚焦新追加行的数量 input */
                const newIndex = materials.length;
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
                setTimeout(() => focusQuantity(newIndex), 0);
              }}
            >
              <option value="">从零跑模板选择添加…</option>
              {/* 任务v35.1：选择列表显示短名（选中追加行内仍存全称，话术/单据照旧） */}
              {leapmotorTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {addonShortNameOf(t)} ¥{t.price}/{t.unit}
                </option>
              ))}
            </select>
          )}
          <select
            className="input"
            value={addonPick}
            aria-label="选择增项加入清单"
            onChange={(e) => addAddon(e.target.value)}
          >
            <option value="">＋ 选择增项（按常用排序）…</option>
            {/* 任务v35.1：选择列表显示短名（历史使用频次段已删，usageCount 排序逻辑不动） */}
            {addonOptions.map((option) => (
              <option key={option.name} value={option.name}>
                {addonShortNameOf(option)} ¥{option.salePrice}/{option.unit}
              </option>
            ))}
          </select>
          {/* 任务v33 零跑增项区底合计（仅零跑单渲染）。任务v35.1：线缆行按
              cableChargeAmount=(总量−套包)×单价 计，他行 qty×price（addonTotalWithCable） */}
          {leapmotorActive && (
            <div className="text-sm text-secondary">
              增项合计 ¥{addonTotalWithCable(materials, resolvePackageMeters())}
            </div>
          )}
          {/* 任务v36：固定辅材入口（漏保规格/漏保单价/PVC米数录入子窗口，
              保存持久化到 order.fixedAux，供完工快照算成本取值） */}
          <button
            type="button"
            className="btn btn--outline btn--sm"
            onClick={() => setFixedAuxOpen(true)}
          >
            固定辅材
          </button>
        </div>
      </FormField>

      <FormField label="勘测备注">
        <textarea
          className="textarea"
          value={note}
          placeholder="走线路径、施工难点、物业要求等"
          onChange={(e) => setNote(e.target.value)}
        />
      </FormField>
    </Modal>

    {/* 勘测完成话术：复制后继续提交；onClose 仅关话术层，保留勘测表单 */}
    <ScriptDialog
      open={scriptOpen}
      order={order}
      scene="surveyComplete"
      extras={{
        materialsText,
        totalCostText: "以实际为准",
        installerName: surveyor.trim(),
        cableDistance: Number(cableDistance),
        surveyDate,
        surveyNote: note.trim(),
        powerSource: powerSource.trim(),
        installType: installType.trim(),
        meterStatus,
        needPlanDoc,
        surveyResult: surveyResult.trim(),
        propertyAllow,
        materials: scriptMaterials,
      }}
      onClose={() => setScriptOpen(false)}
      onConfirm={handleConfirmSubmit}
    />

    {/* 任务v36：固定辅材子窗口（内部已做规格/价格联动与默认值；
        保存→updateOrder 持久化 order.fixedAux + toast） */}
    <FixedMaterialsDialog
      open={fixedAuxOpen}
      order={order}
      brandName={brandName}
      cableMeters={Number(cableDistance) || 0}
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
