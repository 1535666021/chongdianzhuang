/* ============================================================
 * 二次确认弹窗（删除订单 / 取消订单 / 清空数据 等危险操作）
 * 基于 Modal 基座，样式复用 index.css
 * ============================================================ */

import { Modal } from "@/components/common/Modal";
import type { ConfirmDialogProps } from "@/types";

export function ConfirmDialog({
  open,
  title,
  content,
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn btn--outline" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className={
              danger
                ? "btn btn--danger btn--lg"
                : "btn btn--primary btn--lg"
            }
            onClick={onConfirm}
          >
            确定
          </button>
        </>
      }
    >
      <p className="text-secondary">{content}</p>
    </Modal>
  );
}
