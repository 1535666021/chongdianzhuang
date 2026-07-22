/* ============================================================
 * 固定辅材弹窗子窗口（v36.2-P2 扩展：未绑定点击弹出成本表选择）
 * 功能：漏保规格选择 + PVC米数 + 成本表价格联动
 * 规范：业务逻辑收敛 src/lib，本组件只做渲染交互
 * ============================================================ */

import { useState, useEffect } from "react";
import { Icon } from "@/components/common/Icon";
import { loadMaterialsLib } from "@/lib/storage";
import type { FixedAuxSelection, MaterialItemLib } from "@/types";
import {
  BREAKER_SPECS,
  findBreakerPrice,
  TIE_TAPE_PACK_PRICE,
} from "@/lib/fixedAux";
import { CostSheetPicker } from "@/components/CostSheetPicker";
import type { CostSheetItem } from "@/types";

interface FixedMaterialsDialogProps {
  init: FixedAuxSelection;
  cableMeters: number;
  onConfirm: (sel: FixedAuxSelection) => void;
  onCancel: () => void;
}

export function FixedMaterialsDialog({
  init,
  cableMeters,
  onConfirm,
  onCancel,
}: FixedMaterialsDialogProps) {
  const [spec, setSpec] = useState(init.breakerSpec);
  const [breakerPrice, setBreakerPrice] = useState("");
  const [pvcMeters, setPvcMeters] = useState(init.pvcMeters);
  const [lib, setLib] = useState<MaterialItemLib[]>([]);
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    setLib(loadMaterialsLib());
  }, []);

  useEffect(() => {
    /* 任务v36.1 FAIL-3：未匹配价格=null → 价格框置空（严禁自动填兜底数） */
    setBreakerPrice(
      init.breakerPrice != null ? String(init.breakerPrice) : "",
    );
    setSpec(init.breakerSpec);
    setPvcMeters(init.pvcMeters);
  }, [init]);

  /* 换规格：价格联动——查材料库 */
  useEffect(() => {
    const matched = findBreakerPrice(spec, lib);
    if (matched !== null) {
      setBreakerPrice(String(matched));
    }
  }, [spec, lib]);

  const handleConfirm = () => {
    /* 空框=未匹配（null），成本按 0 计；不兜底 */
    const sel: FixedAuxSelection = {
      breakerSpec: spec,
      breakerPrice:
        breakerPrice.trim() === "" ? null : Number(breakerPrice),
      pvcMeters,
    };
    onConfirm(sel);
  };

  const handleSelectFromPicker = (item: CostSheetItem) => {
    setBreakerPrice(String(item.costPrice));
    setShowPicker(false);
  };

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog__header">
          <h3>固定辅材</h3>
          <button
            type="button"
            className="btn btn--icon"
            onClick={onCancel}
          >
            <Icon name="x" size={20} />
          </button>
        </div>
        <div className="dialog__body">
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
            {/* v36.2-P2：未匹配时显示「未绑定」，点击弹出成本表选择 */}
            {breakerPrice.trim() === "" ? (
              <span
                className="text-danger text-sm cursor-pointer"
                onClick={() => setShowPicker(true)}
              >
                未绑定，点击选择成本条目
              </span>
            ) : (
              <span className="text-success text-sm">已绑定</span>
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

          {/* 扎带+胶带（固定价，只展示） */}
          <div className="form-field">
            <label className="form-field__label">扎带+胶带辅材包</label>
            <div className="text-tertiary">
              固定价 {TIE_TAPE_PACK_PRICE} 元
            </div>
          </div>
        </div>
        <div className="dialog__footer">
          <button
            type="button"
            className="btn"
            onClick={onCancel}
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
