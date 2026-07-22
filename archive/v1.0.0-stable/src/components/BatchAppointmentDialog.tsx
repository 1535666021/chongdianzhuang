/* ============================================================
 * 片区批量预约弹窗（任务R-R3：首页片区分组选中后的智能预约）
 * 规范：基于公共 Modal 基座 + FormField，样式全部使用 index.css
 *      全局类与变量，零硬编码
 * 写入：该片待办单（待勘测/已勘测）确认后逐单 AppContext.saveAppointment
 *      一键转已预约；已预约单自动跳过不重复预约
 * 时段：与 AppointmentFormDialog 保持一致（统一引用
 *      geoCluster.BATCH_APPOINTMENT_TIME_SLOTS，不重复定义）
 * ============================================================ */

import { useEffect, useState } from "react";
import { Modal } from "@/components/common/Modal";
import { FormField } from "@/components/common/FormField";
import { StatusTag } from "@/components/common/StatusTag";
import { useApp } from "@/context/AppContext";
import { todayStr } from "@/lib/utils";
import {
  BATCH_APPOINTMENT_TIME_SLOTS,
  getAppointableOrders,
} from "@/lib/geoCluster";
import type {
  AreaCluster,
  BatchAppointmentDraft,
} from "@/lib/geoCluster";

export interface BatchAppointmentDialogProps {
  /** 目标片区聚组；为 null 时弹窗关闭 */
  cluster: AreaCluster | null;
  onClose: () => void;
}

/** 批量预约统一备注（逐单写入，标识来源；与旧片区推荐卡口径一致） */
const BATCH_NOTE = "批量预约";

export function BatchAppointmentDialog({
  cluster,
  onClose,
}: BatchAppointmentDialogProps) {
  const { settings, saveAppointment, showToast } = useApp();

  const [date, setDate] = useState(todayStr());
  const [timeSlot, setTimeSlot] = useState<string>(
    BATCH_APPOINTMENT_TIME_SLOTS[0].value,
  );
  const [installer, setInstaller] = useState("");

  /* 每次打开时重置表单：默认今天 / 第一个时段 / 默认师傅（与单单预约弹窗同模式）
     师傅带入：人员默认（defaultInstaller）优先，回退工程师姓名（engineerName），均未配=空 */
  useEffect(() => {
    if (!cluster) return;
    setDate(todayStr());
    setTimeSlot(BATCH_APPOINTMENT_TIME_SLOTS[0].value);
    setInstaller(settings.defaultInstaller || settings.engineerName || "");
  }, [cluster, settings.defaultInstaller, settings.engineerName]);

  /* 片内待办单（待勘测/已勘测）才批量转已预约；已预约单跳过（判定收敛在 lib） */
  const appointable = cluster ? getAppointableOrders(cluster.orders) : [];
  const skipped = cluster ? cluster.orders.length - appointable.length : 0;

  const handleSubmit = () => {
    if (!cluster || appointable.length === 0) return;
    if (!date) {
      showToast("请选择预约日期");
      return;
    }
    if (!installer.trim()) {
      showToast("请填写安装师傅");
      return;
    }
    const draft: BatchAppointmentDraft = {
      appointmentDate: date,
      timeSlot,
      installer: installer.trim(),
    };
    for (const order of appointable) {
      saveAppointment(order.id, { ...draft, note: BATCH_NOTE });
    }
    showToast(
      skipped > 0
        ? `已批量预约 ${appointable.length} 单，跳过 ${skipped} 单（已预约）`
        : `已批量预约 ${appointable.length} 单`,
    );
    onClose();
  };

  return (
    <Modal
      open={cluster !== null}
      title={cluster ? `批量预约 · ${cluster.name}片区` : "批量预约"}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--outline" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn btn--primary btn--lg"
            disabled={appointable.length === 0}
            onClick={handleSubmit}
          >
            确定预约（{appointable.length} 单）
          </button>
        </>
      }
    >
      {/* 涉及订单清单：待办单逐行列出（客户名 + 地址 + 状态标签），已预约单注明跳过 */}
      {appointable.length > 0 ? (
        <p className="text-sm text-secondary">
          将对本片区以下 {appointable.length} 单待办订单统一预约
          {skipped > 0 ? `（另 ${skipped} 单已预约，自动跳过）` : ""}：
        </p>
      ) : (
        <p className="text-sm text-secondary">
          本片区订单全部已预约，暂无可批量预约的待办单
        </p>
      )}
      {appointable.length > 0 ? (
        <div className="flex-column gap-xs">
          {appointable.map((order) => (
            <span key={order.id} className="flex-between gap-xs">
              <span className="flex-1 text-sm">
                {order.customerName} · {order.address}
              </span>
              <StatusTag status={order.status} />
            </span>
          ))}
        </div>
      ) : null}

      <FormField label="预约日期" required>
        <input
          className="input"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </FormField>

      <FormField label="时间段" required>
        <select
          className="select"
          value={timeSlot}
          onChange={(e) => setTimeSlot(e.target.value)}
        >
          {BATCH_APPOINTMENT_TIME_SLOTS.map((slot) => (
            <option key={slot.value} value={slot.value}>
              {slot.label}
            </option>
          ))}
        </select>
      </FormField>

      <FormField label="安装师傅" required>
        <input
          className="input"
          value={installer}
          placeholder="可在设置页配置默认师傅"
          onChange={(e) => setInstaller(e.target.value)}
        />
      </FormField>
    </Modal>
  );
}
