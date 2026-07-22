/* ============================================================
 * 表单项封装（各业务弹窗复用）
 * 结构：label（可带必填星号）+ 控件插槽 + 错误提示
 * ============================================================ */

import type { ReactNode } from "react";

interface FormFieldProps {
  label: string;
  required?: boolean;
  /** 校验失败时的错误文案；为空字符串/undefined 不显示 */
  error?: string;
  children: ReactNode;
}

export function FormField({ label, required, error, children }: FormFieldProps) {
  return (
    <div className="form-item">
      <label
        className={
          required
            ? "form-item__label form-item__label--required"
            : "form-item__label"
        }
      >
        {label}
      </label>
      {children}
      {error ? <div className="form-item__error">{error}</div> : null}
    </div>
  );
}
