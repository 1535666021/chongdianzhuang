/* ============================================================
 * 固定辅材输入子窗口（任务v36）
 * 职责：漏保规格 / 漏保单价 / PVC米数 三项录入，保存产出 FixedAuxSelection
 *      （完工快照算成本时的取值源；持久化与 toast 由调用方负责）
 * 规则：打开时按 order.fixedAux ?? defaultFixedAux 重算初始化；
 *      换漏保规格时先查材料库再查成本表联动价格（findBreakerPrice →
 *      findBreakerPriceInCostSheet），手改价格优先于联动；
 *      PVC 米数默认=用线米数（桥架混用可手改减半）
 * ============================================================ */

import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/common/Modal";
import { FormField } from "@/components/common/FormField";
import {
  BREAKER_SPECS,
  defaultFixedAux,
  findBreakerPrice,
} from "@/lib/fixedAux";
import { findBreakerPriceInCostSheet } from "@/lib/costMapping";
import { loadMaterialsLib, loadCostSheet } from "@/lib/storage";
import type { FixedAuxSelection, Order } from "@/types";

export interface FixedMaterialsDialogProps {
  open: boolean;
  /** 当前订单（功率/品牌定默认漏保规格；order.fixedAux 有值优先带出） */
  order: Order;
  /** 品牌名（零跑→C40A 判定用，v7 按品牌名口径） */
  brandName: string;
  /** 用线米数（PVC 米数默认值） */
  cableMeters: number;
  onClose: () => void;
  /** 保存回调：持久化与 toast 由调用方负责 */
  onSave: (sel: FixedAuxSelection) => void;
}

export function FixedMaterialsDialog({
  open,
  order,
  brandName,
  cableMeters,
  onClose,
  onSave,
}: FixedMaterialsDialogProps) {
  /* 输入态用 string 受控（与勘测/完工表单数字输入同款写法），保存时转 number */
  const [breakerSpec, setBreakerSpec] = useState<string>(BREAKER_SPECS[1]);
  const [breakerPrice, setBreakerPrice] = useState("");
  const [pvcMeters, setPvcMeters] = useState("");

  /* 材料库+成本表：每次打开重读（设置页可能改过），换规格联动匹配用 */
  const lib = useMemo(() => (open ? loadMaterialsLib() : []), [open]);
  const costSheet = useMemo(() => (open ? loadCostSheet() : []), [open]);

  /* 打开时重算初始化：已存取值源优先，否则按订单功率/品牌/用线米数默认 */
  useEffect(() => {
    if (!open) return;
    const init =
      order.fixedAux ??
      defaultFixedAux(order, brandName, cableMeters, lib, costSheet);
    setBreakerSpec(init.breakerSpec);
    /* 任务v36.1 FAIL-3：未匹配价格=null → 价格框置空（严禁自动填兜底数） */
    setBreakerPrice(
      init.breakerPrice != null ? String(init.breakerPrice) : "",
    );
    setPvcMeters(String(init.pvcMeters));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, order, brandName, cableMeters]);

  /* 规格下拉选项：固定三档 + 兜底当前值（历史数据可能存过其他规格串，防 select 掉值） */
  const specOptions = useMemo(
    () =>
      (BREAKER_SPECS as readonly string[]).includes(breakerSpec)
        ? [...BREAKER_SPECS]
        : [...BREAKER_SPECS, breakerSpec],
    [breakerSpec],
  );

  /* 换规格：价格联动——先查材料库再查成本表（v36.2-P1 修正）
   * ①命中→显示价格+可改；②均未命中→价格框置空+提示去设置页成本表绑定，
   * 严禁自动填兜底数 */
  const handleSpecChange = (spec: string) => {
    setBreakerSpec(spec);
    const matched =
      findBreakerPrice(spec, lib) ??
      findBreakerPriceInCostSheet(spec, costSheet);
    setBreakerPrice(matched !== null ? String(matched) : "");
  };

  const handleSave = () => {
    onSave({
      breakerSpec,
      /* 空框=未匹配（null），成本按 0 计；不兜底 */
      breakerPrice:
        breakerPrice.trim() === "" ? null : Number(breakerPrice),
      pvcMeters: Number(pvcMeters) || 0,
    });
  };

  return (
    <Modal
      open={open}
      title="固定辅材"
      onClose={onClose}
      footer={
        <button
          type="button"
          className="btn btn--primary"
          onClick={handleSave}
        >
          保存
        </button>
      }
    >
      <div className="text-sm text-secondary">
        套包内不向客户收费、但计入成本的辅材；完工利润快照按此处取值计算。
      </div>

      {/* 漏保区：规格下拉（换规格价格联动重匹配）+ 单价手改优先 */}
      <div className="card card--flat">
        <FormField label="漏保规格">
          <select
            className="input"
            value={breakerSpec}
            onChange={(e) => handleSpecChange(e.target.value)}
          >
            {specOptions.map((spec) => (
              <option key={spec} value={spec}>
                {spec}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="漏保单价（元，换规格自动匹配材料库，可手改）">
          <input
            className="input"
            type="number"
            min="0"
            step="0.01"
            value={breakerPrice}
            placeholder="未匹配"
            onChange={(e) => setBreakerPrice(e.target.value)}
          />
        </FormField>
        {/* 任务v36.1 FAIL-3：未匹配（空框）时明确提示绑定路径，不自动填数 */}
        {breakerPrice.trim() === "" ? (
          <div className="text-sm text-tertiary">
            未匹配价格，请到设置页成本表绑定
          </div>
        ) : null}
      </div>

      {/* PVC 区：默认=用线米数，桥架混用减半场景可手改 */}
      <div className="card card--flat">
        <FormField label="PVC管米数（默认=用线米数，桥架混用可手改）">
          <input
            className="input"
            type="number"
            min="0"
            step="1"
            value={pvcMeters}
            onChange={(e) => setPvcMeters(e.target.value)}
          />
        </FormField>
      </div>

      <div className="text-sm text-secondary">
        扎带+胶带辅材包按固定 ¥10 计成本，无需录入。
      </div>
    </Modal>
  );
}
