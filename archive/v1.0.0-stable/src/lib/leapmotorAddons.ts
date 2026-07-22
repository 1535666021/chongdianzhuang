/* ============================================================
 * 零跑增项模板（任务v33 · 业务逻辑唯一收敛处）
 * 数据源：《零跑汽车充电桩安装服务告知书》增项服务收费标准
 *      （2025-02-18 起执行，甲方供图逐行清点：分组序号1-31、明细行=36条）
 * 职责：默认36条模板数据 / 触发判定（品牌=零跑不分平台）/
 *      金额计算（单价×数量、合计）；视图层只渲染本模块输出
 * ============================================================ */

import type { LeapmotorAddon } from "@/types";

/** 默认零跑增项模板 36 条（告知书逐行；id 稳定 leap-01~leap-36，
 *  维护区改价/增删后整体存 cp_leapmotor_addons，键不存在回本默认；
 *  v35.1 逐条补 shortName 人工精修短名，显示取 shortName ?? autoShortName(name)，
 *  精修值与 lib/addonShortName 规则同风格，其中 29/36 可被 autoShortName 原样产出） */
export const DEFAULT_LEAPMOTOR_ADDONS: LeapmotorAddon[] = [
  { id: "leap-01", name: "电缆敷设 YJV 3×6mm²（人工）", shortName: "线缆·3×6", unit: "米", price: 45 },
  { id: "leap-02", name: "电缆敷设 YJV 3×10mm²（人工）", shortName: "线缆·3×10", unit: "米", price: 50 },
  { id: "leap-03", name: "电缆敷设 YJV 3×16mm²（人工）", shortName: "线缆·3×16", unit: "米", price: 65 },
  { id: "leap-04", name: "套餐内线缆升级至 3×10mm²", shortName: "升级·3×10", unit: "米", price: 5 },
  { id: "leap-05", name: "套餐内线缆升级至 3×16mm²", shortName: "升级·3×16", unit: "米", price: 20 },
  { id: "leap-06", name: "充电桩立柱（1.3~1.5米，含立柱和安装）", shortName: "立柱·1.3-1.5米", unit: "根", price: 300 },
  { id: "leap-07", name: "充电桩水泥基础（混凝土 500×500×200mm）", shortName: "水泥基础", unit: "项", price: 300 },
  { id: "leap-08", name: "充电桩钢结构底座（400×330×150mm，含安装）", shortName: "钢结构底座", unit: "项", price: 450 },
  { id: "leap-09", name: "开沟开槽·承重路 A1 土路", shortName: "开沟·A1土路", unit: "米", price: 40 },
  { id: "leap-10", name: "开沟开槽·承重路 A2 水泥路", shortName: "开沟·A2水泥路", unit: "米", price: 130 },
  { id: "leap-11", name: "开沟开槽·承重路 A3 柏油路", shortName: "开沟·A3柏油路", unit: "米", price: 150 },
  { id: "leap-12", name: "开沟开槽·非承重路 B1 土路/草地", shortName: "开沟·B1土路/草地", unit: "米", price: 40 },
  { id: "leap-13", name: "开沟开槽·非承重路 B2 水泥路", shortName: "开沟·B2水泥路", unit: "米", price: 120 },
  { id: "leap-14", name: "开沟开槽·非承重路 B3 铺砖庭院", shortName: "开沟·B3铺砖庭院", unit: "米", price: 120 },
  { id: "leap-15", name: "穿墙打孔（墙体厚度≤20cm）", shortName: "钻孔·墙≤20cm", unit: "个", price: 50 },
  { id: "leap-16", name: "穿墙打孔（20cm<墙体厚度≤40cm）", shortName: "钻孔·墙20-40cm", unit: "个", price: 60 },
  { id: "leap-17", name: "穿墙打孔（40cm<墙体厚度≤60cm）", shortName: "钻孔·墙>40cm", unit: "个", price: 80 },
  { id: "leap-18", name: "穿墙打孔（60cm<墙体厚度≤80cm）", shortName: "钻孔·墙>60cm", unit: "个", price: 120 },
  { id: "leap-19", name: "高空架设（5米及以上高空作业，1000元封顶）", shortName: "高空架设", unit: "米", price: 35 },
  { id: "leap-20", name: "停车限位胶（塑料 55×15.5×9mm，含安装）", shortName: "停车限位胶", unit: "组", price: 50 },
  { id: "leap-21", name: "防撞警示柱（铁制 76×600mm，含安装）", shortName: "防撞警示柱·76×600", unit: "个", price: 50 },
  { id: "leap-22", name: "电缆桥架（50×100mm）", shortName: "电缆桥架·50×100", unit: "米", price: 50 },
  { id: "leap-23", name: "二次勘察费", shortName: "二次勘察", unit: "项", price: 200 },
  { id: "leap-24", name: "售后服务费（检查/维修人工辅料，不含零件费）", shortName: "售后服务费", unit: "项", price: 200 },
  { id: "leap-25", name: "售后换桩（原桩拆除+新桩安装）", shortName: "换桩", unit: "项", price: 200 },
  { id: "leap-26", name: "报装服务费（完全代理报装）", shortName: "报装·全代理", unit: "项", price: 500 },
  { id: "leap-27", name: "电度表（单相 80A 或以下）", shortName: "电度表·单相80A", unit: "个", price: 280 },
  { id: "leap-28", name: "保护箱安装（客户自购，仅安装）", shortName: "保护箱·自购", unit: "次", price: 50 },
  { id: "leap-29", name: "立柱安装（客户自购，仅安装，不含水泥基础）", shortName: "立柱安装·自购", unit: "次", price: 80 },
  { id: "leap-30", name: "充电器保护箱（500×600×250mm，含箱体设备及安装）", shortName: "充电器保护箱", unit: "个", price: 300 },
  { id: "leap-31", name: "移桩·桩体拆除", shortName: "移桩·拆除", unit: "次", price: 300 },
  { id: "leap-32", name: "移桩·桩体挂桩", shortName: "移桩·挂桩", unit: "次", price: 300 },
  { id: "leap-33", name: "移桩·桩体拆除和挂桩", shortName: "移桩·拆除和挂桩", unit: "次", price: 400 },
  { id: "leap-34", name: "移桩·线缆拆除", shortName: "移桩·线缆拆除", unit: "米", price: 20 },
  { id: "leap-35", name: "移桩·线缆敷设（仅维修/移桩场景）", shortName: "移桩·线缆敷设", unit: "米", price: 25 },
  { id: "leap-36", name: "漏电保护开关（2P C40 A型，更换及安装）", shortName: "漏保·2P C40", unit: "个", price: 100 },
];

/** 零跑触发判定：品牌名含「零跑」即真（不分平台、不看原文；
 *  调用方负责 mergeBrands 口径解析品牌名，与 restock.isLeapmotorOnsiteOnly 同入参） */
export function isLeapmotorBrand(brandName: string): boolean {
  return brandName.includes("零跑");
}

/** 金额计算：单价×数量（无单价=套包内行不计价按 0；分位四舍五入防浮点） */
export function leapmotorAddonLineAmount(
  unitPrice: number | undefined,
  quantity: number,
): number {
  if (
    unitPrice === undefined ||
    !Number.isFinite(unitPrice) ||
    !Number.isFinite(quantity)
  ) {
    return 0;
  }
  return Math.round(unitPrice * quantity * 100) / 100;
}

/** 增项合计：Σ各行金额（只对带单价行计价；MaterialItem 直接可传） */
export function leapmotorAddonsTotal(
  rows: ReadonlyArray<{ unitPrice?: number; quantity: number }>,
): number {
  const sum = rows.reduce(
    (acc, r) => acc + leapmotorAddonLineAmount(r.unitPrice, r.quantity),
    0,
  );
  return Math.round(sum * 100) / 100;
}
