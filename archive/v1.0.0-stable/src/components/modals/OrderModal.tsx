/* ============================================================
 * 订单新增 / 编辑弹窗
 * - 新增：open=true 且 order 为空，顶部提供"微信文本智能解析"
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

  /* 智能解析：与首页批量入口共用同一套 lib/parser 新解析，本组件只负责调用与回填；
   * 多条订单时回填第一条并引导去首页「智能识别」批量入库（不静默丢弃）；
   * 未识别的字段保留原值可手补；品牌匹配 customBrands 优先 */
  const handleParse = () => {
    if (!parseText.trim()) {
      showToast("请先粘贴订单文本");
      return;
    }
    const items = parseOrderText(parseText);
    if (items.length === 0) {
      showToast("未能识别有效信息，请检查文本格式");
      return;
    }
    const first = items[0];
    const brandId = matchBrandIdByName(first.brandName, brands, customBrands);
    setForm((prev) => ({
      ...prev,
      customerName: first.customerName || prev.customerName,
      customerPhone: first.phone || prev.customerPhone,
      address: first.address || prev.address,
      brandId: brandId || prev.brandId,
      powerKw: first.powerKw || prev.powerKw,
      remark: first.remark || prev.remark,
    }));
    setErrors({});
    showToast(
      items.length > 1
        ? `识别到 ${items.length} 条订单，已回填第 1 条；批量入库请用首页「智能识别」`
        : first.platformName
          ? `解析完成（平台：${first.platformName}），请核对后保存`
          : "解析完成，请核对后保存",
    );
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
      }
    >
      {/* 智能解析区：仅新增模式显示 */}
      {!order ? (
        <FormField label="订单文本（选填，粘贴后一键解析填充）">
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
            className="btn btn--secondary btn--sm mt-sm"
            onClick={handleParse}
          >
            智能解析
          </button>
        </FormField>
      ) : null}

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
    </Modal>
  );
}
