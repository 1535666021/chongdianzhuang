/* ============================================================
 * 平台与扣点：唯一数据层
 * 规范：平台列表（cp_platforms）的匹配/迁移/兜底口径全部收敛在本模块；
 *      视图层（页面/组件）禁止自行计算扣点率，一律调用 getPlatformRate；
 *      财务层（finance.ts）按订单 platform 取扣点时同样只准调用本模块。
 * 依赖铁则：本模块禁止 import storage（平台列表由调用方从 storage 读取后传入，
 *      与 finance.ts 同一规则，保证纯函数可测）
 * ============================================================ */

import type { PlatformConfig, PlatformRateConfig } from "@/types";
import { DEFAULT_PLATFORM_RATES } from "@/types";

/* ------------------------------------------------------------
 * 一、常量与默认配置
 * ------------------------------------------------------------ */

/** 默认平台列表（deductionPercent 为 0-100 口径：10 = 10%） */
export const DEFAULT_PLATFORMS: PlatformConfig[] = [
  { name: "京东", deductionPercent: 10 },
  { name: "其他", deductionPercent: 20 },
];

/** 兜底平台名：订单平台未命中任何配置时按「其他」计 */
const OTHER_PLATFORM_NAME = "其他";

/** 最终兜底扣点率（小数）：连「其他」都未配置时，沿用旧两档的 other 默认 0.20 */
const FALLBACK_RATE = DEFAULT_PLATFORM_RATES.other;

/** 百分比浮点清理（0.1 × 100 = 10.000000000000002 这类尾差抹平到两位小数） */
function roundPercent(n: number): number {
  return Math.round(n * 100) / 100;
}

/* ------------------------------------------------------------
 * 二、按订单平台名查扣点率
 * ------------------------------------------------------------ */

/**
 * 名称匹配（精确 → 双向 includes 归并）：
 * - 精确：去空白后全等（"京东" 命中 "京东"）
 * - 归并：配置名与查询名互相包含即视为同一平台
 *   （订单 "京东商城" 命中配置 "京东"；配置 "京东慧采" 命中订单 "京东"）
 * - 空名配置不参与匹配（空串 includes 一切，会误命中）
 */
function findByName(
  query: string,
  platforms: PlatformConfig[],
): PlatformConfig | undefined {
  const q = query.trim();
  if (!q) return undefined;
  const exact = platforms.find((p) => p.name.trim() === q);
  if (exact) return exact;
  return platforms.find((p) => {
    const name = p.name.trim();
    return name !== "" && (name.includes(q) || q.includes(name));
  });
}

/**
 * 按订单 platform 名查扣点率，返回小数（deductionPercent ÷ 100）：
 * 1. 精确匹配平台名
 * 2. 双向 includes 归并匹配
 * 3. 查不到回退「其他」（同样 精确 → includes）
 * 4. 连「其他」都没有 → 0.20
 */
export function getPlatformRate(
  platformName: string | undefined,
  platforms: PlatformConfig[],
): number {
  if (!Array.isArray(platforms) || platforms.length === 0) {
    return FALLBACK_RATE;
  }
  const hit =
    findByName(platformName ?? "", platforms) ??
    findByName(OTHER_PLATFORM_NAME, platforms);
  if (!hit) return FALLBACK_RATE;
  return Number.isFinite(hit.deductionPercent)
    ? hit.deductionPercent / 100
    : FALLBACK_RATE;
}

/* ------------------------------------------------------------
 * 三、报单文本平台名归一（智能识别用）
 * ------------------------------------------------------------ */

/** 平台别名表（报单写法 → 标准名候选，按别名长度降序）：
 * 吸收 v7/v2 口径（实测 v7 扣点名"领充"对应平台列表名"西安领充"） */
const PLATFORM_ALIASES: Array<[string, string]> = [
  ["京东商城", "京东"],
  ["苏宁易购", "苏宁"],
  ["西安领充", "西安领充"],
  ["领充", "西安领充"],
  ["jd", "京东"],
  ["taobao", "淘宝"],
  ["tmall", "天猫"],
];

/**
 * 报单平台文本 → 平台配置名（匹配不到返回 ""）：
 * 1. 直接 精确 → 双向 includes 归并（findByName 同扣点口径）；
 * 2. 别名归一后再匹配（"JD/京东商城"→"京东"，"领充"→"西安领充"）；
 * 3. 均不中返回 ""（调用方按"平台未匹配"标黄，不写垃圾值）
 */
export function matchPlatformName(
  query: string,
  platforms: PlatformConfig[],
): string {
  const q = query.trim();
  if (!q || !Array.isArray(platforms) || platforms.length === 0) return "";
  const direct = findByName(q, platforms);
  if (direct) return direct.name;
  const lower = q.toLowerCase();
  for (const [alias, standard] of PLATFORM_ALIASES) {
    if (lower.includes(alias.toLowerCase())) {
      const hit =
        findByName(standard, platforms) ?? findByName(alias, platforms);
      if (hit) return hit.name;
    }
  }
  return "";
}

/* ------------------------------------------------------------
 * 四、旧两档扣点迁移
 * ------------------------------------------------------------ */

/**
 * 旧两档扣点（cp_platform_rates，小数口径）→ 新平台列表（0-100 口径）：
 * { jd: 0.10, other: 0.20 } → [{京东, 10}, {其他, 20}]
 * 字段缺失/非法时回退 DEFAULT_PLATFORM_RATES 对应值
 */
export function migrateLegacyRates(
  legacy: PlatformRateConfig,
): PlatformConfig[] {
  const jd = Number.isFinite(legacy?.jd) ? legacy.jd : DEFAULT_PLATFORM_RATES.jd;
  const other = Number.isFinite(legacy?.other)
    ? legacy.other
    : DEFAULT_PLATFORM_RATES.other;
  return [
    { name: "京东", deductionPercent: roundPercent(jd * 100) },
    { name: "其他", deductionPercent: roundPercent(other * 100) },
  ];
}
