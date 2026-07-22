/* ============================================================
 * 基础弹窗（唯一基座）
 * 规范：所有业务弹窗必须基于本组件开发，禁止页面自造弹窗
 * 样式：全部复用 index.css 的 .modal-mask / .modal* 类
 * ============================================================ */

import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";

export interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** 底部按钮区（通常放 取消/确定） */
  footer?: ReactNode;
}

export function Modal({ open, title, onClose, children, footer }: ModalProps) {
  /* 打开时锁定背景滚动，关闭时恢复 */
  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="modal-mask anim-fade-in"
      onClick={(e) => {
        // 点遮罩空白处关闭；点弹窗内部不触发
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal anim-slide-up" role="dialog" aria-label={title}>
        <div className="modal__header">
          <div className="modal__title">{title}</div>
          <button
            type="button"
            className="modal__close"
            aria-label="关闭"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="modal__body">{children}</div>
        {footer ? <div className="modal__footer">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
