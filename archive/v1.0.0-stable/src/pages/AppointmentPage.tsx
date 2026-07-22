/* ============================================================
 * 已预约页：仅展示「已预约」状态订单，按预约日期三分组
 *   今天待装：路线排序（有坐标按贪心最近邻，无坐标排最后）+ 一键导航
 *   未来预约：预约日期+时段升序（复用 utils）+ 改期
 *   过期未装：整组标红 + 重新预约 / 回退已勘测
 * 阶段2-J2 布局重构：
 *   - 页头/筛选风格与首页一致：搜索框常驻（Icon search，姓名/电话/地址）
 *   - 订单卡跟随统一新版式：登记完工 = 卡片状态主按钮（.btn--md 靠右），
 *     取消订单收进卡片右上角 ⋯ 菜单；
 *     页面级扩展操作（上门话术 / 一键导航 / 改期 / 重新预约 / 回退已勘测）
 *     仍放卡片下方操作行（.appt-order-actions），不再与卡片主按钮重复
 * 弹窗均为独立组件，本页只调度
 * ============================================================ */

import { useMemo, useState } from "react";
import { OrderStatus, DEFAULT_ORDER_FILTER } from "@/types";
import type { Order } from "@/types";
import { Icon } from "@/components/common/Icon";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { OrderCard } from "@/components/order/OrderCard";
import { CompleteModal } from "@/components/modals/CompleteModal";
import { SurveyModal } from "@/components/modals/SurveyModal";
import { AppointmentFormDialog } from "@/components/AppointmentFormDialog";
import { ScriptDialog } from "@/components/ScriptDialog";
import { useApp } from "@/context/AppContext";
import { buildAmapNaviUrl } from "@/lib/geoCache";
import { filterOrders, sortOrdersByAppointment, todayStr } from "@/lib/utils";
import { getScript } from "@/lib/scripts";
import { loadBrandScripts } from "@/lib/storage";

/** 是否有可用坐标（路线排序 / 一键导航共用判定） */
function hasGeo(order: Order): boolean {
  return order.longitude !== undefined && order.latitude !== undefined;
}

/** 两点距离：简单欧氏近似（同城小范围排序足够，无需球面公式） */
function approxDistance(a: Order, b: Order): number {
  const dx = (a.longitude ?? 0) - (b.longitude ?? 0);
  const dy = (a.latitude ?? 0) - (b.latitude ?? 0);
  return dx * dx + dy * dy;
}

/**
 * 路线排序：有坐标的订单按贪心最近邻排列
 * （从第一单开始，每下一单取离当前单最近的剩余单）；
 * 无坐标的排最后，保持原顺序
 */
function sortOrdersByRoute(orders: Order[]): Order[] {
  const remaining = orders.filter(hasGeo);
  const noGeo = orders.filter((o) => !hasGeo(o));
  const sorted: Order[] = [];
  let current = remaining.shift();
  while (current) {
    sorted.push(current);
    let nearestIdx = -1;
    let nearestDist = Infinity;
    for (let i = 0; i < remaining.length; i += 1) {
      const dist = approxDistance(current, remaining[i]);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIdx = i;
      }
    }
    current = nearestIdx >= 0 ? remaining.splice(nearestIdx, 1)[0] : undefined;
  }
  return [...sorted, ...noGeo];
}

export function AppointmentPage() {
  const { orders, cancelOrder, revertToSurveyed, showToast } = useApp();

  const [completeOrder, setCompleteOrder] = useState<Order | null>(null);
  /* 登记勘测弹窗目标（order 为 null 即关闭，承接卡片「登记勘测」主按钮） */
  const [surveyOrder, setSurveyOrder] = useState<Order | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Order | null>(null);
  /* 改期 / 重新预约共用的预约弹窗目标（order 为 null 即关闭） */
  const [rescheduleOrder, setRescheduleOrder] = useState<Order | null>(null);
  /* 回退已勘测二次确认目标 */
  const [revertTarget, setRevertTarget] = useState<Order | null>(null);
  /* 理想上门话术弹窗目标（order 为 null 即关闭，只复制不回调） */
  const [scriptOrder, setScriptOrder] = useState<Order | null>(null);
  /* 常驻搜索关键词（姓名 / 电话 / 地址，复用首页 filterOrders 逻辑） */
  const [keyword, setKeyword] = useState("");

  /* 已预约订单：按预约日期与今天比较三分组 */
  const appointed = useMemo(
    () => orders.filter((o) => o.status === OrderStatus.Appointed),
    [orders],
  );

  /* 关键词过滤（搜索常驻；空串 = 全部，分组逻辑不变） */
  const searched = useMemo(
    () => filterOrders(appointed, { ...DEFAULT_ORDER_FILTER, keyword }),
    [appointed, keyword],
  );

  const groups = useMemo(() => {
    const today = todayStr();
    const todayList: Order[] = [];
    const futureList: Order[] = [];
    const overdueList: Order[] = [];
    for (const order of searched) {
      /* 缺预约日期按“9999”归入未来组（与 sortOrdersByAppointment 兜底一致） */
      const date = order.appointment?.appointmentDate ?? "9999";
      if (date < today) {
        overdueList.push(order);
      } else if (date === today) {
        todayList.push(order);
      } else {
        futureList.push(order);
      }
    }
    return {
      today: sortOrdersByRoute(todayList),
      future: sortOrdersByAppointment(futureList),
      overdue: sortOrdersByAppointment(overdueList),
    };
  }, [searched]);

  /* 一键导航：仅有坐标时可用，打开高德点位标注（APP/网页自适应） */
  const openNavi = (order: Order) => {
    const { longitude, latitude } = order;
    if (longitude === undefined || latitude === undefined) return;
    window.open(
      buildAmapNaviUrl({ longitude, latitude }, order.address),
      "_blank",
    );
  };

  return (
    <div className="page">
      <div className="page-header">
        <span className="page-header__title">已预约</span>
        <div className="page-header__extra">
          <span className="text-sm text-secondary">
            共 {appointed.length} 单
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
            aria-label="搜索已预约订单"
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

        {appointed.length === 0 ? (
          /* 空态：Icon + 一句话（本页无页面级主操作，不放大按钮） */
          <div className="empty-state">
            <div className="empty-state__icon">
              <Icon name="calendar" size={48} />
            </div>
            <div className="empty-state__text">
              暂无已预约订单，去首页为已勘测订单预约安装
            </div>
          </div>
        ) : searched.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state__icon">
              <Icon name="search" size={48} />
            </div>
            <div className="empty-state__text">没有符合搜索条件的订单</div>
          </div>
        ) : (
          <>
            {/* 今天待装：路线排序 + 一键导航（登记完工/取消 已收进卡片） */}
            {groups.today.length > 0 ? (
              <div className="appt-group">
                <span className="appt-group__title">
                  今天待装（{groups.today.length}）
                </span>
                {groups.today.map((order, idx) => (
                  <div key={order.id}>
                    <OrderCard
                      order={order}
                      seq={idx + 1}
                      page="appointment"
                      onSurvey={setSurveyOrder}
                      onComplete={setCompleteOrder}
                      onCancel={setCancelTarget}
                    />
                    <div className="appt-order-actions">
                      {/* 上门前话术入口：仅该品牌配置了 preVisit 模板才显示
                          （默认仅理想有，非理想订单不显示入口） */}
                      {getScript(order.brandId, "preVisit", loadBrandScripts()) ? (
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          onClick={() => setScriptOrder(order)}
                        >
                          上门话术
                        </button>
                      ) : null}
                      {hasGeo(order) ? (
                        <button
                          type="button"
                          className="btn btn--outline btn--sm"
                          onClick={() => openNavi(order)}
                        >
                          一键导航
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {/* 未来预约：按预约日期+时段升序，可改期 */}
            {groups.future.length > 0 ? (
              <div className="appt-group">
                <span className="appt-group__title">
                  未来预约（{groups.future.length}）
                </span>
                {groups.future.map((order) => (
                  <div key={order.id}>
                    <OrderCard
                      order={order}
                      page="appointment"
                      onSurvey={setSurveyOrder}
                      onComplete={setCompleteOrder}
                      onCancel={setCancelTarget}
                    />
                    <div className="appt-order-actions">
                      <button
                        type="button"
                        className="btn btn--outline btn--sm"
                        onClick={() => setRescheduleOrder(order)}
                      >
                        改期
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {/* 过期未装：整组标红，可重新预约 / 回退已勘测 */}
            {groups.overdue.length > 0 ? (
              <div className="appt-group appt-group--overdue">
                <span className="appt-group__title appt-group__title--overdue">
                  过期未装（{groups.overdue.length}）
                </span>
                {groups.overdue.map((order) => (
                  <div key={order.id}>
                    <OrderCard
                      order={order}
                      page="appointment"
                      onSurvey={setSurveyOrder}
                      onComplete={setCompleteOrder}
                      onCancel={setCancelTarget}
                    />
                    <div className="appt-order-actions">
                      <button
                        type="button"
                        className="btn btn--outline btn--sm"
                        onClick={() => setRescheduleOrder(order)}
                      >
                        重新预约
                      </button>
                      <button
                        type="button"
                        className="btn btn--outline btn--sm"
                        onClick={() => setRevertTarget(order)}
                      >
                        回退已勘测
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* 弹窗调度 */}
      <CompleteModal
        open={completeOrder !== null}
        order={completeOrder}
        onClose={() => setCompleteOrder(null)}
      />
      {/* 登记勘测：承接卡片「登记勘测」主按钮（与首页同款挂载方式） */}
      <SurveyModal
        open={surveyOrder !== null}
        order={surveyOrder}
        onClose={() => setSurveyOrder(null)}
      />
      {/* 改期 / 重新预约共用预约弹窗（order 为 null 即关闭） */}
      <AppointmentFormDialog
        order={rescheduleOrder}
        onClose={() => setRescheduleOrder(null)}
      />
      {/* 理想上门话术：只复制，无确认回调（无模板时由弹窗内空态兜底） */}
      <ScriptDialog
        open={scriptOrder !== null}
        order={scriptOrder}
        scene="preVisit"
        extras={{ installerName: scriptOrder?.appointment?.installer }}
        onClose={() => setScriptOrder(null)}
      />
      <ConfirmDialog
        open={cancelTarget !== null}
        title="取消订单"
        content={`确定取消「${cancelTarget?.customerName ?? ""}」的订单吗？取消后不可恢复。`}
        danger
        onConfirm={() => {
          if (cancelTarget) {
            cancelOrder(cancelTarget.id);
            showToast("订单已取消");
          }
          setCancelTarget(null);
        }}
        onCancel={() => setCancelTarget(null)}
      />
      <ConfirmDialog
        open={revertTarget !== null}
        title="回退已勘测"
        content={`确定将「${revertTarget?.customerName ?? ""}」回退到已勘测吗？预约信息将被清除。`}
        onConfirm={() => {
          if (revertTarget) {
            revertToSurveyed(revertTarget.id);
            showToast("已回退到已勘测");
          }
          setRevertTarget(null);
        }}
        onCancel={() => setRevertTarget(null)}
      />
    </div>
  );
}
