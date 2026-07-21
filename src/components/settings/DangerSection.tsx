/* ============================================================
 * 设置区块 · 危险操作（挂载由 SettingsPage「危险操作」二级页完成）
 * 内容：清空全部数据 / 恢复出厂老数据（内置 v7 备份 · 已加密）
 * 规范：两枚 .btn--danger 分卡隔离（不相邻，防误触）；二次确认
 *      ConfirmDialog 不变；恢复出厂改为密码弹窗（任务S 隐私整改）：
 *      点击 → 输入备份密码 → 解密 → 走原 importBackup 导入，
 *      密码错误明确提示"密码不对"，无任何明文兜底；
 *      异步动作沿用 busy 守卫 + .btn--loading
 * ============================================================ */

import { useState } from "react";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { FormField } from "@/components/common/FormField";
import { Modal } from "@/components/common/Modal";
import { useApp } from "@/context/AppContext";
import { DEFAULT_APP_SETTINGS } from "@/types";
import {
  clearAllData,
  loadCustomBrands,
  loadOrders,
  loadSettings,
} from "@/lib/storage";
import { restoreFactoryLegacyData } from "@/lib/legacyBackup";

export function DangerSection() {
  const { replaceAllData, showToast } = useApp();

  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [restoreFactoryOpen, setRestoreFactoryOpen] = useState(false);
  const [restoreFactoryBusy, setRestoreFactoryBusy] = useState(false);
  /* 恢复出厂密码弹窗：输入值 + 字段级错误（密码不对留在弹窗内提示，可重试） */
  const [restorePassword, setRestorePassword] = useState("");
  const [restoreError, setRestoreError] = useState("");

  /* ---- 清空全部数据：二次确认后清空，各配置区块随二级页重挂载自 storage 重读 ---- */
  const handleClearAll = () => {
    clearAllData();
    replaceAllData([], DEFAULT_APP_SETTINGS, []);
    setClearConfirmOpen(false);
    showToast("全部数据已清空");
  };

  /* ---- 恢复出厂密码弹窗：打开即重置输入与错误 ---- */
  const openRestoreDialog = () => {
    setRestorePassword("");
    setRestoreError("");
    setRestoreFactoryOpen(true);
  };

  /* ---- 恢复出厂老数据（内置 v7 密文备份）：密码解密 + busy 守卫防重复确认 ---- */
  const handleRestoreFactory = async () => {
    if (restoreFactoryBusy) return; /* 防重复确认 */
    const password = restorePassword.trim();
    if (!password) {
      setRestoreError("请输入备份密码");
      return;
    }
    setRestoreFactoryBusy(true);
    setRestoreError("");
    try {
      const err = await restoreFactoryLegacyData(password);
      if (err) {
        /* 密码不对：留在弹窗内字段级提示，允许直接重试；其余错误 Toast 并关窗 */
        if (err === "备份密码不对，请重试") {
          setRestoreError(err);
          return;
        }
        showToast(err);
        setRestoreFactoryOpen(false);
        return;
      }
      /* 与文件导入一致：导入成功后重载 storage 到全局状态 */
      replaceAllData(loadOrders(), loadSettings(), loadCustomBrands());
      showToast("出厂老数据已恢复（v7 迁移导入）");
      setRestoreFactoryOpen(false);
    } finally {
      setRestoreFactoryBusy(false);
    }
  };

  return (
    <>
      {/* 危险按钮分卡隔离：两枚 .btn--danger 不相邻，中间隔开防误触 */}
      <div className="card">
        <div className="card__title">清空全部数据</div>
        <button
          type="button"
          className="btn btn--danger btn--block"
          onClick={() => setClearConfirmOpen(true)}
        >
          清空全部数据
        </button>
        <p className="text-sm text-tertiary mt-sm">
          将删除所有订单、设置与自定义品牌，建议先导出备份。
        </p>
      </div>

      <div className="card">
        <div className="card__title">恢复出厂老数据</div>
        <button
          type="button"
          className={
            restoreFactoryBusy
              ? "btn btn--danger btn--block btn--loading"
              : "btn btn--danger btn--block"
          }
          disabled={restoreFactoryBusy}
          onClick={openRestoreDialog}
        >
          恢复出厂老数据
        </button>
        <p className="text-sm text-tertiary mt-sm">
          出厂备份已加密保护：需输入备份密码解密后，用内置 v7
          老备份覆盖现有全部数据，此操作不可恢复，建议先导出备份。
        </p>
      </div>

      <ConfirmDialog
        open={clearConfirmOpen}
        title="清空全部数据"
        content="确定清空所有订单、设置与自定义品牌吗？此操作不可恢复，建议先导出备份。"
        danger
        onConfirm={handleClearAll}
        onCancel={() => setClearConfirmOpen(false)}
      />

      {/* 恢复出厂密码弹窗：警示文案 + 密码输入 + 确认（回车即提交） */}
      <Modal
        open={restoreFactoryOpen}
        title="恢复出厂老数据"
        onClose={() => {
          if (!restoreFactoryBusy) setRestoreFactoryOpen(false);
        }}
        footer={
          <>
            <button
              type="button"
              className="btn btn--outline"
              disabled={restoreFactoryBusy}
              onClick={() => setRestoreFactoryOpen(false)}
            >
              取消
            </button>
            <button
              type="submit"
              form="restore-factory-form"
              className={
                restoreFactoryBusy
                  ? "btn btn--danger btn--loading"
                  : "btn btn--danger"
              }
              disabled={restoreFactoryBusy}
            >
              确认恢复
            </button>
          </>
        }
      >
        <form
          id="restore-factory-form"
          onSubmit={(e) => {
            e.preventDefault();
            void handleRestoreFactory();
          }}
        >
          <p className="text-sm text-tertiary mt-sm">
            将用内置 v7 老备份（140条订单+全部配置）覆盖现有全部数据，
            此操作不可恢复，建议先导出备份。
          </p>
          <FormField label="备份密码" required error={restoreError}>
            <input
              type="password"
              className={restoreError ? "input input--error" : "input"}
              value={restorePassword}
              onChange={(e) => {
                setRestorePassword(e.target.value);
                setRestoreError("");
              }}
              placeholder="默认：工程师手机号后6位"
              autoComplete="off"
              autoFocus
            />
          </FormField>
          <p className="text-sm text-tertiary">
            默认密码为工程师手机号后6位；若已在「数据管理」设置自定义备份密码，
            请输入自定义密码。
          </p>
        </form>
      </Modal>
    </>
  );
}
