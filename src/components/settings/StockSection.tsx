/* ============================================================
 * 设置区块 · 充电桩仓库（挂载由 SettingsPage「充电桩仓库」二级页完成）
 * 功能：各品牌桩库存手填（总数），空串按 0 计，失焦即存
 * 规范：库存查询/增减走 inventory 模块（getStock/adjustStock/formatStock），
 *      读写走 storage（loadInventory/saveInventory），本组件不碰 localStorage
 * ============================================================ */

import { useEffect, useState } from "react";
import { useApp } from "@/context/AppContext";
import { adjustStock, formatStock, getStock } from "@/lib/inventory";
import { loadInventory, saveInventory } from "@/lib/storage";
import type { StockItem } from "@/types";

export function StockSection() {
  const { brands, showToast } = useApp();
  /* 库存快照（保存后同步更新，驱动「当前」列刷新） */
  const [inventory, setInventory] = useState<StockItem[]>([]);
  /* 各品牌输入框草稿（字符串态，空串 = 0），键 = 品牌名 */
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  /* 挂载时自 storage 初始化一次（二级页切换即重挂载重读，与其他区块同规） */
  useEffect(() => {
    const inv = loadInventory();
    setInventory(inv);
    const next: Record<string, string> = {};
    brands.forEach((b) => {
      next[b.name] = String(getStock(b.name, inv));
    });
    setDrafts(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- 失焦保存：空串按 0；与当前库存无差不写回 ---- */
  const handleBlur = (brandName: string) => {
    const raw = (drafts[brandName] ?? "").trim();
    const total = raw === "" ? 0 : Number(raw);
    if (!Number.isFinite(total)) {
      showToast("请填写正确数字");
      return;
    }
    const current = getStock(brandName, inventory);
    if (total === current) return;
    const next = adjustStock(brandName, total - current, inventory);
    saveInventory(next);
    setInventory(next);
    showToast("库存已保存");
  };

  return (
    <div className="card">
      <div className="card__title">充电桩仓库</div>
      <div className="flex-column gap-md">
        {brands.map((brand) => {
          const current = getStock(brand.name, inventory);
          return (
            <div key={brand.id} className="rate-row">
              <div className="rate-row__head">
                <span className="rate-row__brand">{brand.name}</span>
                <span className="text-sm text-tertiary">
                  当前 {formatStock(current)}
                </span>
              </div>
              <div className="rate-row__fields">
                <label className="rate-row__field">
                  <span className="rate-row__label">库存总数（台）</span>
                  <input
                    className="input"
                    type="number"
                    inputMode="numeric"
                    value={drafts[brand.name] ?? ""}
                    placeholder="0"
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [brand.name]: e.target.value,
                      }))
                    }
                    onBlur={() => handleBlur(brand.name)}
                  />
                </label>
              </div>
            </div>
          );
        })}
        <p className="text-sm text-tertiary mt-sm">
          手填各品牌桩库存总数，留空按 0 计，失焦自动保存；完工安装单自动 -1，库存为 0 的新安装单自动挂「需补桩」。
        </p>
      </div>
    </div>
  );
}
