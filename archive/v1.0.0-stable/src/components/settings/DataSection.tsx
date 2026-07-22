/* ============================================================
 * 设置区块 · 数据管理（挂载由 SettingsPage「数据管理」二级页完成）
 * 内容：自动备份开关（自地图服务区块挪入，勾选即存逻辑不变）/
 *      备份 JSON 导出导入 / 订单 xlsx 导出导入
 * 反馈：导入/导出为异步动作，沿用 busy 守卫 + .btn--loading 防重复点击
 * 规范：所有读写走 storage / parser 封装，本组件不碰 localStorage
 * ============================================================ */

import { useRef, useState } from "react";
import { Icon } from "@/components/common/Icon";
import { FormField } from "@/components/common/FormField";
import { Modal } from "@/components/common/Modal";
import { useApp } from "@/context/AppContext";
import {
  exportBackup,
  importBackup,
  loadCustomBrands,
  loadOrders,
  loadSettings,
  saveSettings,
} from "@/lib/storage";
import {
  changeBackupPassword,
  hasCustomBackupPassword,
  resetBackupPasswordToDefault,
} from "@/lib/legacyBackup";
import { exportOrdersToXlsx, parseOrdersFromXlsx } from "@/lib/parser";

/* ------------------------------------------------------------
 * 文件下载小工具（导出 JSON 用，仅此处使用）
 * ------------------------------------------------------------ */
function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function DataSection() {
  const {
    orders,
    updateSettings,
    importOrders,
    replaceAllData,
    showToast,
  } = useApp();

  const backupFileRef = useRef<HTMLInputElement>(null);
  const xlsxFileRef = useRef<HTMLInputElement>(null);
  /* 自动备份开关（自 AmapSection 挪入）：草稿从 loadSettings 初始化 */
  const [autoBackup, setAutoBackup] = useState<boolean>(
    () => loadSettings().autoBackup ?? false,
  );
  /* 异步动作 busy 守卫（导入备份 / 导出 Excel / 导入 Excel） */
  const [importBackupBusy, setImportBackupBusy] = useState(false);
  const [exportXlsxBusy, setExportXlsxBusy] = useState(false);
  const [importXlsxBusy, setImportXlsxBusy] = useState(false);

  /* ---- 备份密码（任务S 隐私整改）：自定义密码改的是本地覆盖值，内置密文只读 ---- */
  const [pwdModalOpen, setPwdModalOpen] = useState(false);
  const [hasCustomPwd, setHasCustomPwd] = useState<boolean>(() =>
    hasCustomBackupPassword(),
  );
  const [pwdCurrent, setPwdCurrent] = useState("");
  const [pwdNew, setPwdNew] = useState("");
  const [pwdNewConfirm, setPwdNewConfirm] = useState("");
  const [pwdError, setPwdError] = useState("");
  const [pwdBusy, setPwdBusy] = useState(false);

  /* ---- 自动备份开关：勾选即存（逻辑自 AmapSection 原样挪入） ---- */
  const handleToggleAutoBackup = (checked: boolean) => {
    setAutoBackup(checked);
    if (!saveSettings({ ...loadSettings(), autoBackup: checked })) {
      setAutoBackup(!checked);
      showToast("保存失败，请重试");
      return;
    }
    updateSettings({ autoBackup: checked });
    showToast(checked ? "自动备份已开启" : "自动备份已关闭");
  };

  /* ---- 备份导出 ---- */
  const handleExportBackup = () => {
    const date = new Date().toISOString().slice(0, 10);
    downloadTextFile(`充电桩订单备份_${date}.json`, exportBackup());
    showToast("备份文件已导出");
  };

  /* ---- 备份导入：busy 守卫防重复选择 ---- */
  const handleImportBackup = async (file: File) => {
    if (importBackupBusy) return;
    setImportBackupBusy(true);
    try {
      const text = await file.text();
      const error = importBackup(text);
      if (error) {
        showToast(error);
        return;
      }
      // storage 已写入，同步内存状态；各配置区块随二级页重新挂载自 storage 重读
      replaceAllData(loadOrders(), loadSettings(), loadCustomBrands());
      setAutoBackup(loadSettings().autoBackup ?? false);
      showToast("备份导入成功");
    } finally {
      setImportBackupBusy(false);
    }
  };

  /* ---- xlsx 导出：xlsx 库动态加载为异步；busy 守卫 + 失败兜底提示 ---- */
  const handleExportXlsx = () => {
    if (exportXlsxBusy) return;
    setExportXlsxBusy(true);
    exportOrdersToXlsx(orders)
      .catch(() => showToast("导出失败，请重试"))
      .finally(() => setExportXlsxBusy(false));
  };

  /* ---- xlsx 导入：busy 守卫防重复选择 ---- */
  const handleImportXlsx = async (file: File) => {
    if (importXlsxBusy) return;
    setImportXlsxBusy(true);
    try {
      const result = await parseOrdersFromXlsx(file);
      if (result.error) {
        showToast(result.error);
        return;
      }
      const count = importOrders(result.orders);
      showToast(
        result.skipped > 0
          ? `已导入 ${count} 单，跳过 ${result.skipped} 行无效数据`
          : `已导入 ${count} 单`,
      );
    } finally {
      setImportXlsxBusy(false);
    }
  };

  /* ---- 备份密码弹窗：打开即重置表单并刷新自定义密码状态 ---- */
  const openPwdModal = () => {
    setHasCustomPwd(hasCustomBackupPassword());
    setPwdCurrent("");
    setPwdNew("");
    setPwdNewConfirm("");
    setPwdError("");
    setPwdModalOpen(true);
  };

  /* ---- 设置/修改自定义备份密码：当前密码验证 + 两次新密码一致 ---- */
  const handleSaveBackupPassword = async () => {
    if (pwdBusy) return;
    const current = pwdCurrent.trim();
    const next = pwdNew.trim();
    if (!current) {
      setPwdError("请输入当前密码");
      return;
    }
    if (!next) {
      setPwdError("请输入新密码");
      return;
    }
    if (next.length < 6) {
      setPwdError("新密码至少 6 位");
      return;
    }
    if (next !== pwdNewConfirm.trim()) {
      setPwdError("两次输入的新密码不一致");
      return;
    }
    setPwdBusy(true);
    setPwdError("");
    try {
      const err = await changeBackupPassword(current, next);
      if (err) {
        setPwdError(err);
        return;
      }
      setHasCustomPwd(true);
      setPwdModalOpen(false);
      showToast("自定义备份密码已设置");
    } finally {
      setPwdBusy(false);
    }
  };

  /* ---- 恢复默认备份密码（工程师手机号后6位）：需输入当前自定义密码验证 ---- */
  const handleResetBackupPassword = async () => {
    if (pwdBusy) return;
    const current = pwdCurrent.trim();
    if (!current) {
      setPwdError("请输入当前密码");
      return;
    }
    setPwdBusy(true);
    setPwdError("");
    try {
      const err = await resetBackupPasswordToDefault(current);
      if (err) {
        setPwdError(err);
        return;
      }
      setHasCustomPwd(false);
      setPwdModalOpen(false);
      showToast("已恢复默认备份密码");
    } finally {
      setPwdBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="card__title">数据管理</div>
      <div className="flex-column gap-sm">
        {/* 自动备份开关：勾选即存（自地图服务区块挪入） */}
        <label className="flex gap-sm text-sm">
          <input
            type="checkbox"
            checked={autoBackup}
            onChange={(e) => handleToggleAutoBackup(e.target.checked)}
          />
          自动备份（订单数据有变动时自动备份到本地）
        </label>
        <button
          type="button"
          className="btn btn--outline btn--block"
          onClick={handleExportBackup}
        >
          <Icon name="export" size={18} />
          导出备份（JSON）
        </button>
        <button
          type="button"
          className={
            importBackupBusy
              ? "btn btn--outline btn--block btn--loading"
              : "btn btn--outline btn--block"
          }
          disabled={importBackupBusy}
          onClick={() => backupFileRef.current?.click()}
        >
          <Icon name="import" size={18} />
          导入备份（JSON）
        </button>
        <button
          type="button"
          className={
            exportXlsxBusy
              ? "btn btn--outline btn--block btn--loading"
              : "btn btn--outline btn--block"
          }
          disabled={exportXlsxBusy}
          onClick={handleExportXlsx}
        >
          <Icon name="export" size={18} />
          导出订单（Excel）
        </button>
        <button
          type="button"
          className={
            importXlsxBusy
              ? "btn btn--outline btn--block btn--loading"
              : "btn btn--outline btn--block"
          }
          disabled={importXlsxBusy}
          onClick={() => xlsxFileRef.current?.click()}
        >
          <Icon name="import" size={18} />
          导入订单（Excel）
        </button>
        {/* 备份密码入口（任务S）：恢复出厂老数据解密用密码的本地覆盖值管理 */}
        <button
          type="button"
          className={
            pwdBusy
              ? "btn btn--outline btn--block btn--loading"
              : "btn btn--outline btn--block"
          }
          disabled={pwdBusy}
          onClick={openPwdModal}
        >
          <Icon name="settings" size={18} />
          备份密码设置
        </button>
        <p className="text-sm text-tertiary">
          {hasCustomPwd
            ? "当前已设置自定义备份密码（恢复出厂老数据时优先使用）"
            : "当前使用默认备份密码（工程师手机号后6位）"}
        </p>
      </div>
      {/* 隐藏的文件选择器 */}
      <input
        ref={backupFileRef}
        type="file"
        accept=".json,application/json"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleImportBackup(file);
          e.target.value = "";
        }}
      />
      <input
        ref={xlsxFileRef}
        type="file"
        accept=".xlsx,.xls"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleImportXlsx(file);
          e.target.value = "";
        }}
      />
      <p className="text-sm text-tertiary mt-sm">
        Excel 导入需包含「客户姓名」「客户电话」两列；备份 JSON
        包含订单、设置与自定义品牌，可完整恢复。
      </p>

      {/* 备份密码弹窗：自定义密码只改本地覆盖值（校验值+重加密信封），内置密文只读 */}
      <Modal
        open={pwdModalOpen}
        title="备份密码设置"
        onClose={() => {
          if (!pwdBusy) setPwdModalOpen(false);
        }}
        footer={
          <>
            <button
              type="button"
              className="btn btn--outline"
              disabled={pwdBusy}
              onClick={() => setPwdModalOpen(false)}
            >
              取消
            </button>
            <button
              type="submit"
              form="backup-pwd-form"
              className={
                pwdBusy ? "btn btn--primary btn--loading" : "btn btn--primary"
              }
              disabled={pwdBusy}
            >
              保存新密码
            </button>
          </>
        }
      >
        <form
          id="backup-pwd-form"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSaveBackupPassword();
          }}
        >
          <p className="text-sm text-tertiary mt-sm">
            {hasCustomPwd
              ? "当前已设置自定义备份密码。修改需先输入当前自定义密码。"
              : "当前使用默认备份密码（工程师手机号后6位）。设置自定义密码需先输入默认密码。"}
          </p>
          <FormField label="当前密码" required error={pwdError}>
            <input
              type="password"
              className={pwdError ? "input input--error" : "input"}
              value={pwdCurrent}
              onChange={(e) => {
                setPwdCurrent(e.target.value);
                setPwdError("");
              }}
              placeholder={hasCustomPwd ? "当前自定义密码" : "默认：工程师手机号后6位"}
              autoComplete="off"
            />
          </FormField>
          <FormField label="新密码（至少 6 位）" required>
            <input
              type="password"
              className="input"
              value={pwdNew}
              onChange={(e) => setPwdNew(e.target.value)}
              autoComplete="new-password"
            />
          </FormField>
          <FormField label="确认新密码" required>
            <input
              type="password"
              className="input"
              value={pwdNewConfirm}
              onChange={(e) => setPwdNewConfirm(e.target.value)}
              autoComplete="new-password"
            />
          </FormField>
          {hasCustomPwd ? (
            <button
              type="button"
              className="btn btn--outline btn--block"
              disabled={pwdBusy}
              onClick={() => void handleResetBackupPassword()}
            >
              恢复默认备份密码
            </button>
          ) : null}
          <p className="text-sm text-tertiary">
            自定义密码仅保存在本机（派生校验值+重加密备份，不存明文）；
            清除浏览器数据后自动回到默认密码。
          </p>
        </form>
      </Modal>
    </div>
  );
}
