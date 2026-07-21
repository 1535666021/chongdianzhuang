/* ============================================================
 * 增项下拉选项（任务R 共享模块，1号定稿冻结）
 * 职责：勘测/完工两表单的"增项录入"下拉共用同一份逻辑——
 *      该品牌增项清单（材料库按品牌过滤）× 历史使用频率降序
 * 红线：禁止在任何组件里复制本逻辑；调整只能改本文件
 * ============================================================ */

import type { MaterialItemLib, Order } from "@/types";
import { getMaterialsByBrand } from "@/lib/materials";
import { loadMaterialsLib } from "@/lib/storage";

/** 增项下拉选项条目 */
export interface AddonOption {
  /** 增项名（材料库名称） */
  name: string;
  /** 单位（如 米/个/套） */
  unit: string;
  /** 默认金额（材料库销售单价，选中后表单内可改） */
  salePrice: number;
  /** 历史使用次数（全部订单勘测+完工物料中同名出现次数，排序依据） */
  usageCount: number;
}

/**
 * 增项下拉选项：品牌增项清单按历史使用频率降序（同次按名称字典序）。
 * @param brandName 品牌名（v7 口径品牌名；内置品牌 id 请先由调用方解析成名称）
 * @param orders    全量订单（频率统计用）
 */
export function getAddonOptions(
  brandName: string,
  orders: Order[],
): AddonOption[] {
  const lib: MaterialItemLib[] = getMaterialsByBrand(
    brandName,
    loadMaterialsLib(),
  );

  /* 历史使用频率：全部订单的勘测物料 + 完工物料按名称计数 */
  const usage = new Map<string, number>();
  for (const order of orders) {
    const lists = [order.survey?.materials, order.completion?.materials];
    for (const list of lists) {
      if (!list) continue;
      for (const item of list) {
        const name = item.name.trim();
        if (!name) continue;
        usage.set(name, (usage.get(name) ?? 0) + 1);
      }
    }
  }

  return lib
    .map((m) => ({
      name: m.name,
      unit: m.unit,
      salePrice: m.salePrice,
      usageCount: usage.get(m.name) ?? 0,
    }))
    .sort((a, b) =>
      b.usageCount !== a.usageCount
        ? b.usageCount - a.usageCount
        : a.name.localeCompare(b.name, "zh-Hans-CN"),
    );
}
