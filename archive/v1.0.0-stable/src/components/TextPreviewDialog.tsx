/* ============================================================
 * 外发文本统一预览编辑弹窗（任务v35 二 · 总规矩封存件）
 * 规矩：凡发给客户或公司的文本（勘测/完工话术、预约清单、一键补桩
 *      发货单、水印名），复制前一律先弹预览 → 预览内可直接编辑 →
 *      确认后再复制；本组件为唯一预览编辑器，各场景只负责喂初始文本
 *      与接复制回调，样式全部复用 Modal 基座与现有类
 * ============================================================ */

import { useEffect, useState } from "react";
import { Modal } from "@/components/common/Modal";

export interface TextPreviewDialogProps {
  open: boolean;
  /** 弹窗标题（如 勘测话术预览 / 发货单预览 / 水印名预览） */
  title: string;
  /** 初始文本（每次打开时载入编辑框；打开期间外部文本变化不覆盖手改） */
  text: string;
  onClose: () => void;
  /** 点「复制」：回传编辑后文本（剪贴板写入与 toast 由调用方完成） */
  onCopy: (editedText: string) => void;
}

export function TextPreviewDialog({
  open,
  title,
  text,
  onClose,
  onCopy,
}: TextPreviewDialogProps) {
  const [draft, setDraft] = useState(text);

  /* 每次打开重置为最新初始文本（关闭期间的编辑不留存） */
  useEffect(() => {
    if (open) setDraft(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => onCopy(draft)}
        >
          复制
        </button>
      }
    >
      <textarea
        className="input text-preview-editor"
        value={draft}
        aria-label="预览文本，可直接编辑"
        onChange={(e) => setDraft(e.target.value)}
      />
      <p className="text-sm text-tertiary">
        内容可直接修改，点「复制」按修改后的文本复制。
      </p>
    </Modal>
  );
}
