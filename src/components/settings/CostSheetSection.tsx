/* ============================================================
 * 成本价目表设置页（v36.2-P2 扩展 / v37-BUG02 修复）
 * 功能：成本表增删改，支持实时保存到 localStorage
 * 修复：新增按钮无响应 → 新增后自动聚焦+滚动+空态优化
 * ============================================================ */

import { useState, useEffect, useRef } from "react";
import { Icon } from "@/components/common/Icon";
import { loadCostSheet, saveCostSheet } from "@/lib/storage";
import type { CostSheetItem } from "@/types";
import { generateId } from "@/lib/utils";

export function CostSheetSection() {
  const [items, setItems] = useState<CostSheetItem[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<CostSheetItem>>({});
  const newItemRef = useRef<HTMLDivElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setItems(loadCostSheet());
  }, []);

  const persist = (next: CostSheetItem[]) => {
    setItems(next);
    saveCostSheet(next);
  };

  const add = () => {
    const id = generateId();
    const newItem: CostSheetItem = {
      id,
      name: "",
      unit: "米",
      costPrice: 0,
    };
    const next = [...items, newItem];
    persist(next);
    setEditing(id);
    setDraft(newItem);
    // 修复：新增后自动滚动并聚焦
    setTimeout(() => {
      newItemRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      nameInputRef.current?.focus();
    }, 50);
  };

  const remove = (id: string) => {
    persist(items.filter((i) => i.id !== id));
    if (editing === id) {
      setEditing(null);
      setDraft({});
    }
  };

  const startEdit = (item: CostSheetItem) => {
    setEditing(item.id);
    setDraft({ ...item });
    setTimeout(() => {
      nameInputRef.current?.focus();
    }, 50);
  };

  const saveEdit = () => {
    if (!editing || !draft.name || draft.name?.trim() === "" || draft.costPrice == null) {
      // 修复：空名称时提示，不静默失败
      if (!draft.name || draft.name?.trim() === "") {
        alert("请输入材料名称");
        nameInputRef.current?.focus();
      }
      return;
    }
    persist(
      items.map((i) =>
        i.id === editing
          ? {
              ...i,
              name: draft.name?.trim() || "",
              unit: draft.unit || "米",
              costPrice: Number(draft.costPrice) || 0,
            }
          : i,
      ),
    );
    setEditing(null);
    setDraft({});
  };

  const cancelEdit = () => {
    // 修复：取消编辑时，如果是空名称的新项，直接删除
    if (editing) {
      const item = items.find((i) => i.id === editing);
      if (item && item.name?.trim() === "") {
        persist(items.filter((i) => i.id !== editing));
      }
    }
    setEditing(null);
    setDraft({});
  };

  return (
    <div className="settings-section">
      <div className="settings-section__header">
        <h3>成本价目表</h3>
        <button
          type="button"
          className="btn btn--primary btn--sm"
          onClick={add}
          title="新增成本条目"
        >
          <Icon name="plus" size={16} /> 新增
        </button>
      </div>
      <div className="settings-list">
        {items.length === 0 && (
          <div className="text-tertiary text-center py-4">
            暂无成本条目，点击右上角「新增」添加
          </div>
        )}
        {items.map((item) => (
          <div
            key={item.id}
            className="list-item"
            ref={editing === item.id ? newItemRef : undefined}
          >
            {editing === item.id ? (
              <div className="flex gap-2 flex-1 items-center" style={{ flexWrap: "wrap" }}>
                <input
                  ref={nameInputRef}
                  className="input input--sm"
                  placeholder="材料名称（必填）"
                  value={draft.name || ""}
                  autoFocus
                  style={{ flex: "2 1 120px", minWidth: "100px", fontSize: "14px" }}
                  onChange={(e) =>
                    setDraft({ ...draft, name: e.target.value })
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveEdit();
                  }}
                />
                <input
                  className="input input--sm"
                  placeholder="单位"
                  value={draft.unit || ""}
                  style={{ width: "48px", textAlign: "center", fontSize: "14px" }}
                  onChange={(e) =>
                    setDraft({ ...draft, unit: e.target.value })
                  }
                />
                <input
                  className="input input--sm"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  placeholder="成本价"
                  value={draft.costPrice ?? ""}
                  style={{ width: "72px", fontSize: "14px" }}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      costPrice: e.target.value === "" ? undefined : Number(e.target.value),
                    })
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveEdit();
                  }}
                />
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  onClick={saveEdit}
                  style={{ padding: "6px 10px", fontSize: "13px" }}
                >
                  保存
                </button>
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={cancelEdit}
                  style={{ padding: "6px 10px", fontSize: "13px" }}
                >
                  取消
                </button>
              </div>
            ) : (
              <>
                <span className="list-item__main">
                  <span className="list-item__title">
                    {item.name || <span className="text-tertiary">（未命名）</span>}
                  </span>
                  <span className="list-item__desc">
                    {item.unit} / {item.costPrice}元
                  </span>
                </span>
                <span className="list-item__extra flex gap-2">
                  <button
                    type="button"
                    className="btn btn--icon"
                    onClick={() => startEdit(item)}
                    title="编辑"
                  >
                    <Icon name="edit" size={16} />
                  </button>
                  <button
                    type="button"
                    className="btn btn--icon text-danger"
                    onClick={() => remove(item.id)}
                    title="删除"
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </span>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
