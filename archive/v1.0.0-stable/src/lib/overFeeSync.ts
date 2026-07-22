/* ============================================================
 * 完工「超米费」增项行同步（任务R 契约§6，3号归属）
 * 职责：实际用线 → 生成/更新/移除「超米费」增项行
 *   超米费 = (实际用线 - 套包米数) × 超米单价；≤0 时不出现该行
 * 语义说明（甲方确认口径）：
 * - 本函数为纯函数，每次调用按入参【全量重算并覆盖】既有「超米费」行
 *   （数量与单价都按最新米数/费率重写）；
 * - 用户手调该行金额后，该行保留在清单中、不会被其他编辑动作冲掉；
 *   但【再次调用】本函数（即再次修改实际用线米数）会按最新米数重算，
 *   覆盖之前的手调金额——"手调后再改米数才重算覆盖"；
 * - 因此组件层只在「实际用线变化」与「打开表单初始化」时调用，
 *   两次米数变更之间的手调金额保持有效；
 * - 用户把该行改名后视为普通增项，不再参与自动同步。
 * ============================================================ */

import type { MaterialItem } from "@/types";

/** 「超米费」增项行名称（行识别依据；改名后不再自动同步） */
export const OVER_FEE_ROW_NAME = "超米费";

/**
 * 实际用线 → 同步「超米费」增项行：
 * - actualCable 有效且 actualCable - packageMeters > 0：
 *   移除既有「超米费」行后按最新值追加一行
 *   （name=超米费 / quantity=超米米数 / unit=米 / unitPrice=overMeterPrice）；
 * - actualCable 为空/非数/超米 ≤0：移除「超米费」行（该行不出现）；
 * - 其他增项行一律原样保留（含用户手调/新增/删除的结果）。
 *
 * @param materials     当前增项物料清单
 * @param actualCable   实际用线（米）；undefined 表示未填写
 * @param packageMeters 套包米数（调用方读 loadRateConfigs()，缺省 30）
 * @param overMeterPrice 超米单价（元/米，调用方读 loadRateConfigs()，缺省 45）
 */
export function syncOverFeeRow(
  materials: MaterialItem[],
  actualCable: number | undefined,
  packageMeters: number,
  overMeterPrice: number,
): MaterialItem[] {
  /* 先剔除既有「超米费」行：无论重算还是移除，其他行原样保留 */
  const others = materials.filter(
    (m) => m.name.trim() !== OVER_FEE_ROW_NAME,
  );
  const overMeters =
    actualCable != null && Number.isFinite(actualCable)
      ? Math.round((actualCable - packageMeters) * 100) / 100
      : 0;
  /* 超米 ≤0：该行不出现（实际用线未超套包/未填写） */
  if (overMeters <= 0) return others;
  return [
    ...others,
    {
      name: OVER_FEE_ROW_NAME,
      spec: "",
      quantity: overMeters,
      unit: "米",
      unitPrice: overMeterPrice,
    },
  ];
}
