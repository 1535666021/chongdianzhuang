/* ============================================================
 * 材料库页（任务D + 任务I）：材料条目 + 安装模板 + 材料领用登记
 * 数据：读写全部走 storage（loadMaterialsLib / saveMaterialsLib /
 *      loadMaterialTemplates / saveMaterialTemplates /
 *      loadMaterialUsage / saveMaterialUsage），
 *      品牌维度查询走 lib/materials（唯一数据层）
 * 结构：品牌筛选 chips → 领用登记（录入 + 按月分组台账）→
 *      材料列表（编辑/删除）→ 新增材料 → 安装模板区
 * 红线：领用记录仅作台账，不参与任何利润/对账/材料成本计算，
 *      与 inventory 逻辑完全无关
 * ============================================================ */

import { useEffect, useMemo, useState } from "react";
import type {
  MaterialItemLib,
  MaterialTemplate,
  MaterialUsageRecord,
} from "@/types";
import { useApp } from "@/context/AppContext";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { FilterChips } from "@/components/common/FilterChips";
import { FormField } from "@/components/common/FormField";
import { Icon } from "@/components/common/Icon";
import { Modal } from "@/components/common/Modal";
import {
  loadMaterialsLib,
  saveMaterialsLib,
  loadMaterialTemplates,
  saveMaterialTemplates,
  loadMaterialUsage,
  saveMaterialUsage,
} from "@/lib/storage";
import { GENERIC_MATERIAL_BRAND, getMaterialsByBrand } from "@/lib/materials";
import { mergeBrands } from "@/lib/brandMaterials";
import { formatMoney, generateId, todayStr } from "@/lib/utils";

/* ------------------------------------------------------------
 * 表单内部状态（数值先以字符串录入，保存时转 number）
 * ------------------------------------------------------------ */
interface MaterialFormState {
  brand: string;
  name: string;
  unit: string;
  salePrice: string;
  costPrice: string;
  hasFreeQuota: boolean;
  freeQuota: string;
}

interface MaterialFormErrors {
  name?: string;
  salePrice?: string;
  costPrice?: string;
  freeQuota?: string;
}

const EMPTY_MATERIAL_FORM: MaterialFormState = {
  brand: GENERIC_MATERIAL_BRAND,
  name: "",
  unit: "个",
  salePrice: "",
  costPrice: "",
  hasFreeQuota: false,
  freeQuota: "",
};

interface TemplateFormState {
  brand: string;
  name: string;
  /** items 的逗号分隔文本（编辑时回填 items.join(",")） */
  itemsText: string;
}

interface TemplateFormErrors {
  name?: string;
  itemsText?: string;
}

const EMPTY_TEMPLATE_FORM: TemplateFormState = {
  brand: GENERIC_MATERIAL_BRAND,
  name: "",
  itemsText: "",
};

/* ---------------- 领用登记（任务I） ---------------- */

/** 领用录入表单：选材料后自动带出 name/unit/costPrice，成本价可手改 */
interface UsageFormState {
  /** 选中的材料库条目 id，空串 = 未选择 */
  materialId: string;
  costPrice: string;
  quantity: string;
  date: string;
}

interface UsageFormErrors {
  materialId?: string;
  costPrice?: string;
  quantity?: string;
  date?: string;
}

const EMPTY_USAGE_FORM: UsageFormState = {
  materialId: "",
  costPrice: "",
  quantity: "",
  date: "",
};

/** 领用编辑弹窗表单（名称/单位也可直接改，仅改台账记录本身） */
interface UsageEditFormState {
  date: string;
  name: string;
  unit: string;
  costPrice: string;
  quantity: string;
}

interface UsageEditFormErrors {
  date?: string;
  name?: string;
  costPrice?: string;
  quantity?: string;
}

/** 金额保留两位小数 */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 校验 YYYY-MM-DD 日期串 */
function isValidDateStr(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00`);
  return !Number.isNaN(d.getTime());
}

export function MaterialsPage() {
  const { customBrands, showToast } = useApp();

  const [materials, setMaterials] = useState<MaterialItemLib[]>([]);
  const [templates, setTemplates] = useState<MaterialTemplate[]>([]);
  const [usageRecords, setUsageRecords] = useState<MaterialUsageRecord[]>([]);
  const [brandFilter, setBrandFilter] = useState("");

  /* 材料弹窗：editingMaterial=null 表示新增 */
  const [materialModalOpen, setMaterialModalOpen] = useState(false);
  const [editingMaterial, setEditingMaterial] =
    useState<MaterialItemLib | null>(null);
  const [materialForm, setMaterialForm] = useState<MaterialFormState>(
    EMPTY_MATERIAL_FORM,
  );
  const [materialErrors, setMaterialErrors] = useState<MaterialFormErrors>({});
  const [deleteMaterialTarget, setDeleteMaterialTarget] =
    useState<MaterialItemLib | null>(null);

  /* 模板弹窗：editingTemplate=null 表示新增 */
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] =
    useState<MaterialTemplate | null>(null);
  const [templateForm, setTemplateForm] = useState<TemplateFormState>(
    EMPTY_TEMPLATE_FORM,
  );
  const [templateErrors, setTemplateErrors] = useState<TemplateFormErrors>({});
  const [deleteTemplateTarget, setDeleteTemplateTarget] =
    useState<MaterialTemplate | null>(null);

  /* 领用登记：录入表单 + 编辑弹窗 + 删除确认 */
  const [usageForm, setUsageForm] = useState<UsageFormState>(() => ({
    ...EMPTY_USAGE_FORM,
    date: todayStr(),
  }));
  const [usageErrors, setUsageErrors] = useState<UsageFormErrors>({});
  const [editingUsage, setEditingUsage] = useState<MaterialUsageRecord | null>(
    null,
  );
  const [usageEditForm, setUsageEditForm] = useState<UsageEditFormState>({
    date: "",
    name: "",
    unit: "",
    costPrice: "",
    quantity: "",
  });
  const [usageEditErrors, setUsageEditErrors] = useState<UsageEditFormErrors>(
    {},
  );
  const [deleteUsageTarget, setDeleteUsageTarget] =
    useState<MaterialUsageRecord | null>(null);

  /* 首次加载：从 storage 读材料库、模板库与领用台账 */
  useEffect(() => {
    setMaterials(loadMaterialsLib());
    setTemplates(loadMaterialTemplates());
    setUsageRecords(loadMaterialUsage());
  }, []);

  /* 品牌下拉选项：内置 + 自定义（材料/模板按品牌名存储） */
  const brandChoices = useMemo(() => mergeBrands(customBrands), [customBrands]);

  /* 顶部筛选 chips：品牌名来自材料数据 brand 字段去重 */
  const filterOptions = useMemo(() => {
    const names = [
      ...new Set(materials.map((m) => m.brand.trim()).filter(Boolean)),
    ];
    return names.map((n) => ({ value: n, label: n }));
  }, [materials]);

  /* 筛选后的材料：选中品牌 = 品牌专属 + 通用 */
  const filteredMaterials = useMemo(
    () => (brandFilter ? getMaterialsByBrand(brandFilter, materials) : materials),
    [materials, brandFilter],
  );

  /* 模板按品牌分组排序展示；品牌筛选生效时只显示该品牌（含通用模板） */
  const visibleTemplates = useMemo(() => {
    const sorted = [...templates].sort((a, b) =>
      a.brand === b.brand
        ? a.name.localeCompare(b.name, "zh-CN")
        : a.brand.localeCompare(b.brand, "zh-CN"),
    );
    if (!brandFilter) return sorted;
    return sorted.filter(
      (t) =>
        t.brand.trim() === brandFilter ||
        t.brand.trim() === GENERIC_MATERIAL_BRAND,
    );
  }, [templates, brandFilter]);

  /* ---------------- 领用登记（任务I，仅台账） ---------------- */

  /* 录入表单实时合计 = 成本价 × 数量（round2），非法输入按 0 显示 */
  const usagePreviewTotal = useMemo(() => {
    const costPrice = Number(usageForm.costPrice);
    const quantity = Number(usageForm.quantity);
    if (
      usageForm.costPrice.trim() === "" ||
      usageForm.quantity.trim() === "" ||
      Number.isNaN(costPrice) ||
      Number.isNaN(quantity) ||
      costPrice < 0 ||
      quantity <= 0
    )
      return 0;
    return round2(costPrice * quantity);
  }, [usageForm.costPrice, usageForm.quantity]);

  /* 台账按月（YYYY-MM）分组：月份倒序，组内保持存储顺序（新记录在前） */
  const usageGroups = useMemo(() => {
    const map = new Map<string, MaterialUsageRecord[]>();
    for (const r of usageRecords) {
      const key = r.date.slice(0, 7);
      const list = map.get(key);
      if (list) list.push(r);
      else map.set(key, [r]);
    }
    return [...map.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([month, records]) => ({
        month,
        records,
        monthTotal: round2(records.reduce((sum, r) => sum + r.total, 0)),
      }));
  }, [usageRecords]);

  /* 选中材料：自动带出成本价（允许随后手改） */
  const handleUsageMaterialChange = (materialId: string) => {
    const m = materials.find((item) => item.id === materialId);
    setUsageForm((prev) => ({
      ...prev,
      materialId,
      costPrice: m ? String(m.costPrice) : prev.costPrice,
    }));
    setUsageErrors((prev) => ({ ...prev, materialId: undefined }));
  };

  const patchUsageForm = <K extends keyof UsageFormState>(
    key: K,
    value: UsageFormState[K],
  ) => {
    setUsageForm((prev) => ({ ...prev, [key]: value }));
    setUsageErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const handleSubmitUsage = () => {
    const m = materials.find((item) => item.id === usageForm.materialId);
    const next: UsageFormErrors = {};
    if (!m) next.materialId = "请选择领用材料";
    const costPrice = Number(usageForm.costPrice);
    if (
      usageForm.costPrice.trim() === "" ||
      Number.isNaN(costPrice) ||
      costPrice < 0
    )
      next.costPrice = "请填写正确的成本价";
    const quantity = Number(usageForm.quantity);
    if (
      usageForm.quantity.trim() === "" ||
      Number.isNaN(quantity) ||
      quantity <= 0
    )
      next.quantity = "请填写正确的数量";
    if (!isValidDateStr(usageForm.date)) next.date = "请选择领用日期";
    setUsageErrors(next);
    if (Object.keys(next).length > 0 || !m) return;

    const record: MaterialUsageRecord = {
      id: generateId(),
      date: usageForm.date,
      name: m.name,
      unit: m.unit,
      costPrice,
      quantity,
      total: round2(costPrice * quantity),
    };
    /* 新记录 prepend，写回 storage */
    const nextRecords = [record, ...usageRecords];
    if (!saveMaterialUsage(nextRecords)) {
      showToast("保存失败，请重试");
      return;
    }
    setUsageRecords(nextRecords);
    setUsageForm({ ...EMPTY_USAGE_FORM, date: todayStr() });
    setUsageErrors({});
    showToast("领用已登记");
  };

  const openEditUsage = (r: MaterialUsageRecord) => {
    setEditingUsage(r);
    setUsageEditForm({
      date: r.date,
      name: r.name,
      unit: r.unit,
      costPrice: String(r.costPrice),
      quantity: String(r.quantity),
    });
    setUsageEditErrors({});
  };

  const patchUsageEditForm = <K extends keyof UsageEditFormState>(
    key: K,
    value: UsageEditFormState[K],
  ) => {
    setUsageEditForm((prev) => ({ ...prev, [key]: value }));
    setUsageEditErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const handleSaveUsageEdit = () => {
    if (!editingUsage) return;
    const next: UsageEditFormErrors = {};
    if (!isValidDateStr(usageEditForm.date)) next.date = "请选择领用日期";
    if (!usageEditForm.name.trim()) next.name = "请填写材料名称";
    const costPrice = Number(usageEditForm.costPrice);
    if (
      usageEditForm.costPrice.trim() === "" ||
      Number.isNaN(costPrice) ||
      costPrice < 0
    )
      next.costPrice = "请填写正确的成本价";
    const quantity = Number(usageEditForm.quantity);
    if (
      usageEditForm.quantity.trim() === "" ||
      Number.isNaN(quantity) ||
      quantity <= 0
    )
      next.quantity = "请填写正确的数量";
    setUsageEditErrors(next);
    if (Object.keys(next).length > 0) return;

    const payload: MaterialUsageRecord = {
      id: editingUsage.id,
      date: usageEditForm.date,
      name: usageEditForm.name.trim(),
      unit: usageEditForm.unit.trim() || "个",
      costPrice,
      quantity,
      total: round2(costPrice * quantity),
    };
    const nextRecords = usageRecords.map((r) =>
      r.id === payload.id ? payload : r,
    );
    if (!saveMaterialUsage(nextRecords)) {
      showToast("保存失败，请重试");
      return;
    }
    setUsageRecords(nextRecords);
    setEditingUsage(null);
    showToast("领用记录已更新");
  };

  const handleDeleteUsage = () => {
    if (!deleteUsageTarget) return;
    const nextRecords = usageRecords.filter(
      (r) => r.id !== deleteUsageTarget.id,
    );
    if (!saveMaterialUsage(nextRecords)) {
      showToast("删除失败，请重试");
      return;
    }
    setUsageRecords(nextRecords);
    setDeleteUsageTarget(null);
    showToast("领用记录已删除");
  };

  /* ---------------- 材料 CRUD ---------------- */

  const openAddMaterial = () => {
    setEditingMaterial(null);
    setMaterialForm({
      ...EMPTY_MATERIAL_FORM,
      brand: brandFilter || GENERIC_MATERIAL_BRAND,
    });
    setMaterialErrors({});
    setMaterialModalOpen(true);
  };

  const openEditMaterial = (m: MaterialItemLib) => {
    setEditingMaterial(m);
    setMaterialForm({
      brand: m.brand || GENERIC_MATERIAL_BRAND,
      name: m.name,
      unit: m.unit,
      salePrice: String(m.salePrice),
      costPrice: String(m.costPrice),
      hasFreeQuota: m.hasFreeQuota,
      freeQuota: m.hasFreeQuota ? String(m.freeQuota) : "",
    });
    setMaterialErrors({});
    setMaterialModalOpen(true);
  };

  const patchMaterialForm = <K extends keyof MaterialFormState>(
    key: K,
    value: MaterialFormState[K],
  ) => {
    setMaterialForm((prev) => ({ ...prev, [key]: value }));
    setMaterialErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const validateMaterial = (): boolean => {
    const next: MaterialFormErrors = {};
    if (!materialForm.name.trim()) next.name = "请填写材料名称";
    const salePrice = Number(materialForm.salePrice);
    if (
      materialForm.salePrice.trim() === "" ||
      Number.isNaN(salePrice) ||
      salePrice < 0
    )
      next.salePrice = "请填写正确的售价";
    const costPrice = Number(materialForm.costPrice);
    if (
      materialForm.costPrice.trim() === "" ||
      Number.isNaN(costPrice) ||
      costPrice < 0
    )
      next.costPrice = "请填写正确的成本价";
    if (materialForm.hasFreeQuota) {
      const freeQuota = Number(materialForm.freeQuota);
      if (
        materialForm.freeQuota.trim() === "" ||
        Number.isNaN(freeQuota) ||
        freeQuota < 0
      )
        next.freeQuota = "请填写正确的免费额度";
    }
    setMaterialErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSaveMaterial = () => {
    if (!validateMaterial()) return;
    const payload: MaterialItemLib = {
      id: editingMaterial?.id ?? generateId(),
      brand: materialForm.brand,
      name: materialForm.name.trim(),
      unit: materialForm.unit.trim() || "个",
      salePrice: Number(materialForm.salePrice),
      costPrice: Number(materialForm.costPrice),
      hasFreeQuota: materialForm.hasFreeQuota,
      freeQuota: materialForm.hasFreeQuota
        ? Number(materialForm.freeQuota)
        : 0,
    };
    const next = editingMaterial
      ? materials.map((m) => (m.id === payload.id ? payload : m))
      : [...materials, payload];
    if (!saveMaterialsLib(next)) {
      showToast("保存失败，请重试");
      return;
    }
    setMaterials(next);
    setMaterialModalOpen(false);
    showToast(editingMaterial ? "材料已更新" : "材料已新增");
  };

  const handleDeleteMaterial = () => {
    if (!deleteMaterialTarget) return;
    const next = materials.filter((m) => m.id !== deleteMaterialTarget.id);
    if (!saveMaterialsLib(next)) {
      showToast("删除失败，请重试");
      return;
    }
    setMaterials(next);
    setDeleteMaterialTarget(null);
    showToast("材料已删除");
  };

  /* ---------------- 模板 CRUD ---------------- */

  const openAddTemplate = () => {
    setEditingTemplate(null);
    setTemplateForm({
      ...EMPTY_TEMPLATE_FORM,
      brand: brandFilter || GENERIC_MATERIAL_BRAND,
    });
    setTemplateErrors({});
    setTemplateModalOpen(true);
  };

  const openEditTemplate = (t: MaterialTemplate) => {
    setEditingTemplate(t);
    setTemplateForm({
      brand: t.brand || GENERIC_MATERIAL_BRAND,
      name: t.name,
      itemsText: t.items.join(","),
    });
    setTemplateErrors({});
    setTemplateModalOpen(true);
  };

  const handleSaveTemplate = () => {
    const nextErrors: TemplateFormErrors = {};
    const name = templateForm.name.trim();
    if (!name) nextErrors.name = "请填写模板名称";
    /* 兼容中英文逗号与顿号分隔 */
    const items = templateForm.itemsText
      .split(/[,，、]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (items.length === 0)
      nextErrors.itemsText = "请填写包含材料（逗号分隔）";
    setTemplateErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const payload: MaterialTemplate = {
      id: editingTemplate?.id ?? generateId(),
      brand: templateForm.brand,
      name,
      items,
    };
    const next = editingTemplate
      ? templates.map((t) => (t.id === payload.id ? payload : t))
      : [...templates, payload];
    if (!saveMaterialTemplates(next)) {
      showToast("保存失败，请重试");
      return;
    }
    setTemplates(next);
    setTemplateModalOpen(false);
    showToast(editingTemplate ? "模板已更新" : "模板已新增");
  };

  const handleDeleteTemplate = () => {
    if (!deleteTemplateTarget) return;
    const next = templates.filter((t) => t.id !== deleteTemplateTarget.id);
    if (!saveMaterialTemplates(next)) {
      showToast("删除失败，请重试");
      return;
    }
    setTemplates(next);
    setDeleteTemplateTarget(null);
    showToast("模板已删除");
  };

  /* ---------------- 渲染 ---------------- */

  return (
    <div className="page">
      <div className="page-header">
        <span className="page-header__title">材料库</span>
        <div className="page-header__extra">
          <span className="text-sm text-secondary">
            共 {materials.length} 项
          </span>
        </div>
      </div>

      <div className="page-body">
        {/* 领用登记（任务I）：仅作台账，不参与利润/对账/成本计算 */}
        <div className="card">
          <div className="card__title">领用登记</div>
          <div className="flex-column gap-md">
            <FormField label="领用材料" required error={usageErrors.materialId}>
              <select
                className="select"
                value={usageForm.materialId}
                onChange={(e) => handleUsageMaterialChange(e.target.value)}
              >
                <option value="">请选择材料（来自材料库）</option>
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {`${m.name}（${m.brand || GENERIC_MATERIAL_BRAND} · ${formatMoney(m.costPrice)}/${m.unit}）`}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField
              label="成本价（元）"
              required
              error={usageErrors.costPrice}
            >
              <input
                className={
                  usageErrors.costPrice ? "input input--error" : "input"
                }
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={usageForm.costPrice}
                placeholder="选材料后自动带出，可修改"
                onChange={(e) => patchUsageForm("costPrice", e.target.value)}
              />
            </FormField>

            <FormField label="数量" required error={usageErrors.quantity}>
              <input
                className={
                  usageErrors.quantity ? "input input--error" : "input"
                }
                type="number"
                inputMode="decimal"
                min="0"
                step="1"
                value={usageForm.quantity}
                placeholder="如：2"
                onChange={(e) => patchUsageForm("quantity", e.target.value)}
              />
            </FormField>

            <FormField label="领用日期" required error={usageErrors.date}>
              <input
                className={usageErrors.date ? "input input--error" : "input"}
                type="date"
                value={usageForm.date}
                onChange={(e) => patchUsageForm("date", e.target.value)}
              />
            </FormField>

            <div className="text-sm text-secondary">
              合计金额：
              <span className="text-primary">
                {formatMoney(usagePreviewTotal)}
              </span>
            </div>

            <button
              type="button"
              className="btn btn--primary btn--block"
              onClick={handleSubmitUsage}
            >
              登记领用
            </button>
          </div>

          {/* 台账列表：按月分组，组头显示月份 + 月度合计 */}
          {usageRecords.length === 0 ? (
            <EmptyState
              icon={<Icon name="file-text" size={48} />}
              text="暂无领用记录"
            />
          ) : (
            usageGroups.map((g) => (
              <div key={g.month}>
                <div className="list-item">
                  <div className="list-item__main">
                    <div className="list-item__title">{g.month}</div>
                  </div>
                  <div className="list-item__extra">
                    <span className="text-sm text-secondary">
                      月合计 {formatMoney(g.monthTotal)}
                    </span>
                  </div>
                </div>
                {g.records.map((r) => (
                  <div key={r.id} className="list-item">
                    <div className="list-item__main">
                      <div className="list-item__title">{r.name}</div>
                      <div className="list-item__desc">
                        {`${r.date} · ${r.quantity}${r.unit} × ${formatMoney(r.costPrice)} = ${formatMoney(r.total)}`}
                      </div>
                    </div>
                    <div className="list-item__extra">
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => openEditUsage(r)}
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        className="btn btn--danger-outline btn--sm"
                        onClick={() => setDeleteUsageTarget(r)}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>

        {/* 品牌筛选（品牌来自材料数据去重） */}
        {filterOptions.length > 0 ? (
          <FilterChips
            options={filterOptions}
            value={brandFilter}
            onChange={(next) =>
              setBrandFilter(typeof next === "string" ? next : "")
            }
          />
        ) : null}

        {/* 材料列表 */}
        <div className="card">
          <div className="card__title">
            材料{brandFilter ? `（${brandFilter}）` : ""}
          </div>
          {filteredMaterials.length === 0 ? (
            <EmptyState
              icon={<Icon name="box" size={48} />}
              text={
                brandFilter
                  ? "该品牌暂无材料，可点击下方按钮新增"
                  : "暂无材料，点击下方按钮新增"
              }
            />
          ) : (
            filteredMaterials.map((m) => (
              <div key={m.id} className="list-item">
                <div className="list-item__main">
                  <div className="list-item__title">{m.name}</div>
                  <div className="list-item__desc">
                    {`${m.brand || GENERIC_MATERIAL_BRAND} · 单位 ${m.unit} · 售价 ${formatMoney(m.salePrice)} · 成本 ${formatMoney(m.costPrice)}`}
                    {m.hasFreeQuota
                      ? ` · 免费额度 ${m.freeQuota}${m.unit}`
                      : ""}
                  </div>
                </div>
                <div className="list-item__extra">
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => openEditMaterial(m)}
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    className="btn btn--danger-outline btn--sm"
                    onClick={() => setDeleteMaterialTarget(m)}
                  >
                    删除
                  </button>
                </div>
              </div>
            ))
          )}
          <button
            type="button"
            className="btn btn--primary btn--block mt-md"
            onClick={openAddMaterial}
          >
            ＋ 新增材料
          </button>
        </div>

        {/* 安装模板（按品牌列出） */}
        <div className="card">
          <div className="card__title">安装模板</div>
          {visibleTemplates.length === 0 ? (
            <EmptyState
              icon={<Icon name="tool" size={48} />}
              text="暂无安装模板，可新增一套常用材料组合"
            />
          ) : (
            visibleTemplates.map((t) => (
              <div key={t.id} className="list-item">
                <div className="list-item__main">
                  <div className="list-item__title">{t.name}</div>
                  <div className="list-item__desc">
                    {`${t.brand || GENERIC_MATERIAL_BRAND} · ${t.items.join("、")}`}
                  </div>
                </div>
                <div className="list-item__extra">
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => openEditTemplate(t)}
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    className="btn btn--danger-outline btn--sm"
                    onClick={() => setDeleteTemplateTarget(t)}
                  >
                    删除
                  </button>
                </div>
              </div>
            ))
          )}
          <button
            type="button"
            className="btn btn--secondary btn--block mt-md"
            onClick={openAddTemplate}
          >
            ＋ 新增模板
          </button>
        </div>
      </div>

      {/* 材料 新增/编辑 弹窗 */}
      <Modal
        open={materialModalOpen}
        title={editingMaterial ? "编辑材料" : "新增材料"}
        onClose={() => setMaterialModalOpen(false)}
        footer={
          <>
            <button
              type="button"
              className="btn btn--outline"
              onClick={() => setMaterialModalOpen(false)}
            >
              取消
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={handleSaveMaterial}
            >
              保存
            </button>
          </>
        }
      >
        <div className="flex-column gap-md">
          <FormField label="适用品牌" required>
            <select
              className="select"
              value={materialForm.brand}
              onChange={(e) => patchMaterialForm("brand", e.target.value)}
            >
              <option value={GENERIC_MATERIAL_BRAND}>
                通用（所有品牌可见）
              </option>
              {brandChoices.map((b) => (
                <option key={b.id} value={b.name}>
                  {b.name}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="材料名称" required error={materialErrors.name}>
            <input
              className={
                materialErrors.name ? "input input--error" : "input"
              }
              value={materialForm.name}
              placeholder="如：电缆 / 漏电保护开关"
              onChange={(e) => patchMaterialForm("name", e.target.value)}
            />
          </FormField>

          <FormField label="单位" required>
            <input
              className="input"
              value={materialForm.unit}
              placeholder="如：米 / 个 / 套"
              onChange={(e) => patchMaterialForm("unit", e.target.value)}
            />
          </FormField>

          <FormField label="售价（元）" required error={materialErrors.salePrice}>
            <input
              className={
                materialErrors.salePrice ? "input input--error" : "input"
              }
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={materialForm.salePrice}
              placeholder="客户结算单价"
              onChange={(e) => patchMaterialForm("salePrice", e.target.value)}
            />
          </FormField>

          <FormField label="成本价（元）" required error={materialErrors.costPrice}>
            <input
              className={
                materialErrors.costPrice ? "input input--error" : "input"
              }
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={materialForm.costPrice}
              placeholder="内部成本单价"
              onChange={(e) => patchMaterialForm("costPrice", e.target.value)}
            />
          </FormField>

          <FormField label="免费额度">
            <select
              className="select"
              value={materialForm.hasFreeQuota ? "1" : "0"}
              onChange={(e) =>
                patchMaterialForm("hasFreeQuota", e.target.value === "1")
              }
            >
              <option value="0">无免费额度</option>
              <option value="1">有免费额度（套包内）</option>
            </select>
          </FormField>

          {materialForm.hasFreeQuota ? (
            <FormField
              label={`免费额度（${materialForm.unit || "单位"}）`}
              required
              error={materialErrors.freeQuota}
            >
              <input
                className={
                  materialErrors.freeQuota ? "input input--error" : "input"
                }
                type="number"
                inputMode="decimal"
                min="0"
                step="1"
                value={materialForm.freeQuota}
                placeholder="如：30（30 米内免费）"
                onChange={(e) =>
                  patchMaterialForm("freeQuota", e.target.value)
                }
              />
            </FormField>
          ) : null}
        </div>
      </Modal>

      {/* 模板 新增/编辑 弹窗（items 用逗号分隔文本编辑） */}
      <Modal
        open={templateModalOpen}
        title={editingTemplate ? "编辑模板" : "新增模板"}
        onClose={() => setTemplateModalOpen(false)}
        footer={
          <>
            <button
              type="button"
              className="btn btn--outline"
              onClick={() => setTemplateModalOpen(false)}
            >
              取消
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={handleSaveTemplate}
            >
              保存
            </button>
          </>
        }
      >
        <div className="flex-column gap-md">
          <FormField label="适用品牌" required>
            <select
              className="select"
              value={templateForm.brand}
              onChange={(e) =>
                setTemplateForm((prev) => ({ ...prev, brand: e.target.value }))
              }
            >
              <option value={GENERIC_MATERIAL_BRAND}>
                通用（所有品牌可用）
              </option>
              {brandChoices.map((b) => (
                <option key={b.id} value={b.name}>
                  {b.name}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="模板名称" required error={templateErrors.name}>
            <input
              className={
                templateErrors.name ? "input input--error" : "input"
              }
              value={templateForm.name}
              placeholder="如：30米套包标准配置"
              onChange={(e) =>
                setTemplateForm((prev) => ({ ...prev, name: e.target.value }))
              }
            />
          </FormField>

          <FormField
            label="包含材料（逗号分隔）"
            required
            error={templateErrors.itemsText}
          >
            <textarea
              className={
                templateErrors.itemsText ? "textarea textarea--error" : "textarea"
              }
              value={templateForm.itemsText}
              placeholder="如：电缆,漏电保护开关,PVC线管"
              onChange={(e) =>
                setTemplateForm((prev) => ({
                  ...prev,
                  itemsText: e.target.value,
                }))
              }
            />
          </FormField>
        </div>
      </Modal>

      {/* 领用记录 编辑弹窗 */}
      <Modal
        open={editingUsage !== null}
        title="编辑领用记录"
        onClose={() => setEditingUsage(null)}
        footer={
          <>
            <button
              type="button"
              className="btn btn--outline"
              onClick={() => setEditingUsage(null)}
            >
              取消
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={handleSaveUsageEdit}
            >
              保存
            </button>
          </>
        }
      >
        <div className="flex-column gap-md">
          <FormField label="领用日期" required error={usageEditErrors.date}>
            <input
              className={usageEditErrors.date ? "input input--error" : "input"}
              type="date"
              value={usageEditForm.date}
              onChange={(e) => patchUsageEditForm("date", e.target.value)}
            />
          </FormField>

          <FormField label="材料名称" required error={usageEditErrors.name}>
            <input
              className={usageEditErrors.name ? "input input--error" : "input"}
              value={usageEditForm.name}
              placeholder="如：电缆"
              onChange={(e) => patchUsageEditForm("name", e.target.value)}
            />
          </FormField>

          <FormField label="单位" required>
            <input
              className="input"
              value={usageEditForm.unit}
              placeholder="如：米 / 个 / 套"
              onChange={(e) => patchUsageEditForm("unit", e.target.value)}
            />
          </FormField>

          <FormField
            label="成本价（元）"
            required
            error={usageEditErrors.costPrice}
          >
            <input
              className={
                usageEditErrors.costPrice ? "input input--error" : "input"
              }
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={usageEditForm.costPrice}
              placeholder="内部成本单价"
              onChange={(e) =>
                patchUsageEditForm("costPrice", e.target.value)
              }
            />
          </FormField>

          <FormField label="数量" required error={usageEditErrors.quantity}>
            <input
              className={
                usageEditErrors.quantity ? "input input--error" : "input"
              }
              type="number"
              inputMode="decimal"
              min="0"
              step="1"
              value={usageEditForm.quantity}
              placeholder="如：2"
              onChange={(e) =>
                patchUsageEditForm("quantity", e.target.value)
              }
            />
          </FormField>
        </div>
      </Modal>

      {/* 删除确认 */}
      <ConfirmDialog
        open={deleteMaterialTarget !== null}
        title="删除材料"
        content={`确定删除材料「${deleteMaterialTarget?.name ?? ""}」吗？删除后不可恢复。`}
        danger
        onConfirm={handleDeleteMaterial}
        onCancel={() => setDeleteMaterialTarget(null)}
      />
      <ConfirmDialog
        open={deleteTemplateTarget !== null}
        title="删除模板"
        content={`确定删除模板「${deleteTemplateTarget?.name ?? ""}」吗？删除后不可恢复。`}
        danger
        onConfirm={handleDeleteTemplate}
        onCancel={() => setDeleteTemplateTarget(null)}
      />
      <ConfirmDialog
        open={deleteUsageTarget !== null}
        title="删除领用记录"
        content={`确定删除领用记录「${deleteUsageTarget?.name ?? ""}」（${deleteUsageTarget?.date ?? ""}）吗？删除后不可恢复。`}
        danger
        onConfirm={handleDeleteUsage}
        onCancel={() => setDeleteUsageTarget(null)}
      />
    </div>
  );
}
