/* ============================================================
 * 已完成页：仅展示「已完成」状态订单
 * 排序：完工日期倒序（最近完工在最前）
 * 筛选：全部 / 未回款 / 已回款（按 order.payment?.paid 判定，无 payment 视为未回款）
 * 操作：删除订单（二次确认，收进卡片 ⋯ 菜单）；标记回款（一键，无需弹窗）/ 取消回款
 * 阶段2-J2 布局重构：
 *   - 页头/筛选风格与首页一致：搜索框常驻（Icon search，姓名/电话/地址）、
 *     回款筛选 chips 一行横滑（功能逻辑不变）
 *   - 订单卡跟随统一新版式：已完成状态无主按钮，删除收进右上角 ⋯ 菜单
 * ============================================================ */

import { useMemo, useState } from "react";
import { OrderStatus, DEFAULT_ORDER_FILTER } from "@/types";
import type { Order } from "@/types";
import { Icon } from "@/components/common/Icon";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { FilterChips } from "@/components/common/FilterChips";
import type { ChipOption } from "@/components/common/FilterChips";
import { OrderCard } from "@/components/order/OrderCard";
import { useApp } from "@/context/AppContext";
import { filterOrders, formatMoney } from "@/lib/utils";

/** 回款筛选值；空串 = 全部（FilterChips 单选约定） */
type PaymentFilter = "unpaid" | "paid";

const PAYMENT_FILTER_OPTIONS: ChipOption<PaymentFilter>[] = [
  { value: "unpaid", label: "未回款" },
  { value: "paid", label: "已回款" },
];

/** 已回款判定：payment.paid === true；无 payment 视为未回款 */
function isPaid(order: Order): boolean {
  return order.payment?.paid === true;
}

export function CompletedPage() {
  const { orders, deleteOrder, updateOrder, showToast } = useApp();

  const [deleteTarget, setDeleteTarget] = useState<Order | null>(null);
  const [showMarkAllConfirm, setShowMarkAllConfirm] = useState(false);
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter | "">("");
  /* 常驻搜索关键词（姓名 / 电话 / 地址，复用首页 filterOrders 逻辑） */
  const [keyword, setKeyword] = useState("");

  /* 已完成订单：按完工日期倒序（无完工日期的排最后） */
  const completed = useMemo(
    () =>
      orders
        .filter((o) => o.status === OrderStatus.Completed)
        .sort((a, b) =>
          (b.completion?.completeDate ?? "").localeCompare(
            a.completion?.completeDate ?? "",
          ),
        ),
    [orders],
  );

  /* 回款筛选 + 关键词搜索后的展示列表（逻辑不变，仅叠加常驻搜索） */
  const filtered = useMemo(
    () =>
      filterOrders(
        paymentFilter === ""
          ? completed
          : completed.filter((o) => (paymentFilter === "paid") === isPaid(o)),
        { ...DEFAULT_ORDER_FILTER, keyword },
      ),
    [completed, paymentFilter, keyword],
  );

  /* 头部统计：未回款金额合计（无金额的单按 0 计，并单独注明单数） */
  const unpaidStats = useMemo(() => {
    const unpaid = completed.filter((o) => !isPaid(o));
    return {
      amount: unpaid.reduce((sum, o) => sum + (o.payment?.amount ?? 0), 0),
      noAmountCount: unpaid.filter((o) => o.payment?.amount == null).length,
    };
  }, [completed]);

  /* ---- 回款标记（一键，无需弹窗）----
   * 金额优先级：已填回款金额 > 新完工实收 > v7老单legacyProfit > 增项费 > 0 */
  const handleMarkPaid = (order: Order) => {
    const legacy = order.completion?.legacyProfit as Record<string, unknown> | undefined;
    const amount =
      order.payment?.amount ??
      order.completion?.profitData?.customerPaid ??
      (typeof legacy?.customerPaid === "number" ? legacy.customerPaid : undefined) ??
      order.completion?.addonFee ??
      0;
    updateOrder(order.id, {
      ...order,
      payment: {
        ...order.payment,
        paid: true,
        amount,
      },
    });
    showToast(`已标记回款 ${formatMoney(amount)}`);
  };

  /* ---- 全部回款（批量标记所有未回款订单）---- */
  const handleMarkAllPaid = () => {
    const unpaid = completed.filter((o) => !isPaid(o));
    let totalAmount = 0;
    for (const order of unpaid) {
      const legacy = order.completion?.legacyProfit as Record<string, unknown> | undefined;
      const amount =
        order.payment?.amount ??
        order.completion?.profitData?.customerPaid ??
        (typeof legacy?.customerPaid === "number" ? legacy.customerPaid : undefined) ??
        order.completion?.addonFee ??
        0;
      totalAmount += amount;
      updateOrder(order.id, {
        ...order,
        payment: {
          ...order.payment,
          paid: true,
          amount,
        },
      });
    }
    showToast(`已批量标记 ${unpaid.length} 单回款，合计 ${formatMoney(totalAmount)}`);
    setShowMarkAllConfirm(false);
  };

  /* ---- 取消回款 ---- */
  const handleCancelPaid = (order: Order) => {
    updateOrder(order.id, {
      ...order,
      payment: {
        ...order.payment,
        paid: false,
        /* 取消回款保留原金额，再次标记时作默认值 */
        amount: order.payment?.amount,
      },
    });
    showToast("已取消回款标记");
  };

  return (
    <div className="page">
      <div className="page-header">
        <span className="page-header__title">已完成</span>
        <div className="page-header__extra">
          <span className="text-sm text-secondary">
            共 {completed.length} 单
          </span>
          <span className="text-sm text-danger">
            未回款金额：{formatMoney(unpaidStats.amount)}
            {unpaidStats.noAmountCount > 0
              ? `（${unpaidStats.noAmountCount} 单未填金额按 0 计）`
              : ""}
          </span>
          {completed.filter((o) => !isPaid(o)).length > 0 && (
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={() => setShowMarkAllConfirm(true)}
            >
              全部回款
            </button>
          )}
        </div>
      </div>

      <div className="page-body">
        {/* 搜索框常驻（与首页一致：Icon search + 圆角搜索条） */}
        <div className="search-bar">
          <Icon name="search" size={20} className="text-tertiary" />
          <input
            className="search-bar__input"
            type="search"
            value={keyword}
            placeholder="搜索 姓名 / 电话 / 地址"
            aria-label="搜索已完成订单"
            onChange={(e) => setKeyword(e.target.value)}
          />
          {keyword ? (
            <button
              type="button"
              className="modal__close"
              aria-label="清空搜索"
              onClick={() => setKeyword("")}
            >
              ×
            </button>
          ) : null}
        </div>

        {/* 回款筛选：全部 / 未回款 / 已回款（一行横滑） */}
        <FilterChips<PaymentFilter>
          options={PAYMENT_FILTER_OPTIONS}
          value={paymentFilter}
          onChange={(next) => setPaymentFilter(next as PaymentFilter | "")}
        />

        {filtered.length === 0 ? (
          completed.length === 0 ? (
            /* 空态：Icon + 一句话（本页无页面级主操作，不放大按钮） */
            <div className="empty-state">
              <div className="empty-state__icon">
                <Icon name="check-circle" size={48} />
              </div>
              <div className="empty-state__text">
                暂无已完成订单，完工登记后会出现在这里
              </div>
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-state__icon">
                <Icon name="search" size={48} />
              </div>
              <div className="empty-state__text">当前筛选下暂无订单</div>
            </div>
          )
        ) : (
          filtered.map((order) => (
            <div key={order.id}>
              <OrderCard
                order={order}
                page="completed"
                onDelete={setDeleteTarget}
              />
              {/* 回款操作行：标记回款（一键）/ 取消回款 */}
              <div className="appt-order-actions">
                <span
                  className={
                    isPaid(order)
                      ? "text-sm text-secondary"
                      : "text-sm text-danger"
                  }
                >
                  {isPaid(order)
                    ? `已回款${
                        order.payment?.amount != null
                          ? ` ${formatMoney(order.payment.amount)}`
                          : ""
                      }`
                    : "未回款"}
                </span>
                {isPaid(order) ? (
                  <button
                    type="button"
                    className="btn btn--outline btn--sm"
                    onClick={() => handleCancelPaid(order)}
                  >
                    取消回款
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    onClick={() => handleMarkPaid(order)}
                  >
                    标记回款
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* 批量回款确认 */}
      <ConfirmDialog
        open={showMarkAllConfirm}
        title="全部回款确认"
        content={`确定将 ${completed.filter((o) => !isPaid(o)).length} 单未回款订单全部标记为已回款吗？`}
        onConfirm={handleMarkAllPaid}
        onCancel={() => setShowMarkAllConfirm(false)}
      />

      {/* 弹窗调度 */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除订单"
        content={`确定删除「${deleteTarget?.customerName ?? ""}」的订单吗？删除后不可恢复。`}
        danger
        onConfirm={() => {
          if (deleteTarget) {
            deleteOrder(deleteTarget.id);
            showToast("订单已删除");
          }
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

/* v36.2-P3-1-fix: 回款金额取值优先级修复确认 */
