/* ============================================================
 * 订单卡片（首页 / 已预约 / 已完成 三个列表页复用）
 * 布局（阶段2-J2 统一版式）：
 *   信息区：姓名 + 状态标签 一行（右上角 ⋯ 更多菜单按钮）
 *           品牌 / 功率 / 服务类型标签一行（缺失自动隐藏）
 *           电话一行（.btn--icon 拨号 Icon phone 随行，长按复制号码）
 *           地址一行（.btn--icon 导航 Icon navigate 随行，长按复制地址）
 *   操作区（任务v32.2 页面化，page prop 决定渲染口径）：
 *           page="home"（首页）：主「预约」（Pending/Surveyed 统一文案，onAppoint
 *             存在才显示；不做状态区分，Appointed 意外传入同口径兜底）；无次按钮、
 *             无水印名；⋯菜单只收「查看原文」（话术回放/编辑/取消订单不收首页）
 *           page="appointment"（已预约页）：主「登记勘测」+ 次「登记完工」+
 *             水印名（描边 .btn--outline .btn--md，次按钮旁）；⋯菜单保持 v32 全量
 *             （话术回放按状态 / 编辑 / 取消订单）
 *           危险操作（删除）两页面均置底 .btn--danger（Modal footer 与主按钮物理隔离）
 *           已完成页/回收站不传 page 默认 "home"：不传 onAppoint → 操作区为空，与现状一致
 * 话术回放（任务R-R4，组件自闭环；任务v32.2 起仅 page="appointment" 分支收录）：
 *   ⋯ 菜单按状态加项——已预约/已勘测/已完成→「勘测话术」（order.survey
 *   有数据才可点，无则 disabled 灰显），已完成再加「完工话术」；
 *   普通点击打开 ScriptDialog（只复制无确认回调），数据=该单快照
 *   （buildScriptVars 已从 order.survey/completion 回退，直接传 order 即可）
 * 交互：姓名/电话/地址 文本点击复制保留；图标按钮点按执行、长按（500ms）复制
 * 按钮点击一律通过回调上抛给页面，卡片本身不直接改数据（话术弹窗只读复制）
 * ============================================================ */

import { useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { OrderStatus } from "@/types";
import type { Order, ScriptScene } from "@/types";
import { Icon } from "@/components/common/Icon";
import type { IconName } from "@/components/common/Icon";
import { Modal } from "@/components/common/Modal";
import { StatusTag } from "@/components/common/StatusTag";
import { OrderProfitDialog } from "@/components/OrderProfitDialog";
import { ScriptDialog } from "@/components/ScriptDialog";
import { TextPreviewDialog } from "@/components/TextPreviewDialog";
import { findBrand } from "@/lib/brandMaterials";
import { buildAmapNaviUrl, getCachedGeo } from "@/lib/geoCache";
import {
  isInstallOrder,
  isLeapmotorOnsiteOnly,
  platformNameOf,
  serviceKindOf,
  SERVICE_KIND_LABEL,
} from "@/lib/restock";
import { loadPlatforms, loadWatermarkTemplates } from "@/lib/storage";
import { buildWatermarkName, watermarkTemplateFor } from "@/lib/watermark";
import { formatDate } from "@/lib/utils";
import { useApp } from "@/context/AppContext";

export interface OrderCardProps {
  order: Order;
  /** 列表序号（从 1 开始；不传则不显示） */
  seq?: number;
  /** 页面化渲染口径（任务v32.2）：
   * "home"=首页（主按钮只留预约、无次按钮/水印名、⋯菜单只收查看原文）；
   * "appointment"=已预约页（登记勘测/登记完工/水印名 + ⋯菜单 v32 全量）；
   * 已完成页/回收站不传默认 "home"（不传 onAppoint → 操作区为空，不破坏现状） */
  page?: "home" | "appointment" | "completed";
  /** 编辑订单（待勘测/已勘测可编辑） */
  onEdit?: (order: Order) => void;
  /** 登记勘测 */
  onSurvey?: (order: Order) => void;
  /** 预约（首页主按钮统一文案，onAppoint 存在才显示） */
  onAppoint?: (order: Order) => void;
  /** 登记完工 */
  onComplete?: (order: Order) => void;
  /** 取消订单 */
  onCancel?: (order: Order) => void;
  /** 删除订单 */
  onDelete?: (order: Order) => void;
}

/** 导航链接：有坐标用点位标注，无坐标按地址搜索（均走高德 URI，APP/网页自适应） */
function naviUrl(order: Order): string {
  const cached = getCachedGeo(order.address);
  if (order.longitude !== undefined && order.latitude !== undefined) {
    return buildAmapNaviUrl(
      { longitude: order.longitude, latitude: order.latitude },
      order.address,
    );
  }
  if (cached) {
    return buildAmapNaviUrl(cached, order.address);
  }
  return `https://uri.amap.com/search?keyword=${encodeURIComponent(order.address)}&callnative=1`;
}

/**
 * 长按复制手势（500ms）：
 * - 点按（未达长按阈值）执行 onTap（拨号 / 导航）
 * - 长按触发 onCopy，并吞掉随后的 click（防止复制后误拨号/误导航）
 * - 禁掉长按弹出的系统上下文菜单（与复制手势冲突）
 */
function useLongPressCopy(onCopy: () => void, onTap: () => void) {
  const timerRef = useRef<number | null>(null);
  const firedRef = useRef(false);

  const clear = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };
  const start = () => {
    firedRef.current = false;
    clear();
    timerRef.current = window.setTimeout(() => {
      firedRef.current = true;
      onCopy();
    }, 500);
  };

  return {
    onTouchStart: start,
    onTouchEnd: clear,
    onTouchCancel: clear,
    /* 手指滑动（滚动意图）即取消长按，避免滚动中误触发复制 */
    onTouchMove: clear,
    onMouseDown: start,
    onMouseUp: clear,
    onMouseLeave: clear,
    onClick: () => {
      /* 长按已复制：本次点按作废 */
      if (firedRef.current) {
        firedRef.current = false;
        return;
      }
      onTap();
    },
    onContextMenu: (e: ReactMouseEvent) => e.preventDefault(),
  };
}

export function OrderCard({
  order,
  seq,
  page = "home",
  onEdit,
  onSurvey,
  onAppoint,
  onComplete,
  onCancel,
  onDelete,
}: OrderCardProps) {
  const { customBrands, showToast, updateOrderPlatform, updateRestockStatus } =
    useApp();
  const brand = findBrand(order.brandId, customBrands);
  /* 任务U 模块A：服务类型判定收敛 lib（与统计同口径），标签只显示
     类型文字（安装/维修/勘测），禁带套包米数 */
  const serviceKind = serviceKindOf(order);
  const isInstall = isInstallOrder(order);
  /* 平台显示名（lib platformNameOf，空不渲染平台标签） */
  const platformName = platformNameOf(order);
  /* 任务U 模块E：订单原文（一单对一段；为空则小字行不可点） */
  const originalText = (order.originalText ?? "").trim();
  const canShowOriginal = originalText !== "";

  /* ⋯ 更多操作菜单弹层 */
  const [menuOpen, setMenuOpen] = useState(false);
  /* 话术回放弹窗场景（null=关闭；勘测话术→surveyComplete，完工话术→installComplete） */
  const [scriptScene, setScriptScene] = useState<ScriptScene | null>(null);
  /* 订单原文弹窗开关（任务U 模块E，组件自闭环） */
  const [originalOpen, setOriginalOpen] = useState(false);
  /* 平台选择弹层开关（任务v32 功能二：仅平台为"其他"时入口可点） */
  const [platformOpen, setPlatformOpen] = useState(false);
  const [profitOpen, setProfitOpen] = useState(false);
  /* 水印名预览弹窗开关（任务v35：点击先弹预览可编辑，确认复制，不再直复制） */
  const [watermarkOpen, setWatermarkOpen] = useState(false);

  const canEdit =
    order.status === OrderStatus.Pending ||
    order.status === OrderStatus.Surveyed;
  const canCancel =
    order.status !== OrderStatus.Completed &&
    order.status !== OrderStatus.Cancelled;

  /* 点击复制：浏览器剪贴板 API + 旧 WebView 兜底（纯 UI 交互，不含业务逻辑） */
  const copyText = async (text: string, label: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    showToast(`${label}已复制`);
  };

  /* 电话图标按钮：点按拨号，长按复制号码 */
  const phonePress = useLongPressCopy(
    () => copyText(order.customerPhone, "手机号"),
    () => {
      window.location.href = `tel:${order.customerPhone}`;
    },
  );
  /* 地址图标按钮：点按导航（新窗口打开高德），长按复制地址 */
  const addressPress = useLongPressCopy(
    () => copyText(order.address, "地址"),
    () => {
      window.open(naviUrl(order), "_blank");
    },
  );

  /* 状态主按钮（任务v32.2 页面化）：每单最多 1 个。
   * page="home"：只留「预约」（onAppoint 存在才显示；Pending/Surveyed 统一文案，
   *   统一动作不做状态区分——Appointed 意外传入同口径兜底）；
   * page="appointment"：主「登记勘测」（onSurvey 存在时）。
   * 已完成页/回收站不传 onAppoint/onSurvey → null，操作区为空 */
  const primaryAction: { label: string; run: () => void } | null =
    page === "home"
      ? onAppoint
        ? { label: "预约", run: () => onAppoint(order) }
        : null
      : onSurvey
        ? { label: "登记勘测", run: () => onSurvey(order) }
        : null;

  /* 次按钮（描边）：仅 page="appointment" 有——「登记完工」（onComplete 存在时，
   * 与主按钮同框）；page="home" 恒 null（首页无次按钮） */
  const secondaryAction: { label: string; run: () => void } | null =
    page === "appointment" && onComplete
      ? { label: "登记完工", run: () => onComplete(order) }
      : null;

  /* ⋯ 菜单次操作（任务v32.2 页面化）；危险操作（删除）单独置底 footer
   * page="home"：只收「查看原文」（话术回放/编辑/取消订单不收首页）；
   * page="appointment"：保持 v32 现状全量（话术回放按状态 / 编辑 / 取消订单） */
  const menuActions: {
    key: string;
    label: string;
    icon: IconName;
    /** true 时灰显禁点（全局 .btn:disabled 样式：半透明 + 禁指针） */
    disabled?: boolean;
    run: () => void;
  }[] = [];

  if (page === "home") {
    menuActions.push({
      key: "original",
      label: "查看原文",
      icon: "file-text",
      run: () => setOriginalOpen(true),
    });
  } else if (page === "completed") {
    /* v32.3 FAIL-2：已完成单⋯菜单恢复双话术回放入口（v28 交付功能，
     * ScriptDialog 复用；无 survey/completion 快照对应项 disabled 灰显）
     * + 保留「查看原文」；不收编辑/取消（Completed 单本不可编辑取消） */
    menuActions.push({
      key: "script-survey",
      label: "勘测话术",
      icon: "file-text",
      disabled: order.survey === undefined,
      run: () => setScriptScene("surveyComplete"),
    });
    menuActions.push({
      key: "script-install",
      label: "完工话术",
      icon: "file-text",
      disabled: order.completion === undefined,
      run: () => setScriptScene("installComplete"),
    });
    menuActions.push({
      key: "original",
      label: "查看原文",
      icon: "file-text",
      run: () => setOriginalOpen(true),
    });
  } else {
    /* 话术回放（任务R-R4）：已预约/已勘测/已完成→「勘测话术」（order.survey
     * 有数据才可点，无则 disabled 灰显）；已完成再加「完工话术」 */
    const hasSurveySnapshot = order.survey !== undefined;
    if (
      order.status === OrderStatus.Appointed ||
      order.status === OrderStatus.Surveyed ||
      order.status === OrderStatus.Completed
    ) {
      menuActions.push({
        key: "script-survey",
        label: "勘测话术",
        icon: "file-text",
        disabled: !hasSurveySnapshot,
        run: () => setScriptScene("surveyComplete"),
      });
    }
    if (order.status === OrderStatus.Completed) {
      menuActions.push({
        key: "script-install",
        label: "完工话术",
        icon: "file-text",
        disabled: order.completion === undefined,
        run: () => setScriptScene("installComplete"),
      });
    }

    if (canEdit && onEdit) {
      menuActions.push({
        key: "edit",
        label: "编辑订单",
        icon: "edit",
        run: () => onEdit(order),
      });
    }
    if (canCancel && onCancel) {
      menuActions.push({
        key: "cancel",
        label: "取消订单",
        icon: "close",
        run: () => onCancel(order),
      });
    }
  }
  const hasMenu = menuActions.length > 0 || onDelete !== undefined;

  /* 菜单项点击：先收弹层再上抛回调（避免确认弹窗叠在菜单上） */
  const runMenuAction = (run: () => void) => {
    setMenuOpen(false);
    run();
  };

  return (
    <div className="card">
      {/* 信息区 一行：姓名（点击复制）+ 状态标签；右侧序号 + ⋯ 更多菜单 */}
      <div className="flex-between gap-sm">
        <div className="flex-1">
          <span
            className="text-lg text-bold copyable"
            title="点击复制姓名"
            onClick={() => copyText(order.customerName, "姓名")}
          >
            {order.customerName}
          </span>{" "}
          <StatusTag status={order.status} />
        </div>
        <span className="flex gap-xs">
          {seq !== undefined ? (
            <span className="text-sm text-tertiary">#{seq}</span>
          ) : null}
          {hasMenu ? (
            <button
              type="button"
              className="btn btn--icon"
              aria-label="更多操作"
              title="更多操作"
              onClick={() => setMenuOpen(true)}
            >
              <Icon name="more-h" size={24} />
            </button>
          ) : null}
        </span>
      </div>

      {/* 信息区 二行（任务U 模块A 五槽标签排）：①平台 ②品牌 ③功率
          ④服务类型（仅类型文字，套包米数不进标签排） ⑤补桩状态
          （仅安装单：零跑仅上门→静态「仅上门安装」；needed=需补桩 /
          done=已补桩，点击互转；无标记不渲染）
          任务v32 功能二：平台为"其他"时平台标签可点，弹层手选平台 */}
      <div className="flex gap-xs mt-sm order-card__tags">
        {platformName ? (
          platformName === "其他" ? (
            <span
              className="tag tag--info tag--clickable"
              role="button"
              title="点击选择平台"
              onClick={(e) => {
                e.stopPropagation();
                setPlatformOpen(true);
              }}
            >
              {platformName}
            </span>
          ) : (
            <span className="tag tag--info">{platformName}</span>
          )
        ) : null}
        <span className="tag tag--info">{brand?.name ?? order.brandId}</span>
        <span className="tag tag--info">{order.powerKw}kW</span>
        <span className="tag tag--info">{SERVICE_KIND_LABEL[serviceKind]}</span>
        {isInstall &&
        isLeapmotorOnsiteOnly(order, brand?.name ?? order.brandId) ? (
          <span className="tag tag--info">仅上门安装</span>
        ) : isInstall && order.restockStatus === "needed" ? (
          <span
            className="tag tag--danger tag--clickable"
            role="button"
            title="点击标记为已补桩"
            onClick={(e) => {
              e.stopPropagation();
              updateRestockStatus(order.id, "done");
              showToast("已标记「已补桩」");
            }}
          >
            已补桩
          </span>
        ) : isInstall && order.restockStatus === "done" ? (
          <span
            className="tag tag--completed tag--clickable"
            role="button"
            title="点击打回需补桩"
            onClick={(e) => {
              e.stopPropagation();
              updateRestockStatus(order.id, "needed");
              showToast("已打回「需补桩」");
            }}
          >
            已补桩
          </span>
        ) : null}
      </div>

      {/* 信息区 三行：电话（点按拨号 / 长按复制）、地址（点按导航 / 长按复制） */}
      <div className="flex-column gap-xs mt-sm">
        {order.customerPhone ? (
          <div className="flex-between gap-sm">
            <span
              className="text-sm copyable flex-1"
              title="点击复制手机号"
              onClick={() => copyText(order.customerPhone, "手机号")}
            >
              {order.customerPhone}
            </span>
            <button
              type="button"
              className="btn btn--icon"
              aria-label={`拨打 ${order.customerPhone}（长按复制号码）`}
              title="点按拨打，长按复制号码"
              {...phonePress}
            >
              <Icon name="phone" size={24} />
            </button>
          </div>
        ) : null}
        {order.address ? (
          <div className="flex-between gap-sm">
            <span
              className="text-sm copyable flex-1" style={{ whiteSpace: "normal", wordBreak: "break-all" }}
              title="点击复制地址"
              onClick={() => copyText(order.address, "地址")}
            >
              {order.address}
            </span>
            <button
              type="button"
              className="btn btn--icon"
              aria-label={`导航到 ${order.address}（长按复制地址）`}
              title="点按导航，长按复制地址"
              {...addressPress}
            >
              <Icon name="navigate" size={24} />
            </button>
          </div>
        ) : null}

        {/* 流程信息（勘测/预约/完工，存在才显示；lucide 图标 + 文本，
            flex-between 仅为图标垂直居中，flex-1 文本占满剩余宽度） */}
        {order.survey ? (
          <span className="flex-between gap-xs">
            <Icon name="ruler" size={16} className="text-tertiary" />
            <span className="flex-1 text-sm text-secondary">
              勘测 {formatDate(order.survey.surveyDate)} · 距电表{" "}
              {order.survey.cableDistance}米
              {/* 任务v35：套包米数（师傅视角），有持久化值才追加显示 */}
              {order.packageMeters != null
                ? ` · 套包${order.packageMeters}米`
                : ""}
            </span>
          </span>
        ) : null}
        {order.appointment ? (
          <span className="flex-between gap-xs">
            <Icon name="calendar" size={16} className="text-tertiary" />
            <span className="flex-1 text-sm text-secondary">
              预约 {formatDate(order.appointment.appointmentDate)}{" "}
              {order.appointment.timeSlot} · {order.appointment.installer}
            </span>
          </span>
        ) : null}
        {order.completion ? (
          <span
            className="flex-between gap-xs"
            onClick={() => order.status === OrderStatus.Completed && setProfitOpen(true)}
            style={{ cursor: order.status === OrderStatus.Completed ? "pointer" : undefined }}
          >
            <Icon name="check-circle" size={16} className="text-tertiary" />
            <span className="flex-1 text-sm text-secondary">
              完工 {formatDate(order.completion.completeDate)} ·{" "}
              {order.completion.installer}
            </span>
          </span>
        ) : null}
      </div>

      {/* 备注小字行（任务U 模块E：有原文时可点击弹「订单原文」；
          originalText 为空则纯展示不可点） */}
      {order.remark ? (
        <div className="mt-sm">
          <span className="flex-between gap-xs">
            <Icon name="file-text" size={16} className="text-tertiary" />
            <span
              className={
                canShowOriginal
                  ? "flex-1 text-sm text-tertiary copyable"
                  : "flex-1 text-sm text-tertiary"
              }
              title={canShowOriginal ? "点击查看订单原文" : undefined}
              onClick={
                canShowOriginal ? () => setOriginalOpen(true) : undefined
              }
            >
              {order.remark}
            </span>
          </span>
        </div>
      ) : null}

      {/* 操作区（任务v32.2 页面化）：次按钮（描边）+ 水印名（描边，
          仅 page="appointment" 渲染，任务v32.2 新四参签名含品牌）+
          主按钮（.btn--md 靠右），其余收进 ⋯ 菜单 */}
      {primaryAction || secondaryAction ? (
        <div className="flex gap-sm mt-md">
          <span className="flex-1" />
          {secondaryAction ? (
            <button
              type="button"
              className="btn btn--outline btn--md"
              onClick={secondaryAction.run}
            >
              {secondaryAction.label}
            </button>
          ) : null}
          {/* 任务v35：点击弹 TextPreviewDialog 预览（可编辑），确认后复制；
              不再点击直复制 */}
          {page === "appointment" ? (
            <button
              type="button"
              className="btn btn--outline btn--md"
              onClick={() => setWatermarkOpen(true)}
            >
              水印名
            </button>
          ) : null}
          {primaryAction ? (
            <button
              type="button"
              className="btn btn--primary btn--md"
              onClick={primaryAction.run}
            >
              {primaryAction.label}
            </button>
          ) : null}
        </div>
      ) : null}

      {/* ⋯ 更多操作弹层（任务v32.2 页面化）：home 只列「查看原文」，
          appointment 列 v32 全量次操作（话术回放/编辑/取消订单）；
          危险操作（删除）置底 footer 红色 .btn--danger，不与主按钮相邻 */}
      <Modal
        open={menuOpen}
        title="订单操作"
        onClose={() => setMenuOpen(false)}
        footer={
          onDelete ? (
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => runMenuAction(() => onDelete(order))}
            >
              <Icon name="trash" size={18} />
              删除订单
            </button>
          ) : undefined
        }
      >
        {menuActions.map((action) => (
          <button
            key={action.key}
            type="button"
            className="btn btn--outline"
            disabled={action.disabled}
            onClick={() => runMenuAction(action.run)}
          >
            <Icon name={action.icon} size={18} />
            {action.label}
          </button>
        ))}
      </Modal>

      {/* 平台选择弹层（任务v32 功能二）：列出平台库全部平台，
          选中即写回 order.platform 并提示；平台库为空时给设置页指引 */}
      <Modal
        open={platformOpen}
        title="选择平台"
        onClose={() => setPlatformOpen(false)}
      >
        {loadPlatforms().length === 0 ? (
          <span className="text-sm text-tertiary">
            平台库为空，请先在设置页平台扣点配置平台
          </span>
        ) : (
          loadPlatforms().map((p) => (
            <button
              key={p.name}
              type="button"
              className="btn btn--outline"
              onClick={() => {
                updateOrderPlatform(order.id, p.name);
                showToast(`平台已更新为 ${p.name}`);
                setPlatformOpen(false);
              }}
            >
              {p.name}
            </button>
          ))
        )}
      </Modal>

      {/* 水印名预览弹窗（任务v35）：初始文本=水印串（每次打开重置），
          点「复制」回传编辑后文本再走原 copyText 复制流程 */}
      <TextPreviewDialog
        open={watermarkOpen}
        title="水印名预览"
        text={buildWatermarkName(
          watermarkTemplateFor(platformName, loadWatermarkTemplates()),
          platformName,
          brand?.name ?? order.brandId,
          order.customerName,
        )}
        onClose={() => setWatermarkOpen(false)}
        onCopy={(edited) => {
          copyText(edited, "水印名");
          setWatermarkOpen(false);
        }}
      />

      {/* 话术回放弹窗：只复制模式（无 onConfirm），数据=该单快照，
          buildScriptVars 从 order.survey/completion 回退，无需 extras */}
      <ScriptDialog
        open={scriptScene !== null}
        order={order}
        scene={scriptScene ?? "surveyComplete"}
        onClose={() => setScriptScene(null)}
      />

      {/* 订单原文弹窗（任务U 模块E）：一单对一段，只读 + footer 复制；
          展示 originalText（为空回退备注原文，空值时入口本不可点） */}
      <Modal
        open={originalOpen}
        title="订单原文"
        onClose={() => setOriginalOpen(false)}
        footer={
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              copyText(originalText || order.remark, "订单原文");
              setOriginalOpen(false);
            }}
          >
            复制
          </button>
        }
      >
        <pre className="shipment-preview">{originalText || order.remark}</pre>
      </Modal>

      <OrderProfitDialog
        open={profitOpen}
        order={order}
        onClose={() => setProfitOpen(false)}
      />
    </div>
  );
}
