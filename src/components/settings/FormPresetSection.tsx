/* ============================================================
 * 设置区块 · 表单预设（挂载由 SettingsPage「表单预设」二级页完成）
 * 职责：勘测表单 6 项默认值——取电方式 / 线缆规格 / 勘测详情 /
 *      电表状态 / 物业需要施工方案图 / 勘测结果；
 *      勘测表单打开即按此预填，师傅现场只需核对修改
 * 输入即存：与话术模板同模式，编辑后防抖（500ms）自动保存 + toast「已保存」；
 *      落库走 saveFormPresets（缺字段合并由 loadFormPresets 兜底）
 * 规范：所有读写走 storage 封装，本组件不碰 localStorage
 * ============================================================ */

import { useState } from "react";
import { FormField } from "@/components/common/FormField";
import { useApp } from "@/context/AppContext";
import { loadFormPresets, saveFormPresets } from "@/lib/storage";
import { useDebouncedCallback } from "@/components/settings/useDebouncedCallback";
import type { FormPresets } from "@/types";

export function FormPresetSection() {
  const { showToast } = useApp();

  /* 草稿：挂载时自 storage 读取（无存档为默认值，缺字段已合并补齐） */
  const [draft, setDraft] = useState<FormPresets>(loadFormPresets);

  /* ---- 输入即存：防抖 500ms 自动保存（保存参数随调用显式传入） ---- */
  const persistPresets = useDebouncedCallback((next: FormPresets) => {
    if (!saveFormPresets(next)) {
      showToast("保存失败，请重试");
      return;
    }
    showToast("已保存");
  });

  /* ---- 编辑草稿（改内存 + 触发防抖自动保存） ---- */
  const updatePreset = (key: keyof FormPresets, value: string) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    persistPresets(next);
  };

  return (
    <div className="card">
      <div className="card__title">表单预设</div>
      <div className="flex-column gap-md">
        <FormField label="取电方式默认">
          <input
            className="input"
            value={draft.powerSource}
            placeholder="如 国网取电"
            onChange={(e) => updatePreset("powerSource", e.target.value)}
          />
        </FormField>
        <FormField label="线缆规格默认">
          <input
            className="input"
            value={draft.cableSpec}
            placeholder="如 3*6"
            onChange={(e) => updatePreset("cableSpec", e.target.value)}
          />
        </FormField>
        <FormField label="勘测详情默认">
          <input
            className="input"
            value={draft.installType}
            placeholder="如 壁挂安装"
            onChange={(e) => updatePreset("installType", e.target.value)}
          />
        </FormField>
        <FormField label="电表状态默认">
          <select
            className="input"
            value={draft.meterStatus}
            onChange={(e) => updatePreset("meterStatus", e.target.value)}
          >
            <option value="已安装">已安装</option>
            <option value="未安装">未安装</option>
          </select>
        </FormField>
        <FormField label="物业需要施工方案图默认">
          <select
            className="input"
            value={draft.needPlanDoc}
            onChange={(e) => updatePreset("needPlanDoc", e.target.value)}
          >
            <option value="否">否</option>
            <option value="是">是</option>
          </select>
        </FormField>
        <FormField label="勘测结果默认">
          <input
            className="input"
            value={draft.surveyResult}
            placeholder="如 车位是符合安装"
            onChange={(e) => updatePreset("surveyResult", e.target.value)}
          />
        </FormField>
      </div>
      <p className="text-sm text-tertiary mt-sm">
        勘测表单打开即按以上预设填写，现场只需核对修改；修改后自动保存生效。
      </p>
    </div>
  );
}
