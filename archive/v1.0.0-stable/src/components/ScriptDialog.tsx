/* ============================================================
 * 客户话术弹窗（理想上门 / 勘测完成 / 安装完工 三场景复用）
 * 模板来源：设置页按品牌+场景配置（storage.loadBrandScripts → scripts.getScript）
 * 复制：clipboard API + execCommand 兜底（同 OrderCard 写法）
 * ============================================================ */

import { useEffect, useState } from "react";
import { Modal } from "@/components/common/Modal";
import { FormField } from "@/components/common/FormField";
import { EmptyState } from "@/components/common/EmptyState";
import { Icon } from "@/components/common/Icon";
import { useApp } from "@/context/AppContext";
import {
  renderScript,
  buildScriptVars,
  getScript,
  SCRIPT_SCENES,
} from "@/lib/scripts";
import type { ScriptVarsExtras } from "@/lib/scripts";
import { loadBrandScripts, loadRateConfigs, loadSettings } from "@/lib/storage";
import { findBrand } from "@/lib/brandMaterials";
import type { Order, ScriptScene } from "@/types";

export interface ScriptDialogProps {
  open: boolean;
  order: Order | null;
  scene: ScriptScene;
  /** 话术变量补充（表单未保存值/物料明细等），由触发方计算后传入；
   *  工程师信息/品牌费率/品牌名由本组件从 storage 富化，触发方无需传 */
  extras?: ScriptVarsExtras;
  onClose: () => void;
  /** 点"复制并继续"时先复制话术再回调（用于继续原提交流程） */
  onConfirm?: () => void;
}

export function ScriptDialog({
  open,
  order,
  scene,
  extras,
  onClose,
  onConfirm,
}: ScriptDialogProps) {
  const { showToast, customBrands } = useApp();
  /** 渲染后话术文本；空字符串 = 该品牌该场景未配置模板 */
  const [scriptText, setScriptText] = useState("");

  /* 打开时：加载品牌话术模板 → 富化变量（设置/费率/品牌名）→ 渲染；无模板置空走空态 */
  useEffect(() => {
    if (!open || !order) return;
    const template = getScript(order.brandId, scene, loadBrandScripts());
    if (!template) {
      setScriptText("");
      return;
    }
    /* 工程师信息（设置页）与品牌费率（套包米数/超米单价）富化，extras 优先 */
    const settings = loadSettings();
    const rate = loadRateConfigs().find((r) => r.brandId === order.brandId);
    const brandName =
      findBrand(order.brandId, customBrands)?.name ?? order.brandId;
    setScriptText(
      renderScript(
        template,
        buildScriptVars(order, {
          scene,
          brandName,
          engineerName: settings.engineerName,
          engineerPhone: settings.engineerPhone,
          packageMeters: rate?.packageMeters,
          overMeterPrice: rate?.overMeterPrice,
          ...extras,
        }),
      ),
    );
    /* extras 为触发方瞬时表单值，整体作依赖即可（弹层打开时才求值） */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, order, scene, extras, customBrands]);

  /* 复制话术：clipboard API + execCommand 兜底（同 OrderCard） */
  const copyScript = async () => {
    if (!scriptText) return;
    try {
      await navigator.clipboard.writeText(scriptText);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = scriptText;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    showToast("话术已复制");
  };

  /* 复制并继续：先复制话术，再回调原提交流程，最后关闭 */
  const handleConfirm = async () => {
    await copyScript();
    onConfirm?.();
    onClose();
  };

  if (!order) return null;

  const hasScript = scriptText !== "";
  const sceneLabel =
    SCRIPT_SCENES.find((s) => s.key === scene)?.label ?? scene;

  return (
    <Modal
      open={open}
      title={`客户话术 · ${sceneLabel} · ${order.customerName}`}
      onClose={onClose}
      footer={
        onConfirm ? (
          <>
            <button type="button" className="btn btn--outline" onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className="btn btn--primary btn--lg"
              onClick={handleConfirm}
            >
              复制并继续
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn--primary btn--lg"
            onClick={onClose}
          >
            关闭
          </button>
        )
      }
    >
      {/* 任务v35：只读展示改可编辑（受控 scriptText）；打开/换单时由生成
          effect 写初值，用户手改不被覆盖；复制一律取编辑后 scriptText */}
      {hasScript ? (
        <FormField label="话术内容（可直接修改，复制按修改后文本）">
          <textarea
            className="input text-preview-editor"
            rows={8}
            value={scriptText}
            aria-label="话术内容，可直接编辑"
            onChange={(e) => setScriptText(e.target.value)}
          />
        </FormField>
      ) : (
        <EmptyState
          icon={<Icon name="file-text" size={48} />}
          text="该品牌暂无此场景话术，请到设置页配置"
        />
      )}
      <button
        type="button"
        className="btn btn--secondary"
        disabled={!hasScript}
        onClick={copyScript}
      >
        复制话术
      </button>
    </Modal>
  );
}
