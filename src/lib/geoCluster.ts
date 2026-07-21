/* ============================================================
 * 片区聚类唯一入口：活跃订单按坐标贪心聚组（3km 全连接 + 15km 半径上限），
 *      无坐标订单按地址片区文本归组
 * 规范：片区聚类唯一入口，视图层禁止自算距离 / 自写聚类逻辑，
 *      页面/组件一律调用本模块纯函数（距离统一走 haversineKm）
 * 依赖例外：本模块允许 import storage（仅 loadGeoCache 读取地理编码缓存，
 *      订单缺坐标时按订单地址查缓存坐标）；费率/扣点/映射不直接读 storage，
 *      仍由调用方读取后经 deps 传入
 * ============================================================ */

import { OrderStatus } from "@/types";
import type {
  BrandRateConfig,
  CostMapping,
  MaterialItem,
  Order,
  PlatformRateConfig,
} from "@/types";
import { calcOrderProfit, DEFAULT_RATE_CONFIG } from "@/lib/finance";
import { getBrandMaterialPack } from "@/lib/brandMaterials";
import { loadGeoCache } from "@/lib/storage";
import type { GeoPoint } from "@/lib/storage";

/* ------------------------------------------------------------
 * 一、聚类常量与出入参模型
 * ------------------------------------------------------------ */

/** 全连接并组阈值（km）：候选单与组内所有成员距离 ≤ 3km 才吸纳 */
const MERGE_DISTANCE_KM = 3;

/** 组半径上限（km）：任一成员距种子单 > 15km 不吸纳 */
const MAX_RADIUS_KM = 15;

/** 地球平均半径（km，Haversine 公式用） */
const EARTH_RADIUS_KM = 6371;

/** 地址提取不到片区名时的回退名 */
const UNNAMED_AREA = "未命名片区";

/** 活跃状态：只有这些状态参与片区聚类（completed/cancelled 跳过） */
const ACTIVE_STATUSES: readonly OrderStatus[] = [
  OrderStatus.Pending,
  OrderStatus.Surveyed,
  OrderStatus.Appointed,
];

/** 片区名提取正则：优先匹配"XX区/县/镇/街道"（前缀 2~6 字，惰性取最短） */
/* 片区名提取：匹配"区/县/镇/街道"结尾的 2-6 字片段，且不跨越省/市边界
 * （v29 修复：旧正则跨市界吞字，"安徽省合肥市巢湖市烔炀镇…"会得出"市巢湖市烔炀镇"） */
const AREA_NAME_RE = /([^省市]{2,6}?(?:区|县|镇|街道))/;

export interface AreaClusterDeps {
  rateConfigs: BrandRateConfig[];
  platformRates: PlatformRateConfig;
  mappings: CostMapping[];
}

export interface AreaCluster {
  /** 片区标识（片区名+序号） */
  id: string;
  /** 片区名：从地址提取"XX区/县/镇/街道"，提取不到用"未命名片区" */
  name: string;
  /** 组内订单（保持输入相对顺序） */
  orders: Order[];
  /** 组内订单间最大距离（km，文本归组的为 0） */
  maxDistanceKm: number;
  /** 预估总利润（calcOrderProfit 逐单求和） */
  estimatedProfit: number;
}

/* ------------------------------------------------------------
 * 二、基础工具：距离 / 片区名 / 坐标解析
 * ------------------------------------------------------------ */

/** Haversine 距离（km） */
export function haversineKm(
  lng1: number,
  lat1: number,
  lng2: number,
  lat2: number,
): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  // 浮点误差下 a 可能略大于 1（对跖点），钳位防 NaN
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(Math.min(1, a)));
}

/** 地址片区名提取（导出供 HomePage 展示复用）：优先匹配 /(.{2,6}?(?:区|县|镇|街道))/，无则空串 */
export function extractAreaName(address: string): string {
  const match = address.match(AREA_NAME_RE);
  return match?.[1] ?? "";
}

/** 地址 → 片区名：提取不到时回退"未命名片区"（聚类命名与文本归组统一走这里） */
function areaNameOf(address: string): string {
  return extractAreaName(address) || UNNAMED_AREA;
}

/** 订单坐标解析：order.longitude/latitude 优先；缺失时查 geoCache（key 为 trim 后地址，与 geoCache.ts 写入口径一致）；均无则 null */
function resolvePoint(
  order: Order,
  geoCache: Record<string, GeoPoint>,
): GeoPoint | null {
  const { longitude, latitude } = order;
  if (
    typeof longitude === "number" &&
    typeof latitude === "number" &&
    Number.isFinite(longitude) &&
    Number.isFinite(latitude)
  ) {
    return { longitude, latitude };
  }
  const cached = geoCache[order.address.trim()];
  if (cached && Number.isFinite(cached.longitude) && Number.isFinite(cached.latitude)) {
    return cached;
  }
  return null;
}

/* ------------------------------------------------------------
 * 三、组内距离与利润估算
 * ------------------------------------------------------------ */

/** 带坐标的活跃订单（聚类内部结构） */
interface LocatedOrder {
  order: Order;
  point: GeoPoint;
}

/** 两点间 Haversine 距离（LocatedOrder 便捷包装） */
function distanceOf(a: LocatedOrder, b: LocatedOrder): number {
  return haversineKm(
    a.point.longitude,
    a.point.latitude,
    b.point.longitude,
    b.point.latitude,
  );
}

/** 组内订单间最大距离（km）：全部成员两两取最大 */
function maxPairwiseDistance(members: LocatedOrder[]): number {
  let max = 0;
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const d = distanceOf(members[i], members[j]);
      if (d > max) max = d;
    }
  }
  return max;
}

/** 金额保留两位小数（与 finance.ts 出口口径一致） */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * 单单预估利润：
 * - 物料取 order.survey?.materials ?? getBrandMaterialPack(order.brandId)
 * - rateConfig 按 brandId 查 deps.rateConfigs，缺失用 { brandId, ...DEFAULT_RATE_CONFIG }
 */
function estimateOrderProfit(order: Order, deps: AreaClusterDeps): number {
  const materials: MaterialItem[] =
    order.survey?.materials ?? getBrandMaterialPack(order.brandId);
  const rateConfig: BrandRateConfig = deps.rateConfigs.find(
    (r) => r.brandId === order.brandId,
  ) ?? { brandId: order.brandId, ...DEFAULT_RATE_CONFIG };
  return calcOrderProfit({
    order,
    materials,
    rateConfig,
    platformRates: deps.platformRates,
    mappings: deps.mappings,
  }).profit;
}

/** 组装聚组结果（id 留空，由出口统一按"片区名+序号"编号） */
function buildCluster(
  name: string,
  orders: Order[],
  maxDistanceKm: number,
  deps: AreaClusterDeps,
): AreaCluster {
  const estimatedProfit = round2(
    orders.reduce((sum, order) => sum + estimateOrderProfit(order, deps), 0),
  );
  return { id: "", name, orders, maxDistanceKm, estimatedProfit };
}

/* ------------------------------------------------------------
 * 四、片区聚类主入口
 * ------------------------------------------------------------ */

/**
 * 片区聚类：
 * - 只聚"活跃订单"（pending/surveyed/appointed；completed/cancelled 跳过）
 * - 坐标来源：order.longitude/latitude；缺失时查 geoCache（loadGeoCache()[order.address]）
 * - 有坐标订单：贪心全连接聚类——以每单为种子，吸纳与组内所有成员距离 ≤3km 的订单；组半径超过15km（任一成员距种子>15km）不吸纳；距离用 Haversine
 * - 无坐标订单：文本归组——地址提取的片区名相同的归为一组（≥2单才成组），maxDistanceKm=0
 * - 每单只属一个组（先到先得）；最终只返回 orders.length ≥ 2 的组
 * - 组排序：estimatedProfit 降序
 * - 预估利润：物料取 order.survey?.materials ?? getBrandMaterialPack(order.brandId)；rateConfig 按 brandId 查 deps.rateConfigs，缺失用 { brandId, ...DEFAULT_RATE_CONFIG }
 *
 * 补充口径（实现细节）：
 * - 坐标组的片区名取种子单地址提取结果；坐标组的 maxDistanceKm 为成员两两距离最大值
 * - id 在过滤 ≥2 单并排序后统一编号：`${片区名}-${序号}`（序号从 1 起，返回数组顺序即序号顺序）
 */
export function clusterOrdersByArea(
  orders: Order[],
  deps: AreaClusterDeps,
): AreaCluster[] {
  /* 1. 只聚活跃订单（保持输入相对顺序） */
  const active = orders.filter((o) => ACTIVE_STATUSES.includes(o.status));

  /* 2. 坐标解析：有坐标进坐标聚类，无坐标进文本归组（缓存整表只读一次） */
  const geoCache = loadGeoCache();
  const located: LocatedOrder[] = [];
  const unlocated: Order[] = [];
  for (const order of active) {
    const point = resolvePoint(order, geoCache);
    if (point) {
      located.push({ order, point });
    } else {
      unlocated.push(order);
    }
  }

  const clusters: AreaCluster[] = [];

  /* 3. 有坐标：贪心全连接聚类（先到先得，每单只属一个组） */
  const assigned = new Set<Order>();
  for (const seed of located) {
    if (assigned.has(seed.order)) continue;
    const members: LocatedOrder[] = [seed];
    assigned.add(seed.order);
    for (const cand of located) {
      if (assigned.has(cand.order)) continue;
      // 半径上限：候选距种子 > 15km 不吸纳（吸纳后组半径即超限）
      if (distanceOf(cand, seed) > MAX_RADIUS_KM) continue;
      // 全连接：候选与组内所有成员距离 ≤ 3km 才吸纳
      const linkable = members.every(
        (m) => distanceOf(cand, m) <= MERGE_DISTANCE_KM,
      );
      if (!linkable) continue;
      members.push(cand);
      assigned.add(cand.order);
    }
    clusters.push(
      buildCluster(
        areaNameOf(seed.order.address),
        members.map((m) => m.order),
        maxPairwiseDistance(members),
        deps,
      ),
    );
  }

  /* 4. 无坐标：文本归组——片区名相同（含"未命名片区"回退名）的归为一组 */
  const textGroups = new Map<string, Order[]>();
  for (const order of unlocated) {
    const name = areaNameOf(order.address);
    const group = textGroups.get(name);
    if (group) {
      group.push(order);
    } else {
      textGroups.set(name, [order]);
    }
  }
  for (const [name, groupOrders] of textGroups) {
    clusters.push(buildCluster(name, groupOrders, 0, deps));
  }

  /* 5. 同名片区合并（v30：坐标聚类可能把同镇拆成多组、或与文本归组重名，
   *    片区 chip 按名合一——一个片区一个 chip，chip 单数=该片实际待办总数） */
  const byName = new Map<string, AreaCluster>();
  for (const cluster of clusters) {
    const name = cluster.name.trim() || UNNAMED_AREA;
    const exist = byName.get(name);
    if (exist) {
      exist.orders.push(...cluster.orders);
      exist.estimatedProfit = round2(
        exist.estimatedProfit + cluster.estimatedProfit,
      );
      exist.maxDistanceKm = Math.max(
        exist.maxDistanceKm,
        cluster.maxDistanceKm,
      );
    } else {
      byName.set(name, { ...cluster, name, orders: [...cluster.orders] });
    }
  }

  /* 6. 片区标签全显示（v30 返工口径·甲方原话："只要有单（哪怕只有1单），
   *    片区标签就全部显示"——取消 ≥2 单门槛，无任何单数门槛）
   *    → 预估利润降序 → 统一编号（片区名+序号） */
  return [...byName.values()]
    .sort((a, b) => b.estimatedProfit - a.estimatedProfit)
    .map((c, i) => ({ ...c, id: `${c.name}-${i + 1}` }));
}

/* ------------------------------------------------------------
 * 五、批量预约（任务R-R3：首页片区分组一键批量预约）
 * 口径：逐单写入走既有 AppContext.saveAppointment(id, appointment)，
 *      本模块只出口草稿模型 / 待办判定 / 时段常量，不碰存储与状态流转
 * ------------------------------------------------------------ */

/** 批量预约草稿（BatchAppointmentDialog 确认后逐单写入；接口契约 §5 冻结） */
export interface BatchAppointmentDraft {
  /** 预约安装日期，YYYY-MM-DD */
  appointmentDate: string;
  /** 预约时间段 */
  timeSlot: string;
  /** 安装师傅 */
  installer: string;
}

/**
 * 批量预约可选时段（与 AppointmentFormDialog 的 TIME_SLOTS 逐字保持一致，
 * 统一在 lib 层维护，避免各组件重复定义漂移）
 */
export const BATCH_APPOINTMENT_TIME_SLOTS = [
  { value: "09:00-12:00", label: "上午 09:00-12:00" },
  { value: "14:00-18:00", label: "下午 14:00-18:00" },
  { value: "18:00-21:00", label: "晚上 18:00-21:00" },
] as const;

/** 待办（活跃）订单判定：与片区聚类口径一致（pending/surveyed/appointed） */
export function isActiveOrder(order: Order): boolean {
  return ACTIVE_STATUSES.includes(order.status);
}

/**
 * 片内可批量预约的待办单：待勘测 / 已勘测
 * （已预约单不重复预约跳过；已完成/已取消/回收站本就不参与片区聚类）
 */
export function getAppointableOrders(orders: Order[]): Order[] {
  return orders.filter(
    (o) =>
      o.status === OrderStatus.Pending || o.status === OrderStatus.Surveyed,
  );
}
