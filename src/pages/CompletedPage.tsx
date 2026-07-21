/* ============================================================
 * 已完成页：仅展示「已完成」状态订单
 * 排序：完工日期倒序（最近完工在最前）
 * 筛选：全部 / 未回款 / 已回款（按 order.payment?.paid 判定，无 payment 视为未回款）
 * 操作：删除订单（二次确认，收进卡片 ⋯ 菜单）；标记回款（金额弹窗）/ 取消回款
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
import { FormField } from "@/components/common/FormField";
import { Modal } from "@/components/common/Modal";
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
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter | "">("");
  /* 常驻搜索关键词（姓名 / 电话 / 地址，复用首页 filterOrders 逻辑） */
  const [keyword, setKeyword] = useState("");
  /* 标记回款金额弹窗：payTarget 非空即打开，金额为字符串草稿 */
  const [payTarget, setPayTarget] = useState<Order | null>(null);
  const [payAmount, setPayAmount] = useState("");

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

  /* ---- 回款标记（标记/取消共用入口）----
   * AppContext 通用 updateOrder 已可承载 payment（OrderDraft 含 payment 字段）；
   * 展开整单传入，context 浅合并后等价于仅改 payment，无需新增 context 动作 */
  const setOrderPaid = (order: Order, paid: boolean, amount?: number) => {
    updateOrder(order.id, {
      ...order,
      payment: {
        ...order.payment,
        paid,
        /* 取消回款保留原金额，再次标记时作弹窗默认值 */
        amount: amount ?? order.payment?.amount,
      },
    });
  };

  /* ---- 标记回款：打开金额弹窗（默认带出已有金额） ---- */
  const openPayModal = (order: Order) => {
    setPayTarget(order);
    setPayAmount(
      order.payment?.amount != null ? String(order.payment.amount) : "",
    );
  };

  /* ---- 标记回款：确认（金额选填，空 = 未填金额按 0 计） ---- */
  const handleConfirmPay = () => {
    if (!payTarget) return;
    const trimmed = payAmount.trim();
    const amount = trimmed === "" ? undefined : Number(trimmed);
    if (amount !== undefined && (!Number.isFinite(amount) || amount < 0)) {
      showToast("回款金额请填写不小于 0 的数字");
      return;
    }
    setOrderPaid(payTarget, true, amount);
    setPayTarget(null);
    showToast(
      amount === undefined
        ? "已标记回款（未填金额按 0 计）"
        : `已标记回款 ${formatMoney(amount)}`,
    );
  };

  /* ---- 取消回款 ---- */
  const handleCancelPaid = (order: Order) => {
    setOrderPaid(order, false);
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
              {/* 回款操作行：标记回款 / 取消回款 */}
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
                    onClick={() => openPayModal(order)}
                  >
                    标记回款
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

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

      {/* 标记回款：金额输入弹窗（金额选填，默认带出已有金额） */}
      <Modal
        open={payTarget !== null}
        title="标记回款"
        onClose={() => setPayTarget(null)}
        footer={
          <>
            <button
              type="button"
              className="btn btn--outline"
              onClick={() => setPayTarget(null)}
            >
              取消
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={handleConfirmPay}
            >
              确定
            </button>
          </>
        }
      >
        <FormField label="回款金额（元，选填）">
          <input
            className="input"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={payAmount}
            placeholder="不填按 0 计入统计"
            onChange={(e) => setPayAmount(e.target.value)}
          />
        </FormField>
        <p className="text-sm text-tertiary mt-sm">
          客户：{payTarget?.customerName ?? ""}；不填金额则该单按 0
          计入未回款金额统计。
        </p>
      </Modal>
    </div>
  );
}
