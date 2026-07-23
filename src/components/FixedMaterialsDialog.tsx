/* ============================================================
 * 固定辅材弹窗子窗口（v36.2-P12：三区域统一走 CostBindField 模块）
 * 功能：漏保规格选择 + 漏保单价绑定 + 电缆绑定 + PVC米数 + 漏保盒绑定
 * 规范：业务逻辑收敛 src/lib，本组件只做渲染交互
 * ============================================================ */

import { useState, useEffect } from "react";
import { Modal } from "@/components/common/Modal";
import { CostBindField } from "@/components/common/CostBindField";
import { loadCostSheet } from "@/lib/storage";
import { fuzzySearchCostSheet, fuzzyFindCostSheetPrice } from "@/lib/costMapping";
import { getGlobalBinding, setGlobalBinding, costSheetItemToBinding } from "@/lib/globalMaterialConfig";
import type { FixedAuxSelection, Order, CostSheetItem } from "@/types";
import {
  BREAKER_SPECS,
  findBreakerPriceFromCostSheet,
} from "@/lib/fixedAux";

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

  const resolvedInit = init ?? order?.fixedAux ?? {
    breakerSpec: "C40",
    breakerPrice: null,
    pvcMeters: cableMeters,
    leakBoxPrice: null,
  };

  const [spec, setSpec] = useState(resolvedInit.breakerSpec);
  const [breakerPrice, setBreakerPrice] = useState("");
  const [breakerBoundName, setBreakerBoundName] = useState("");
  const [pvcMeters, setPvcMeters] = useState(resolvedInit.pvcMeters);
  const [pvcPrice, setPvcPrice] = useState("");
  const [pvcBoundName, setPvcBoundName] = useState("");
  const [cablePrice, setCablePrice] = useState("");
  const [cableBoundName, setCableBoundName] = useState("");
  const [leakBoxPrice, setLeakBoxPrice] = useState("");
  const [leakBoxBoundName, setLeakBoxBoundName] = useState("");
  const [costSheet, setCostSheet] = useState<CostSheetItem[]>([]);

  useEffect(() => {
    setCostSheet(loadCostSheet());
  }, []);

  /* 初始化回填（含绑定名称） */
  useEffect(() => {
    const target = init ?? order?.fixedAux;
    if (!target) return;
    setBreakerPrice(target.breakerPrice != null ? String(target.breakerPrice) : "");
    setBreakerBoundName(target.breakerBoundName ?? "");
    setSpec(target.breakerSpec);
    setPvcMeters(target.pvcMeters);
    setPvcPrice(target.pvcPrice != null ? String(target.pvcPrice) : "");
    setPvcBoundName(target.pvcBoundName ?? "");
    setCablePrice(target.cablePrice != null ? String(target.cablePrice) : "");
    setCableBoundName(target.cableBoundName ?? "");
    setLeakBoxPrice(target.leakBoxPrice != null ? String(target.leakBoxPrice) : "");
    setLeakBoxBoundName(target.leakBoxBoundName ?? "");
  }, [init, order?.fixedAux]);

  /* 换规格：漏保价格联动查成本表 */
  useEffect(() => {
    const costPrice = findBreakerPriceFromCostSheet(spec, costSheet);
    if (costPrice !== null) {
      setBreakerPrice(String(costPrice));
      setBreakerBoundName(`漏保 ${spec}`);
    }
  }, [spec, costSheet]);

  /* 自动搜索绑定：弹窗打开时，对各项固定辅材在成本表中自动搜索 */
  useEffect(() => {
    if (costSheet.length === 0) return;

    // 1. PVC自动搜索（搜索词："PVC"）
    if (!pvcBoundName && !pvcPrice) {
      const pvcItem = fuzzySearchCostSheet("PVC", costSheet);
      if (pvcItem) {
        setPvcPrice(String(pvcItem.costPrice));
        setPvcBoundName(pvcItem.name);
        setGlobalBinding("PVC", costSheetItemToBinding(pvcItem));
      }
    }

    // 2. 电缆自动搜索（搜索词："电缆"）
    if (!cableBoundName && !cablePrice) {
      const cableItem = fuzzySearchCostSheet("电缆", costSheet);
      if (cableItem) {
        setCablePrice(String(cableItem.costPrice));
        setCableBoundName(cableItem.name);
        setGlobalBinding("电缆", costSheetItemToBinding(cableItem));
      }
    }

    // 3. 漏保盒自动搜索（搜索词："漏保盒"）
    if (!leakBoxBoundName && !leakBoxPrice) {
      const boxItem = fuzzySearchCostSheet("漏保盒", costSheet);
      if (boxItem) {
        setLeakBoxPrice(String(boxItem.costPrice));
        setLeakBoxBoundName(boxItem.name);
        setGlobalBinding("漏保盒", costSheetItemToBinding(boxItem));
      }
    }

    // 4. 漏保规格自动搜索（搜索词：当前选中的spec，如"C40"）
    // 注意：漏保规格切换时已有联动，这里只在无绑定状态时补充
    if (!breakerBoundName && !breakerPrice) {
      const breakerItem = fuzzySearchCostSheet(`漏保 ${spec}`, costSheet);
      if (!breakerItem) {
        // 如果"漏保 C40"搜不到，尝试直接用规格名"C40"搜索
        const specItem = fuzzySearchCostSheet(spec, costSheet);
        if (specItem) {
          setBreakerPrice(String(specItem.costPrice));
          setBreakerBoundName(specItem.name);
          setGlobalBinding("漏保", costSheetItemToBinding(specItem));
        }
      } else {
        setBreakerPrice(String(breakerItem.costPrice));
        setBreakerBoundName(breakerItem.name);
        setGlobalBinding("漏保", costSheetItemToBinding(breakerItem));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [costSheet]);

  const handleConfirm = () => {
    const sel: FixedAuxSelection = {
      breakerSpec: spec,
      breakerPrice: breakerPrice.trim() === "" ? null : Number(breakerPrice),
      breakerBoundName: breakerBoundName || null,
      pvcMeters,
      pvcPrice: pvcPrice.trim() === "" ? null : Number(pvcPrice),
      pvcBoundName: pvcBoundName || null,
      cablePrice: cablePrice.trim() === "" ? null : Number(cablePrice),
      cableBoundName: cableBoundName || null,
      leakBoxPrice: leakBoxPrice.trim() === "" ? null : Number(leakBoxPrice),
      leakBoxBoundName: leakBoxBoundName || null,
    };
    if (onSave) onSave(sel);
    else if (onConfirm) onConfirm(sel);
  };

  /* 绑定状态判定：有价格且有名=已绑定 */
  const isBreakerBound = breakerPrice !== "" && breakerBoundName !== "";
  const isCableBound = cablePrice !== "" && cableBoundName !== "";
  const isPvcBound = pvcPrice !== "" && pvcBoundName !== "";
  const isLeakBoxBound = leakBoxPrice !== "" && leakBoxBoundName !== "";

  return (
    <Modal
      open={!!open}
      title="固定辅材"
      onClose={() => {
        if (onClose) onClose();
        else if (onCancel) onCancel();
      }}
      zIndex={150}
      footer={
        <>
          <button
            type="button"
            className="btn"
            onClick={() => {
              if (onCancel) onCancel();
              else if (onClose) onClose();
            }}
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
        </>
      }
    >
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

      {/* 漏保单价 —— CostBindField 模块 */}
      <CostBindField
        label="漏保单价（元，换规格自动匹配，可手改）"
        pickerName="漏保"
        price={breakerPrice}
        boundName={breakerBoundName}
        isBound={isBreakerBound}
        onPriceChange={setBreakerPrice}
        onBoundNameChange={setBreakerBoundName}
        onBind={(item) => {
          setBreakerPrice(String(item.costPrice));
          setBreakerBoundName(item.name);
          setGlobalBinding("漏保", costSheetItemToBinding(item));
        }}
      />

      {/* PVC —— CostBindField 模块（v36.2-P10 改造） */}
      <CostBindField
        label={`PVC（用量 ${pvcMeters} 米）`}
        pickerName="PVC"
        price={pvcPrice}
        boundName={pvcBoundName}
        isBound={isPvcBound}
        onPriceChange={setPvcPrice}
        onBoundNameChange={setPvcBoundName}
        onBind={(item) => {
          setPvcPrice(String(item.costPrice));
          setPvcBoundName(item.name);
          setGlobalBinding("PVC", costSheetItemToBinding(item));
        }}
      />

      {/* 电缆 —— CostBindField 模块（v36.2-P10 新增） */}
      <CostBindField
        label="电缆（元/米，查成本表绑定）"
        pickerName="电缆"
        price={cablePrice}
        boundName={cableBoundName}
        isBound={isCableBound}
        onPriceChange={setCablePrice}
        onBoundNameChange={setCableBoundName}
        onBind={(item) => {
          setCablePrice(String(item.costPrice));
          setCableBoundName(item.name);
          setGlobalBinding("电缆", costSheetItemToBinding(item));
        }}
      />

      {/* 漏保盒 —— CostBindField 模块（v36.2-P10 改造） */}
      <CostBindField
        label="漏保盒（元，查成本表绑定）"
        pickerName="漏保盒"
        price={leakBoxPrice}
        boundName={leakBoxBoundName}
        isBound={isLeakBoxBound}
        onPriceChange={setLeakBoxPrice}
        onBoundNameChange={setLeakBoxBoundName}
        onBind={(item) => {
          setLeakBoxPrice(String(item.costPrice));
          setLeakBoxBoundName(item.name);
          setGlobalBinding("漏保盒", costSheetItemToBinding(item));
        }}
      />
    </Modal>
  );
}