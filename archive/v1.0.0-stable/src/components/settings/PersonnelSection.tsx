/* ============================================================
 * 设置区块 · 人员默认（默认勘测人 / 默认安装师傅）
 * 即存方式：context updateSettings 输入即时落库（本区块从未有保存按钮，
 *      字段与 storage 调用保持原样，仅随微信式分组列表改呈现）
 * 挂载：由 SettingsPage「人员默认」二级页挂载
 * ============================================================ */

import { FormField } from "@/components/common/FormField";
import { useApp } from "@/context/AppContext";

export function PersonnelSection() {
  const { settings, updateSettings } = useApp();

  return (
    <div className="card">
      <div className="card__title">人员默认</div>
      <div className="flex-column gap-md">
        <FormField label="默认勘测人">
          <input
            className="input"
            value={settings.defaultSurveyor}
            placeholder="勘测弹窗自动带出"
            onChange={(e) =>
              updateSettings({ defaultSurveyor: e.target.value })
            }
          />
        </FormField>
        <FormField label="默认安装师傅">
          <input
            className="input"
            value={settings.defaultInstaller}
            placeholder="预约/完工弹窗自动带出"
            onChange={(e) =>
              updateSettings({ defaultInstaller: e.target.value })
            }
          />
        </FormField>
      </div>
    </div>
  );
}
