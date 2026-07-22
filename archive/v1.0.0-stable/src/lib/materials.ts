/* ============================================================
 * 材料库 / 模板库 唯一数据层（任务D）
 * 说明：
 * - MaterialItemLib / MaterialTemplate 的读写统一走 storage.ts
 *   （loadMaterialsLib / saveMaterialsLib / loadMaterialTemplates /
 *     saveMaterialTemplates），本文件只提供查询与派生工具，不直接碰 localStorage；
 * - 勘测/完工弹窗的物料 datalist、安装模板匹配等消费方一律调用本文件函数，
 *   禁止各自实现过滤逻辑；
 * - v7 口径：材料/模板按"品牌名"管理（非 brandId），
 *   "通用"或空品牌 = 所有品牌可见
 * ============================================================ */

import { BUILT_IN_BRANDS } from "@/lib/brandMaterials";
import type { MaterialItemLib, MaterialTemplate } from "@/types";

/** 通用材料品牌标记：brand 为该值或空串时，对所有品牌可见 */
export const GENERIC_MATERIAL_BRAND = "通用";

/**
 * 取某品牌可见的材料列表 = 品牌专属（brand 精确匹配）+ 通用（"通用"/空品牌）
 * brand 传空串或"通用"时，返回全部通用材料
 */
export function getMaterialsByBrand(
  brand: string,
  materials: MaterialItemLib[],
): MaterialItemLib[] {
  const key = brand.trim();
  return materials.filter((m) => {
    const mb = (m.brand ?? "").trim();
    if (mb === "" || mb === GENERIC_MATERIAL_BRAND) return true;
    return mb === key;
  });
}

/**
 * 按品牌取安装模板（精确匹配，返回第一个命中；无命中返回 null）
 * 入参可为品牌名（v7 口径），也可为内置品牌 id（自动解析为品牌名后再匹配）；
 * 自定义品牌请直接传品牌名
 */
export function getTemplateByBrand(
  brandIdOrName: string,
  templates: MaterialTemplate[],
): MaterialTemplate | null {
  const key = brandIdOrName.trim();
  if (!key) return null;
  const byName = templates.find((t) => t.brand.trim() === key);
  if (byName) return byName;
  const resolved = BUILT_IN_BRANDS.find((b) => b.id === key)?.name;
  if (!resolved) return null;
  return templates.find((t) => t.brand.trim() === resolved) ?? null;
}

/** 材料名去重列表（供勘测/完工弹窗 datalist 使用），空名剔除 */
export function materialNames(materials: MaterialItemLib[]): string[] {
  const seen = new Set<string>();
  for (const m of materials) {
    const name = m.name.trim();
    if (name) seen.add(name);
  }
  return [...seen];
}
