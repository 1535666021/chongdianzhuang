/* ============================================================
 * 设置区块 · 自定义品牌（挂载由 SettingsPage「自定义品牌」二级页完成）
 * 功能：新增自定义品牌（名称必填 + 默认功率 > 0），字段与校验不变
 * ============================================================ */

import { useState } from "react";
import { FormField } from "@/components/common/FormField";
import { useApp } from "@/context/AppContext";
import { generateId } from "@/lib/utils";

export function BrandSection() {
  const { addCustomBrand, showToast } = useApp();
  const [brandName, setBrandName] = useState("");
  const [brandPower, setBrandPower] = useState("7");

  /* ---- 新增自定义品牌（校验与原逻辑一致） ---- */
  const handleAddBrand = () => {
    const name = brandName.trim();
    const power = Number(brandPower);
    if (!name) {
      showToast("请填写品牌名称");
      return;
    }
    if (!Number.isFinite(power) || power <= 0) {
      showToast("请填写正确的默认功率");
      return;
    }
    addCustomBrand({ id: generateId(), name, defaultPowerKw: power });
    setBrandName("");
    setBrandPower("7");
    showToast(`品牌「${name}」已添加`);
  };

  return (
    <div className="card">
      <div className="card__title">自定义品牌</div>
      <div className="flex-column gap-md">
        <FormField label="品牌名称">
          <input
            className="input"
            value={brandName}
            placeholder="如：蔚来"
            onChange={(e) => setBrandName(e.target.value)}
          />
        </FormField>
        <FormField label="默认功率（kW）">
          <input
            className="input"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.1"
            value={brandPower}
            onChange={(e) => setBrandPower(e.target.value)}
          />
        </FormField>
        {/* 本组唯一主操作：添加品牌 */}
        <button
          type="button"
          className="btn btn--primary btn--block"
          onClick={handleAddBrand}
        >
          添加品牌
        </button>
      </div>
    </div>
  );
}
