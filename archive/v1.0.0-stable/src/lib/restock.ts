/* ============================================================
 * 补桩状态机 + 发货单文本（任务U 模块C/D 业务逻辑收敛处）
 * 职责：安装单判定 / 库存查询 / 补桩标签判定 / 一键补桩发货单文本生成
 * 红线：statistics.ts 锁定不可改，服务类型口径在此复刻（与
 *      statistics.resolveServiceKind 保持一致），禁止第三处复制
 * ============================================================ */

import type { Order, StockItem } from "@/types";
import { getServiceKind } from "@/lib/finance";
import { getStock } from "@/lib/inventory";

/** 服务类型（与 statistics.resolveServiceKind 同口径：
 *  legacyExtra.serviceType 中英文优先，缺省回退 finance.getServiceKind） */
export function serviceKindOf(order: Order): "install" | "repair" | "survey" {
  const raw = order.legacyExtra?.serviceType;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (t === "维修" || t === "repair") return "repair";
    if (t === "勘测" || t === "survey") return "survey";
    if (t === "安装" || t === "install") return "install";
  }
  return getServiceKind(order);
}

/** 安装单判定（补桩标签仅安装单可挂） */
export function isInstallOrder(order: Order): boolean {
  return serviceKindOf(order) === "install";
}

/** 服务类型中文标签（视图层只渲染本映射，判定走 serviceKindOf；
 *  仅类型文字，禁带套包米数——任务U 模块A④） */
export const SERVICE_KIND_LABEL: Record<
  ReturnType<typeof serviceKindOf>,
  string
> = {
  install: "安装",
  repair: "维修",
  survey: "勘测",
};

/** 品牌当前桩库存（无记录视为 0；品牌按名称匹配，与 v7 库存口径一致） */
export function getPileStock(
  brandName: string,
  inventory: StockItem[],
): number {
  return getStock(brandName, inventory);
}

/* ------------------------------------------------------------
 * 零跑补桩特例（任务v32 功能一）
 * 品牌=零跑 且 订单原文不含「带桩上门」→ 「仅上门安装」：
 *   不打需补桩标记、不进一键补桩发货单、不可互转、完工不扣库存
 * 原文含「带桩上门」→ 走正常补桩状态机；非零跑品牌不涉入
 * ------------------------------------------------------------ */

/** 零跑「仅上门安装」判定：品牌名含零跑 && originalText 不含「带桩上门」。
 *  调用方负责解析品牌名（mergeBrands 口径，与 shouldTagRestock 同一入参） */
export function isLeapmotorOnsiteOnly(order: Order, brandName: string): boolean {
  return (
    brandName.includes("零跑") &&
    !(order.originalText ?? "").includes("带桩上门")
  );
}

/** 是否应挂「需补桩」：安装单 && 无补桩标记 && 非零跑仅上门 && 该品牌库存≤0
 * （录入不拦截，仅提示；零跑仅上门单永不打标——v32 守卫；
 *  v32.2 守卫修正：库存判定 ===0 → <=0——v7 承接库存有负数超发挂账
 * （五菱 -4 / 长城 -1 / 比亚迪 -1），负数=更缺货，必须挂标；
 *  库存 > 0 不挂的原口径不变） */
export function shouldTagRestock(
  order: Order,
  inventory: StockItem[],
  brandName: string,
): boolean {
  return (
    isInstallOrder(order) &&
    order.restockStatus == null &&
    !isLeapmotorOnsiteOnly(order, brandName) &&
    getPileStock(brandName, inventory) <= 0
  );
}

/* ------------------------------------------------------------
 * 一键补桩发货单（模块D）
 * ------------------------------------------------------------ */

/** 辅材行（可整区不填；空名/空数量行不落文本） */
export interface RestockMaterialRow {
  name: string;
  quantity: string;
}

/** 平台显示名：优先 order.platform（全称），回退 platformType 映射 */
export function platformNameOf(order: Order): string {
  if (order.platform && order.platform.trim() !== "")
    return order.platform.trim();
  if (order.platformType === "jd") return "京东";
  if (order.platformType === "other") return "其他";
  return "";
}

/**
 * 生成发货单纯文本（微信粘贴用）：
 *   第1行：X月X日发货明细
 *   桩明细行：平台 品牌 功率 N台（同平台同品牌同功率合并计数，多行按平台/品牌/功率排序）
 *   辅材区（有可填行才出现）：每行「名称 数量」
 *   落款：工程师信息收货地址（原样引用，有值才出现）
 */
export function buildRestockShipmentText(
  date: Date,
  orders: Order[],
  materials: RestockMaterialRow[],
  receiveAddr: string,
  brandNameOf: (brandId: string) => string,
): string {
  const lines: string[] = [`${date.getMonth() + 1}月${date.getDate()}日发货明细`];

  /* 同平台同品牌同功率合并计数 */
  const groups = new Map<string, number>();
  for (const order of orders) {
    const key = [
      platformNameOf(order),
      brandNameOf(order.brandId),
      `${order.powerKw}kW`,
    ].join("|");
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  const rows = [...groups.entries()]
    .map(([key, count]) => {
      const [platform, brand, power] = key.split("|");
      return { platform, brand, power, count };
    })
    .sort((a, b) =>
      `${a.platform}${a.brand}${a.power}`.localeCompare(
        `${b.platform}${b.brand}${b.power}`,
        "zh-Hans-CN",
      ),
    );
  for (const row of rows) {
    lines.push(`${row.platform} ${row.brand} ${row.power} ${row.count}台`);
  }

  /* 辅材区（可整区不填） */
  const materialLines = materials
    .filter((m) => m.name.trim() !== "" && m.quantity.trim() !== "")
    .map((m) => `${m.name.trim()} ${m.quantity.trim()}`);
  if (materialLines.length > 0) {
    lines.push("辅材：");
    lines.push(...materialLines);
  }

  /* 落款：收货地址原样引用 */
  const addr = receiveAddr.trim();
  if (addr !== "") {
    lines.push(addr);
  }

  return lines.join("\n");
}
