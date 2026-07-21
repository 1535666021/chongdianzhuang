/* ============================================================
 * 服务费取值裁决层：品牌结算价（cp_brand_prices）接入利润计算（任务H）
 * 职责：按服务类型 + 套包米数档位，优先取品牌结算价；
 *      未命中品牌 / 档位价非法（非正数、非有限数）时回退品牌费率配置
 * 规范：服务类型判定复用 finance.getServiceKind（remark 关键词口径全项目唯一），
 *      本模块不碰 storage（brandPrices 由调用方读取后传入，品牌名由调用方解析）
 * ============================================================ */

import type { BrandPrice, BrandRateConfig, Order } from "@/types";
import { getServiceKind } from "@/lib/finance";

/* ------------------------------------------------------------
 * 一、裁决结果模型
 * ------------------------------------------------------------ */

/** 服务费裁决结果（fee 已 round2 保留两位小数） */
export interface ServiceFeeResolution {
  /** 最终服务费（元） */
  fee: number;
  /** 取值来源（对账弹窗展示用）：brandPrice=品牌结算价 / rateConfig=品牌费率配置 */
  source: "brandPrice" | "rateConfig";
  /** 判定档位：安装按套包米数分档，维修恒为 repairSettlement，勘测恒为 survey */
  tier?: "install20m" | "install30m" | "repairSettlement" | "survey";
}

/* ------------------------------------------------------------
 * 二、内部工具
 * ------------------------------------------------------------ */

/** 金额保留两位小数（与 finance.ts 内部 round2 同一口径） */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 结算价档位值有效性：必须为正且有限，否则视为未设置并回退费率配置 */
function isUsablePrice(n: number): boolean {
  return Number.isFinite(n) && n > 0;
}

/* ------------------------------------------------------------
 * 三、裁决主入口
 * ------------------------------------------------------------ */

/**
 * 裁决单个订单的服务费：
 * 1. 勘测单：结算价表无勘测档，永远取 rateConfig.surveyFee（source="rateConfig"，tier="survey"）
 * 2. 安装单：以 rateConfig.packageMeters 为档位依据，≤20 米 → install20m 档，>20 米 → install30m 档；
 *    维修单 → repairSettlement 档
 * 3. 品牌匹配：brandName 与 BrandPrice.brand 全等命中才采用结算价（source="brandPrice"）；
 *    未命中或命中档位价非正数/非有限数 → 回退 rateConfig（install→installFee / repair→repairFee）
 * @param order 订单（remark 识别服务类型）
 * @param rateConfig 品牌费率配置（套包米数档位依据 + 回退费用来源）
 * @param brandPrices 品牌结算价表（调用方从 storage 读取）
 * @param brandName 订单品牌名（调用方由 order.brandId 经 mergeBrands 解析后传入）
 */
export function resolveServiceFee(
  order: Order,
  rateConfig: BrandRateConfig,
  brandPrices: BrandPrice[],
  brandName: string,
): ServiceFeeResolution {
  const kind = getServiceKind(order);

  /* 勘测单：结算价表无勘测档，永远走费率配置 */
  if (kind === "survey") {
    return {
      fee: round2(rateConfig.surveyFee),
      source: "rateConfig",
      tier: "survey",
    };
  }

  /* 档位判定：安装按套包米数分 20m/30m 档，维修恒为维修结算档 */
  const tier =
    kind === "repair"
      ? ("repairSettlement" as const)
      : rateConfig.packageMeters <= 20
        ? ("install20m" as const)
        : ("install30m" as const);

  /* 费率配置回退值：未命中品牌 / 档位价非法时使用（与 finance.calcOrderProfit 原口径一致） */
  const fallbackFee =
    kind === "repair" ? rateConfig.repairFee : rateConfig.installFee;

  /* 品牌结算价：品牌名全等命中且档位价为正数才采用，否则回退费率配置 */
  const name = brandName.trim();
  const hit = name
    ? brandPrices.find((p) => p.brand === name)
    : undefined;
  if (hit) {
    const tierPrice = hit[tier];
    if (isUsablePrice(tierPrice)) {
      return { fee: round2(tierPrice), source: "brandPrice", tier };
    }
  }
  return { fee: round2(fallbackFee), source: "rateConfig", tier };
}
