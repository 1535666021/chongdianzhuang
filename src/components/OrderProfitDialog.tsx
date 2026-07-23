/* ============================================================
 * 订单盈亏核算弹窗
 * 从 order.fixedAux + completion.materials 读取材料明细
 * 计算成本合计、回款、利润
 * ============================================================ */

import { useState } from "react";
import { Modal } from "@/components/common/Modal";
import { useApp } from "@/context/AppContext";
import { OrderStatus } from "@/types";
import type { Order } from "@/types";

interface OrderProfitDialogProps {
  open: boolean;
  order: Order | null;
  onClose: () => void;
}

interface MaterialRow {
  name: string;
  unitPrice: number;
  quantity: number;
}

export function OrderProfitDialog({ open, order, onClose }: OrderProfitDialogProps) {
  const { showToast } = useApp();
  const [editMode, setEditMode] = useState(false);
  const [editRows, setEditRows] = useState<MaterialRow[]>([]);

  if (!open || !order) return null;

  // 从 fixedAux 构建材料行
  const fixedRows: MaterialRow[] = [];
  if (order.fixedAux) {
    const fa = order.fixedAux;
    if (fa.breakerPrice != null) {
      fixedRows.push({ name: `漏保 ${fa.breakerSpec}`, unitPrice: fa.breakerPrice, quantity: 1 });
    }
    if (fa.pvcPrice != null && fa.pvcMeters > 0) {
      fixedRows.push({ name: "PVC管", unitPrice: fa.pvcPrice, quantity: fa.pvcMeters });
    }
    if (fa.cablePrice != null && order.completion?.actualCable) {
      fixedRows.push({ name: "电缆", unitPrice: fa.cablePrice, quantity: order.completion.actualCable });
    } else if (fa.cablePrice != null) {
      fixedRows.push({ name: "电缆", unitPrice: fa.cablePrice, quantity: 1 });
    }
    if (fa.leakBoxPrice != null) {
      fixedRows.push({ name: "漏保盒", unitPrice: fa.leakBoxPrice, quantity: 1 });
    }
  }

  // 从 completion.materials 读取其他材料
  const otherRows: MaterialRow[] = (order.completion?.materials || []).map((m) => ({
    name: m.name,
    unitPrice: m.price,
    quantity: m.quantity ?? 1,
  }));

  const allRows = editMode ? editRows : [...fixedRows, ...otherRows];
  const totalCost = allRows.reduce((sum, r) => sum + r.unitPrice * r.quantity, 0);

  // 回款金额
  const profitData = order.completion?.profitData;
  const revenue = profitData ? (profitData.baseFee + profitData.customerPaid) : 0;
  const profit = revenue - totalCost;

  const handleSaveEdit = () => {
    setEditMode(false);
    showToast("材料明细已更新");
  };

  const addRow = () => setEditRows((prev) => [...prev, { name: "", unitPrice: 0, quantity: 1 }]);
  const patchRow = (i: number, patch: Partial<MaterialRow>) =>
    setEditRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeRow = (i: number) => setEditRows((prev) => prev.filter((_, idx) => idx !== i));

  return (
    <Modal
      open={open}
      title={`订单盈亏核算 · ${order.customerName}`}
      onClose={onClose}
      footer={
        editMode ? (
          <>
            <button type="button" className="btn btn--outline" onClick={() => setEditMode(false)}>
              取消
            </button>
            <button type="button" className="btn btn--primary" onClick={handleSaveEdit}>
              保存
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              setEditRows(allRows);
              setEditMode(true);
            }}
          >
            重新核算
          </button>
        )
      }
    >
      {/* 材料明细 */}
      <div className="flex-column gap-sm">
        {allRows.map((row, i) => (
          <div key={i} className="flex-between gap-sm">
            {editMode ? (
              <>
                <input
                  className="input flex-1"
                  value={row.name}
                  onChange={(e) => patchRow(i, { name: e.target.value })}
                />
                <input
                  className="input"
                  style={{ width: 80 }}
                  type="number"
                  value={row.unitPrice}
                  onChange={(e) => patchRow(i, { unitPrice: Number(e.target.value) })}
                />
                <input
                  className="input"
                  style={{ width: 60 }}
                  type="number"
                  value={row.quantity}
                  onChange={(e) => patchRow(i, { quantity: Number(e.target.value) })}
                />
                <button type="button" className="btn btn--danger-outline btn--sm" onClick={() => removeRow(i)}>
                  删
                </button>
              </>
            ) : (
              <>
                <span className="flex-1">{row.name}</span>
                <span className="text-sm text-secondary">
                  ¥{row.unitPrice} × {row.quantity}
                </span>
                <span className="text-sm text-bold">¥{(row.unitPrice * row.quantity).toFixed(2)}</span>
              </>
            )}
          </div>
        ))}
        {editMode && (
          <button type="button" className="btn btn--outline btn--sm" onClick={addRow}>
            + 新增行
          </button>
        )}
      </div>

      {/* 汇总 */}
      <div className="mt-md pt-md" style={{ borderTop: "1px solid var(--color-border)" }}>
        <div className="flex-between">
          <span>成本合计</span>
          <span className="text-bold">¥{totalCost.toFixed(2)}</span>
        </div>
        <div className="flex-between">
          <span>回款金额</span>
          <span className="text-bold">¥{revenue.toFixed(2)}</span>
        </div>
        <div className="flex-between mt-sm">
          <span className="text-lg">利润</span>
          <span className={`text-lg text-bold ${profit >= 0 ? "text-success" : "text-danger"}`}>
            {profit >= 0 ? `赚 ¥${profit.toFixed(2)}` : `赔 ¥${Math.abs(profit).toFixed(2)}`}
          </span>
        </div>
      </div>
    </Modal>
  );
}
