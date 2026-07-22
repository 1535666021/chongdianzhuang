/* ============================================================
 * 设置区块 · 费率配置（按品牌）+ 品牌结算价
 * （挂载由 SettingsPage「费率配置」二级页完成；品牌结算价 SettlementSection
 *   同属本组，紧随费率卡片之后）
 * 输入即存：去掉单品牌「保存」按钮，onChange 防抖（500ms）自动保存
 *      + toast「已保存」；落库逻辑不变——读最新数组 upsert 后整体写回，
 *      非法输入（负数/非数字）保持原校验 toast 且不落库
 * 规范：所有读写走 storage 封装，本组件不碰 localStorage
 * ============================================================ */

import { useState } from "react";
import type { BrandRateConfig } from "@/types";
import { useApp } from "@/context/AppContext";
import { loadRateConfigs, saveRateConfigs } from "@/lib/storage";
import { mergeBrands } from "@/lib/brandMaterials";
import { SettlementSection } from "@/components/settings/SettlementSection";
import { useDebouncedCallback } from "@/components/settings/useDebouncedCallback";

/* ------------------------------------------------------------
 * 费率：表单草稿模型与加载工具
 * 输入框统一用字符串草稿（受控 number 无法清空），保存时才转数字
 * ------------------------------------------------------------ */

/** 单品牌费率草稿，与 BrandRateConfig 字段一一对应 */
interface RateDraft {
  packageMeters: string;
  installFee: string;
  repairFee: string;
  surveyFee: string;
}

/** 未配置品牌的占位默认值 */
const DEFAULT_RATE_DRAFT: RateDraft = {
  packageMeters: "30",
  installFee: "300",
  repairFee: "60",
  surveyFee: "0",
};

/** 从 storage 读已保存费率，转为 brandId → 草稿 的映射 */
function readRateDrafts(): Record<string, RateDraft> {
  const drafts: Record<string, RateDraft> = {};
  for (const config of loadRateConfigs()) {
    drafts[config.brandId] = {
      packageMeters: String(config.packageMeters),
      installFee: String(config.installFee),
      repairFee: String(config.repairFee),
      surveyFee: String(config.surveyFee),
    };
  }
  return drafts;
}

/** 解析非负数字草稿；空串/非法数字返回 null */
function parseNonNegative(value: string): number | null {
  const num = Number(value);
  return value.trim() !== "" && Number.isFinite(num) && num >= 0 ? num : null;
}

export function RatesSection() {
  const { customBrands, showToast } = useApp();

  /* 费率草稿：进入二级页（组件挂载）时从 storage 加载 */
  const [rateDrafts, setRateDrafts] =
    useState<Record<string, RateDraft>>(readRateDrafts);

  /* 内置 + 自定义品牌（按品牌逐行渲染） */
  const allBrands = mergeBrands(customBrands);

  /* ---- 输入即存：防抖 500ms 自动保存（原单品牌 upsert 落库逻辑不变，
   *      对全部草稿逐个校验 upsert，未变动品牌重写同值为幂等） ---- */
  const persist = useDebouncedCallback(() => {
    const configs = loadRateConfigs();
    let hasInvalid = false;
    let savedCount = 0;
    for (const [brandId, draft] of Object.entries(rateDrafts)) {
      const packageMeters = parseNonNegative(draft.packageMeters);
      const installFee = parseNonNegative(draft.installFee);
      const repairFee = parseNonNegative(draft.repairFee);
      const surveyFee = parseNonNegative(draft.surveyFee);
      if (
        packageMeters === null ||
        installFee === null ||
        repairFee === null ||
        surveyFee === null
      ) {
        hasInvalid = true;
        continue;
      }
      const next: BrandRateConfig = {
        brandId,
        packageMeters,
        installFee,
        repairFee,
        surveyFee,
      };
      const index = configs.findIndex((c) => c.brandId === brandId);
      if (index >= 0) {
        configs[index] = next;
      } else {
        configs.push(next);
      }
      savedCount += 1;
    }
    if (savedCount > 0 && !saveRateConfigs(configs)) {
      showToast("保存失败，请重试");
      return;
    }
    if (hasInvalid) {
      showToast("费率请填写不小于 0 的数字");
      return;
    }
    if (savedCount > 0) {
      showToast("已保存");
    }
  });

  return (
    <>
      <div className="card">
        <div className="card__title">费率配置（按品牌）</div>
        <div className="flex-column gap-md">
          {allBrands.map((brand) => {
            const draft = rateDrafts[brand.id] ?? DEFAULT_RATE_DRAFT;
            const updateDraft = (patch: Partial<RateDraft>) => {
              setRateDrafts((prev) => ({
                ...prev,
                [brand.id]: {
                  ...(prev[brand.id] ?? DEFAULT_RATE_DRAFT),
                  ...patch,
                },
              }));
              persist();
            };
            return (
              <div key={brand.id} className="rate-row">
                <div className="rate-row__head">
                  <span className="rate-row__brand">{brand.name}</span>
                </div>
                <div className="rate-row__fields">
                  <label className="rate-row__field">
                    <span className="rate-row__label">套包米数</span>
                    <input
                      className="input"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      value={draft.packageMeters}
                      onChange={(e) =>
                        updateDraft({ packageMeters: e.target.value })
                      }
                    />
                  </label>
                  <label className="rate-row__field">
                    <span className="rate-row__label">安装费（元）</span>
                    <input
                      className="input"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      value={draft.installFee}
                      onChange={(e) =>
                        updateDraft({ installFee: e.target.value })
                      }
                    />
                  </label>
                  <label className="rate-row__field">
                    <span className="rate-row__label">维修费（元）</span>
                    <input
                      className="input"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      value={draft.repairFee}
                      onChange={(e) =>
                        updateDraft({ repairFee: e.target.value })
                      }
                    />
                  </label>
                  <label className="rate-row__field">
                    <span className="rate-row__label">勘测费（元）</span>
                    <input
                      className="input"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      value={draft.surveyFee}
                      onChange={(e) =>
                        updateDraft({ surveyFee: e.target.value })
                      }
                    />
                  </label>
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-sm text-tertiary mt-sm">
          未配置的品牌按默认值计算（套包 30 米 / 安装 300 元 / 维修 60 元 /
          勘测 0 元），修改后自动保存生效。
        </p>
      </div>

      {/* 品牌结算价（同属费率配置组） */}
      <SettlementSection />
    </>
  );
}
