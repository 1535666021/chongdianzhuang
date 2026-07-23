/* ============================================================
 * 成本绑定字段（P12-fix3 · 统一模块）
 * 功能：四个固定材料（电缆/PVC管/漏保/漏保盒）的统一绑定组件
 * 逻辑：显示"已绑定/未绑定" → 点击弹出 CostSheetPicker → 选中后
 *       写全局配置 + 回调通知父组件 + toast"已改成本价"
 * ============================================================ */

import { useState, useMemo } from "react";
import { CostSheetPicker } from "./CostSheetPicker";
import {
  getGlobalBinding,
  setGlobalBinding,
  costSheetItemToBinding,
} from "@/lib/globalMaterialConfig";
import type { CostSheetItem } from "@/types";
import { formatMoney } from "@/lib/utils";

export type BindableMaterial = "电缆" | "PVC管" | "漏保" | "漏保盒";

interface CostBindFieldProps {
  /** 材料名称 */
  materialName: BindableMaterial;
  /** 订单自己的绑定值（优先显示） */
  orderValue?: number | null;
  /** 数量/米数（用于显示总价） */
  quantity?: number;
  /** 绑定成功后回调（price, name） */
  onBind?: (price: number, name: string) => void;
  /** toast 函数 */
  showToast: (msg: string) => void;
  /** 额外样式类 */
  className?: string;
}

export function CostBindField({
  materialName,
  orderValue,
  quantity,
  onBind,
  showToast,
  className = "",
}: CostBindFieldProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

  const globalBinding = useMemo(
    () => getGlobalBinding(materialName),
    [materialName, pickerOpen]
  );

  const isBound = orderValue != null || globalBinding != null;
  const displayPrice = orderValue ?? globalBinding?.costPrice ?? null;
  const totalPrice = quantity != null && displayPrice != null
    ? Math.round(quantity * displayPrice * 100) / 100
    : null;

  const handleSelect = (item: CostSheetItem) => {
    const binding = costSheetItemToBinding(item);
    setGlobalBinding(materialName, binding);
    if (onBind) {
      onBind(binding.costPrice, binding.name);
    }
    showToast("已改成本价");
    setPickerOpen(false);
  };

  const handleClick = () => {
    setPickerOpen(true);
  };

  return (
    <>
      {isBound ? (
        <span
          className={`text-success cursor-pointer ${className}`}
          style={{ textDecoration: "underline" }}
          onClick={handleClick}
        >
          {displayPrice != null ? formatMoney(displayPrice) : "已绑定"}
          {totalPrice != null && (
            <span className="text-muted" style={{ marginLeft: 4, textDecoration: "none" }}>
              (×{quantity}={formatMoney(totalPrice)})
            </span>
          )}
        </span>
      ) : (
        <span
          className={`text-danger cursor-pointer ${className}`}
          onClick={handleClick}
        >
          未绑定
        </span>
      )}
      {pickerOpen && (
        <CostSheetPicker
          materialName={materialName}
          onSelect={handleSelect}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </>
  );
}
