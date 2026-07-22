/* ============================================================
 * 智能识别预览弹窗（唯一预览组件）
 * 规范：业务口径（存疑标记/数量对账）全部来自 lib/parser 的
 *      buildParsePreview / parseOrderTextDetailed，本组件零判断只渲染；
 *      确认后才入库，取消可返回原文修改，禁止静默丢弃
 * ============================================================ */

import { Modal } from "@/components/common/Modal";
import { Icon } from "@/components/common/Icon";
import type { ParsePreviewRow } from "@/lib/parser";

export interface ParsePreviewDialogProps {
  open: boolean;
  /** 预览行（buildParsePreview 输出，已去重） */
  rows: ParsePreviewRow[];
  /** 原文疑似订单块数（> rows.length 时显著告警：可能吞单） */
  blockCount: number;
  /** 已自动跳过的重复单数（订单号/姓名+电话去重口径） */
  duplicated: number;
  /** 入库进行中（按钮 loading + 禁点） */
  busy: boolean;
  /** 确认入库（rows 的 draft 逐条 addOrder） */
  onConfirm: () => void;
  /** 返回修改（回到文本输入弹层，原文保留） */
  onCancel: () => void;
}

export function ParsePreviewDialog({
  open,
  rows,
  blockCount,
  duplicated,
  busy,
  onConfirm,
  onCancel,
}: ParsePreviewDialogProps) {
  /* 数量对账：原文疑似块多于识别结果 = 可能有单未被识别（吞单告警） */
  const missing = blockCount > rows.length ? blockCount - rows.length : 0;

  return (
    <Modal
      open={open}
      title={`识别到 ${rows.length} 单`}
      onClose={onCancel}
      footer={
        <>
          <button
            type="button"
            className="btn btn--outline"
            disabled={busy}
            onClick={onCancel}
          >
            返回修改
          </button>
          <button
            type="button"
            className={
              busy ? "btn btn--primary btn--loading" : "btn btn--primary"
            }
            disabled={busy || rows.length === 0}
            onClick={onConfirm}
          >
            {busy ? "入库中…" : `确认入库 ${rows.length} 单`}
          </button>
        </>
      }
    >
      {missing > 0 ? (
        <div className="parse-preview__alert" role="alert">
          <Icon name="alert" size={16} />
          <span>
            原文疑似 {blockCount} 单，仅识别出 {rows.length} 单，可能有{" "}
            {missing} 单未被识别，建议返回检查原文
          </span>
        </div>
      ) : null}
      {duplicated > 0 ? (
        <div className="parse-preview__dup">
          已按订单号 / 姓名+电话自动跳过重复 {duplicated} 单
        </div>
      ) : null}

      <div className="parse-preview__list">
        {rows.map((row, index) => (
          <div
            key={index}
            className={
              row.issues.length > 0
                ? "parse-preview__item parse-preview__item--warn"
                : "parse-preview__item"
            }
          >
            <div className="parse-preview__head">
              <span className="parse-preview__seq">{index + 1}</span>
              <span className="parse-preview__name">
                {row.item.customerName || "（缺姓名）"}
              </span>
              <span className="parse-preview__phone">
                {row.item.phone || "（缺电话）"}
              </span>
            </div>
            <div className="parse-preview__meta">
              <span>
                品牌：{row.brandName || "未识别"}
                {row.brandFallback ? "（待确认）" : ""}
              </span>
              <span>平台：{row.platformName || "未匹配"}</span>
            </div>
            <div className="parse-preview__addr">
              {row.item.address || "（缺地址）"}
            </div>
            {row.issues.length > 0 ? (
              <div className="parse-preview__issues">
                {row.issues.map((issue) => (
                  <span key={issue} className="parse-preview__issue">
                    {issue}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="parse-preview__tip">
        标黄字段为存疑项，入库后请及时补填；不阻塞本次入库
      </div>
    </Modal>
  );
}
