/* ============================================================
 * 设置区块 · 地图服务（挂载由 SettingsPage「地图服务」二级页完成）
 * 字段：amapKey / amapSecurity（必须配对，缺一坐标解析失败）
 * 输入即存：去掉保存按钮，onChange 防抖（500ms）自动保存 + toast「已保存」；
 *      落库逻辑不变——saveSettings 基于 storage 最新设置合并写回，
 *      并 updateSettings 同步 context 内存（避免 context 旧 settings
 *      之后的自动持久化把本区块字段覆盖回去）
 * 说明：自动备份开关已挪入「数据管理」二级页（见 DataSection）
 * ============================================================ */

import { useState } from "react";
import { FormField } from "@/components/common/FormField";
import { useApp } from "@/context/AppContext";
import { loadSettings, saveSettings } from "@/lib/storage";
import { useDebouncedCallback } from "@/components/settings/useDebouncedCallback";

/** 高德配置表单草稿（Key + 安全密钥） */
interface AmapDraft {
  amapKey: string;
  amapSecurity: string;
}

/** 从 storage 读已保存配置作为草稿（可选字段缺省给空串） */
function readAmapDraft(): AmapDraft {
  const settings = loadSettings();
  return {
    amapKey: settings.amapKey,
    amapSecurity: settings.amapSecurity ?? "",
  };
}

export function AmapSection() {
  const { updateSettings, showToast } = useApp();
  const [draft, setDraft] = useState<AmapDraft>(readAmapDraft);

  /* ---- 输入即存：防抖 500ms 自动保存；Key 与安全密钥必须配对（校验不变） ---- */
  const persist = useDebouncedCallback(() => {
    const patch = {
      amapKey: draft.amapKey.trim(),
      amapSecurity: draft.amapSecurity.trim(),
    };
    if ((patch.amapKey === "") !== (patch.amapSecurity === "")) {
      showToast("Key与安全密钥必须配对，缺一坐标解析失败");
      return;
    }
    /* 基于 storage 最新设置合并写回，再同步 context 内存 */
    if (!saveSettings({ ...loadSettings(), ...patch })) {
      showToast("保存失败，请重试");
      return;
    }
    updateSettings(patch);
    showToast("已保存");
  });

  const handleChange = (key: keyof AmapDraft, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    persist();
  };

  return (
    <div className="card">
      <div className="card__title">地图服务（配对配置）</div>
      <div className="flex-column gap-md">
        <FormField label="高德地图 Key">
          <input
            className="input"
            value={draft.amapKey}
            placeholder="用于地址解析坐标，选填"
            onChange={(e) => handleChange("amapKey", e.target.value)}
          />
        </FormField>
        <FormField label="高德安全密钥">
          <input
            className="input"
            value={draft.amapSecurity}
            placeholder="与 Key 配对的安全密钥，选填"
            onChange={(e) => handleChange("amapSecurity", e.target.value)}
          />
        </FormField>
      </div>
      <p className="text-sm text-tertiary mt-sm">
        Key与安全密钥必须配对，缺一坐标解析失败；两者都不填则导航按地址搜索。
      </p>
    </div>
  );
}
