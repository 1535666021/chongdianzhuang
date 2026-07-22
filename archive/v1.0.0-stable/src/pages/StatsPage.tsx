/* ============================================================
 * 统计页：纯展示，所有指标由 utils 的 calcOrderStats 一次算出
 * 结构：财务概览（对账单式科目列表 + 科目明细弹层）→ 总览 →
 *      状态分布 → 品牌分布 → 月度趋势 → 物料用量 → 平台维度 → 回款统计
 * 财务数据唯一入口：@/lib/statistics（视图层零业务计算）
 * 口径（G2/G3）：除"月度趋势"保留全量跨月外，其余区块一律按
 * 月份选择器过滤后的 monthOrders（当月口径）取数。
 * ============================================================ */

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Icon } from "@/components/common/Icon";
import { Modal } from "@/components/common/Modal";
import { StatusTag } from "@/components/common/StatusTag";
import { useApp } from "@/context/AppContext";
import {
  exportExcelReconciliation,
  getAvailableMonths,
  getMonthlyFinanceStats,
} from "@/lib/statistics";
import { calcOrderStats, formatMoney } from "@/lib/utils";
import {
  getUnpaidStats,
  getPlatformStats,
  getMaterialUsageSummary,
} from "@/lib/statistics";
import type { MonthSubject } from "@/types";

/** 对账/实际两利润科目的固定短注（提炼自各自 formula 口径说明，硬编码展示） */
const SUBJECT_SIDE_NOTE: Record<string, string> = {
  reconciliation: "明面账",
  actual: "含辅材隐性成本",
};

/** 科目行/弹层头部的金额展示：单量科目用 amountText（"20 单（装13/修4/勘3）"），
 * 金额科目（含平均利润）用 formatMoney（千分位 + ¥） */
function subjectAmountText(subject: MonthSubject): string {
  return subject.amountText ?? formatMoney(subject.amount);
}

/** 金额保留两位小数（弹层合计行 Σentries 与科目 amount 对照用，与 statistics.ts 同口径） */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 占比条：宽度按占比动态计算，颜色引用全局变量（非硬编码） */
function PercentBar({ ratio }: { ratio: number }) {
  const width = `${Math.round(Math.min(Math.max(ratio, 0), 1) * 100)}%`;
  return (
    <div
      style={{
        width,
        height: "100%",
        backgroundColor: "var(--color-primary)",
        borderRadius: "var(--radius-full)",
        transition: "width var(--transition-normal)",
      }}
    />
  );
}

/** 条形行容器（状态/月度共用，避免重复结构） */
function BarRow({
  label,
  valueText,
  ratio,
}: {
  label: ReactNode;
  valueText: string;
  ratio: number;
}) {
  return (
    <div className="list-item">
      <div className="list-item__main">
        <div className="flex-between">
          {label}
          <span className="text-sm text-bold">{valueText}</span>
        </div>
        <div
          style={{
            height: "6px",
            backgroundColor: "var(--color-bg-muted)",
            borderRadius: "var(--radius-full)",
            overflow: "hidden",
          }}
        >
          <PercentBar ratio={ratio} />
        </div>
      </div>
    </div>
  );
}

/** G1：月份下拉显示格式统一 "YYYY年M月"（月份不补零；option 的 value 仍为 "YYYY-MM"） */
function formatMonthLabel(yearMonth: string): string {
  const [y, m] = yearMonth.split("-");
  return `${y}年${Number(m)}月`;
}

export function StatsPage() {
  const { orders, brands } = useApp();

  /* ---------- 财务概览：月份选择 + 八科目对账单 + 科目明细弹层 ---------- */
  const availableMonths = useMemo(() => getAvailableMonths(orders), [orders]);
  const [selectedMonth, setSelectedMonth] = useState(
    () => getAvailableMonths(orders)[0] ?? "",
  );
  /* 当前打开明细弹层的科目 key（null = 弹层关闭）；切月后按 key 重取新月份数据 */
  const [activeSubjectKey, setActiveSubjectKey] = useState<string | null>(null);

  /* G2：当月订单——除"月度趋势"外所有区块的统一数据源。
   * G4 归月口径与 statistics.ts 保持一致：completion.completeDate 优先，
   * 无则 createdAt 兜底，取日期串前 7 位（YYYY-MM）与 selectedMonth 比较；
   * 缺失/非法日期自然不匹配、被排除在外。 */
  const monthOrders = useMemo(
    () =>
      orders.filter((o) => {
        const dateStr = o.completion?.completeDate ?? o.createdAt;
        return !!dateStr && dateStr.slice(0, 7) === selectedMonth;
      }),
    [orders, selectedMonth],
  );

  /* G2：当月口径统计（总览 / 状态分布 / 品牌分布 / 物料用量均取自此） */
  const monthStats = useMemo(
    () => calcOrderStats(monthOrders, brands),
    [monthOrders, brands],
  );

  /* G3：stats 为全量跨月口径，仅用于"月度趋势"区块
   *（跨月对比必须看全量数据，是本页唯一不随月份选择器切换的例外） */
  const stats = useMemo(() => calcOrderStats(orders, brands), [orders, brands]);

  /* 阶段3（G2 改当月口径）：平台维度 / 未回款（当月完工单）/ 物料领用（材料库口径） */
  const platformStats = useMemo(
    () => getPlatformStats(monthOrders).sort((a, b) => b.profit - a.profit),
    [monthOrders],
  );
  const unpaid = useMemo(
    () => getUnpaidStats(monthOrders.filter((o) => o.status === "completed")),
    [monthOrders],
  );
  const usageSummary = useMemo(
    () => getMaterialUsageSummary(monthOrders),
    [monthOrders],
  );

  /* 八科目对账单唯一数据源（subjects 逐单明细已随月份一次算好，弹层直接消费） */
  const finance = useMemo(
    () => getMonthlyFinanceStats(selectedMonth, orders),
    [selectedMonth, orders],
  );

  /* 弹层当前科目：按 key 从当月 subjects 重取，切月即重算（弹层数据随月份联动） */
  const activeSubject =
    finance.subjects.find((s) => s.key === activeSubjectKey) ?? null;

  // 订单变化导致月份列表更新时，若当前选中月份已不存在则回退到列表首项
  useEffect(() => {
    if (!availableMonths.includes(selectedMonth)) {
      setSelectedMonth(availableMonths[0] ?? "");
    }
  }, [availableMonths, selectedMonth]);

  const handleExport = async () => {
    const blob = await exportExcelReconciliation(selectedMonth, orders);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `对账单-${selectedMonth}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /* G2：总览/状态分布指标一律取当月口径 monthStats */
  const completedCount =
    monthStats.byStatus.find((s) => s.status === "completed")?.count ?? 0;
  const maxStatusCount = Math.max(
    1,
    ...monthStats.byStatus.map((s) => s.count),
  );
  const maxMonthCount = Math.max(
    1,
    ...stats.byMonth.map((m) => Math.max(m.created, m.completed)),
  );

  return (
    <div className="page">
      <div className="page-header">
        <span className="page-header__title">统计</span>
      </div>

      <div className="page-body">
        {/* 财务概览：月份选择器 + 对账单式八科目列表 + 导出 */}
        <div className="card">
          <div className="card__title">财务概览</div>
          <select
            className="month-select"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
          >
            {availableMonths.map((m) => (
              <option key={m} value={m}>
                {formatMonthLabel(m)}
              </option>
            ))}
          </select>
          {finance ? (
            <>
              {/* 对账单科目列表：单列 100% 宽，逐行可点查明细 */}
              <div className="bill-subject">
                {finance.subjects.map((subject) => (
                  <button
                    type="button"
                    key={subject.key}
                    className="bill-subject__row"
                    onClick={() => setActiveSubjectKey(subject.key)}
                  >
                    <span className="bill-subject__label">
                      {subject.label}
                      {SUBJECT_SIDE_NOTE[subject.key] ? (
                        <span className="bill-subject__note">
                          {SUBJECT_SIDE_NOTE[subject.key]}
                        </span>
                      ) : null}
                    </span>
                    <span className="bill-subject__amount">
                      {subjectAmountText(subject)}
                    </span>
                    <Icon
                      name="chevron-right"
                      size={16}
                      className="bill-subject__chevron"
                    />
                  </button>
                ))}
              </div>
              <button className="btn--export" onClick={handleExport}>
                <span className="flex-center gap-xs">
                  <Icon name="export" size={16} />
                  导出Excel对账单
                </span>
              </button>
            </>
          ) : (
            <p className="text-sm text-tertiary">当前月份暂无财务数据</p>
          )}
        </div>

        {orders.length === 0 ? (
          /* 空态：Icon + 一句话（复用 .empty-state 既有样式） */
          <div className="empty-state">
            <div className="empty-state__icon">
              <Icon name="chart" size={48} />
            </div>
            <div className="empty-state__text">
              暂无数据，录入订单后自动生成统计
            </div>
          </div>
        ) : (
          <>
            {/* 总览（G2：当月口径；stat-grid--safe 防窄屏溢出） */}
            {monthOrders.length === 0 ? (
              <p className="text-sm text-tertiary">当月暂无订单数据</p>
            ) : (
              <div className="stat-grid stat-grid--safe">
                <div className="stat-card">
                  <span className="stat-card__value">
                    {monthStats.totalCount}
                  </span>
                  <span className="stat-card__label">订单总数</span>
                  <span className="stat-card__label">当月新增</span>
                </div>
                <div className="stat-card">
                  <span className="stat-card__value">{completedCount}</span>
                  <span className="stat-card__label">已完成</span>
                </div>
                <div className="stat-card">
                  <span className="stat-card__value">
                    {monthStats.totalCount === 0
                      ? "0%"
                      : `${Math.round((completedCount / monthStats.totalCount) * 100)}%`}
                  </span>
                  <span className="stat-card__label">完工率</span>
                </div>
                <div className="stat-card">
                  <span className="stat-card__value">
                    {monthStats.avgCompleteDays}
                  </span>
                  <span className="stat-card__label">平均完工周期（天）</span>
                </div>
              </div>
            )}

            {/* 状态分布（G2：当月口径） */}
            <div className="card">
              <div className="card__title">状态分布</div>
              {monthStats.totalCount === 0 ? (
                <p className="text-sm text-tertiary">当月暂无订单数据</p>
              ) : (
                monthStats.byStatus.map((item) => (
                  <BarRow
                    key={item.status}
                    label={<StatusTag status={item.status} />}
                    valueText={`${item.count} 单`}
                    ratio={item.count / maxStatusCount}
                  />
                ))
              )}
            </div>

            {/* 品牌分布（G2：当月口径） */}
            <div className="card">
              <div className="card__title">品牌分布</div>
              {monthStats.byBrand.filter((b) => b.count > 0).length === 0 ? (
                <p className="text-sm text-tertiary">当月暂无品牌数据</p>
              ) : (
                monthStats.byBrand
                  .filter((b) => b.count > 0)
                  .map((brand) => (
                    <div key={brand.brandId} className="list-item">
                      <div className="list-item__main">
                        <span className="list-item__title">
                          {brand.brandName}
                        </span>
                        <span className="list-item__desc">
                          已完成 {brand.completedCount} / 共 {brand.count} 单
                        </span>
                      </div>
                      <div className="list-item__extra">
                        <span className="text-lg text-bold text-primary-color">
                          {brand.count}
                        </span>
                      </div>
                    </div>
                  ))
              )}
            </div>

            {/* 月度趋势（G3：唯一保留全量跨月口径的区块，用于跨月对比，
                不随月份选择器切换；数据源为全量 stats.byMonth） */}
            <div className="card">
              <div className="card__title">月度趋势</div>
              {stats.byMonth.length === 0 ? (
                <p className="text-sm text-tertiary">暂无月度数据</p>
              ) : (
                stats.byMonth.map((month) => (
                  <BarRow
                    key={month.month}
                    label={
                      <span className="text-sm text-bold">{month.month}</span>
                    }
                    valueText={`新增 ${month.created} · 完工 ${month.completed}`}
                    ratio={
                      Math.max(month.created, month.completed) / maxMonthCount
                    }
                  />
                ))
              )}
            </div>

            {/* 物料用量（G2：当月完工单物料，复用 calcOrderStats(monthOrders) 结果） */}
            <div className="card">
              <div className="card__title">物料用量汇总（按完工订单）</div>
              {monthStats.materialUsage.length === 0 ? (
                <p className="text-sm text-tertiary">
                  当月暂无物料数据，完工登记时填写物料后自动汇总
                </p>
              ) : (
                monthStats.materialUsage.map((m) => (
                  <div key={`${m.name}|${m.spec}|${m.unit}`} className="list-item">
                    <div className="list-item__main">
                      <span className="list-item__title">
                        {m.name}
                        <span className="text-sm text-tertiary">
                          {" "}
                          {m.spec}
                        </span>
                      </span>
                      <span className="list-item__desc">
                        用量 {m.totalQuantity}
                        {m.unit}
                        {m.totalAmount > 0
                          ? ` · 金额 ${formatMoney(m.totalAmount)}`
                          : ""}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* 平台维度统计（阶段3，G2 当月口径：getPlatformStats(monthOrders)） */}
            <div className="card">
              <div className="card__title">平台维度（完工单量 / 利润）</div>
              {platformStats.length === 0 ? (
                <p className="text-sm text-tertiary">当月暂无完工订单</p>
              ) : (
                platformStats.map((row) => (
                  <div key={row.platform} className="list-item">
                    <div className="list-item__main">
                      <span className="list-item__title">{row.platform}</span>
                      <span className="list-item__desc">
                        {row.count} 单 · 利润 {formatMoney(row.profit)}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* 回款统计（阶段3，G2 当月口径：未回款取当月完工单，领用取 monthOrders 汇总） */}
            <div className="card">
              <div className="card__title">回款统计</div>
              {monthOrders.length === 0 ? (
                <p className="text-sm text-tertiary">当月暂无订单数据</p>
              ) : (
                <>
                  <div className="list-item">
                    <div className="list-item__main">
                      <span className="list-item__title">未回款订单</span>
                      <span className="list-item__desc">
                        {unpaid.count} 单 · 未回款金额{" "}
                        {formatMoney(unpaid.amount)}
                        {unpaid.missingAmount > 0
                          ? `（${unpaid.missingAmount} 单未填金额按 0 计）`
                          : ""}
                      </span>
                    </div>
                  </div>
                  <div className="list-item">
                    <div className="list-item__main">
                      <span className="list-item__title">
                        领用记录（材料库口径）
                      </span>
                      <span className="list-item__desc">
                        {usageSummary.usageRecordCount} 条 · 合计{" "}
                        {formatMoney(usageSummary.usageRecordTotal)}
                      </span>
                    </div>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* 科目明细弹层：顶部 label + 金额大字 → 口径 formula → 逐单明细/派生提示 */}
      {activeSubject && (
        <Modal
          open
          title={activeSubject.label}
          onClose={() => setActiveSubjectKey(null)}
          footer={
            <>
              <span className="flex-1" />
              <button
                type="button"
                className="btn btn--outline"
                onClick={() => setActiveSubjectKey(null)}
              >
                关闭
              </button>
            </>
          }
        >
          {/* 顶部：label + 金额大字 */}
          <div className="bill-subject__hero">
            <span className="bill-subject__hero-label">
              {activeSubject.label}
              {SUBJECT_SIDE_NOTE[activeSubject.key]
                ? ` · ${SUBJECT_SIDE_NOTE[activeSubject.key]}`
                : ""}
            </span>
            <span className="bill-subject__hero-amount">
              {subjectAmountText(activeSubject)}
            </span>
          </div>

          {/* 口径块：formula 全文（等宽数字右对齐，长公式允许换行） */}
          <div className="bill-subject__formula">
            <div className="bill-subject__block-title">计算口径</div>
            <p className="bill-subject__formula-text">
              {activeSubject.formula}
            </p>
          </div>

          {/* 明细块：entries 非空逐单展示 + 合计对照；空 = 派生科目仅展示口径 */}
          {activeSubject.entries.length > 0 ? (
            <div className="bill-subject__entries">
              <div className="bill-subject__block-title">
                逐单明细（{activeSubject.entries.length}）
              </div>
              {activeSubject.entries.map((entry) => (
                <div className="bill-subject__entry" key={entry.orderId}>
                  <div className="bill-subject__entry-main">
                    <span className="bill-subject__entry-name">
                      {entry.customerName}
                    </span>
                    <span className="bill-subject__entry-date">
                      {entry.date}
                      {entry.note && activeSubject.key !== "volume"
                        ? ` · ${entry.note}`
                        : ""}
                    </span>
                  </div>
                  <span
                    className={
                      entry.amount < 0
                        ? "bill-subject__entry-amount bill-subject__entry-amount--negative"
                        : "bill-subject__entry-amount"
                    }
                  >
                    {/* 单量科目逐行值为服务类型（装/修/勘），金额科目为逐单金额 */}
                    {activeSubject.key === "volume"
                      ? (entry.note ?? `${entry.amount} 单`)
                      : formatMoney(entry.amount)}
                  </span>
                </div>
              ))}
              {/* 合计行：Σentries 与科目 amount 对照（应相等） */}
              <div className="bill-subject__total">
                <span>合计（{activeSubject.entries.length} 行）</span>
                <span className="bill-subject__total-amount">
                  {activeSubject.key === "volume"
                    ? `${round2(activeSubject.entries.reduce((t, e) => t + e.amount, 0))} 单`
                    : formatMoney(
                        round2(
                          activeSubject.entries.reduce(
                            (t, e) => t + e.amount,
                            0,
                          ),
                        ),
                      )}
                </span>
              </div>
              <p className="bill-subject__total-compare">
                与科目金额 {subjectAmountText(activeSubject)} 对照
                {round2(
                  activeSubject.entries.reduce((t, e) => t + e.amount, 0) -
                    activeSubject.amount,
                ) === 0
                  ? "，一致"
                  : `，差额 ${formatMoney(
                      round2(
                        activeSubject.entries.reduce(
                          (t, e) => t + e.amount,
                          0,
                        ) - activeSubject.amount,
                      ),
                    )}`}
              </p>
            </div>
          ) : (
            <p className="bill-subject__derived-tip">
              该科目为派生指标，无逐单明细
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}
