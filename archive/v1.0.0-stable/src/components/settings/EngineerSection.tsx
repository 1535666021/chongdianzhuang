/* ============================================================
 * 设置区块 · 工程师信息（挂载由 SettingsPage「工程师信息」二级页完成）
 * 字段：engineerName / engineerPhone / receiveAddr（AppSettings 可选字段）
 * 输入即存：去掉保存按钮，onChange 防抖（500ms）自动保存 + toast「已保存」；
 *      落库逻辑不变——saveSettings 基于 storage 最新设置合并写回，
 *      并 updateSettings 同步 context 内存（避免 context 旧 settings
 *      之后的自动持久化把本区块字段覆盖回去）
 * ============================================================ */

import { useState } from "react";
import { FormField } from "@/components/common/FormField";
import { useApp } from "@/context/AppContext";
import { loadSettings, saveSettings } from "@/lib/storage";
import { useDebouncedCallback } from "@/components/settings/useDebouncedCallback";

/** 工程师信息表单草稿（与 AppSettings 可选字段一一对应） */
interface EngineerDraft {
  engineerName: string;
  engineerPhone: string;
  receiveAddr: string;
}

/** 从 storage 读已保存的工程师信息作为草稿（可选字段缺省给空串） */
function readEngineerDraft(): EngineerDraft {
  const settings = loadSettings();
  return {
    engineerName: settings.engineerName ?? "",
    engineerPhone: settings.engineerPhone ?? "",
    receiveAddr: settings.receiveAddr ?? "",
  };
}

export function EngineerSection() {
  const { updateSettings, showToast } = useApp();
  const [draft, setDraft] = useState<EngineerDraft>(readEngineerDraft);

  /* ---- 输入即存：防抖 500ms 自动保存（原保存按钮落库逻辑原样保留） ---- */
  const persist = useDebouncedCallback(() => {
    const patch = {
      engineerName: draft.engineerName.trim(),
      engineerPhone: draft.engineerPhone.trim(),
      receiveAddr: draft.receiveAddr.trim(),
    };
    /* 基于 storage 最新设置合并写回，再同步 context 内存 */
    if (!saveSettings({ ...loadSettings(), ...patch })) {
      showToast("保存失败，请重试");
      return;
    }
    updateSettings(patch);
    showToast("已保存");
  });

  const handleChange = (key: keyof EngineerDraft, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    persist();
  };

  return (
    <div className="card">
      <div className="card__title">工程师信息</div>
      <div className="flex-column gap-md">
        <FormField label="工程师姓名">
          <input
            className="input"
            value={draft.engineerName}
            placeholder="报单 / 对账落款使用"
            onChange={(e) => handleChange("engineerName", e.target.value)}
          />
        </FormField>
        <FormField label="工程师电话">
          <input
            className="input"
            type="tel"
            inputMode="tel"
            value={draft.engineerPhone}
            placeholder="客户 / 平台联系用"
            onChange={(e) => handleChange("engineerPhone", e.target.value)}
          />
        </FormField>
        <FormField label="收货地址">
          <input
            className="input"
            value={draft.receiveAddr}
            placeholder="充电桩 / 材料收货地址"
            onChange={(e) => handleChange("receiveAddr", e.target.value)}
          />
        </FormField>
      </div>
    </div>
  );
}
