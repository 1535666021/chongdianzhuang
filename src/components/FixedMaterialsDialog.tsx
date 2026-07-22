/* ============================================================
 * 固定辅材弹窗子窗口（v36.2-P3：成本核算全面走成本表）
 * 功能：漏保规格选择 + PVC米数 + 成本表价格联动
 * 规范：业务逻辑收敛 src/lib，本组件只做渲染交互
 * ============================================================ */

import { useState, useEffect } from "react";
import { Icon } from "@/components/common/Icon";
import { loadCostSheet } from "@/lib/storage";
import type { FixedAuxSelection, Order, CostSheetItem } from "@/types";
import {
  BREAKER_SPECS,
  findBreakerPriceFromCostSheet,
} from "@/lib/fixedAux";
import { findCostSheetPrice } from "@/lib/costMapping";
import { CostSheetPicker } from "@/components/CostSheetPicker";
import type { CostSheetItem as CostSheetItemType } from "@/types";

interface FixedMaterialsDialogProps {
  open?: boolean;
  order?: Order;
  brandName?: string;
  init?: FixedAuxSelection;
  cableMeters: number;
  onConfirm?: (sel: FixedAuxSelection) => void;
  onCancel?: () => void;
  onSave?: (sel: FixedAuxSelection) => void;
  onClose?: () => void;
}

export function FixedMaterialsDialog({
  open,
  order,
  brandName: _brandName,
  init,
  cableMeters,
  onConfirm,
  onCancel,
  onSave,
  onClose,
}: FixedMaterialsDialogProps) {
  if (!open) return null;
  const resolvedInit = init ?? order?.fixedAux ?? { breakerSpec: "C40", breakerPrice: null, pvcMeters: cableMeters };
  const [spec, setSpec] = useState(resolvedInit.breakerSpec);
  const [breakerPrice, setBreakerPrice] = useState("");
  const [pvcMeters, setPvcMeters] = useState(resolvedInit.pvcMeters);
  const [costSheet, setCostSheet] = useState<CostSheetItem[]>([]);
  const [manuallyBound, setManuallyBound] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    setCostSheet(loadCostSheet());
  }, []);

  useEffect(() => {
    /* 任务v36.1 FAIL-3：未匹配价格=null → 价格框置空（严禁自动填兜底数） */
    const target = init ?? order?.fixedAux;
    if (!target) return;
    setBreakerPrice(
      target.breakerPrice != null ? String(target.breakerPrice) : "",
    );
    setSpec(target.breakerSpec);
    setPvcMeters(target.pvcMeters);
    /* v36.2-P3：判断绑定状态（成本表命中=已绑定） */
    const costPrice = findCostSheetPrice(`漏保 ${target.breakerSpec}`, costSheet);
    setManuallyBound(costPrice !== null);
  }, [init, order?.fixedAux, costSheet]);

  /* 切换规格时重置手动绑定状态 */
  useEffect(() => {
    setManuallyBound(false);
  }, [spec]);

  /* 换规格：价格联动——查成本表（v36.2-P3 成本结算统一走成本表） */
  useEffect(() => {
    const costPrice = findCostSheetPrice(`漏保 ${spec}`, costSheet);
    if (costPrice !== null) {
      setBreakerPrice(String(costPrice));
      setManuallyBound(true);
    }
    /* 成本表未命中：不自动填充，保留当前值（init传入或用户手改） */
  }, [spec, costSheet]);

  const handleConfirm = () => {
    /* 空框=未匹配（null），成本按 0 计；不兜底 */
    const sel: FixedAuxSelection = {
      breakerSpec: spec,
      breakerPrice:
        breakerPrice.trim() === "" ? null : Number(breakerPrice),
      pvcMeters,
    };
    if (onSave) onSave(sel);
    else if (onConfirm) onConfirm(sel);
  };

  const handleSelectFromPicker = (item: CostSheetItemType) => {
    setBreakerPrice(String(item.costPrice));
    setManuallyBound(true);
    setShowPicker(false);
  };

  /* 绑定状态：成本表命中或用户手动选择后 */
  const isBound = manuallyBound;

  return (
    <div className="modal-mask" style={{ zIndex: 150 }} onClick={() => { if (onClose) onClose(); else if (onCancel) onCancel(); }}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h3>固定辅材</h3>
          <button
            type="button"
            className="modal__close"
            onClick={() => { if (onClose) onClose(); else if (onCancel) onCancel(); }}
          >
            <Icon name="x" size={20} />
          </button>
        </div>
        <div className="modal__body">
          {/* 漏保规格 */}
          <div className="form-field">
            <label className="form-field__label">漏保规格</label>
            <div className="flex gap-2">
              {BREAKER_SPECS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`btn ${spec === s ? "btn--primary" : ""}`}
                  onClick={() => setSpec(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* 漏保单价 */}
          <div className="form-field">
            <label className="form-field__label">
              漏保单价（元，换规格自动匹配，可手改）
            </label>
            <input
              className="input"
              type="number"
              placeholder="未匹配"
              value={breakerPrice}
              onChange={(e) => setBreakerPrice(e.target.value)}
            />
            {/* v36.2-P3：绑定状态基于成本表是否命中 */}
            {isBound ? (
              <span className="text-success text-sm">已绑定</span>
            ) : (
              <span
                className="text-danger text-sm cursor-pointer"
                onClick={() => setShowPicker(true)}
              >
                未绑定，点击选择成本条目
              </span>
            )}
          </div>

          {/* PVC 管米数 */}
          <div className="form-field">
            <label className="form-field__label">PVC 管（米）</label>
            <input
              className="input"
              type="number"
              value={pvcMeters}
              onChange={(e) =>
                setPvcMeters(Number(e.target.value) || 0)
              }
            />
          </div>

          {/* 漏保盒（v36.2-P3：原扎带+胶带辅材包改名） */}
          <div className="form-field">
            <label className="form-field__label">漏保盒</label>
            <div className="text-tertiary">
              成本表定价
            </div>
          </div>
        </div>
        <div className="modal__footer">
          <button
            type="button"
            className="btn"
            onClick={() => { if (onClose) onClose(); else if (onCancel) onCancel(); }}
          >
            取消
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={handleConfirm}
          >
            确认
          </button>
        </div>
      </div>

      {showPicker && (
        <CostSheetPicker
          materialName={`漏保 ${spec}`}
          onSelect={handleSelectFromPicker}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}
