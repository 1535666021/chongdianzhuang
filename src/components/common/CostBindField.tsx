/* ============================================================
 * 成本绑定字段（v36.2-P12 可复用模块）
 * 功能：价格输入框 + 绑定材料名称显示框 + 绑定按钮
 * 点击绑定 → 弹出成本表选择器 → 选中后价格与名称同步回填
 * 规范：纯渲染组件，业务逻辑（成本表查询/弹窗）由父组件传入
 * ============================================================ */

import { useState } from "react";
import { CostSheetPicker } from "@/components/CostSheetPicker";
import type { CostSheetItem } from "@/types";

export interface CostBindFieldProps {
  /** 字段标签（如"漏保单价"） */
  label: string;
  /** 价格输入值 */
  price: string;
  /** 价格占位提示 */
  pricePlaceholder?: string;
  /** 绑定的成本表材料名称 */
  boundName: string;
  /** 名称占位提示 */
  boundNamePlaceholder?: string;
  /** 是否已绑定（控制状态文字颜色） */
  isBound: boolean;
  /** 价格变化回调 */
  onPriceChange: (val: string) => void;
  /** 绑定名称变化回调（通常由绑定操作自动设置） */
  onBoundNameChange: (val: string) => void;
  /** 绑定成功回调（item=选中的成本表条目） */
  onBind: (item: CostSheetItem) => void;
  /** 成本表搜索用的纯净材料名（缺省回退到 label） */
  pickerName?: string;
  /** 弹窗 zIndex（默认不覆盖） */
  zIndex?: number;
}

export function CostBindField({
  label,
  price,
  pricePlaceholder = "未匹配",
  boundName,
  boundNamePlaceholder = "未绑定",
  isBound,
  onPriceChange,
  onBoundNameChange,
  onBind,
  pickerName,
  zIndex,
}: CostBindFieldProps) {
  const [showPicker, setShowPicker] = useState(false);

  const handleSelect = (item: CostSheetItem) => {
    onPriceChange(String(item.costPrice));
    onBoundNameChange(item.name);
    onBind(item);
    setShowPicker(false);
  };

  return (
    <div className="form-field">
      <label className="form-field__label">{label}</label>
      <div className="flex gap-sm">
        <input
          className="input flex-1"
          type="number"
          inputMode="decimal"
          step="0.01"
          placeholder={pricePlaceholder}
          value={price}
          onChange={(e) => onPriceChange(e.target.value)}
        />
        <input
          className="input flex-1"
          placeholder={boundNamePlaceholder}
          value={boundName}
          readOnly
          onChange={() => {}}
        />
        <button
          type="button"
          className="btn btn--primary btn--sm"
          style={{ whiteSpace: "nowrap" }}
          onClick={() => setShowPicker(true)}
        >
          绑定
        </button>
      </div>
      {isBound ? (
        <span className="text-success text-sm">已绑定</span>
      ) : (
        <span className="text-danger text-sm">未绑定</span>
      )}

      {showPicker && (
        <CostSheetPicker
          materialName={boundName || pickerName || label}
          onSelect={handleSelect}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}