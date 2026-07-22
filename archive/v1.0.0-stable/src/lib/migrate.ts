/* ============================================================
 * v7 老备份兼容迁移器（零数据丢失红线）
 * 规范：v7 备份 → v2 数据结构的唯一入口，字段映射红线见《接口约定文档》第三节
 * 实测基准：charging-pile-backup_2026-07-16_12-03_手动备份.json
 *   orders 9 / completedOrders 125 / trashOrders 6 / materials 572 / brandPrices 30
 *   inventory 6 / templates 4 / costSheet 37 / platforms 13 / platformDeductions 11
 *   materialUsage 21 / geoCache 14（双层编码 JSON 字符串）
 * ============================================================ */

import { OrderStatus } from "@/types";
import type {
  AppSettings,
  BrandPrice,
  ChargeBrand,
  CompletionInfo,
  CostSheetItem,
  MaterialItem,
  MaterialItemLib,
  MaterialTemplate,
  MaterialUsageRecord,
  Order,
  PlatformConfig,
  StockItem,
  SurveyInfo,
} from "@/types";
import { BUILT_IN_BRANDS } from "@/lib/brandMaterials";
import { matchBrandIdByName } from "@/lib/parser";
import { generateId, nowIso } from "@/lib/utils";
import type { GeoPoint } from "@/lib/storage";

/* ------------------------------------------------------------
 * 一、版本探测
 * ------------------------------------------------------------ */
export type BackupVersionKind = "v1" | "v7" | "unknown";

/** 备份版本探测：version==="v7" 或含 completedOrders/trashOrders 键 → v7；
 * version 为 number → v1；其余 → unknown */
export function detectBackupVersion(json: unknown): BackupVersionKind {
  if (typeof json !== "object" || json === null) return "unknown";
  const obj = json as Record<string, unknown>;
  if (
    obj.version === "v7" ||
    "completedOrders" in obj ||
    "trashOrders" in obj
  ) {
    return "v7";
  }
  if (typeof obj.version === "number") return "v1";
  return "unknown";
}

/* ------------------------------------------------------------
 * 二、迁移结果（storage.importBackup 全量入库用，report 供验收对账）
 * ------------------------------------------------------------ */
/** 日期兜底清单条目：迁移中发生过回退/解析失败/非平凡换算的日期字段逐条登记 */
export interface DateFallbackEntry {
  orderId: string;
  field: string;
  original: unknown;
  resolved: string;
  rule: string;
}

/** 对账报告：每模块迁入条数 + collisions + dateFallbacks 日期兜底清单 */
export interface MigrationReport {
  [module: string]: number | DateFallbackEntry[];
  dateFallbacks: DateFallbackEntry[];
}

export interface MigrationResult {
  /** 合并后订单：9待办+125完成+6回收站=140，status: pending/completed/trash */
  orders: Order[];
  /** userSettings + amapKey + amapSecurity + myPosition + todayCalls */
  settings: Partial<AppSettings>;
  /** 老品牌名自动新建的自定义品牌（不存在于内置品牌的） */
  customBrands: ChargeBrand[];
  /** 地理编码缓存（双层解码后） */
  geoCache: Record<string, GeoPoint>;
  materialsLib: MaterialItemLib[];
  brandPrices: BrandPrice[];
  inventory: StockItem[];
  materialTemplates: MaterialTemplate[];
  costSheet: CostSheetItem[];
  /** platforms 13 ∪ platformDeductions 11 合并，缺扣点给 0 */
  platforms: PlatformConfig[];
  materialUsage: MaterialUsageRecord[];
  /** 每模块迁入条数 + collisions + dateFallbacks 日期兜底清单（验收对账用） */
  report: MigrationReport;
}

/* ------------------------------------------------------------
 * 三、内部工具
 * ------------------------------------------------------------ */

/** v7 原始订单行：字段杂、允许任意键，访问前逐一校验 */
type RawV7Order = Record<string, unknown> & {
  surveyData?: Record<string, unknown>;
  completionData?: Record<string, unknown>;
  profitData?: Record<string, unknown>;
};

/** 脏值 → 字符串（null/undefined → ""，其余 String 化） */
function asStr(v: unknown): string {
  if (v === undefined || v === null) return "";
  return typeof v === "string" ? v : String(v);
}

/** 脏值 → 数字（非有限数 → fallback） */
function asNum(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** v7 时间戳（ms 数字）→ ISO 字符串；字符串原样保留；缺失兜底 now（实测 140 条均为 ms 数字） */
function tsToIso(v: unknown): string {
  if (typeof v === "number" && Number.isFinite(v)) {
    return new Date(v).toISOString();
  }
  if (typeof v === "string" && v) return v;
  return nowIso();
}

/** 统一日期归一化（脏数据2红线）：接受 ms时间戳 / ISO / YYYY-MM-DD / 空值，
 * 输出严格 "YYYY-MM-DD"（UTC 口径，与 v7 completionData.completionDate 实测温准一致）；
 * 其余脏格式（实测 installDate 有 "7.13"/"17" 等残缺写法）解析失败返回 ""，禁止臆造补全 */
function normalizeDateStr(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "";
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
  }
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  }
  const s = asStr(v).trim();
  if (!s) return "";
  /* 仅承接 YYYY-MM-DD 及其带时间后缀的 ISO 形态，校验真实日期后取日期段 */
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/.exec(s);
  if (!m) return "";
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  /* 回读校验：拦截 2026-02-31 之类虚假日期 */
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`);
  if (
    Number.isNaN(d.getTime()) ||
    d.toISOString().slice(0, 10) !== `${m[1]}-${m[2]}-${m[3]}`
  ) {
    return "";
  }
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** 脏值 → 对象数组（非数组 → []） */
function asRecordArray(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
}

/** 大陆 11 位手机号（与 parser.ts 口径一致的正则核心） */
const PHONE_RE = /1[3-9]\d{9}/;
/** 是否含中文（phone 残余姓名判定用） */
const CJK_RE = /[一-龥]/;

/** v7 type → 服务前缀（写入 remark，兼容 finance.getServiceKind 识别口径） */
const V7_TYPE_LABEL: Record<string, string> = {
  install: "安装",
  survey: "勘测",
  repair: "维修",
};

/** 预约时段 → timeSlot（约定三项 +"中午"实测 18 条，归并到午间档） */
const PERIOD_TO_SLOT: Record<string, string> = {
  上午: "09:00-12:00",
  下午: "14:00-18:00",
  晚上: "18:00-21:00",
  中午: "12:00-14:00",
};
/** 约定文档规定的三个标准时段；其余时段原文需进 legacyExtra 防丢 */
const STANDARD_PERIODS = new Set(["上午", "下午", "晚上"]);

/** legacyExtra 收纳的 v7 原字段（约定清单，有值才写） */
const LEGACY_EXTRA_KEYS = [
  "freeCableMeters",
  "onlyInstall",
  "noPile",
  "uncertain",
  "inspectionItems",
  "pileName",
  "serialNumber",
  "installDate",
  "restocked",
  "serviceType",
] as const;

/** "有值"判定：false/""/0/空数组/null/undefined 视为无值（v7 里这些是默认占位） */
function hasLegacyValue(v: unknown): boolean {
  if (v === undefined || v === null || v === "" || v === false) return false;
  if (typeof v === "number" && v === 0) return false;
  if (Array.isArray(v) && v.length === 0) return false;
  return true;
}

/** 品牌名 → 安全 id 片段（保留中文/字母/数字/下划线/连字符，其余剔除） */
function safeBrandId(name: string): string {
  return (
    "v7_" + name.trim().replace(/\s+/g, "_").replace(/[^\w一-龥-]/g, "")
  );
}

/* ------------------------------------------------------------
 * 四、主迁移入口
 * ------------------------------------------------------------ */
export function migrateV7Backup(json: Record<string, unknown>): MigrationResult {
  /* ---- 品牌解析上下文：内置精确 → 内置 includes 模糊（matchBrandIdByName 口径）
   *     → 已新建自定义去重 → 自动新建（禁止丢弃任何老品牌名） ---- */
  const usedBrandIds = new Set(BUILT_IN_BRANDS.map((b) => b.id));
  const customByName = new Map<string, ChargeBrand>();

  function resolveBrandId(brandName: unknown): string {
    const text = asStr(brandName).trim();
    /* 空品牌名归入内置"其他品牌"，禁止新建空品牌 */
    if (!text) return "other";
    const exact = BUILT_IN_BRANDS.find((b) => b.name === text);
    if (exact) return exact.id;
    const fuzzy = matchBrandIdByName(text, BUILT_IN_BRANDS);
    if (fuzzy) return fuzzy;
    const existing = customByName.get(text);
    if (existing) return existing.id;
    const base = safeBrandId(text) || "v7_brand";
    let id = base;
    let seq = 2;
    while (usedBrandIds.has(id)) {
      id = `${base}_${seq}`;
      seq += 1;
    }
    usedBrandIds.add(id);
    const brand: ChargeBrand = { id, name: text, defaultPowerKw: 7 };
    customByName.set(text, brand);
    return id;
  }

  /* ---- 订单 id 冲突处理：保留原值；三类间撞 id 加 "_c{n}" 后缀并计数 ---- */
  const seenOrderIds = new Set<string>();
  let collisions = 0;

  function dedupeOrderId(rawId: unknown): string {
    let id = asStr(rawId) || generateId();
    if (seenOrderIds.has(id)) {
      collisions += 1;
      const baseId = id;
      let seq = 2;
      id = `${baseId}_c${seq}`;
      while (seenOrderIds.has(id)) {
        seq += 1;
        id = `${baseId}_c${seq}`;
      }
    }
    seenOrderIds.add(id);
    return id;
  }

  type Bucket = "orders" | "completedOrders" | "trashOrders";

  /* ---- 日期兜底清单：回退/解析失败/非平凡换算逐条登记（report.dateFallbacks） ---- */
  const dateFallbacks: DateFallbackEntry[] = [];

  /* completeDate 归一化兜底链（统计归月全靠它，禁止只存时间戳）：
   * 顶层completedAt(ms) → completionData.completedAt → createdAt换算 → 解析失败归入创建月 → 留空；
   * 每一级回退/失败都逐条记入 dateFallbacks */
  function resolveCompleteDate(
    raw: RawV7Order,
    cd: Record<string, unknown>,
    orderId: string,
  ): string {
    const top = normalizeDateStr(raw.completedAt);
    if (top) return top;
    dateFallbacks.push({
      orderId,
      field: "completeDate",
      original: raw.completedAt ?? null,
      resolved: "",
      rule: "顶层completedAt缺失/解析失败，回退completionData.completedAt",
    });
    const inner = normalizeDateStr(cd.completedAt);
    if (inner) {
      dateFallbacks.push({
        orderId,
        field: "completeDate",
        original: cd.completedAt,
        resolved: inner,
        rule: "completionData.completedAt换算",
      });
      return inner;
    }
    dateFallbacks.push({
      orderId,
      field: "completeDate",
      original: cd.completedAt ?? null,
      resolved: "",
      rule: "completionData.completedAt缺失/解析失败，回退createdAt",
    });
    const fromCreated = normalizeDateStr(raw.createdAt);
    if (fromCreated) {
      dateFallbacks.push({
        orderId,
        field: "completeDate",
        original: raw.createdAt,
        resolved: fromCreated,
        rule: "completedAt→createdAt换算",
      });
      return fromCreated;
    }
    /* 创建月兜底：createdAt 整体不可解析时尽力截取 YYYY-MM 归月（日补 01） */
    const mm = /^(\d{4})-(0[1-9]|1[0-2])/.exec(asStr(raw.createdAt).trim());
    if (mm) {
      const monthDate = `${mm[1]}-${mm[2]}-01`;
      dateFallbacks.push({
        orderId,
        field: "completeDate",
        original: raw.createdAt,
        resolved: monthDate,
        rule: "解析失败归入创建月",
      });
      return monthDate;
    }
    dateFallbacks.push({
      orderId,
      field: "completeDate",
      original: raw.completedAt ?? cd.completedAt ?? raw.createdAt ?? null,
      resolved: "",
      rule: "解析失败留空",
    });
    return "";
  }

  function convertOrder(
    raw: RawV7Order,
    mappedStatus: OrderStatus,
    bucket: Bucket,
  ): Order {
    const legacyExtra: Record<string, unknown> = {};
    const orderId = dedupeOrderId(raw.id);

    /* 约定清单字段：有值才写（原字段名原样保留） */
    for (const key of LEGACY_EXTRA_KEYS) {
      const v = raw[key];
      if (hasLegacyValue(v)) legacyExtra[key] = v;
    }

    /* installDate 归一化：原值已由上方 LEGACY_EXTRA_KEYS 留存；
     * 规范值写 installDateNormalized 兄弟键，被改写/解析失败逐条记兜底清单 */
    if (hasLegacyValue(raw.installDate)) {
      const installDateNorm = normalizeDateStr(raw.installDate);
      const installDateRawStr = asStr(raw.installDate).trim();
      if (installDateNorm && installDateNorm !== installDateRawStr) {
        legacyExtra.installDateNormalized = installDateNorm;
      }
      if (installDateNorm !== installDateRawStr) {
        dateFallbacks.push({
          orderId,
          field: "installDate",
          original: raw.installDate,
          resolved: installDateNorm,
          rule: installDateNorm
            ? "installDate归一化换算，原值留存legacyExtra"
            : "installDate解析失败，原值留存legacyExtra",
        });
      }
    }

    /* 老 status 留存：orders 桶按约定必存；其余桶与新状态不同才存（回收站单可据此恢复原状态） */
    const oldStatus = asStr(raw.status).trim();
    if (oldStatus && (bucket === "orders" || oldStatus !== mappedStatus)) {
      legacyExtra.status = oldStatus;
    }

    /* deletedAt（v7 脏数据：实测 3 条已完成单带删除时间）原值一律留存 legacyExtra；
     * 回收站单在下方另归一化为 order.deletedAt（YYYY-MM-DD 日期精度） */
    if (hasLegacyValue(raw.deletedAt)) {
      legacyExtra.deletedAt = raw.deletedAt;
    }

    /* 完工时间原文（ms 时间戳）留存：completeDate 只保留日期精度 */
    if (bucket === "completedOrders" && hasLegacyValue(raw.completedAt)) {
      legacyExtra.completedAt = raw.completedAt;
    }

    /* phone 脏数据：正则提取手机号；提取后残余含中文名且 customerName 为空则并入 */
    const phoneRaw = asStr(raw.phone);
    let customerName = asStr(raw.name).trim();
    let customerPhone = "";
    const pm = phoneRaw.match(PHONE_RE);
    if (pm) {
      customerPhone = pm[0];
      const residual = phoneRaw.replace(pm[0], "").trim();
      if (!customerName && CJK_RE.test(residual)) customerName = residual;
    }

    /* power："11kW"→11（parseFloat，NaN→7） */
    const powerParsed = parseFloat(asStr(raw.power));
    const powerKw = Number.isFinite(powerParsed) ? powerParsed : 7;

    /* type → remark 前缀"服务:安装/勘测/维修"（getServiceKind 兼容），原 remark 接在前缀后；
     * 老 serviceType 原文由上方 LEGACY_EXTRA_KEYS 收纳进 legacyExtra */
    const typeLabel = V7_TYPE_LABEL[asStr(raw.type).trim()] ?? "";
    const oldRemark = asStr(raw.remark).trim();
    const remark = typeLabel
      ? oldRemark
        ? `服务:${typeLabel} ${oldRemark}`
        : `服务:${typeLabel}`
      : oldRemark;

    /* appointmentDate 过 normalizeDateStr（YYYY-MM-DD）；被改写/解析失败的原值留存 legacyExtra 并记清单 */
    const apptRawStr = asStr(raw.appointmentDate).trim();
    const apptDate = normalizeDateStr(raw.appointmentDate);
    if (apptRawStr && apptRawStr !== apptDate) {
      legacyExtra.appointmentDate = raw.appointmentDate;
      dateFallbacks.push({
        orderId,
        field: "appointmentDate",
        original: raw.appointmentDate,
        resolved: apptDate,
        rule: apptDate
          ? "appointmentDate归一化换算，原值留存legacyExtra"
          : "appointmentDate解析失败，原值留存legacyExtra",
      });
    }

    /* appointmentPeriod → timeSlot；非标准时段（如"中午"）原文进 legacyExtra */
    const period = asStr(raw.appointmentPeriod).trim();
    const apptNote = asStr(raw.appointmentNote).trim();
    if (period && !STANDARD_PERIODS.has(period)) {
      legacyExtra.appointmentPeriod = period;
    }

    /* createdAt 保留原时间戳（ms → ISO）；updatedAt = createdAt */
    const createdAt = tsToIso(raw.createdAt);

    const order: Order = {
      id: orderId,
      customerName,
      customerPhone,
      address: asStr(raw.addr).trim(),
      brandId: resolveBrandId(raw.brand),
      powerKw,
      status: mappedStatus,
      remark,
      createdAt,
      updatedAt: createdAt,
    };

    /* lat/lng → longitude/latitude */
    if (typeof raw.lng === "number" && Number.isFinite(raw.lng)) {
      order.longitude = raw.lng;
    }
    if (typeof raw.lat === "number" && Number.isFinite(raw.lat)) {
      order.latitude = raw.lat;
    }

    const platform = asStr(raw.platform).trim();
    if (platform) order.platform = platform;

    /* originalText 完整保留（不 trim 不改写，丢失=重大事故） */
    if (typeof raw.originalText === "string" && raw.originalText) {
      order.originalText = raw.originalText;
    }

    /* surveyData → survey：v7 快照整体保留（老字段名原样；
     * v7 该结构跨版本不稳定——实测存在两代字段集，禁止逐项映射，类型断言承接）；
     * 快照内 surveyDate 过 normalizeDateStr（YYYY-MM-DD），被改写/解析失败的原值留存 legacyExtra */
    if (raw.surveyData && typeof raw.surveyData === "object") {
      const sd = raw.surveyData;
      const surveyDate = normalizeDateStr(sd.surveyDate);
      order.survey = { ...sd, surveyDate } as unknown as SurveyInfo;
      const surveyDateRawStr = asStr(sd.surveyDate).trim();
      if (surveyDateRawStr && surveyDateRawStr !== surveyDate) {
        legacyExtra["surveyData.surveyDate"] = sd.surveyDate;
        dateFallbacks.push({
          orderId,
          field: "surveyDate",
          original: sd.surveyDate,
          resolved: surveyDate,
          rule: surveyDate
            ? "surveyDate归一化换算，原值留存legacyExtra"
            : "surveyDate解析失败，原值留存legacyExtra",
        });
      }
    }

    /* appointmentDate/appointmentNote → appointment（字段名对齐 AppointmentInfo） */
    if (apptDate || period || apptNote) {
      order.appointment = {
        appointmentDate: apptDate,
        timeSlot: PERIOD_TO_SLOT[period] ?? period,
        installer: "",
        note: apptNote,
      };
    }

    /* completionData + profitData → completion */
    if (raw.completionData && typeof raw.completionData === "object") {
      const cd = raw.completionData;
      const rawMats = Array.isArray(cd.materials) ? cd.materials : [];
      /* materials 映射新 MaterialItem：materialName→name、price→unitPrice（v7 无规格字段→spec 留空） */
      const materials: MaterialItem[] = rawMats.map((m) => {
        const mm = (m ?? {}) as Record<string, unknown>;
        return {
          name: asStr(mm.materialName),
          spec: "",
          quantity: asNum(mm.quantity),
          unit: asStr(mm.unit),
          unitPrice: asNum(mm.price),
        };
      });
      const completion = {
        /* v7 completionData 快照整体摊开保留（totalExtraFee/actualCableMeters/profit/
         * completionDate/textSummary/inspectionChecks 等老字段名原样），再覆盖新规范必有字段 */
        ...cd,
        /* completeDate 必须严格 YYYY-MM-DD：走 resolveCompleteDate 四级兜底链，回退逐条记 dateFallbacks */
        completeDate: resolveCompleteDate(raw, cd, orderId),
        installer: asStr(cd.engineerName),
        materials,
        /* v7 无工时字段，必有字段补 0 */
        workHours: 0,
        note: asStr(cd.remarks),
      } as CompletionInfo;
      /* profitData 全量塞进 legacyProfit，利润数值禁止重算 */
      if (raw.profitData && typeof raw.profitData === "object") {
        completion.legacyProfit = raw.profitData;
      }
      order.completion = completion;
    }

    /* payment：paid/paidAmount/paymentStatus 任一存在才写 */
    if (
      raw.paid !== undefined ||
      raw.paidAmount !== undefined ||
      raw.paymentStatus !== undefined
    ) {
      order.payment = { paid: Boolean(raw.paid) };
      if (raw.paidAmount !== undefined) {
        order.payment.amount = asNum(raw.paidAmount);
      }
      if (raw.paymentStatus !== undefined) {
        order.payment.status = asStr(raw.paymentStatus);
      }
    }

    /* 回收站单：deletedAt 归一化为日期精度（YYYY-MM-DD）；原始删除时间戳已在上方留存 legacyExtra */
    if (bucket === "trashOrders" && hasLegacyValue(raw.deletedAt)) {
      order.deletedAt = normalizeDateStr(raw.deletedAt);
      if (!order.deletedAt) {
        dateFallbacks.push({
          orderId,
          field: "deletedAt",
          original: raw.deletedAt,
          resolved: "",
          rule: "deletedAt解析失败，原值留存legacyExtra",
        });
      }
    }

    if (Object.keys(legacyExtra).length > 0) order.legacyExtra = legacyExtra;
    return order;
  }

  /* ---- 三类订单合并：orders→pending / completedOrders→completed / trashOrders→trash ---- */
  const pendingList = asRecordArray(json.orders);
  const completedList = asRecordArray(json.completedOrders);
  const trashList = asRecordArray(json.trashOrders);
  const orders: Order[] = [
    ...pendingList.map((r) => convertOrder(r, OrderStatus.Pending, "orders")),
    ...completedList.map((r) =>
      convertOrder(r, OrderStatus.Completed, "completedOrders"),
    ),
    ...trashList.map((r) => convertOrder(r, OrderStatus.Trash, "trashOrders")),
  ];

  /* ---- 设置：userSettings + 顶层 amapKey/amapSecurity/myPosition/todayCalls ---- */
  const us =
    typeof json.userSettings === "object" && json.userSettings !== null
      ? (json.userSettings as Record<string, unknown>)
      : {};
  const settings: Partial<AppSettings> = {};
  const amapKey = asStr(json.amapKey).trim();
  if (amapKey) settings.amapKey = amapKey;
  const amapSecurity = asStr(json.amapSecurity).trim();
  if (amapSecurity) settings.amapSecurity = amapSecurity;
  const engineerName = asStr(us.engineerName).trim();
  if (engineerName) settings.engineerName = engineerName;
  const engineerPhone = asStr(us.engineerPhone).trim();
  if (engineerPhone) settings.engineerPhone = engineerPhone;
  const receiveAddr = asStr(us.receiveAddr).trim();
  if (receiveAddr) settings.receiveAddr = receiveAddr;
  /* autoBackup 是布尔开关，false 本身即有效值，不套用"有值才写" */
  if (typeof us.autoBackup === "boolean") settings.autoBackup = us.autoBackup;
  const mp = json.myPosition as {
    lat?: unknown;
    lng?: unknown;
    date?: unknown;
  } | null;
  if (
    mp &&
    typeof mp === "object" &&
    Number.isFinite(Number(mp.lat)) &&
    Number.isFinite(Number(mp.lng))
  ) {
    settings.myPosition = {
      lat: Number(mp.lat),
      lng: Number(mp.lng),
      date: asStr(mp.date),
    };
  }
  const tc = json.todayCalls as { date?: unknown; phones?: unknown } | null;
  if (tc && typeof tc === "object") {
    settings.todayCalls = {
      date: asStr(tc.date),
      phones: Array.isArray(tc.phones)
        ? tc.phones.map(asStr).filter(Boolean)
        : [],
    };
  }

  /* ---- geoCache 双层解码：备份里是 JSON 字符串 → JSON.parse 一次 → {lat,lng,ts} 转 GeoPoint ---- */
  function decodeGeoCache(raw: unknown): Record<string, GeoPoint> {
    let obj: unknown = raw;
    if (typeof obj === "string") {
      try {
        obj = JSON.parse(obj);
      } catch {
        return {};
      }
    }
    if (typeof obj !== "object" || obj === null) return {};
    const out: Record<string, GeoPoint> = {};
    for (const [addr, entry] of Object.entries(obj)) {
      const e = entry as { lat?: unknown; lng?: unknown } | null;
      const lat = Number(e?.lat);
      const lng = Number(e?.lng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        out[addr] = { longitude: lng, latitude: lat };
      }
    }
    return out;
  }
  const geoCache = decodeGeoCache(json.geoCache);

  /* ---- 材料库 / 品牌结算价 / 库存 / 模板 / 成本价目 / 领用记录：结构与v2类型一致，数值字段防御性归一 ---- */
  const materialsLib: MaterialItemLib[] = asRecordArray(json.materials).map(
    (m) => ({
      id: asStr(m.id) || generateId(),
      brand: asStr(m.brand),
      name: asStr(m.name),
      unit: asStr(m.unit),
      salePrice: asNum(m.salePrice),
      costPrice: asNum(m.costPrice),
      hasFreeQuota: Boolean(m.hasFreeQuota),
      freeQuota: asNum(m.freeQuota),
    }),
  );

  const brandPrices: BrandPrice[] = asRecordArray(json.brandPrices).map(
    (p) => ({
      brand: asStr(p.brand),
      install20m: asNum(p.install20m),
      install30m: asNum(p.install30m),
      repairSettlement: asNum(p.repairSettlement),
    }),
  );

  /* total 允许负数（v7 超发挂账实测温 -4），Number 保号原样承接 */
  const inventory: StockItem[] = asRecordArray(json.inventory).map((s) => ({
    brand: asStr(s.brand),
    total: asNum(s.total),
  }));

  const materialTemplates: MaterialTemplate[] = asRecordArray(
    json.templates,
  ).map((t) => ({
    id: asStr(t.id) || generateId(),
    brand: asStr(t.brand),
    name: asStr(t.name),
    items: Array.isArray(t.items) ? t.items.map(asStr) : [],
  }));

  const costSheet: CostSheetItem[] = asRecordArray(json.costSheet).map(
    (c) => ({
      id: asStr(c.id) || generateId(),
      name: asStr(c.name),
      unit: asStr(c.unit),
      costPrice: asNum(c.costPrice),
    }),
  );

  const materialUsage: MaterialUsageRecord[] = asRecordArray(
    json.materialUsage,
  ).map((u) => ({
    id: asStr(u.id) || generateId(),
    date: asStr(u.date),
    name: asStr(u.name),
    unit: asStr(u.unit),
    costPrice: asNum(u.costPrice),
    quantity: asNum(u.quantity),
    total: asNum(u.total),
  }));

  /* ---- platforms 13 平台名 ∪ platformDeductions 11 条扣点合并（缺扣点给 0）：
   * 先按 platforms 原顺序建表；扣点先精确匹配，再双向 includes 归并
   *（实测 v7 扣点名"领充"对应平台列表名"西安领充"，精确匹配会错配成 0）；
   * 仍无主的扣点平台（如"其他"）追加在末尾，扣点数据不丢 ---- */
  const platforms: PlatformConfig[] = [];
  const rawPlatformNames = Array.isArray(json.platforms) ? json.platforms : [];
  for (const nameRaw of rawPlatformNames) {
    const name = asStr(nameRaw).trim();
    if (name && !platforms.some((p) => p.name === name)) {
      platforms.push({ name, deductionPercent: 0 });
    }
  }
  for (const d of asRecordArray(json.platformDeductions)) {
    const name = asStr(d.platform).trim();
    if (!name) continue;
    const percent = asNum(d.deductionPercent);
    const hit =
      platforms.find((p) => p.name === name) ??
      platforms.find((p) => p.name.includes(name) || name.includes(p.name));
    if (hit) hit.deductionPercent = percent;
    else platforms.push({ name, deductionPercent: percent });
  }

  const customBrands = [...customByName.values()];

  /* ---- 对账报告：每模块迁入条数 + collisions + 日期兜底清单 ---- */
  const report: MigrationReport = {
    orders: orders.length,
    pendingOrders: pendingList.length,
    completedOrders: completedList.length,
    trashOrders: trashList.length,
    customBrands: customBrands.length,
    geoCache: Object.keys(geoCache).length,
    materialsLib: materialsLib.length,
    brandPrices: brandPrices.length,
    inventory: inventory.length,
    materialTemplates: materialTemplates.length,
    costSheet: costSheet.length,
    platforms: platforms.length,
    materialUsage: materialUsage.length,
    collisions,
    dateFallbacks,
  };

  return {
    orders,
    settings,
    customBrands,
    geoCache,
    materialsLib,
    brandPrices,
    inventory,
    materialTemplates,
    costSheet,
    platforms,
    materialUsage,
    report,
  };
}
