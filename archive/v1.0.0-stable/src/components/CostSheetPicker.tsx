/* ============================================================
 * 成本表选择弹窗（v36.2-P2 扩展）
 * 功能：材料未绑定时弹出，支持从成本表选择或新增条目
 * ============================================================ */

import { useState, useEffect } from "react";
import { Icon } from "@/components/common/Icon";
import { loadCostSheet, saveCostSheet } from "@/lib/storage";
import type { CostSheetItem } from "@/types";
import { generateId } from "@/lib/utils";

interface CostSheetPickerProps {
  /** 要绑定的材料名称（弹窗标题和默认值） */
  materialName: string;
  /** 选中后回调 */
  onSelect: (item: CostSheetItem) => void;
  /** 关闭弹窗 */
  onClose: () => void;
}

export function CostSheetPicker({
  materialName,
  onSelect,
  onClose,
}: CostSheetPickerProps) {
  const [items, setItems] = useState<CostSheetItem[]>([]);
  const [search, setSearch] = useState(materialName);
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState<Partial<CostSheetItem>>({
    name: materialName,
    unit: "米",
    costPrice: 0,
  });

  useEffect(() => {
    setItems(loadCostSheet());
  }, []);

  const filtered = items.filter((i) =>
    i.name.toLowerCase().includes(search.toLowerCase()),
  );

  const handleSelect = (item: CostSheetItem) => {
    onSelect(item);
    onClose();
  };

  const handleAdd = () => {
    if (!draft.name || draft.costPrice == null) return;
    const newItem: CostSheetItem = {
      id: generateId(),
      name: draft.name,
      unit: draft.unit || "米",
      costPrice: Number(draft.costPrice) || 0,
    };
    const next = [...items, newItem];
    setItems(next);
    saveCostSheet(next);
    setShowAdd(false);
    onSelect(newItem);
    onClose();
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog__header">
          <h3>选择成本条目 — {materialName}</h3>
          <button
            type="button"
            className="btn btn--icon"
            onClick={onClose}
          >
            <Icon name="x" size={20} />
          </button>
        </div>
        <div className="dialog__body">
          <input
            className="input mb-3"
            placeholder="搜索成本条目..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="list">
            {filtered.map((item) => (
              <button
                key={item.id}
                type="button"
                className="list-item copyable"
                onClick={() => handleSelect(item)}
              >
                <span className="list-item__main">
                  <span className="list-item__title">{item.name}</span>
                  <span className="list-item__desc">
                    {item.unit} / {item.costPrice}元
                  </span>
                </span>
                <span className="list-item__extra">
                  <Icon name="check" size={16} />
                </span>
              </button>
            ))}
            {filtered.length === 0 && !showAdd && (
              <div className="text-tertiary text-center py-4">
                无匹配条目
                <button
                  type="button"
                  className="btn btn--link btn--sm ml-2"
                  onClick={() => setShowAdd(true)}
                >
                  新增绑定
                </button>
              </div>
            )}
          </div>
          {showAdd && (
            <div className="card mt-3">
              <h4>新增成本条目</h4>
              <div className="flex gap-2 mt-2">
                <input
                  className="input flex-1"
                  placeholder="材料名称"
                  value={draft.name || ""}
                  onChange={(e) =>
                    setDraft({ ...draft, name: e.target.value })
                  }
                />
                <input
                  className="input w-20"
                  placeholder="单位"
                  value={draft.unit || ""}
                  onChange={(e) =>
                    setDraft({ ...draft, unit: e.target.value })
                  }
                />
                <input
                  className="input w-24"
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
              </div>
              <div className="flex gap-2 mt-2 justify-end">
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => setShowAdd(false)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  onClick={handleAdd}
                >
                  保存并绑定
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
