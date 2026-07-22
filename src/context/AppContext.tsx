/* ============================================================
 * 全局状态：AppContext
 * 规范：跨页面业务数据统一由本模块管理；
 *      组件/页面通过 useApp() 读写，不直接碰 storage / localStorage
 * ============================================================ */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import {
  OrderStatus,
  DEFAULT_APP_SETTINGS,
} from "@/types";
import type {
  AppSettings,
  AppointmentInfo,
  ChargeBrand,
  CompletionInfo,
  Order,
  OrderDraft,
  SurveyInfo,
} from "@/types";
import {
  ensureDataVersion,
  loadCustomBrands,
  loadOrders,
  loadSettings,
  saveCustomBrands,
  saveOrders,
  saveSettings,
  loadInventory,
  saveInventory,
  loadRestockEvaluated,
  saveRestockEvaluated,
} from "@/lib/storage";
import { adjustStock } from "@/lib/inventory";
import {
  isInstallOrder,
  isLeapmotorOnsiteOnly,
  shouldTagRestock,
} from "@/lib/restock";
import { generateId, nowIso } from "@/lib/utils";
import { mergeBrands } from "@/lib/brandMaterials";

/* ------------------------------------------------------------
 * 一、Context 值类型（页面可用的全部状态与方法）
 * ------------------------------------------------------------ */
export interface AppContextValue {
  /* ---- 数据 ---- */
  orders: Order[];
  settings: AppSettings;
  customBrands: ChargeBrand[];
  /** 内置 + 自定义 合并后的品牌列表（页面统一用这个） */
  brands: ChargeBrand[];
  /** 是否已完成首次加载（避免首屏闪空列表） */
  hydrated: boolean;

  /* ---- 订单操作 ---- */
  addOrder: (draft: OrderDraft) => Order;
  updateOrder: (id: string, draft: OrderDraft) => void;
  deleteOrder: (id: string) => void;
  cancelOrder: (id: string) => void;
  /** 回收站：恢复订单（读 legacyExtra.status 还原原状态，无效值回退 待勘测），清除 deletedAt */
  restoreOrder: (id: string) => void;
  /** 回收站：彻底删除（物理移除，不可恢复；软删走 deleteOrder） */
  purgeOrder: (id: string) => void;
  /** 过期未装回退到已勘测，清除预约信息 */
  revertToSurveyed: (id: string) => void;
  /** 登记勘测：写入勘测信息并流转到 已勘测 */
  saveSurvey: (id: string, survey: SurveyInfo) => void;
  /** 登记预约：写入预约信息并流转到 已预约 */
  saveAppointment: (id: string, appointment: AppointmentInfo) => void;
  /** 登记完工：写入完工信息并流转到 已完成 */
  saveCompletion: (id: string, completion: CompletionInfo) => void;
  /** xlsx 批量导入：追加到现有订单，返回导入条数 */
  importOrders: (orders: Order[]) => number;

  /* ---- 设置 / 品牌 ---- */
  updateSettings: (patch: Partial<AppSettings>) => void;
  addCustomBrand: (brand: ChargeBrand) => void;

  /* ---- 数据重置（设置页导入备份/清空后同步内存） ---- */
  replaceAllData: (
    orders: Order[],
    settings: AppSettings,
    customBrands: ChargeBrand[],
  ) => void;

  /* ---- 轻提示 ---- */
  toast: string | null;
  showToast: (message: string) => void;

  /* ---- 补桩（任务U） ---- */
  /** 补桩标签互转（订单卡点击：需补桩 ⇄ 已补桩） */
  updateRestockStatus: (id: string, status: "needed" | "done") => void;
  /** 一键补桩复制完成后，本次纳入单全部翻「已补桩」 */
  markRestockDone: (ids: string[]) => void;
  /* ---- 平台（任务v32 功能二） ---- */
  /** 单字段更新订单平台（平台标签手选持久化；originalText 不动） */
  updateOrderPlatform: (id: string, platform: string) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

/* ------------------------------------------------------------
 * 二、Provider
 * ------------------------------------------------------------ */
const TOAST_DURATION = 2200;

export function AppProvider({ children }: { children: ReactNode }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [customBrands, setCustomBrands] = useState<ChargeBrand[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  /* ---- 首次加载：版本迁移 → 读 storage ---- */
  /* ---- 首次加载：版本迁移 → 读 storage（数据>300条时分批，避免首屏阻塞） ---- */
  useEffect(() => {
    ensureDataVersion();
    const all = loadOrders();
    if (all.length > 300) {
      setOrders(all.slice(0, 30));
      if ("requestIdleCallback" in window) {
        requestIdleCallback(() => setOrders(all));
      } else {
        setTimeout(() => setOrders(all), 200);
      }
    } else {
      setOrders(all);
    }
    setSettings(loadSettings());
    setCustomBrands(loadCustomBrands());
    setHydrated(true);
  }, []);

  /* ---- 变更自动持久化：写入防抖 300ms，连续操作只存最后一次 ---- */
  useEffect(() => {
    if (!hydrated) return;
    const timer = setTimeout(() => {
      saveOrders(orders);
    }, 300);
    return () => clearTimeout(timer);
  }, [orders, hydrated]);

  useEffect(() => {
    if (hydrated) saveSettings(settings);
  }, [settings, hydrated]);

  useEffect(() => {
    if (hydrated) saveCustomBrands(customBrands);
  }, [customBrands, hydrated]);

  /* ---- Toast：全局单例，自动消失 ---- */
  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current !== null) {
      window.clearTimeout(toastTimer.current);
    }
    toastTimer.current = window.setTimeout(() => {
      setToast(null);
      toastTimer.current = null;
    }, TOAST_DURATION);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current !== null) {
        window.clearTimeout(toastTimer.current);
      }
    };
  }, []);

  /* ---- 订单操作 ---- */

  const addOrder = useCallback(
    (draft: OrderDraft): Order => {
      const now = nowIso();
      const order: Order = {
        ...draft,
        id: generateId(),
        createdAt: now,
        updatedAt: now,
      };
      /* 任务U 模块C：新安装单导入——该品牌库存=0 自动挂「需补桩」（仅提示不拦截） */
      const brandName =
        mergeBrands(customBrands).find((b) => b.id === order.brandId)?.name ??
        order.brandId;
      if (shouldTagRestock(order, loadInventory(), brandName)) {
        order.restockStatus = "needed";
      }
      setOrders((prev) => [order, ...prev]);
      return order;
    },
    [customBrands],
  );

  const updateOrder = useCallback((id: string, draft: OrderDraft) => {
    setOrders((prev) =>
      prev.map((o) =>
        o.id === id ? { ...o, ...draft, updatedAt: nowIso() } : o,
      ),
    );
  }, []);

  /* 回收站机制：删除 = 软删（status→Trash + deletedAt 记录删除时间，
   * 原状态暂存 legacyExtra.status 供恢复还原；物理删除走 purgeOrder） */
  /* 任务E：桩库存钩子——带桩订单完工-1、完成单删除回库+1、恢复完成单-1。
   * legacyExtra.noPile===true 的不带桩单跳过；库存键按品牌名（StockItem.brand） */
  const adjustInventoryFor = useCallback(
    (order: Order | undefined, delta: number) => {
      if (!order || order.legacyExtra?.noPile === true) return;
      const brandName =
        mergeBrands(customBrands).find((b) => b.id === order.brandId)?.name ??
        order.brandId;
      saveInventory(adjustStock(brandName, delta, loadInventory()));
    },
    [customBrands],
  );

  /* 任务v32 功能一：该单是否参与桩库存增减——安装单 且 非「零跑仅上门」
     （零跑原文含「带桩上门」正常参与；完工-1/删除回库+1/恢复-1 三处
     统一走本判定，保持增减对称，判定收敛 lib） */
  const participatesPileStock = useCallback(
    (order: Order): boolean => {
      if (!isInstallOrder(order)) return false;
      const brandName =
        mergeBrands(customBrands).find((b) => b.id === order.brandId)?.name ??
        order.brandId;
      return !isLeapmotorOnsiteOnly(order, brandName);
    },
    [customBrands],
  );

  const deleteOrder = useCallback((id: string) => {
    const target = orders.find((o) => o.id === id);
    /* v32 功能一：完成单删除回库与完工扣减对称——零跑仅上门完工单
       当初未扣减，删除不回库 */
    if (target?.status === OrderStatus.Completed && participatesPileStock(target)) {
      adjustInventoryFor(target, 1);
    }
    setOrders((prev) =>
      prev.map((o) =>
        o.id === id
          ? {
              ...o,
              status: OrderStatus.Trash,
              deletedAt: nowIso(),
              legacyExtra: { ...o.legacyExtra, status: o.status },
              updatedAt: nowIso(),
            }
          : o,
      ),
    );
  }, [orders, adjustInventoryFor, participatesPileStock]);

  const cancelOrder = useCallback((id: string) => {
    setOrders((prev) =>
      prev.map((o) =>
        o.id === id
          ? { ...o, status: OrderStatus.Cancelled, updatedAt: nowIso() }
          : o,
      ),
    );
  }, []);

  const revertToSurveyed = useCallback((id: string) => {
    setOrders((prev) =>
      prev.map((o) =>
        o.id === id
          ? {
              ...o,
              status: OrderStatus.Surveyed,
              appointment: undefined,
              updatedAt: nowIso(),
            }
          : o,
      ),
    );
  }, []);

  /* 回收站恢复：仅对 trash 单生效；原状态取自 legacyExtra.status
   * （迁移与软删时写入），缺失/非法值回退 待勘测，并清除 deletedAt */
  const restoreOrder = useCallback((id: string) => {
    const target = orders.find((o) => o.id === id);
    setOrders((prev) =>
      prev.map((o) => {
        if (o.id !== id || o.status !== OrderStatus.Trash) return o;
        const raw = o.legacyExtra?.status;
        const restored =
          typeof raw === "string" &&
          raw !== OrderStatus.Trash &&
          (Object.values(OrderStatus) as string[]).includes(raw)
            ? (raw as OrderStatus)
            : OrderStatus.Pending;
        /* v32 功能一：恢复完成单回扣与完工扣减对称——零跑仅上门单不回扣 */
        if (
          restored === OrderStatus.Completed &&
          target &&
          participatesPileStock(target)
        ) {
          adjustInventoryFor(target, -1);
        }
        return {
          ...o,
          status: restored,
          deletedAt: undefined,
          updatedAt: nowIso(),
        };
      }),
    );
  }, [orders, adjustInventoryFor, participatesPileStock]);

  /* 回收站彻底删除：物理移除，不可恢复 */
  const purgeOrder = useCallback((id: string) => {
    setOrders((prev) => prev.filter((o) => o.id !== id));
  }, []);

  /* v32.4 状态保持：已预约单登记勘测=补填勘测数据，预约身份不变
   * （状态保持 Appointed、预约日期/时段保留、留在已预约页；
   *  唯一离开路径=完工→已完成）；待办单登记勘测→已勘测（原口径） */
  const saveSurvey = useCallback((id: string, survey: SurveyInfo) => {
    setOrders((prev) =>
      prev.map((o) =>
        o.id === id
          ? {
              ...o,
              survey,
              status:
                o.status === OrderStatus.Appointed
                  ? OrderStatus.Appointed
                  : OrderStatus.Surveyed,
              updatedAt: nowIso(),
            }
          : o,
      ),
    );
  }, []);

  const saveAppointment = useCallback(
    (id: string, appointment: AppointmentInfo) => {
      setOrders((prev) =>
        prev.map((o) =>
          o.id === id
            ? {
                ...o,
                appointment,
                status: OrderStatus.Appointed,
                updatedAt: nowIso(),
              }
            : o,
        ),
      );
    },
    [],
  );

  const saveCompletion = useCallback(
    (id: string, completion: CompletionInfo) => {
      /* 任务U 模块C + v32 功能一：完工安装单→该品牌桩库存自动-1
         （维修/勘测完工不扣桩；零跑仅上门单不扣桩） */
      const target = orders.find((o) => o.id === id);
      if (target && participatesPileStock(target)) {
        adjustInventoryFor(target, -1);
      }
      setOrders((prev) =>
        prev.map((o) =>
          o.id === id
            ? {
                ...o,
                completion,
                status: OrderStatus.Completed,
                updatedAt: nowIso(),
              }
            : o,
        ),
      );
    },
    [orders, adjustInventoryFor, participatesPileStock],
  );

  const importOrders = useCallback(
    (incoming: Order[]): number => {
      if (incoming.length === 0) return 0;
      /* 任务U 模块C：批量导入同样按库存判定挂「需补桩」 */
      const inventory = loadInventory();
      const tagged = incoming.map((order) => {
        const brandName =
          mergeBrands(customBrands).find((b) => b.id === order.brandId)?.name ??
          order.brandId;
        return shouldTagRestock(order, inventory, brandName)
          ? { ...order, restockStatus: "needed" as const }
          : order;
      });
      setOrders((prev) => [...tagged, ...prev]);
      return tagged.length;
    },
    [customBrands],
  );

  /* ---- 设置 / 品牌 ---- */

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const addCustomBrand = useCallback((brand: ChargeBrand) => {
    setCustomBrands((prev) =>
      prev.some((b) => b.id === brand.id) ? prev : [...prev, brand],
    );
  }, []);

  /* ---- 数据重置（导入备份 / 清空后整体替换内存） ---- */
  const replaceAllData = useCallback(
    (
      nextOrders: Order[],
      nextSettings: AppSettings,
      nextBrands: ChargeBrand[],
    ) => {
      setOrders(nextOrders);
      setSettings(nextSettings);
      setCustomBrands(nextBrands);
    },
    [],
  );

  /* ---- 任务U 模块C：补桩标签互转 + 一键补桩批量翻已补桩 ---- */
  const updateRestockStatus = useCallback(
    (id: string, status: "needed" | "done") => {
      setOrders((prev) =>
        prev.map((o) =>
          o.id === id ? { ...o, restockStatus: status, updatedAt: nowIso() } : o,
        ),
      );
    },
    [],
  );

  const markRestockDone = useCallback((ids: string[]) => {
    const targets = new Set(ids);
    setOrders((prev) =>
      prev.map((o) =>
        targets.has(o.id)
          ? { ...o, restockStatus: "done" as const, updatedAt: nowIso() }
          : o,
      ),
    );
  }, []);

  /* ---- 任务v32 功能二：平台标签手选持久化（仅 platform 单字段，
     originalText 与其余字段一律不动；水印/发货单/片区等后续取值自动生效） ---- */
  const updateOrderPlatform = useCallback((id: string, platform: string) => {
    setOrders((prev) =>
      prev.map((o) =>
        o.id === id ? { ...o, platform, updatedAt: nowIso() } : o,
      ),
    );
  }, []);

  /* ---- 任务U 模块C：遗留安装单补桩首判（上线后一次性，一个不漏） ---- */
  useEffect(() => {
    if (!hydrated || loadRestockEvaluated()) return;
    const inventory = loadInventory();
    setOrders((prev) => {
      let changed = false;
      const next = prev.map((o) => {
        if (o.restockStatus != null) return o;
        if (!isInstallOrder(o)) return o;
        const brandName =
          mergeBrands(customBrands).find((b) => b.id === o.brandId)?.name ??
          o.brandId;
        if (!shouldTagRestock(o, inventory, brandName)) return o;
        changed = true;
        return { ...o, restockStatus: "needed" as const, updatedAt: nowIso() };
      });
      return changed ? next : prev;
    });
    saveRestockEvaluated();
  }, [hydrated, customBrands]);

  /* ---- 任务v32 功能一：零跑「仅上门安装」清洗（幂等，每次挂载扫一遍） ----
   * v31 首判把 127 个安装单全挂了 needed（含零跑仅上门单，基线数据实测 16 个）。
   * v32 规则：零跑+原文无「带桩上门」永不持补桩标记——凡带 needed/done 的
   * 零跑仅上门单一律清标（→ 显示「仅上门安装」、退出补桩计数与发货单）；
   * 含「带桩上门」的零跑单标记保留（正常走状态机）。无脏数据返回 prev 零开销 */
  useEffect(() => {
    if (!hydrated) return;
    const brands = mergeBrands(customBrands);
    setOrders((prev) => {
      let changed = false;
      const next = prev.map((o) => {
        if (o.restockStatus == null) return o;
        const brandName =
          brands.find((b) => b.id === o.brandId)?.name ?? o.brandId;
        if (!isLeapmotorOnsiteOnly(o, brandName)) return o;
        changed = true;
        return { ...o, restockStatus: undefined, updatedAt: nowIso() };
      });
      return changed ? next : prev;
    });
  }, [hydrated, customBrands]);

  /* ---- 汇总 ---- */
  const brands = useMemo(() => mergeBrands(customBrands), [customBrands]);

  const value = useMemo<AppContextValue>(
    () => ({
      orders,
      settings,
      customBrands,
      brands,
      hydrated,
      addOrder,
      updateOrder,
      deleteOrder,
      cancelOrder,
      restoreOrder,
      purgeOrder,
      revertToSurveyed,
      saveSurvey,
      saveAppointment,
      saveCompletion,
      importOrders,
      updateSettings,
      addCustomBrand,
      replaceAllData,
      toast,
      showToast,
      updateRestockStatus,
      markRestockDone,
      updateOrderPlatform,
    }),
    [
      orders,
      settings,
      customBrands,
      brands,
      hydrated,
      addOrder,
      updateOrder,
      deleteOrder,
      cancelOrder,
      restoreOrder,
      purgeOrder,
      revertToSurveyed,
      saveSurvey,
      saveAppointment,
      saveCompletion,
      importOrders,
      updateSettings,
      addCustomBrand,
      replaceAllData,
      toast,
      showToast,
      updateRestockStatus,
      markRestockDone,
      updateOrderPlatform,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

/* ------------------------------------------------------------
 * 三、消费 Hook：页面/组件唯一取数入口
 * ------------------------------------------------------------ */
export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error("useApp 必须在 <AppProvider> 内使用");
  }
  return ctx;
}
