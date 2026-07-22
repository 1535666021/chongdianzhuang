/* ============================================================
 * 利润明细弹窗（统计页：对账利润 / 实际利润 等卡片点击查看）
 * 五分组：增项费 / 平台扣点 / 材料成本 / 服务费 / 利润（计算过程）
 * 基于 Modal 基座，样式复用 index.css 的 .profit-* / .profit-steps__* 类
 * 数字列：等宽数字（tabular-nums）+ 右对齐（见 NUMERIC_CELL_STYLE 注释）
 * 只渲染不计算：breakdown 与 steps 由 lib/statistics.ts 预计算传入
 * （「服务费小计」= 安装+维修+勘测三档求和，口径同 statistics.ts 的
 *   serviceFeeTotal，为展示层对既有字段的合并呈现，不产生新口径）
 * ============================================================ */

import { Modal } from "@/components/common/Modal";
import { formatMoney } from "@/lib/utils";
import type { CSSProperties } from "react";
import type { CalculationStep, ProfitBreakdown } from "@/types";

export interface ProfitDetailDialogProps {
  open: boolean;
  onClose: () => void;
  /** 弹窗标题（如"对账利润 · 计算明细"） */
  title: string;
  /** 分组数据：增项费/扣点/材料成本/服务费（收入拆解） */
  breakdown: ProfitBreakdown;
  /** 计算过程步骤：不传用 breakdown.calculationSteps；传入则覆盖（StatsPage 各卡片传 buildStepsForCard 结果） */
  steps?: CalculationStep[];
}

/* 数字单元格样式：等宽数字右对齐。
 * index.css 不在本任务文件归属内，tabular-nums 无既有 class 可复用，
 * 故用内联样式（纯渲染属性，不涉及色值/尺寸等设计令牌硬编码） */
const NUMERIC_CELL_STYLE: CSSProperties = {
  fontVariantNumeric: "tabular-nums",
  textAlign: "right",
};

export function ProfitDetailDialog({
  open,
  onClose,
  title,
  breakdown,
  steps,
}: ProfitDetailDialogProps) {
  const { income, platformDeduction, cost } = breakdown;
  const displaySteps = steps ?? breakdown.calculationSteps;
  const finalResult =
    displaySteps.length > 0
      ? displaySteps[displaySteps.length - 1].result
      : null;
  /* 服务费小计 = 安装费 + 维修费 + 勘测费（同 statistics.ts serviceFeeTotal 口径） */
  const serviceFeeTotal = income.installFee + income.repairFee + income.surveyFee;

  return (
    <Modal open={open} title={title} onClose={onClose}>
      {/* 增项费 */}
      <section className="profit-section profit-section--income">
        <div className="profit-section__title">增项费</div>
        <div className="profit-row">
          <span>客户增项费</span>
          <span style={NUMERIC_CELL_STYLE}>
            {formatMoney(income.customerAddonFee)}
          </span>
        </div>
      </section>

      {/* 平台扣点（负数红色展示） */}
      <section className="profit-section profit-section--deduction">
        <div className="profit-section__title">平台扣点</div>
        <div className="profit-row">
          <span>平台扣点金额</span>
          <span
            className="profit-row__amount--negative"
            style={NUMERIC_CELL_STYLE}
          >
            {formatMoney(platformDeduction.amount)}
          </span>
        </div>
      </section>

      {/* 材料成本 */}
      <section className="profit-section profit-section--cost">
        <div className="profit-section__title">材料成本</div>
        <div className="profit-row">
          <span>材料领用成本</span>
          <span
            className="profit-row__amount--negative"
            style={NUMERIC_CELL_STYLE}
          >
            {formatMoney(cost.materialCost)}
          </span>
        </div>
        <div className="profit-section__desc">{cost.description}</div>
      </section>

      {/* 服务费（按服务类型：安装 / 维修 / 勘测） */}
      <section className="profit-section profit-section--income">
        <div className="profit-section__title">服务费</div>
        <div className="profit-row">
          <span>安装费</span>
          <span style={NUMERIC_CELL_STYLE}>
            {formatMoney(income.installFee)}
          </span>
        </div>
        <div className="profit-row">
          <span>维修费</span>
          <span style={NUMERIC_CELL_STYLE}>
            {formatMoney(income.repairFee)}
          </span>
        </div>
        <div className="profit-row">
          <span>勘测费</span>
          <span style={NUMERIC_CELL_STYLE}>
            {formatMoney(income.surveyFee)}
          </span>
        </div>
        <div className="profit-row profit-row--total">
          <span>服务费小计</span>
          <span style={NUMERIC_CELL_STYLE}>{formatMoney(serviceFeeTotal)}</span>
        </div>
      </section>

      {/* 利润（计算过程逐步展示） */}
      <section className="profit-section profit-section--steps">
        <div className="profit-section__title">利润</div>
        {displaySteps.length === 0 ? (
          <div className="profit-steps__empty">暂无数据</div>
        ) : (
          displaySteps.map((step, stepIndex) => (
            <div
              className="profit-steps__step"
              key={`${step.label}-${stepIndex}`}
            >
              <div>
                <strong>{step.label}</strong>：{step.formula}
              </div>
              {step.details.map((line, lineIndex) => (
                <div className="profit-steps__line" key={lineIndex}>
                  {line}
                </div>
              ))}
              <div
                className="profit-steps__result"
                style={NUMERIC_CELL_STYLE}
              >
                = {formatMoney(step.result)}
              </div>
            </div>
          ))
        )}
        {/* 底部一行加粗：最终结果 = 最后一步 result */}
        {finalResult !== null && (
          <div className="profit-row profit-row--total">
            <span>最终结果</span>
            <span style={NUMERIC_CELL_STYLE}>{formatMoney(finalResult)}</span>
          </div>
        )}
      </section>
    </Modal>
  );
}
