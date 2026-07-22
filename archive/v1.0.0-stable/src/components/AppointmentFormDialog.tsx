/* ============================================================
 * 预约安装弹窗（独立业务弹窗组件）
 * 规范：基于公共 Modal 基座 + FormField，样式全部使用 index.css
 *      全局类与变量，零硬编码；任何页面需要预约功能时直接引入复用
 * ============================================================ */

import { useEffect, useState } from "react";
import { Modal } from "@/components/common/Modal";
import { FormField } from "@/components/common/FormField";
import { useApp } from "@/context/AppContext";
import { todayStr } from "@/lib/utils";
import type { Order } from "@/types";

export interface AppointmentFormDialogProps {
  /** 目标订单；为 null 时弹窗关闭 */
  order: Order | null;
  onClose: () => void;
}

/** 可选时间段（统一管理，避免各页面重复定义） */
const TIME_SLOTS = [
  { value: "09:00-12:00", label: "上午 09:00-12:00" },
  { value: "14:00-18:00", label: "下午 14:00-18:00" },
  { value: "18:00-21:00", label: "晚上 18:00-21:00" },
] as const;

export function AppointmentFormDialog({
  order,
  onClose,
}: AppointmentFormDialogProps) {
  const { settings, saveAppointment, showToast } = useApp();

  const [date, setDate] = useState(todayStr());
  const [timeSlot, setTimeSlot] = useState<string>(TIME_SLOTS[0].value);
  const [installer, setInstaller] = useState("");
  const [note, setNote] = useState("");

  /* 每次打开时重置表单：默认今天 / 默认师傅 / 清空备注
     师傅带入：人员默认（defaultInstaller）优先，回退工程师姓名（engineerName），均未配=空 */
  useEffect(() => {
    if (!order) return;
    setDate(todayStr());
    setTimeSlot(TIME_SLOTS[0].value);
    setInstaller(settings.defaultInstaller || settings.engineerName || "");
    setNote("");
  }, [order, settings.defaultInstaller, settings.engineerName]);

  const handleSubmit = () => {
    if (!order) return;
    if (!date) {
      showToast("请选择预约日期");
      return;
    }
    if (!installer.trim()) {
      showToast("请填写安装师傅");
      return;
    }
    saveAppointment(order.id, {
      appointmentDate: date,
      timeSlot,
      installer: installer.trim(),
      note: note.trim(),
    });
    showToast("预约成功，订单进入「已预约」");
    onClose();
  };

  return (
    <Modal
      open={order !== null}
      title={order ? `预约安装 · ${order.customerName}` : "预约安装"}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--outline" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn btn--primary btn--lg"
            onClick={handleSubmit}
          >
            确定预约
          </button>
        </>
      }
    >
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
          {TIME_SLOTS.map((slot) => (
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

      <FormField label="预约备注">
        <textarea
          className="textarea"
          value={note}
          placeholder="选填：客户特殊时间要求等"
          onChange={(e) => setNote(e.target.value)}
        />
      </FormField>
    </Modal>
  );
}
