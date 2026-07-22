/* ============================================================
 * 内置数据：充电桩品牌 + 各品牌默认物料包
 * 说明：勘测弹窗选择品牌后可"一键带入"默认物料，再手工微调；
 *      用户新增品牌存于 storage（customBrands），与内置品牌合并展示
 * ============================================================ */

import type { BrandMaterialPack, ChargeBrand, MaterialItem } from "@/types";

/* ------------------------------------------------------------
 * 一、内置品牌
 * ------------------------------------------------------------ */
export const BUILT_IN_BRANDS: ChargeBrand[] = [
  { id: "tesla", name: "特斯拉", defaultPowerKw: 7 },
  { id: "byd", name: "比亚迪", defaultPowerKw: 7 },
  { id: "bull", name: "公牛", defaultPowerKw: 7 },
  { id: "prtdt", name: "普诺得", defaultPowerKw: 7 },
  { id: "zhida", name: "挚达", defaultPowerKw: 7 },
  { id: "starcharge", name: "星星充电", defaultPowerKw: 7 },
  { id: "lixiang", name: "理想", defaultPowerKw: 7 },
  { id: "other", name: "其他品牌", defaultPowerKw: 7 },
];

/* ------------------------------------------------------------
 * 二、通用物料快捷构造函数（各品牌物料包复用，避免重复字面量）
 * ------------------------------------------------------------ */
function cable(spec: string, quantity: number): MaterialItem {
  return { name: "电缆", spec, quantity, unit: "米" };
}

function baseMaterials(cableSpec: string): MaterialItem[] {
  return [
    cable(cableSpec, 30),
    { name: "漏电保护开关", spec: "40A/2P", quantity: 1, unit: "个" },
    { name: "PVC线管", spec: "DN32", quantity: 10, unit: "米" },
    { name: "空气开关", spec: "C40", quantity: 1, unit: "个" },
    { name: "防水配电箱", spec: "IP54", quantity: 1, unit: "个" },
  ];
}

/* ------------------------------------------------------------
 * 三、各品牌默认物料包
 * ------------------------------------------------------------ */
export const BRAND_MATERIAL_PACKS: BrandMaterialPack[] = [
  {
    brandId: "tesla",
    items: [
      ...baseMaterials("YJV-3×6mm²"),
      { name: "特斯拉专用挂壁支架", spec: "Gen3", quantity: 1, unit: "套" },
    ],
  },
  {
    brandId: "byd",
    items: [
      ...baseMaterials("YJV-3×6mm²"),
      { name: "比亚迪专用充电枪线", spec: "5米", quantity: 1, unit: "根" },
    ],
  },
  {
    brandId: "bull",
    items: baseMaterials("YJV-3×6mm²"),
  },
  {
    brandId: "prtdt",
    items: baseMaterials("YJV-3×6mm²"),
  },
  {
    brandId: "zhida",
    items: [
      ...baseMaterials("YJV-3×6mm²"),
      { name: "挚达专用立柱", spec: "1.5米", quantity: 1, unit: "根" },
    ],
  },
  {
    brandId: "starcharge",
    items: baseMaterials("YJV-3×6mm²"),
  },
  {
    brandId: "other",
    items: baseMaterials("YJV-3×6mm²"),
  },
];

/* ------------------------------------------------------------
 * 四、查询工具（components / context 复用）
 * ------------------------------------------------------------ */

/** 合并内置品牌 + 用户自定义品牌 */
export function mergeBrands(customBrands: ChargeBrand[]): ChargeBrand[] {
  return [...BUILT_IN_BRANDS, ...customBrands];
}

/** 按品牌 ID 取品牌（内置 + 自定义） */
export function findBrand(
  brandId: string,
  customBrands: ChargeBrand[],
): ChargeBrand | undefined {
  return mergeBrands(customBrands).find((b) => b.id === brandId);
}

/** 取品牌默认物料包；无配置返回空数组 */
export function getBrandMaterialPack(brandId: string): MaterialItem[] {
  const pack = BRAND_MATERIAL_PACKS.find((p) => p.brandId === brandId);
  // 深拷贝，避免弹窗直接改到内置数据
  return pack ? pack.items.map((item) => ({ ...item })) : [];
}
