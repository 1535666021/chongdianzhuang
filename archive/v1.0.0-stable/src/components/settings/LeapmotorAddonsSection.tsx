/* ============================================================
 * 设置区块 · 零跑增项模板（挂载由 SettingsPage「零跑增项模板」二级页完成）
 * 功能：维护零跑增项模板条目（名称/短名/单位/单价），行编辑改草稿、失焦整存；
 *      短名留空=按全称自动压缩（autoShortName），顶部输入添加（id 自生成
 *      leap-custom- 前缀），底部可重置回默认 36 条（默认模板自带精修短名）
 * 规范：读写走 storage 封装（loadLeapmotorAddons / saveLeapmotorAddons），
 *      默认模板取自 leapmotorAddons 模块（DEFAULT_LEAPMOTOR_ADDONS），
 *      本组件只渲染，不直触本地存储
 * ============================================================ */

import { useEffect, useState } from "react";
import { useApp } from "@/context/AppContext";
import { DEFAULT_LEAPMOTOR_ADDONS } from "@/lib/leapmotorAddons";
import { autoShortName } from "@/lib/addonShortName";
import { loadLeapmotorAddons, saveLeapmotorAddons } from "@/lib/storage";
import type { LeapmotorAddon } from "@/types";

export function LeapmotorAddonsSection() {
  const { showToast } = useApp();
  /* 条目草稿（挂载时自 storage 初始化一次；行编辑只改草稿，失焦整存） */
  const [items, setItems] = useState<LeapmotorAddon[]>([]);
  /* 添加区输入草稿（字符串态；短名可选留空=自动压缩；单价添加时转数校验） */
  const [newName, setNewName] = useState("");
  const [newShortName, setNewShortName] = useState("");
  const [newUnit, setNewUnit] = useState("");
  const [newPrice, setNewPrice] = useState("");

  /* 挂载时自 storage 初始化一次（二级页切换即重挂载重读，与其他区块同规） */
  useEffect(() => {
    setItems(loadLeapmotorAddons());
  }, []);

  /* ---- 统一保存：更新草稿 + 整存 + toast（行失焦保存走此） ---- */
  const persist = (next: LeapmotorAddon[]) => {
    setItems(next);
    saveLeapmotorAddons(next);
    showToast("模板已保存");
  };

  /* ---- 行编辑：只改草稿，失焦时由 onBlur 统一 persist ---- */
  const patchItem = (id: string, patch: Partial<LeapmotorAddon>) => {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, ...patch } : it)),
    );
  };

  /* ---- 短名失焦保存：空串=删 shortName 键回自动压缩；非空=存 trim 后短名 ---- */
  const handleShortNameBlur = (id: string) => {
    const next = items.map((it) => {
      if (it.id !== id) return it;
      const s = (it.shortName ?? "").trim();
      if (s === "") {
        const { shortName: _omit, ...rest } = it;
        return rest;
      }
      return { ...it, shortName: s };
    });
    persist(next);
  };

  /* ---- 添加：校验名称非空、单价有限数 ≥0；短名非空才写入；id 自生成后立即整存 ---- */
  const handleAdd = () => {
    const name = newName.trim();
    const shortName = newShortName.trim();
    const price = Number(newPrice);
    if (name === "") {
      showToast("请填写名称");
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      showToast("请填写正确单价");
      return;
    }
    const next: LeapmotorAddon[] = [
      ...items,
      {
        id: `leap-custom-${Date.now()}`,
        name,
        ...(shortName !== "" ? { shortName } : {}),
        unit: newUnit.trim() || "项",
        price,
      },
    ];
    setItems(next);
    saveLeapmotorAddons(next);
    showToast("已添加");
    setNewName("");
    setNewShortName("");
    setNewUnit("");
    setNewPrice("");
  };

  /* ---- 删除该行并立即整存 ---- */
  const handleDelete = (id: string) => {
    const next = items.filter((it) => it.id !== id);
    setItems(next);
    saveLeapmotorAddons(next);
    showToast("已删除");
  };

  /* ---- 重置回默认 36 条（默认模板来自 lib/leapmotorAddons） ---- */
  const handleReset = () => {
    const next = [...DEFAULT_LEAPMOTOR_ADDONS];
    setItems(next);
    saveLeapmotorAddons(next);
    showToast("已重置为默认 36 条");
  };

  return (
    <div className="card">
      <div className="card__title">零跑增项模板</div>
      <div className="flex-column gap-md">
        <p className="text-sm text-tertiary">
          零跑订单勘测/完工登记时，增项区可从本模板快速勾选带出；改价/增删即时生效，恢复出厂回到默认
          36 条。短名用于增项选择列表显示（短名+¥单价/单位）；正式单据/话术仍用全称，留空按全称自动压缩。
        </p>

        {/* 添加区：名称 + 短名（可选窄列）+ 单位（窄列）+ 单价（窄列）+ 添加按钮 */}
        <div className="card card--flat">
          <div className="flex gap-sm">
            <input
              className="input flex-1"
              type="text"
              value={newName}
              placeholder="名称"
              onChange={(e) => setNewName(e.target.value)}
            />
            <input
              className="input shipment-preview__qty"
              type="text"
              value={newShortName}
              placeholder="短名(可选)"
              onChange={(e) => setNewShortName(e.target.value)}
            />
            <input
              className="input shipment-preview__qty"
              type="text"
              value={newUnit}
              placeholder="单位"
              onChange={(e) => setNewUnit(e.target.value)}
            />
            <input
              className="input shipment-preview__qty"
              type="number"
              inputMode="decimal"
              value={newPrice}
              placeholder="单价"
              onChange={(e) => setNewPrice(e.target.value)}
            />
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={handleAdd}
            >
              添加
            </button>
          </div>
        </div>

        {/* 条目列表：每条目一行，行编辑改草稿、失焦整存；短名留空=回自动压缩 */}
        {items.map((item) => (
          <div key={item.id} className="rate-row">
            <div className="flex gap-sm">
              <input
                className="input flex-1"
                type="text"
                value={item.name}
                onChange={(e) => patchItem(item.id, { name: e.target.value })}
                onBlur={() => persist(items)}
              />
              <input
                className="input shipment-preview__qty"
                type="text"
                value={item.shortName ?? ""}
                placeholder={autoShortName(item.name)}
                onChange={(e) =>
                  patchItem(item.id, { shortName: e.target.value })
                }
                onBlur={() => handleShortNameBlur(item.id)}
              />
              <input
                className="input shipment-preview__qty"
                type="text"
                value={item.unit}
                onChange={(e) => patchItem(item.id, { unit: e.target.value })}
                onBlur={() => persist(items)}
              />
              <input
                className="input shipment-preview__qty"
                type="number"
                inputMode="decimal"
                value={item.price}
                onChange={(e) => {
                  const nextPrice = Number(e.target.value);
                  patchItem(item.id, {
                    price: Number.isFinite(nextPrice) ? nextPrice : 0,
                  });
                }}
                onBlur={() => persist(items)}
              />
              <button
                type="button"
                className="btn btn--danger-outline btn--sm"
                onClick={() => handleDelete(item.id)}
              >
                删
              </button>
            </div>
          </div>
        ))}

        {/* 底部：重置回默认 36 条 + 当前条数 */}
        <button
          type="button"
          className="btn btn--outline"
          onClick={handleReset}
        >
          重置为默认 36 条
        </button>
        <p className="text-sm text-tertiary mt-sm">当前共 {items.length} 条</p>
      </div>
    </div>
  );
}
