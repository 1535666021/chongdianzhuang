/* ============================================================
 * 轻提示（全局单例）
 * 数据源：AppContext 的 toast 字段；挂载一次于 App 根布局
 * ============================================================ */

import { createPortal } from "react-dom";
import { useApp } from "@/context/AppContext";

export function Toast() {
  const { toast } = useApp();
  if (!toast) return null;

  return createPortal(
    <div className="toast anim-fade-in" role="status">
      {toast}
    </div>,
    document.body,
  );
}
