/* ============================================================
 * 设置区块 · 品牌结算价（cp_brand_prices，v7 承接 30 条）
 * （挂载由 RatesSection 完成，同属设置页「费率配置」二级页）
 * 职责：结算价列表展示（品牌名 + 20米/30米套包安装 + 维修结算三档）、
 *      编辑自动保存（upsert 整体落库）、手动新增品牌行
 * 输入即存：去掉「保存结算价」按钮，编辑/新增/删除后防抖（500ms）自动保存
 *      + toast「已保存」；落库逻辑不变——逐行校验后整体 upsert 写回
 * 规范：全部读写走 storage 封装（loadBrandPrices/saveBrandPrices），
 *      本组件不碰 localStorage；价格为字符串草稿态，保存时才转 number；
 *      结算价如何参与利润计算由 lib/serviceFee.ts 裁决，视图层不算费用
 * ============================================================ */

import { useState } from "react";
import type { BrandPrice } from "@/types";
import { useApp } from "@/context/AppContext";
import { loadBrandPrices, saveBrandPrices } from "@/lib/storage";
import { useDebouncedCallback } from "@/components/settings/useDebouncedCallback";

/* ------------------------------------------------------------
 * 草稿模型与解析工具（价格字符串态，保存时才转 number）
 * ------------------------------------------------------------ */

/** 结算价行草稿：三个价格以字符串暂存，允许输入中态（空串/小数点） */
interface SettlementRowDraft {
  brand: string;
  install20m: string;
  install30m: string;
  repairSettlement: string;
}

/** 价格字段描述：驱动行内三个数字输入框，避免三处重复 JSX */
const PRICE_FIELDS = [
  { key: "install20m", label: "20米套包安装（元/台）" },
  { key: "install30m", label: "30米套包安装（元/台）" },
  { key: "repairSettlement", label: "维修结算（元/台）" },
] as const;

type PriceFieldKey = (typeof PRICE_FIELDS)[number]["key"];

const EMPTY_ROW_DRAFT: SettlementRowDraft = {
  brand: "",
  install20m: "",
  install30m: "",
  repairSettlement: "",
};

/** 价格展示：清理浮点尾差（300.00000000000006 → "300"），非法值给空串 */
function formatPrice(n: number): string {
  if (!Number.isFinite(n)) return "";
  return String(Math.round(n * 100) / 100);
}

/**
 * 价格解析：留空按 0 处理（0 = 未设置，利润计算时该档回退品牌费率）；
 * 非法（非数字/负数/非有限）返回 null
 */
function parsePrice(raw: string): number | null {
  const text = raw.trim();
  if (text === "") return 0;
  const num = Number(text);
  if (!Number.isFinite(num) || num < 0) return null;
  return num;
}

/** 从 storage 加载结算价列表为草稿行 */
function readSettlementDrafts(): SettlementRowDraft[] {
  return loadBrandPrices().map((p) => ({
    brand: p.brand,
    install20m: formatPrice(p.install20m),
    install30m: formatPrice(p.install30m),
    repairSettlement: formatPrice(p.repairSettlement),
  }));
}

/* ------------------------------------------------------------
 * 区块组件
 * ------------------------------------------------------------ */

export function SettlementSection(): JSX.Element {
  const { showToast } = useApp();

  /* 结算价行草稿 + 新增行草稿（编辑只改内存，防抖 500ms 后自动落库） */
  const [rows, setRows] = useState<SettlementRowDraft[]>(readSettlementDrafts);
  const [newRow, setNewRow] = useState<SettlementRowDraft>(EMPTY_ROW_DRAFT);

  /* ---- 输入即存：防抖 500ms 自动保存（原「保存结算价」统一校验+upsert
   *      落库逻辑不变；任一行非法则整批不落库并提示，与原保存行为一致） ---- */
  const persist = useDebouncedCallback(() => {
    const prices: BrandPrice[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const brand = row.brand.trim();
      if (!brand) {
        showToast("存在未填写品牌名称的行，请删除后再保存");
        return;
      }
      if (seen.has(brand)) {
        showToast(`品牌「${brand}」重复，请合并后再保存`);
        return;
      }
      seen.add(brand);
      const install20m = parsePrice(row.install20m);
      const install30m = parsePrice(row.install30m);
      const repairSettlement = parsePrice(row.repairSettlement);
      if (
        install20m === null ||
        install30m === null ||
        repairSettlement === null
      ) {
        showToast(`「${brand}」的价格请填写不小于 0 的数字`);
        return;
      }
      prices.push({ brand, install20m, install30m, repairSettlement });
    }
    if (!saveBrandPrices(prices)) {
      showToast("保存失败，请重试");
      return;
    }
    showToast("已保存");
  });

  /* ---- 行编辑 / 删除（改动后触发防抖自动保存） ---- */
  const handleRowChange = (
    index: number,
    key: PriceFieldKey,
    value: string,
  ) => {
    setRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [key]: value } : row)),
    );
    persist();
  };

  const handleDeleteRow = (index: number) => {
    setRows((prev) => prev.filter((_, i) => i !== index));
    persist();
  };

  /* ---- 新增行：品牌名必填、三价留空按 0、不与现有行重名（校验不变） ---- */
  const handleAddRow = () => {
    const brand = newRow.brand.trim();
    if (!brand) {
      showToast("请填写品牌名称");
      return;
    }
    if (rows.some((row) => row.brand.trim() === brand)) {
      showToast(`品牌「${brand}」已存在`);
      return;
    }
    for (const field of PRICE_FIELDS) {
      if (parsePrice(newRow[field.key]) === null) {
        showToast(`「${field.label}」请填写不小于 0 的数字`);
        return;
      }
    }
    setRows((prev) => [
      ...prev,
      {
        brand,
        install20m: String(parsePrice(newRow.install20m)),
        install30m: String(parsePrice(newRow.install30m)),
        repairSettlement: String(parsePrice(newRow.repairSettlement)),
      },
    ]);
    setNewRow(EMPTY_ROW_DRAFT);
    persist();
  };

  return (
    <div className="card">
      <div className="card__title">品牌结算价</div>

      <div className="flex-column gap-md mt-md">
        {rows.map((row, index) => (
          <div key={index} className="rate-row">
            <div className="rate-row__head">
              <span className="rate-row__brand">
                {row.brand.trim() || "未命名品牌"}
              </span>
              <button
                type="button"
                className="btn btn--danger-outline btn--sm"
                onClick={() => handleDeleteRow(index)}
              >
                删除
              </button>
            </div>
            <div className="rate-row__fields">
              {PRICE_FIELDS.map((field) => (
                <label key={field.key} className="rate-row__field">
                  <span className="rate-row__label">{field.label}</span>
                  <input
                    className="input"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="1"
                    value={row[field.key]}
                    placeholder="0"
                    onChange={(e) =>
                      handleRowChange(index, field.key, e.target.value)
                    }
                  />
                </label>
              ))}
            </div>
          </div>
        ))}

        {/* 新增品牌行（加入列表后随防抖自动保存生效） */}
        <div className="cost-map-row cost-map-row--new">
          <div className="cost-map-row__main">
            <input
              className="input"
              value={newRow.brand}
              placeholder="新品牌名称（与订单品牌名一致）"
              onChange={(e) =>
                setNewRow((prev) => ({ ...prev, brand: e.target.value }))
              }
            />
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={handleAddRow}
            >
              添加
            </button>
          </div>
          <div className="rate-row__fields">
            {PRICE_FIELDS.map((field) => (
              <label key={field.key} className="rate-row__field">
                <span className="rate-row__label">{field.label}</span>
                <input
                  className="input"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="1"
                  value={newRow[field.key]}
                  placeholder="0"
                  onChange={(e) =>
                    setNewRow((prev) => ({
                      ...prev,
                      [field.key]: e.target.value,
                    }))
                  }
                />
              </label>
            ))}
          </div>
        </div>
      </div>

      <p className="text-sm text-tertiary mt-sm">
        按品牌名与订单品牌全等匹配；命中品牌且对应档位价格大于 0
        时按结算价计算服务费，未命中或价格为 0 时回退品牌费率（勘测费始终取品牌费率）。价格留空按
        0 保存。
      </p>
    </div>
  );
}
