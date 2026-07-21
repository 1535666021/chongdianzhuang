/* ============================================================
 * 首页：全部订单 + 内置搜索筛选（搜索功能只集成在本页）
 * 阶段2-J2 布局重构（功能与文案含义不变）：
 *   - 「智能识别」收起为一条入口栏（Icon scan + 标题），点击展开弹层；
 *     粘贴自动识别 → 预览列表（存疑标黄/数量告警）确认后才入库；
 *     订单号去重 / 入库动作带 busy 守卫 + .btn--loading 防重复触发
 *   - 状态统计 2×2 大卡 → 一排 4 个迷你数字条（.stat-mini），点击=快捷筛选
 *   - 筛选区：搜索框常驻（Icon search）；
 *     品牌 / 日期 / 回收站收进「筛选」抽屉（Icon filter 弹层），
 *     已选条件以小标签回显在搜索框下方、可单独点 × 清除
 *   - 空态居中：Icon + 一句话 + 一个 .btn--primary .btn--lg 主按钮
 *   - 页面级主操作统一右上角（新增订单 + 材料库入口）
 * 任务R-R3 首页片区智能预约：
 *   - 删除搜索框下方状态筛选排（原 FilterChips 状态多选行；
 *     抽屉内品牌/日期/回收站筛选与 stat-mini 迷你数字条保持不动）
 *   - 原位放「片区分组」区：待办订单总数（全部 chip）+ 各片区单数
 *     （clusterOrdersByArea 聚类结果横排 chip）；点片区=列表只看该片
 *     订单（再点或点全部取消）；无待办时该区不显示
 *   - 智能预约：片区选中后的操作位「批量预约」→ BatchAppointmentDialog
 *     选日期/时段/师傅，该片待办单（待勘测/已勘测）逐单 saveAppointment
 *     一键转已预约（旧「片区推荐」展开卡由本区替代）
 * 调度：订单弹窗 / 勘测弹窗 / 预约弹窗 / 批量预约弹窗 / 完工弹窗 / 取消 / 删除
 * 说明：全部弹窗均为 components 下的独立组件，本页只引入调用
 * ============================================================ */

import { useMemo, useRef, useState } from "react";
import {
  OrderStatus,
  ORDER_STATUS_LABEL,
  DEFAULT_ORDER_FILTER,
  TabKey,
} from "@/types";
import type { Order, OrderFilter } from "@/types";
import { Icon } from "@/components/common/Icon";
import { Modal } from "@/components/common/Modal";
import { FilterChips } from "@/components/common/FilterChips";
import type { ChipOption } from "@/components/common/FilterChips";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { OrderCard } from "@/components/order/OrderCard";
import { OrderModal } from "@/components/modals/OrderModal";
import { SurveyModal } from "@/components/modals/SurveyModal";
import { CompleteModal } from "@/components/modals/CompleteModal";
import { AppointmentFormDialog } from "@/components/AppointmentFormDialog";
import { BatchAppointmentDialog } from "@/components/BatchAppointmentDialog";
import { RestockDialog } from "@/components/RestockDialog";
import { useApp } from "@/context/AppContext";
import { isInstallOrder } from "@/lib/restock";
import { filterOrders, sortOrdersByUpdated } from "@/lib/utils";
import {
  buildParsePreview,
  filterNewParsedItems,
  parseOrderTextDetailed,
} from "@/lib/parser";
import type { ParsePreviewRow } from "@/lib/parser";
import { ParsePreviewDialog } from "@/components/ParsePreviewDialog";
import {
  loadMaterialsLib,
  loadPlatformRates,
  loadPlatforms,
  loadRateConfigs,
} from "@/lib/storage";
import { clusterOrdersByArea, getAppointableOrders } from "@/lib/geoCluster";
import type { AreaCluster } from "@/lib/geoCluster";

/** HomePage 入参：onNavigate 由 App.tsx 透传（Tab 切换能力，材料库入口用） */
interface HomePageProps {
  onNavigate: (tab: TabKey) => void;
}

export function HomePage({ onNavigate }: HomePageProps) {
  const {
    orders,
    brands,
    customBrands,
    addOrder,
    cancelOrder,
    deleteOrder,
    restoreOrder,
    purgeOrder,
    showToast,
  } = useApp();

  const [filter, setFilter] = useState<OrderFilter>(DEFAULT_ORDER_FILTER);

  /* 智能识别：入口栏 + 弹层（粘贴后自动解析 → 预览确认后才入库） */
  const [parseOpen, setParseOpen] = useState(false);
  const [parseText, setParseText] = useState("");
  /* 识别入库 busy 守卫：入库进行中按钮挂 .btn--loading 并禁点，防重复触发 */
  const [importBusy, setImportBusy] = useState(false);
  /* 识别预览：非 null 即展示预览弹窗（确认入库 / 返回修改） */
  const [previewRows, setPreviewRows] = useState<ParsePreviewRow[] | null>(
    null,
  );
  /* 预览元信息：原文疑似块数（数量对账告警）+ 已跳过重复数 */
  const [previewMeta, setPreviewMeta] = useState({
    blockCount: 0,
    duplicated: 0,
  });
  const parseRef = useRef<HTMLTextAreaElement>(null);

  /* 「筛选」抽屉：品牌 / 日期 / 回收站 收进弹层 */
  const [filterOpen, setFilterOpen] = useState(false);

  /* 弹窗调度状态 */
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | undefined>();
  const [surveyOrder, setSurveyOrder] = useState<Order | null>(null);
  const [appointOrder, setAppointOrder] = useState<Order | null>(null);
  const [completeOrder, setCompleteOrder] = useState<Order | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Order | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Order | null>(null);

  /* 回收站：视图开关 + 彻底删除确认目标 */
  const [trashView, setTrashView] = useState(false);
  const [purgeTarget, setPurgeTarget] = useState<Order | null>(null);

  /* 片区分组：选中的片区聚组 id（null=全部；再点片区 chip 或点全部取消） */
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  /* 批量预约弹窗目标片区（非 null 即打开 BatchAppointmentDialog） */
  const [batchCluster, setBatchCluster] = useState<AreaCluster | null>(null);

  /* 一键补桩弹窗开关（任务U 模块D） */
  const [restockOpen, setRestockOpen] = useState(false);

  /* 筛选选项（品牌 chips 供「筛选」抽屉使用；回收站由抽屉内独立 chip 切换回收站视图） */
  const brandOptions: ChipOption<string>[] = useMemo(
    () => brands.map((b) => ({ value: b.id, label: b.name })),
    [brands],
  );

  /* 回收站软删单不进常规列表 / 统计计数 / 片区分组（智能识别去重仍按全量 orders） */
  const activeOrders = useMemo(
    () => orders.filter((o) => o.status !== OrderStatus.Trash),
    [orders],
  );

  /* 口径A·未预约待办池：待勘测 + 「从未预约过」的已勘测（v32.4 口径3：
     凡是预约过的单——有预约日期为证——任何情况下不回首页；
     老数据中已勘测且从未预约过的单不受影响，后续可正常预约；
     列表底池 / 片区聚类 / 全部计数三处同源，禁止另起第二份过滤逻辑） */
  const homePool = useMemo(
    () =>
      activeOrders.filter(
        (o) =>
          o.status === OrderStatus.Pending ||
          (o.status === OrderStatus.Surveyed &&
            (o.appointment?.appointmentDate ?? "") === ""),
      ),
    [activeOrders],
  );

  /* 需补桩安装单数（任务U 模块D：回收站单不计；入口栏回显与点击守卫用） */
  const restockNeededCount = useMemo(
    () =>
      activeOrders.filter(
        (o) => o.restockStatus === "needed" && isInstallOrder(o),
      ).length,
    [activeOrders],
  );

  /* 回收站清单：按删除时间倒序（老数据无 deletedAt 时兜底 updatedAt） */
  const trashOrders = useMemo(
    () =>
      orders
        .filter((o) => o.status === OrderStatus.Trash)
        .sort((a, b) =>
          (b.deletedAt ?? b.updatedAt).localeCompare(
            a.deletedAt ?? a.updatedAt,
          ),
        ),
    [orders],
  );

  /* 片区分组：未预约待办池按片区聚组（口径A与列表/计数同源；
     费率/平台扣点/材料库实时读 storage） */
  const areaClusters = useMemo(
    () =>
      clusterOrdersByArea(homePool, {
        rateConfigs: loadRateConfigs(),
        platformRates: loadPlatformRates(),
        lib: loadMaterialsLib(),
      }),
    [homePool],
  );

  /* 选中的片区聚组（订单变化致聚组消失/重编号时自动回落为未选中，无需 effect 清理） */
  const selectedCluster = useMemo(
    () => areaClusters.find((c) => c.id === selectedAreaId) ?? null,
    [areaClusters, selectedAreaId],
  );

  /* 待办订单总数（口径A=未预约待办数：待勘测/已勘测，与片区聚类同池 homePool） */
  const todoCount = useMemo(() => homePool.length, [homePool]);

  /* 选中片区内可批量预约单数（操作位展示与按钮可用性；判定收敛在 lib） */
  const selectedAppointableCount = useMemo(
    () =>
      selectedCluster ? getAppointableOrders(selectedCluster.orders).length : 0,
    [selectedCluster],
  );

  /* 筛选 + 排序后的列表（选中片区时叠加"只看该片订单"）
     任务v32-〇 首页过滤修复：默认底池=未预约待办池 homePool（口径A，
     待勘测/已勘测，已勘测单的「预约安装」主按钮在首页操作，故留首页）；
     已完成/已预约/已取消一律不进首页列表。显式点状态概览迷你条
     （statuses 非空）= 用户主动临时查看该状态，可越出底池，再点取消回待办底池 */
  const filtered = useMemo(() => {
    const pool = filter.statuses.length > 0 ? activeOrders : homePool;
    const list = sortOrdersByUpdated(filterOrders(pool, filter));
    if (!selectedCluster) return list;
    const ids = new Set(selectedCluster.orders.map((o) => o.id));
    return list.filter((o) => ids.has(o.id));
  }, [activeOrders, homePool, filter, selectedCluster]);

  /* 状态概览：点击迷你数字条 = 快捷筛选该状态 */
  const statusCounts = useMemo(() => {
    const counts = new Map<OrderStatus, number>();
    for (const o of activeOrders) {
      counts.set(o.status, (counts.get(o.status) ?? 0) + 1);
    }
    return counts;
  }, [activeOrders]);

  /* 回显用：已选品牌名（id → 名称，找不到兜底原 id） */
  const selectedBrandName = useMemo(
    () => brands.find((b) => b.id === filter.brandId)?.name ?? filter.brandId,
    [brands, filter.brandId],
  );

  const patchFilter = (patch: Partial<OrderFilter>) =>
    setFilter((prev) => ({ ...prev, ...patch }));

  const toggleStatusQuick = (status: OrderStatus) => {
    setFilter((prev) => ({
      ...prev,
      statuses:
        prev.statuses.length === 1 && prev.statuses[0] === status
          ? []
          : [status],
    }));
  };

  /* 抽屉内筛选条件清空（品牌 / 日期 / 回收站视图；关键词与状态 chips 不动） */
  const clearDrawerFilters = () => {
    patchFilter({ brandId: "", dateFrom: "", dateTo: "" });
    setTrashView(false);
  };

  /* 智能识别批量入库（本页只调度，逻辑全在 lib）：
   * parseOrderTextDetailed 解析（附疑似块数量对账）→ filterNewParsedItems 去重 →
   * buildParsePreview 组装预览行 → 预览弹窗确认后才 addOrder 入库（禁止静默丢弃）
   * busy 守卫：识别/入库期间按钮 .btn--loading 禁重复点击 */
  const handleBatchImport = (raw?: string) => {
    const text = (raw ?? parseText).trim();
    if (!text || importBusy) return;
    setImportBusy(true);
    /* 延到下一拍执行：让 loading 态先渲染（大段文本解析可能耗时） */
    window.setTimeout(() => {
      const { items, blockCount } = parseOrderTextDetailed(text);
      if (items.length === 0) {
        setImportBusy(false);
        showToast("未能识别有效订单，请检查文本格式");
        return;
      }
      const { fresh, duplicated } = filterNewParsedItems(items, orders);
      if (fresh.length === 0) {
        setImportBusy(false);
        showToast(`${duplicated} 条订单均已存在，未重复入库`);
        return;
      }
      const rows = buildParsePreview(
        fresh,
        brands,
        loadPlatforms(),
        customBrands,
      );
      setPreviewMeta({ blockCount, duplicated });
      setPreviewRows(rows);
      setImportBusy(false);
      setParseOpen(false);
    }, 0);
  };

  /* 预览确认入库：逐条 addOrder（draft 已在 lib 组装完毕），
   * busy 守卫防重复触发；入库完清空原文并提示汇总 */
  const handleConfirmImport = () => {
    if (!previewRows || previewRows.length === 0 || importBusy) return;
    const rows = previewRows;
    setImportBusy(true);
    window.setTimeout(() => {
      for (const row of rows) {
        addOrder(row.draft);
      }
      const duplicated = previewMeta.duplicated;
      setPreviewRows(null);
      setParseText("");
      setImportBusy(false);
      showToast(
        `已入库 ${rows.length} 条${duplicated > 0 ? `，跳过重复 ${duplicated} 条` : ""}`,
      );
    }, 0);
  };

  /* 预览返回修改：回文本输入弹层（原文保留，可修正后重新识别） */
  const handleCancelPreview = () => {
    if (importBusy) return;
    setPreviewRows(null);
    setParseOpen(true);
  };

  /* 页面级主操作（右上角）：新增订单 */
  const openNewOrder = () => {
    setEditingOrder(undefined);
    setOrderModalOpen(true);
  };

  /* 抽屉已选条件回显（搜索框下方小标签，点 × 单独清除） */
  const hasDrawerFilters =
    filter.brandId !== "" ||
    filter.dateFrom !== "" ||
    filter.dateTo !== "" ||
    trashView;

  return (
    <div className="page">
      <div className="page-header">
        <span className="page-header__title">充电桩订单助手</span>
        <div className="page-header__extra">
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={openNewOrder}
          >
            <Icon name="plus" size={16} />
            新增订单
          </button>
          {/* 材料库入口（阶段2-J1 从底部导航迁至此处）：box 图标按钮，44px 热区 */}
          <button
            type="button"
            className="btn btn--icon"
            aria-label="材料库"
            title="材料库"
            onClick={() => onNavigate(TabKey.Materials)}
          >
            <Icon name="box" size={24} />
          </button>
        </div>
      </div>

      <div className="page-body">
        {/* 智能识别：收起为一条入口栏，点击展开弹层（识别完自动收起） */}
        <button
          type="button"
          className="card card--clickable flex-between gap-sm"
          aria-haspopup="dialog"
          onClick={() => setParseOpen(true)}
        >
          <span className="flex gap-sm">
            <Icon name="scan" size={24} className="text-primary-color" />
            <span className="text-bold">智能识别 · 粘贴批量入库</span>
          </span>
          <Icon name="chevron-right" size={20} className="text-tertiary" />
        </button>

        {/* 状态概览：一排 4 个迷你数字条（点击快捷筛选） */}
        <div className="stat-mini" role="group" aria-label="状态概览">
          {(
            [
              OrderStatus.Pending,
              OrderStatus.Surveyed,
              OrderStatus.Appointed,
              OrderStatus.Completed,
            ] as OrderStatus[]
          ).map((status) => (
            <button
              key={status}
              type="button"
              className="stat-mini__item"
              aria-pressed={
                filter.statuses.length === 1 && filter.statuses[0] === status
              }
              onClick={() => toggleStatusQuick(status)}
            >
              <span className="stat-mini__value">
                {statusCounts.get(status) ?? 0}
              </span>
              <span className="stat-mini__label">
                {ORDER_STATUS_LABEL[status]}
              </span>
            </button>
          ))}
        </div>

        {/* 筛选区：搜索框常驻（Icon search）+ 筛选抽屉入口（Icon filter） */}
        <div className="flex gap-sm">
          <div className="search-bar flex-1">
            <Icon name="search" size={20} className="text-tertiary" />
            <input
              className="search-bar__input"
              type="search"
              value={filter.keyword}
              placeholder="搜索 姓名 / 电话 / 地址"
              aria-label="搜索订单"
              onChange={(e) => patchFilter({ keyword: e.target.value })}
            />
            {filter.keyword ? (
              <button
                type="button"
                className="modal__close"
                aria-label="清空搜索"
                onClick={() => patchFilter({ keyword: "" })}
              >
                ×
              </button>
            ) : null}
          </div>
          <button
            type="button"
            className="btn btn--icon"
            aria-label="筛选（品牌 / 日期 / 回收站）"
            title="筛选"
            onClick={() => setFilterOpen(true)}
          >
            <Icon name="filter" size={24} />
          </button>
        </div>

        {/* 已选条件回显：小标签列在搜索框下方，点 × 单独清除 */}
        {hasDrawerFilters ? (
          <div className="filter-chips" role="group" aria-label="已选筛选条件">
            {trashView ? (
              <button
                type="button"
                className="chip chip--active"
                title="点击清除该条件"
                onClick={() => setTrashView(false)}
              >
                回收站 ×
              </button>
            ) : null}
            {filter.brandId ? (
              <button
                type="button"
                className="chip chip--active"
                title="点击清除该条件"
                onClick={() => patchFilter({ brandId: "" })}
              >
                品牌：{selectedBrandName} ×
              </button>
            ) : null}
            {filter.dateFrom || filter.dateTo ? (
              <button
                type="button"
                className="chip chip--active"
                title="点击清除该条件"
                onClick={() => patchFilter({ dateFrom: "", dateTo: "" })}
              >
                日期：{filter.dateFrom || "…"} ~ {filter.dateTo || "…"} ×
              </button>
            ) : null}
          </div>
        ) : null}

        {/* 片区分组（任务R-R3，原位替代状态筛选排）：待办总数（全部 chip）
            + 各片区单数横排 chip；点片区=列表只看该片订单（再点或点全部取消）；
            无待办或回收站视图时不显示 */}
        {!trashView && todoCount > 0 ? (
          <div className="flex-column gap-xs">
            <div className="filter-chips" role="group" aria-label="片区分组">
              <button
                type="button"
                className={
                  selectedCluster === null ? "chip chip--active" : "chip"
                }
                aria-pressed={selectedCluster === null}
                onClick={() => setSelectedAreaId(null)}
              >
                全部 {todoCount}单
              </button>
              {areaClusters.map((cluster) => (
                <button
                  key={cluster.id}
                  type="button"
                  className={
                    selectedCluster?.id === cluster.id
                      ? "chip chip--active"
                      : "chip"
                  }
                  aria-pressed={selectedCluster?.id === cluster.id}
                  title={`只看${cluster.name}片区订单`}
                  onClick={() =>
                    setSelectedAreaId((prev) =>
                      prev === cluster.id ? null : cluster.id,
                    )
                  }
                >
                  {cluster.name} {cluster.orders.length}单
                </button>
              ))}
            </div>
            {/* 智能预约操作位：选中片区后出现，该片待办单一键批量转已预约 */}
            {selectedCluster ? (
              <div className="flex-between gap-sm">
                <span className="flex-1 text-sm text-secondary">
                  {selectedCluster.name}片区 · 待预约{" "}
                  {selectedAppointableCount} 单
                </span>
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  disabled={selectedAppointableCount === 0}
                  onClick={() => setBatchCluster(selectedCluster)}
                >
                  <Icon name="calendar" size={16} />
                  批量预约
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* 一键补桩入口栏（任务U 模块D，片区分组区附近）：需补桩安装单数回显；
            0 单时点击仅提示，>0 开 RestockDialog；回收站视图不显示 */}
        {!trashView ? (
          <button
            type="button"
            className="card card--clickable flex-between gap-sm"
            aria-haspopup="dialog"
            onClick={() => {
              if (restockNeededCount === 0) {
                showToast("当前没有需补桩的安装单");
                return;
              }
              setRestockOpen(true);
            }}
          >
            <span className="flex gap-sm">
              <Icon name="box" size={24} className="text-primary-color" />
              <span className="text-bold">
                一键补桩 · 需补桩 {restockNeededCount} 单
              </span>
            </span>
            <Icon name="chevron-right" size={20} className="text-tertiary" />
          </button>
        ) : null}

        {/* 订单列表（回收站视图：仅 trash 单，操作 = 恢复 / 彻底删除） */}
        {trashView ? (
          trashOrders.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state__icon">
                <Icon name="trash" size={48} />
              </div>
              <div className="empty-state__text">回收站为空</div>
            </div>
          ) : (
            trashOrders.map((order, index) => (
              <div key={order.id}>
                <OrderCard order={order} seq={index + 1} />
                <div className="appt-order-actions">
                  <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    onClick={() => {
                      restoreOrder(order.id);
                      showToast("订单已恢复");
                    }}
                  >
                    恢复
                  </button>
                  <button
                    type="button"
                    className="btn btn--danger-outline btn--sm"
                    onClick={() => setPurgeTarget(order)}
                  >
                    彻底删除
                  </button>
                </div>
              </div>
            ))
          )
        ) : filtered.length === 0 ? (
          activeOrders.length === 0 ? (
            /* 空态：Icon + 一句话 + 页面主按钮（与右上角主操作同一动作） */
            <div className="empty-state">
              <div className="empty-state__icon">
                <Icon name="box" size={48} />
              </div>
              <div className="empty-state__text">
                还没有订单，点右上角新增第一单
              </div>
              <button
                type="button"
                className="btn btn--primary btn--lg"
                onClick={openNewOrder}
              >
                新增订单
              </button>
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-state__icon">
                <Icon name="search" size={48} />
              </div>
              <div className="empty-state__text">没有符合筛选条件的订单</div>
              <button
                type="button"
                className="btn btn--primary btn--lg"
                onClick={() => {
                  setFilter(DEFAULT_ORDER_FILTER);
                  setTrashView(false);
                  setSelectedAreaId(null);
                }}
              >
                清空筛选条件
              </button>
            </div>
          )
        ) : (
          filtered.map((order, index) => (
            <OrderCard
              key={order.id}
              order={order}
              seq={index + 1}
              page="home"
              onEdit={(o) => {
                setEditingOrder(o);
                setOrderModalOpen(true);
              }}
              onAppoint={setAppointOrder}
              onCancel={setCancelTarget}
              onDelete={setDeleteTarget}
            />
          ))
        )}
      </div>

      {/* 智能识别弹层：粘贴微信订单文本 → 解析出预览列表，确认后才批量入库（按订单号去重） */}
      <Modal
        open={parseOpen}
        title="智能识别"
        onClose={() => setParseOpen(false)}
        footer={
          <button
            type="button"
            className={
              importBusy ? "btn btn--primary btn--loading" : "btn btn--primary"
            }
            disabled={importBusy}
            onClick={() => handleBatchImport()}
          >
            {importBusy ? "识别中…" : "开始识别"}
          </button>
        }
      >
        <textarea
          ref={parseRef}
          className="textarea"
          maxLength={50000}
          value={parseText}
          placeholder="粘贴微信聊天记录 / 公告 /【订单信息】/ 单行文本，自动拆分全部订单；识别后先出预览列表，确认无误再批量入库（按订单号自动去重）"
          onChange={(e) => setParseText(e.target.value)}
          onPaste={() => {
            /* 等粘贴值落地后自动触发识别预览 */
            window.setTimeout(
              () => handleBatchImport(parseRef.current?.value),
              80,
            );
          }}
        />
      </Modal>

      {/* 识别预览：确认后才入库；存疑字段标黄不阻塞；数量对不上显著告警 */}
      <ParsePreviewDialog
        open={previewRows !== null}
        rows={previewRows ?? []}
        blockCount={previewMeta.blockCount}
        duplicated={previewMeta.duplicated}
        busy={importBusy}
        onConfirm={handleConfirmImport}
        onCancel={handleCancelPreview}
      />

      {/* 「筛选」抽屉：品牌 / 日期 / 回收站（已选条件回显在搜索框下方） */}
      <Modal
        open={filterOpen}
        title="筛选"
        onClose={() => setFilterOpen(false)}
        footer={
          <>
            <button
              type="button"
              className="btn btn--outline"
              onClick={clearDrawerFilters}
            >
              清空
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => setFilterOpen(false)}
            >
              完成
            </button>
          </>
        }
      >
        <span className="text-sm text-secondary">品牌</span>
        <FilterChips<string>
          value={filter.brandId}
          options={brandOptions}
          onChange={(next) => patchFilter({ brandId: next as string })}
        />
        <span className="text-sm text-secondary">创建日期</span>
        <div className="flex gap-sm">
          <input
            className="input flex-1"
            type="date"
            value={filter.dateFrom}
            placeholder="开始日期"
            aria-label="创建日期从"
            onChange={(e) => patchFilter({ dateFrom: e.target.value })}
          />
          <input
            className="input flex-1"
            type="date"
            value={filter.dateTo}
            placeholder="结束日期"
            aria-label="创建日期至"
            onChange={(e) => patchFilter({ dateTo: e.target.value })}
          />
        </div>
        <span className="text-sm text-secondary">回收站</span>
        {/* 回收站入口：独立 chip（数量角标），点击切换回收站视图 */}
        <div className="filter-chips" role="group" aria-label="回收站">
          <button
            type="button"
            className={trashView ? "chip chip--active" : "chip"}
            onClick={() => setTrashView((prev) => !prev)}
          >
            {`回收站(${trashOrders.length})`}
          </button>
        </div>
      </Modal>

      {/* 弹窗调度：全部为独立组件，本页只负责开关 */}
      <OrderModal
        open={orderModalOpen}
        order={editingOrder}
        onClose={() => setOrderModalOpen(false)}
      />
      <SurveyModal
        open={surveyOrder !== null}
        order={surveyOrder}
        onClose={() => setSurveyOrder(null)}
      />
      <AppointmentFormDialog
        order={appointOrder}
        onClose={() => setAppointOrder(null)}
      />
      {/* 片区批量预约：选中片区操作位触发，确认后该片待办单逐单转已预约 */}
      <BatchAppointmentDialog
        cluster={batchCluster}
        onClose={() => setBatchCluster(null)}
      />
      {/* 一键补桩：全部需补桩安装单合并发货单，复制后全翻「已补桩」 */}
      <RestockDialog open={restockOpen} onClose={() => setRestockOpen(false)} />
      <CompleteModal
        open={completeOrder !== null}
        order={completeOrder}
        onClose={() => setCompleteOrder(null)}
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
        open={deleteTarget !== null}
        title="删除订单"
        content={`确定删除「${deleteTarget?.customerName ?? ""}」的订单吗？删除后将移入回收站，可随时恢复。`}
        danger
        onConfirm={() => {
          if (deleteTarget) {
            deleteOrder(deleteTarget.id);
            showToast("已移入回收站");
          }
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
      {/* 回收站：彻底删除（物理移除，不可恢复） */}
      <ConfirmDialog
        open={purgeTarget !== null}
        title="彻底删除"
        content={`确定彻底删除「${purgeTarget?.customerName ?? ""}」的订单吗？彻底删除后不可恢复。`}
        danger
        onConfirm={() => {
          if (purgeTarget) {
            purgeOrder(purgeTarget.id);
            showToast("订单已彻底删除");
          }
          setPurgeTarget(null);
        }}
        onCancel={() => setPurgeTarget(null)}
      />
    </div>
  );
}

