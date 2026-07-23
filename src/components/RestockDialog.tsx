/* ============================================================
 * 一键补桩弹窗（任务U 模块D）
 * 统计范围：全部 restockStatus==="needed" 且 isInstallOrder 的安装单
 * 发货单文本：lib/restock.buildRestockShipmentText 生成（本组件只渲染，
 *      合并计数/排序/辅材区/落款规则全部收敛在 lib）
 * 复制：clipboard API + execCommand 兜底（与 ScriptDialog 同写法）；
 *      复制成功 → markRestockDone(纳入单 id 列表) 全部翻「已补桩」
 * ============================================================ */

import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/common/Modal";
import { FormField } from "@/components/common/FormField";
import { useApp } from "@/context/AppContext";
import { mergeBrands } from "@/lib/brandMaterials";
import {
  buildRestockShipmentText,
  isInstallOrder,
} from "@/lib/restock";
import type { RestockMaterialRow } from "@/lib/restock";
import { loadMaterialsLib, loadSettings } from "@/lib/storage";
import { OrderStatus } from "@/types";

export interface RestockDialogProps {
  open: boolean;
  onClose: () => void;
}

export function RestockDialog({ open, onClose }: RestockDialogProps) {
  const { orders, customBrands, markRestockDone, showToast } = useApp();
  /* 辅材行（可增行/可删除/可整区不填；空名或空数量行不落文本） */
  const [materials, setMaterials] = useState<RestockMaterialRow[]>([]);
  /* 辅材下拉受控选中值（选中追加一行后立即复位，便于连续添加） */
  const [materialPick, setMaterialPick] = useState("");
  /* 手动添加：名称 + 数量 */
  const [manualName, setManualName] = useState("");
  const [manualQty, setManualQty] = useState("1");

  /* 本次纳入补桩的安装单（全部「需补桩」，「已补桩」不纳入；
   * v32.3 顺手修：剔除回收站挂标单——与首页入口计数（activeOrders 口径）
   * 同源一致，两处数字必须相等） */
  const targets = useMemo(
    () =>
      orders.filter(
        (o) =>
          o.status !== OrderStatus.Trash &&
          o.status !== OrderStatus.Completed &&
          o.status !== OrderStatus.Cancelled &&
          o.restockStatus === "needed" &&
          isInstallOrder(o),
      ),
    [orders],
  );

  /* 品牌名解析（mergeBrands，与 AppContext 打标时同口径） */
  const brandNameOf = useMemo(() => {
    const brands = mergeBrands(customBrands);
    return (brandId: string) =>
      brands.find((b) => b.id === brandId)?.name ?? brandId;
  }, [customBrands]);

  /* 辅材下拉选项：材料库全部名称去重（每次打开重读，设置页可能改过材料库） */
  const materialOptions = useMemo(() => {
    if (!open) return [];
    const names = loadMaterialsLib()
      .map((m) => m.name.trim())
      .filter((n) => n !== "");
    return [...new Set(names)];
  }, [open]);

  /* 发货单文本：当天日期 + 合并桩明细 + 辅材区 + 落款收货地址（实时重算） */
  const shipmentText = buildRestockShipmentText(
    new Date(),
    targets,
    materials,
    loadSettings().receiveAddr ?? "",
    brandNameOf,
  );

  /* 预览可编辑（任务v35）：previewText 为复制口径；未手改时跟随最新
     计算值（订单/辅材变化同步），手改后（dirty）不再自动覆盖；
     弹层关闭时复位 dirty，下次打开重新取最新计算值 */
  const [previewText, setPreviewText] = useState(shipmentText);
  const [previewDirty, setPreviewDirty] = useState(false);
  useEffect(() => {
    if (!open) {
      setPreviewDirty(false);
      setManualName("");
      setManualQty("1");
      return;
    }
    if (!previewDirty) setPreviewText(shipmentText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, shipmentText, previewDirty]);

  /* ---- 辅材行编辑 ---- */
  const patchMaterial = (index: number, patch: Partial<RestockMaterialRow>) =>
    setMaterials((prev) =>
      prev.map((m, i) => (i === index ? { ...m, ...patch } : m)),
    );
  const removeMaterial = (index: number) =>
    setMaterials((prev) => prev.filter((_, i) => i !== index));
  /* 下拉选中追加一行（数量默认 1 可改），随后复位下拉 */
  const handlePick = (name: string) => {
    if (!name) return;
    setMaterials((prev) => [...prev, { name, quantity: "1" }]);
    setMaterialPick("");
  };
  /* 手动输入追加一行 */
  const handleManualAdd = () => {
    const name = manualName.trim();
    if (!name) {
      showToast("请输入辅材名称");
      return;
    }
    const qty = manualQty.trim() || "1";
    setMaterials((prev) => [...prev, { name, quantity: qty }]);
    setManualName("");
    setManualQty("1");
  };

  /* ---- 一键复制：编辑后预览文本整段进剪贴板，成功后纳入单全翻「已补桩」 ---- */
  const handleCopy = async () => {
    const ids = targets.map((o) => o.id);
    try {
      await navigator.clipboard.writeText(previewText);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = previewText;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    markRestockDone(ids);
    setMaterials([]);
    setMaterialPick("");
    setManualName("");
    setManualQty("1");
    setPreviewDirty(false);
    showToast(`发货单已复制，${ids.length} 单已标记「已补桩」`);
    onClose();
  };

  return (
    <Modal
      open={open}
      title="一键补桩"
      onClose={onClose}
      footer={
        <button
          type="button"
          className="btn btn--primary"
          disabled={targets.length === 0}
          onClick={handleCopy}
        >
          一键复制
        </button>
      }
    >
      <div className="text-sm text-secondary">
        本次纳入 {targets.length} 单需补桩安装单，复制后全部标记「已补桩」。
      </div>

      {/* 发货单预览（任务v35 可编辑：未手改时辅材/订单变化即时同步，
          手改后不再自动覆盖；复制取编辑后文本） */}
      <textarea
        className="input text-preview-editor"
        value={previewText}
        aria-label="发货单预览，可直接编辑"
        onChange={(e) => {
          setPreviewText(e.target.value);
          setPreviewDirty(true);
        }}
      />

      {/* 辅材区：下拉（材料库名称去重）+ 手动输入，可增可删可整区不填 */}
      <FormField label="辅材（可整区不填）">
        <div className="flex-column gap-sm">
          <select
            className="input"
            value={materialPick}
            onChange={(e) => handlePick(e.target.value)}
          >
            <option value="">从材料库选择添加…</option>
            {materialOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>

          {/* 手动添加行：名称 + 数量 + 添加按钮 */}
          <div className="flex gap-sm">
            <input
              className="input flex-1"
              placeholder="手动输入辅材名称"
              value={manualName}
              onChange={(e) => setManualName(e.target.value)}
            />
            <input
              className="input shipment-preview__qty"
              placeholder="数量"
              value={manualQty}
              onChange={(e) => setManualQty(e.target.value)}
            />
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={handleManualAdd}
            >
              添加
            </button>
          </div>

          {materials.map((item, index) => (
            <div key={index} className="card card--flat">
              <div className="flex gap-sm">
                <input
                  className="input flex-1"
                  placeholder="辅材名称"
                  value={item.name}
                  onChange={(e) =>
                    patchMaterial(index, { name: e.target.value })
                  }
                />
                <input
                  className="input shipment-preview__qty"
                  placeholder="数量"
                  value={item.quantity}
                  onChange={(e) =>
                    patchMaterial(index, { quantity: e.target.value })
                  }
                />
                <button
                  type="button"
                  className="btn btn--danger-outline btn--sm"
                  aria-label="删除该行"
                  onClick={() => removeMaterial(index)}
                >
                  删
                </button>
              </div>
            </div>
          ))}
        </div>
      </FormField>
    </Modal>
  );
}
