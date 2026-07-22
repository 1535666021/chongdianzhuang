/* ============================================================
 * 成本价目表设置页（v36.2-P2 扩展）
 * 功能：成本表增删改，支持实时保存到 localStorage
 * ============================================================ */

import { useState, useEffect } from "react";
import { Icon } from "@/components/common/Icon";
import { loadCostSheet, saveCostSheet } from "@/lib/storage";
import type { CostSheetItem } from "@/types";
import { generateId } from "@/lib/utils";

export function CostSheetSection() {
  const [items, setItems] = useState<CostSheetItem[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<CostSheetItem>>({});

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
    persist([...items, newItem]);
    setEditing(id);
    setDraft(newItem);
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
  };

  const saveEdit = () => {
    if (!editing || !draft.name || draft.costPrice == null) return;
    persist(
      items.map((i) =>
        i.id === editing
          ? {
              ...i,
              name: draft.name!,
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
        >
          <Icon name="plus" size={16} /> 新增
        </button>
      </div>
      <div className="settings-list">
        {items.length === 0 && (
          <div className="text-tertiary text-center py-4">
            暂无成本条目，点击右上角新增
          </div>
        )}
        {items.map((item) => (
          <div key={item.id} className="list-item">
            {editing === item.id ? (
              <div className="flex gap-2 flex-1 items-center">
                <input
                  className="input input--sm flex-1"
                  placeholder="材料名称"
                  value={draft.name || ""}
                  onChange={(e) =>
                    setDraft({ ...draft, name: e.target.value })
                  }
                />
                <input
                  className="input input--sm w-20"
                  placeholder="单位"
                  value={draft.unit || ""}
                  onChange={(e) =>
                    setDraft({ ...draft, unit: e.target.value })
                  }
                />
                <input
                  className="input input--sm w-24"
                  type="number"
                  placeholder="成本价"
                  value={draft.costPrice ?? ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      costPrice: Number(e.target.value),
                    })
                  }
                />
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  onClick={saveEdit}
                >
                  保存
                </button>
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={cancelEdit}
                >
                  取消
                </button>
              </div>
            ) : (
              <>
                <span className="list-item__main">
                  <span className="list-item__title">{item.name}</span>
                  <span className="list-item__desc">
                    {item.unit} / {item.costPrice}元
                  </span>
                </span>
                <span className="list-item__extra flex gap-2">
                  <button
                    type="button"
                    className="btn btn--icon"
                    onClick={() => startEdit(item)}
                  >
                    <Icon name="edit" size={16} />
                  </button>
                  <button
                    type="button"
                    className="btn btn--icon text-danger"
                    onClick={() => remove(item.id)}
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
