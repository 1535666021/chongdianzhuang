/* ============================================================
 * 全局材料绑定配置（P12-fix3）
 * 功能：四个固定材料（电缆/PVC管/漏保/漏保盒）的全局绑定数据
 * 存储位置：localStorage 全局键 globalMaterialConfig
 * 特性：不区分品牌/平台，所有订单共享默认绑定
 * 历史订单：已完工订单不受影响；未完工订单打开弹窗时自动带出
 * ============================================================ */

import type { CostSheetItem } from "@/types";

const STORAGE_KEY = "globalMaterialConfig";

export interface MaterialBinding {
  id: string;
  name: string;
  costPrice: number;
  unit: string;
}

export interface GlobalMaterialConfig {
  cable?: MaterialBinding;
  pvc?: MaterialBinding;
  breaker?: MaterialBinding;
  leakBox?: MaterialBinding;
}

/** 加载全局材料绑定配置 */
export function loadGlobalMaterialConfig(): GlobalMaterialConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as GlobalMaterialConfig;
    }
  } catch {
    // ignore parse error
  }
  return {};
}

/** 保存全局材料绑定配置 */
export function saveGlobalMaterialConfig(config: GlobalMaterialConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

/** 获取指定材料的全局绑定 */
export function getGlobalBinding(
  materialName: string
): MaterialBinding | undefined {
  const config = loadGlobalMaterialConfig();
  const key =
    materialName === "电缆"
      ? "cable"
      : materialName === "PVC管"
      ? "pvc"
      : materialName === "漏保"
      ? "breaker"
      : "leakBox";
  return config[key];
}

/** 设置指定材料的全局绑定 */
export function setGlobalBinding(
  materialName: string,
  binding: MaterialBinding | undefined
): void {
  const config = loadGlobalMaterialConfig();
  const key =
    materialName === "电缆"
      ? "cable"
      : materialName === "PVC管"
      ? "pvc"
      : materialName === "漏保"
      ? "breaker"
      : "leakBox";
  if (binding) {
    config[key] = binding;
  } else {
    delete config[key];
  }
  saveGlobalMaterialConfig(config);
}

/** 将 CostSheetItem 转为 MaterialBinding */
export function costSheetItemToBinding(item: CostSheetItem): MaterialBinding {
  return {
    id: item.id,
    name: item.name,
    costPrice: item.costPrice,
    unit: item.unit || "米",
  };
}
