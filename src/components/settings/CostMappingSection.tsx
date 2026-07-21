/* ============================================================
 * 设置区块 · 成本映射（挂载由 SettingsPage「成本映射」二级页完成）
 * 职责：增项名 → 成本名 + 成本单价 映射的行编辑 / 删除 / 新增
 * 输入即存：去掉「保存映射」按钮，编辑/新增/删除后防抖（500ms）自动保存
 *      + toast「已保存」；落库逻辑不变——逐行校验后整体写回
 * 规范：所有读写走 storage 封装，本组件不碰 localStorage
 * ============================================================ */

import { useState } from "react";
import type { CostMapping } from "@/types";
import { useApp } from "@/context/AppContext";
import { loadCostMappings, saveCostMappings } from "@/lib/storage";
import { useDebouncedCallback } from "@/components/settings/useDebouncedCallback";

/* ------------------------------------------------------------
 * 草稿模型与加载工具（unitPrice 字符串态，保存时才转数字）
 * ------------------------------------------------------------ */

/** 成本映射草稿（unitPrice 字符串态） */
interface CostMappingDraft {
  addonName: string;
  costName: string;
  unitPrice: string;
}

const EMPTY_COST_MAPPING_DRAFT: CostMappingDraft = {
  addonName: "",
  costName: "",
  unitPrice: "",
};

function readCostMappingDrafts(): CostMappingDraft[] {
  return loadCostMappings().map((m) => ({
    addonName: m.addonName,
    costName: m.costName,
    unitPrice: String(m.unitPrice),
  }));
}

/** 解析非负数字草稿；空串/非法数字返回 null */
function parseNonNegative(value: string): number | null {
  const num = Number(value);
  return value.trim() !== "" && Number.isFinite(num) && num >= 0 ? num : null;
}

export function CostMappingSection() {
  const { showToast } = useApp();

  /* 成本映射草稿：进入二级页（组件挂载）时从 storage 加载 */
  const [costRows, setCostRows] = useState<CostMappingDraft[]>(
    readCostMappingDrafts,
  );
  const [newCostRow, setNewCostRow] = useState<CostMappingDraft>(
    EMPTY_COST_MAPPING_DRAFT,
  );

  /* ---- 输入即存：防抖 500ms 自动保存（原「保存映射」统一校验+整体写回
   *      逻辑不变；任一行非法则整批不落库并提示，与原保存行为一致） ---- */
  const persist = useDebouncedCallback(() => {
    const mappings: CostMapping[] = [];
    for (const row of costRows) {
      const addonName = row.addonName.trim();
      const costName = row.costName.trim();
      const unitPrice = parseNonNegative(row.unitPrice);
      if (!addonName || !costName) {
        showToast("存在未填写完整的映射行，请补全或删除后再保存");
        return;
      }
      if (unitPrice === null) {
        showToast(`「${addonName}」的成本单价填写有误`);
        return;
      }
      mappings.push({ addonName, costName, unitPrice });
    }
    if (!saveCostMappings(mappings)) {
      showToast("保存失败，请重试");
      return;
    }
    showToast("已保存");
  });

  /* ---- 行编辑 / 删除 / 新增（改动后触发防抖自动保存） ---- */
  const handleCostRowChange = (
    index: number,
    patch: Partial<CostMappingDraft>,
  ) => {
    setCostRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
    persist();
  };

  const handleDeleteCostRow = (index: number) => {
    setCostRows((prev) => prev.filter((_, i) => i !== index));
    persist();
  };

  const handleAddCostRow = () => {
    const addonName = newCostRow.addonName.trim();
    const costName = newCostRow.costName.trim();
    const unitPrice = parseNonNegative(newCostRow.unitPrice);
    if (!addonName || !costName) {
      showToast("请填写增项名与成本名");
      return;
    }
    if (unitPrice === null) {
      showToast("成本单价请填写不小于 0 的数字");
      return;
    }
    setCostRows((prev) => [
      ...prev,
      { addonName, costName, unitPrice: String(unitPrice) },
    ]);
    setNewCostRow(EMPTY_COST_MAPPING_DRAFT);
    persist();
  };

  return (
    <div className="card">
      <div className="card__title">成本映射</div>
      <div className="flex-column gap-md">
        {costRows.map((row, index) => (
          <div key={index} className="cost-map-row">
            <div className="cost-map-row__main">
              <input
                className="input"
                value={row.addonName}
                placeholder="增项名（如 超出米数）"
                onChange={(e) =>
                  handleCostRowChange(index, { addonName: e.target.value })
                }
              />
              <button
                type="button"
                className="btn btn--danger-outline btn--sm"
                onClick={() => handleDeleteCostRow(index)}
              >
                删除
              </button>
            </div>
            <div className="cost-map-row__fields">
              <input
                className="input"
                value={row.costName}
                placeholder="成本名"
                onChange={(e) =>
                  handleCostRowChange(index, { costName: e.target.value })
                }
              />
              <input
                className="input"
                type="number"
                inputMode="decimal"
                min="0"
                value={row.unitPrice}
                placeholder="成本单价（元）"
                onChange={(e) =>
                  handleCostRowChange(index, { unitPrice: e.target.value })
                }
              />
            </div>
          </div>
        ))}
        {/* 新增映射行（加入列表后随防抖自动保存生效） */}
        <div className="cost-map-row cost-map-row--new">
          <div className="cost-map-row__main">
            <input
              className="input"
              value={newCostRow.addonName}
              placeholder="增项名"
              onChange={(e) =>
                setNewCostRow((prev) => ({
                  ...prev,
                  addonName: e.target.value,
                }))
              }
            />
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={handleAddCostRow}
            >
              添加
            </button>
          </div>
          <div className="cost-map-row__fields">
            <input
              className="input"
              value={newCostRow.costName}
              placeholder="成本名"
              onChange={(e) =>
                setNewCostRow((prev) => ({
                  ...prev,
                  costName: e.target.value,
                }))
              }
            />
            <input
              className="input"
              type="number"
              inputMode="decimal"
              min="0"
              value={newCostRow.unitPrice}
              placeholder="成本单价（元）"
              onChange={(e) =>
                setNewCostRow((prev) => ({
                  ...prev,
                  unitPrice: e.target.value,
                }))
              }
            />
          </div>
        </div>
      </div>
      <p className="text-sm text-tertiary mt-sm">
        增项名对应内部核算的成本名与成本单价，编辑后自动保存生效。
      </p>
    </div>
  );
}
