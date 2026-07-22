/* ============================================================
 * 订单新增 / 编辑弹窗
 * - 新增：open=true 且 order 为空，顶部提供"微信文本智能解析"
 *   简化模式：只保留文本输入框 + "智能解析并保存"按钮，解析后自动保存
 * - 编辑：传入 order，表单回填（不显示解析区，避免覆盖已有数据）
 * 校验：姓名必填、手机号格式、地址必填；品牌切换自动带出默认功率
 * 规范：文本解析调用 lib/parser 的 parseOrderText，本组件零正则
 * ============================================================ */

import { useEffect, useState } from "react";
import { Modal } from "@/components/common/Modal";
import { FormField } from "@/components/common/FormField";
import { useApp } from "@/context/AppContext";
import { isValidPhone } from "@/lib/utils";
import { matchBrandIdByName, parseOrderText } from "@/lib/parser";
import { OrderStatus } from "@/types";
import type { OrderDraft, OrderModalProps } from "@/types";

/** 表单内部状态（功率用字符串便于输入，提交时转数字） */
interface FormState {
  customerName: string;
  customerPhone: string;
  address: string;
  brandId: string;
  powerKw: string;
  remark: string;
}

interface FormErrors {
  customerName?: string;
  customerPhone?: string;
  address?: string;
  powerKw?: string;
}

const EMPTY_FORM: FormState = {
  customerName: "",
  customerPhone: "",
  address: "",
  brandId: "",
  powerKw: "7",
  remark: "",
};

export function OrderModal({ open, order, onClose }: OrderModalProps) {
  const { brands, customBrands, addOrder, updateOrder, showToast } = useApp();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  /* 微信订单文本（仅新增模式使用） */
  const [parseText, setParseText] = useState("");

  /* 打开时初始化表单：编辑回填 / 新增重置（含解析框清空） */
  useEffect(() => {
    if (!open) return;
    setErrors({});
    setParseText("");
    if (order) {
      setForm({
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        address: order.address,
        brandId: order.brandId,
        powerKw: String(order.powerKw),
        remark: order.remark,
      });
    } else {
      setForm({ ...EMPTY_FORM, brandId: brands[0]?.id ?? "" });
    }
  }, [open, order, brands]);

  const patch = (key: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const handleBrandChange = (brandId: string) => {
    const brand = brands.find((b) => b.id === brandId);
    setForm((prev) => ({
      ...prev,
      brandId,
      powerKw: brand ? String(brand.defaultPowerKw) : prev.powerKw,
    }));
  };

  /* 智能解析并保存：解析后直接保存所有识别到的订单，无需手动回填 */
  const handleParseAndSave = () => {
    if (!parseText.trim()) {
      showToast("请先粘贴订单文本");
      return;
    }
    const items = parseOrderText(parseText);
    if (items.length === 0) {
      showToast("未能识别有效信息，请检查文本格式");
      return;
    }

    // 解析成功，直接保存所有识别到的订单
    let savedCount = 0;
    for (const item of items) {
      const brandId = matchBrandIdByName(item.brandName, brands, customBrands);
      const draft: OrderDraft = {
        customerName: item.customerName?.trim() || "未命名",
        customerPhone: item.phone?.trim() || "",
        address: item.address?.trim() || "",
        brandId: brandId || brands[0]?.id || "",
        powerKw: Number(item.powerKw) || 7,
        status: OrderStatus.Pending,
        remark: item.remark?.trim() || "",
      };
      addOrder(draft);
      savedCount++;
    }

    showToast(`已保存 ${savedCount} 条订单`);
    setParseText("");
    onClose();
  };

  const validate = (): boolean => {
    const next: FormErrors = {};
    if (!form.customerName.trim()) next.customerName = "请填写客户姓名";
    if (!isValidPhone(form.customerPhone))
      next.customerPhone = "请填写正确的 11 位手机号";
    if (!form.address.trim()) next.address = "请填写安装地址";
    const power = Number(form.powerKw);
    if (!Number.isFinite(power) || power <= 0)
      next.powerKw = "请填写正确的功率（kW）";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    const draft: OrderDraft = {
      customerName: form.customerName.trim(),
      customerPhone: form.customerPhone.trim(),
      address: form.address.trim(),
      brandId: form.brandId,
      powerKw: Number(form.powerKw),
      status: order?.status ?? OrderStatus.Pending,
      remark: form.remark.trim(),
    };
    if (order) {
      updateOrder(order.id, draft);
      showToast("订单已更新");
    } else {
      addOrder(draft);
      showToast("订单已创建");
    }
    onClose();
  };

  return (
    <Modal
      open={open}
      title={order ? "编辑订单" : "新增订单"}
      onClose={onClose}
      footer={
        order ? (
          <>
            <button type="button" className="btn btn--outline" onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className="btn btn--primary btn--lg"
              onClick={handleSubmit}
            >
              保存
            </button>
          </>
        ) : undefined
      }
    >
      {/* 新增模式：简化界面，只保留文本输入 + 解析保存按钮 */}
      {!order ? (
        <div className="p-md">
          <label className="label">订单文本（粘贴后一键解析保存）</label>
          <textarea
            className="textarea"
            value={parseText}
            maxLength={50000}
            placeholder={
              "支持粘贴微信聊天记录/公告/【订单信息】/单行文本，多条自动拆分。\n如：张先生 13800001111 朝阳区幸福小区3栋501 特斯拉 7kW"
            }
            onChange={(e) => setParseText(e.target.value)}
          />
          <button
            type="button"
            className="btn btn--primary btn--block mt-md"
            onClick={handleParseAndSave}
          >
            智能解析并保存
          </button>
        </div>
      ) : (
        /* 编辑模式：保留原有表单字段 */
        <>
          <FormField label="客户姓名" required error={errors.customerName}>
            <input
              className={errors.customerName ? "input input--error" : "input"}
              value={form.customerName}
              placeholder="如：张先生"
              onChange={(e) => patch("customerName", e.target.value)}
            />
          </FormField>

          <FormField label="客户电话" required error={errors.customerPhone}>
            <input
              className={errors.customerPhone ? "input input--error" : "input"}
              type="tel"
              inputMode="numeric"
              maxLength={11}
              value={form.customerPhone}
              placeholder="11 位手机号"
              onChange={(e) => patch("customerPhone", e.target.value)}
            />
          </FormField>

          <FormField label="安装地址" required error={errors.address}>
            <textarea
              className={errors.address ? "textarea textarea--error" : "textarea"}
              value={form.address}
              placeholder="小区 / 楼栋 / 车位号，尽量详细"
              onChange={(e) => patch("address", e.target.value)}
            />
          </FormField>

          <FormField label="充电桩品牌" required>
            <select
              className="select"
              value={form.brandId}
              onChange={(e) => handleBrandChange(e.target.value)}
            >
              {brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="功率（kW）" required error={errors.powerKw}>
            <input
              className={errors.powerKw ? "input input--error" : "input"}
              type="number"
              inputMode="decimal"
              min="0"
              step="0.1"
              value={form.powerKw}
              onChange={(e) => patch("powerKw", e.target.value)}
            />
          </FormField>

          <FormField label="备注">
            <textarea
              className="textarea"
              value={form.remark}
              placeholder="选填：物业要求、特殊情况等"
              onChange={(e) => patch("remark", e.target.value)}
            />
          </FormField>
        </>
      )}
    </Modal>
  );
}
