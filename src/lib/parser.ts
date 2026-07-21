/* ============================================================
 * 解析层：xlsx 订单导入 / 导出 + 多格式订单文本批量解析
 * 规范：全部解析逻辑只此一处，页面/组件禁止手写正则与拆分逻辑
 * ============================================================ */

import { OrderStatus } from "@/types";
import type {
  ChargeBrand,
  MaterialItem,
  Order,
  OrderDraft,
  PlatformConfig,
} from "@/types";
import { generateId, nowIso, statusLabel } from "@/lib/utils";
import { matchPlatformName } from "@/lib/platforms";

/* ------------------------------------------------------------
 * 一、导出列定义（中文表头，顺序固定）
 * ------------------------------------------------------------ */
const EXPORT_HEADERS = [
  "客户姓名",
  "客户电话",
  "安装地址",
  "品牌ID",
  "功率(kW)",
  "状态",
  "勘测日期",
  "预约日期",
  "完工日期",
  "备注",
  "创建时间",
] as const;

/** 状态文案 → 枚举 反向映射（导入时解析"状态"列） */
const STATUS_FROM_LABEL: Record<string, OrderStatus> = {
  待勘测: OrderStatus.Pending,
  已勘测: OrderStatus.Surveyed,
  已预约: OrderStatus.Appointed,
  已完成: OrderStatus.Completed,
  已取消: OrderStatus.Cancelled,
};

/* ------------------------------------------------------------
 * 二、导出
 * ------------------------------------------------------------ */

/** 订单列表 → xlsx 文件并触发浏览器下载
 * （xlsx 库按需动态加载，避免 400KB+ 进入主包拖垮低端机内存） */
export async function exportOrdersToXlsx(
  orders: Order[],
  filename?: string,
): Promise<void> {
  const XLSX = await import("xlsx");
  const rows = orders.map((o) => [
    o.customerName,
    o.customerPhone,
    o.address,
    o.brandId,
    o.powerKw,
    statusLabel(o.status),
    o.survey?.surveyDate ?? "",
    o.appointment?.appointmentDate ?? "",
    o.completion?.completeDate ?? "",
    o.remark,
    o.createdAt,
  ]);

  const sheet = XLSX.utils.aoa_to_sheet([[...EXPORT_HEADERS], ...rows]);
  // 列宽友好设置
  sheet["!cols"] = EXPORT_HEADERS.map((h) => ({
    wch: h.includes("地址") || h.includes("备注") ? 30 : 14,
  }));

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "订单");
  XLSX.writeFile(
    book,
    filename ?? `充电桩订单_${new Date().toISOString().slice(0, 10)}.xlsx`,
  );
}

/* ------------------------------------------------------------
 * 三、导入
 * ------------------------------------------------------------ */

export interface ImportResult {
  /** 解析成功的订单（已补齐 id/时间戳，状态无法识别时归入待勘测） */
  orders: Order[];
  /** 跳过的行数（缺少姓名或电话） */
  skipped: number;
  /** 错误信息；为 null 表示解析流程正常 */
  error: string | null;
}

/**
 * 解析 xlsx 文件为订单数组。
 * 约定：第一行为表头，至少包含"客户姓名""客户电话"两列（按列名匹配，顺序不限）。
 */
export async function parseOrdersFromXlsx(file: File): Promise<ImportResult> {
  try {
    const XLSX = await import("xlsx");
    const buffer = await file.arrayBuffer();
    const book = XLSX.read(buffer, { type: "array" });
    const firstSheetName = book.SheetNames[0];
    if (!firstSheetName) {
      return { orders: [], skipped: 0, error: "文件中没有工作表" };
    }

    const sheet = book.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: "",
    });
    if (rows.length === 0) {
      return { orders: [], skipped: 0, error: "工作表中没有数据行" };
    }

    const orders: Order[] = [];
    let skipped = 0;
    const now = nowIso();

    for (const row of rows) {
      const name = String(row["客户姓名"] ?? "").trim();
      const phone = String(row["客户电话"] ?? "").trim();
      if (!name || !phone) {
        skipped += 1;
        continue;
      }

      const statusText = String(row["状态"] ?? "").trim();
      const status: OrderStatus =
        STATUS_FROM_LABEL[statusText] ?? OrderStatus.Pending;

      const powerRaw = Number(row["功率(kW)"]);
      orders.push({
        id: generateId(),
        customerName: name,
        customerPhone: phone,
        address: String(row["安装地址"] ?? "").trim(),
        brandId: String(row["品牌ID"] ?? "").trim(),
        powerKw: Number.isFinite(powerRaw) && powerRaw > 0 ? powerRaw : 7,
        status,
        remark: String(row["备注"] ?? "").trim(),
        createdAt: now,
        updatedAt: now,
      });
    }

    if (orders.length === 0) {
      return {
        orders: [],
        skipped,
        error: "没有可导入的有效数据行（每行至少需要 客户姓名 + 客户电话）",
      };
    }
    return { orders, skipped, error: null };
  } catch {
    return { orders: [], skipped: 0, error: "文件解析失败，请确认是有效的 xlsx 文件" };
  }
}

/* ------------------------------------------------------------
 * 四、物料清单文本化（导出可读列 / 粘贴导入用，≥2处复用故收编于此）
 * 格式：名称(规格)×数量单位；多项用顿号分隔
 * 例：电缆(YJV-3×6mm²)×30米、漏保开关(40A)×1个
 * ------------------------------------------------------------ */
export function materialsToText(items: MaterialItem[]): string {
  return items
    .map((m) => `${m.name}(${m.spec})×${m.quantity}${m.unit}`)
    .join("、");
}

/** 文本 → 物料数组；无法解析的片段会被忽略 */
export function textToMaterials(text: string): MaterialItem[] {
  return text
    .split(/[、,，;；\n]/)
    .map((seg) => seg.trim())
    .filter(Boolean)
    .map((seg) => {
      const match = seg.match(/^(.+?)\((.+?)\)×(\d+(?:\.\d+)?)(.+)$/);
      if (!match) return null;
      const [, name, spec, quantity, unit] = match;
      return { name, spec, quantity: Number(quantity), unit };
    })
    .filter((m): m is MaterialItem => m !== null);
}

/* ------------------------------------------------------------
 * 五、多格式订单文本批量解析（对外唯一入口：parseOrderText）
 * 兼容格式（自动识别，无需手动指定）：
 *   1. 领充键值公告：订单号:/用户信息:/用户地址:/服务品牌: 等键值行
 *   2. 【订单信息】块：订单姓名/安装地址/购买套包/真实号码/首联信息
 *   3. 空格分隔单行流：编号 姓名 手机号 地址 品牌 功率 自由组合
 *   4. 维修/勘测工单：客户姓名:/客户手机:/安装工单号: 等键值两行式
 * 容错：识别不到的字段留空；单条解析失败不影响整体
 * ------------------------------------------------------------ */

/** 标准订单字段：识别不到的字段为空字符串 */
export interface ParsedOrderItem {
  /** 订单号 */
  orderNo: string;
  /** 客户姓名 */
  customerName: string;
  /** 手机号 */
  phone: string;
  /** 安装地址 */
  address: string;
  /** 服务品牌 */
  brandName: string;
  /** 功率（kW 数值字符串，如 "7" / "3.5"） */
  powerKw: string;
  /** 套包米数（数值字符串，如 "30"） */
  packageMeters: string;
  /** 车架号（VIN） */
  vin: string;
  /** 服务类型 */
  serviceType: string;
  /** 平台原始文本（从 运营商/信息来源/平台 等键或全文平台词提取的原始词；
   * 归一到平台配置名由 platforms.ts matchPlatformName 在入库/预览时完成） */
  platformName: string;
  /** 备注 */
  remark: string;
  /** 原始报单块文本（增量字段；入库时写入 Order.originalText，原文可追溯） */
  rawText?: string;
}

/* ---- 基础正则（模块内统一维护） ---- */
/** 大陆 11 位手机号（带边界：前后不能紧跟字母/数字，
 * 防止从订单号如 ORA20260615000529602INS 中误切出 11 位数字） */
const PHONE_RE = /(^|[^A-Za-z0-9])(1[3-9]\d{9})(?!\d)/;

/** 从文本中提取第一个手机号；无则返回 "" */
function extractPhone(text: string): string {
  const m = text.match(PHONE_RE);
  return m ? m[2] : "";
}
/** VIN：整 token 17 位且至少含一个字母（排除纯数字编号） */
const VIN_FULL_RE = /^(?=[A-HJ-NPR-Z0-9]*[A-HJ-NPR-Z])[A-HJ-NPR-Z0-9]{17}$/;
/** VIN：全文搜索用 */
const VIN_SEARCH_RE = /(?=[A-HJ-NPR-Z0-9]*[A-HJ-NPR-Z])[A-HJ-NPR-Z0-9]{17}/g;
/** 功率：数字 + kW/千瓦 */
const POWER_RE = /(\d+(?:\.\d+)?)\s*(?:kw|千瓦)/i;
/** 米数：数字 + 米 */
const METERS_RE = /(\d+)\s*米/;
/** 日期 token（2024/6/19、2026-06-07） */
const DATE_TOKEN_RE = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/;
/** 时间 token（0:00:00、19:39:46） */
const TIME_TOKEN_RE = /^\d{1,2}:\d{2}(:\d{2})?$/;
/** 行首时间戳前缀（2026-06-15 19:39:46...） */
const TIMESTAMP_PREFIX_RE =
  /^\d{4}[-/]\d{1,2}[-/]\d{1,2}[ T]\d{1,2}:\d{2}(:\d{2})?\s*/;
/** 键值行：键（2-10 个中文/字母）+ 冒号 */
const KEY_VALUE_RE = /^([一-龥A-Za-z]{2,10})[:：]\s*(.*)$/;

/** 地址片段特征词（出现任一即视为地址候选段） */
const ADDRESS_HINTS =
  /(省|市|区|县|镇|乡|村|路|街|巷|道|小区|花园|苑|栋|幢|座|单元|室|号|车位|车库)/;
/** 强地址特征（姓名判定时用于排除地址词） */
const STRONG_ADDRESS_HINTS = /(小区|栋|幢|单元|室|车位|车库|路|街|花园|苑|\d)/;

/** 品牌词表（已按词长降序排列，匹配时长的优先） */
const BRAND_WORDS = [
  "长城欧拉", "长城坦克", "长城皮卡",
  "鸿蒙智行", "广汽埃安", "特来电", "比亚迪", "特斯拉", "零跑", "埃安",
  "五菱", "公牛", "捷途", "吉利", "长城", "坦克", "欧拉", "奇瑞", "icar",
  "理想", "蔚来", "小鹏", "长安", "深蓝", "极氪", "问界", "小米", "传祺",
  "华境", "奔驰", "宝马", "奥迪", "大众", "丰田", "本田", "日产", "皮卡",
];

/** 平台提示词表（已按词长降序；仅作"提取原始词"候选，
 * 归一/别名/扣点匹配权威口径在 platforms.ts matchPlatformName） */
const PLATFORM_HINT_WORDS = [
  "西安领充", "苏宁易购", "上汽通用", "拼多多",
  "京东", "苏宁", "天猫", "淘宝", "领充", "万帮", "挚达",
  "妍伟", "空灵", "美团", "苹果",
];

/** 姓名排除词（施工状态/渠道/服务类词，绝不可能是姓名） */
const NAME_EXCLUDE_RE =
  /(地下|地面|壁挂|立柱|电表|安装|申请|到货|加急|预约|京东|苏宁|挚达|维修|服务|套包|套餐|预排|上门|检测|拆桩|充电桩|联系)/;

/** 键值块字段 ← 候选键（按优先级排序，取第一个非空值） */
const KV_FIELD_KEYS = {
  orderNo: ["订单号", "安装订单号", "安装工单号", "服务编号"],
  customerName: ["订单姓名", "客户姓名", "联系人"],
  phone: ["真实号码", "客户手机", "用户电话", "联系电话", "联系人电话"],
  address: ["安装地址", "用户地址", "收件地址"],
  brandName: ["服务品牌"],
  powerKw: ["功率"],
  packageMeters: ["套包米数"],
  vin: ["车架号"],
  serviceType: ["服务类型", "购买套包"],
  /* 平台字段：运营商/信息来源/平台 等键的值是平台名（如"京东"），
   * 必须提取到 platformName 字段，禁止丢弃或残留备注（实测 bug③） */
  platformName: ["运营商", "平台", "信息来源", "渠道", "来源", "工单来源"],
} as const;

/** 键值块中归入备注的键 */
const KV_REMARK_KEYS = ["备注", "首联信息", "安装备注", "用户需求"];

/** 已知但无需保留的键（出现即丢弃，不进备注）；
 * 注意：运营商/信息来源/工单来源 已上移到 platformName 消费，不在此列 */
const KV_DISCARD_KEYS = new Set([
  "服务商", "接件时间", "单据类型", "服务性质",
  "创建人", "工单状态", "客户ID", "安装城市", "用户购车信息",
  "关联车辆订单号", "车型", "家充权益", "车辆订单状态", "交付时间",
  "剩余积分", "工单关键节点", "工单创建", "创建类型", "反馈结果",
]);

/** 独立行丢弃词（无冒号的孤词行进自由行时直接丢弃，不进备注） */
const STANDALONE_DISCARD = new Set([
  ...KV_DISCARD_KEYS,
  "运营商", "信息来源", "工单来源", "平台", "渠道",
]);

/* ------------------------------------------------------------
 * 5.1 工具函数
 * ------------------------------------------------------------ */

function emptyItem(): ParsedOrderItem {
  return {
    orderNo: "",
    customerName: "",
    phone: "",
    address: "",
    brandName: "",
    powerKw: "",
    packageMeters: "",
    vin: "",
    serviceType: "",
    platformName: "",
    remark: "",
  };
}

/** 从 kv 表中按优先级取第一个非空值 */
function pickKv(kv: Map<string, string>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = kv.get(key);
    if (value) return value;
  }
  return "";
}

/** 地址清洗：去重复键前缀、去"安徽省 安庆市 "式省级前缀 */
function cleanAddressText(addr: string): string {
  let text = addr.trim();
  text = text.replace(/^安装地址[:：]\s*/, "");
  text = text.replace(/^[一-龥]{2,4}省\s+[一-龥]{2,4}市\s+/, "");
  return text.trim();
}

/** 品牌词表匹配（词表已按长度降序，返回第一个命中词；忽略大小写） */
function extractBrandName(text: string): string {
  const lower = text.toLowerCase();
  for (const word of BRAND_WORDS) {
    if (lower.includes(word.toLowerCase())) return word;
  }
  return "";
}

/** 平台词表提取（词表已按长度降序，返回第一个命中词；无则 ""） */
function extractPlatformName(text: string): string {
  for (const word of PLATFORM_HINT_WORDS) {
    if (text.includes(word)) return word;
  }
  return "";
}

/** 从文本中剔除指定词（带边界判断：前后紧跟中英文/数字时不剔，
 * 防止把"西安领充"里的"领充"误剔成残文；返回剔除后并整理空白的文本） */
function stripWordFromText(text: string, word: string): string {
  if (!word) return text;
  let result = text;
  let idx = result.indexOf(word);
  while (idx >= 0) {
    const before = idx === 0 ? "" : result.charAt(idx - 1);
    const after =
      idx + word.length >= result.length ? "" : result.charAt(idx + word.length);
    const isBoundary = (ch: string) => ch === "" || !/[一-龥A-Za-z0-9]/.test(ch);
    if (isBoundary(before) && isBoundary(after)) {
      result = `${result.slice(0, idx)} ${result.slice(idx + word.length)}`;
      idx = result.indexOf(word, idx + 1);
    } else {
      idx = result.indexOf(word, idx + word.length);
    }
  }
  return result.replace(/\s{2,}/g, " ").trim();
}

/**
 * 统一兜底补提取（键值块/流式块共用）：
 * 手机号 / VIN / 功率 / 米数 / 品牌，识别不到的保持留空
 */
function fillFallbacks(item: ParsedOrderItem, blockText: string): void {
  /* 手机号兜底：全文第一个 */
  if (!item.phone) {
    item.phone = extractPhone(blockText);
  }

  /* VIN 兜底：全文第一个不等于订单号的 17 位含字母串 */
  if (!item.vin) {
    const all = blockText.match(VIN_SEARCH_RE) ?? [];
    const found = all.find((v) => v !== item.orderNo);
    if (found) item.vin = found;
  }

  /* 功率：已有值提炼数字（"7KW"→"7"）；否则从服务类型/备注/全文提取 */
  if (item.powerKw) {
    const m = item.powerKw.match(/(\d+(?:\.\d+)?)/);
    if (m) item.powerKw = m[1];
  } else {
    const m =
      (item.serviceType + " " + item.remark).match(POWER_RE) ??
      blockText.match(POWER_RE);
    if (m) item.powerKw = m[1];
  }

  /* 套包米数：已有值提炼数字（"30米"→"30"）；否则从服务类型/备注提取 */
  if (item.packageMeters) {
    const m = item.packageMeters.match(/(\d+)/);
    if (m) item.packageMeters = m[1];
  } else {
    const m = (item.serviceType + " " + item.remark).match(METERS_RE);
    if (m) item.packageMeters = m[1];
  }

  /* 品牌兜底：服务类型 + 全文词表匹配 */
  if (!item.brandName) {
    item.brandName = extractBrandName(item.serviceType + " " + blockText);
  }

  /* 平台兜底：服务类型/备注 → 全文 平台词表扫描（原始词提取，
   * 归一到平台配置名在入库/预览时由 platforms.ts matchPlatformName 完成） */
  if (!item.platformName) {
    item.platformName =
      extractPlatformName(item.serviceType + " " + item.remark) ||
      extractPlatformName(blockText);
  }

  /* 平台词已提取为字段，禁止残留在备注文本里（实测 bug③）；
   * 带边界剔除，"西安领充"不会被"领充"误剔 */
  if (item.platformName && item.remark.includes(item.platformName)) {
    item.remark = stripWordFromText(item.remark, item.platformName);
  }
}

/* ------------------------------------------------------------
 * 5.2 文本切块：剔除聊天记录噪声 → 按消息边界/块标记分块
 * ------------------------------------------------------------ */

/** 聊天记录日期分隔行：————— 2026-06-06 ————— */
const DATE_SEP_RE = /^[—\-–=\s]*\d{4}[-/年]\d{1,2}[-/月]\d{1,2}[日]?\s*[—\-–=\s]*$/;

/** 发言人时间行（如"换个态度 夏长敏 19:26"）：短行 + 空格 + HH:MM 结尾 */
function isSpeakerLine(line: string): boolean {
  if (line.length > 25) return false;
  if (!/\s\d{1,2}:\d{2}$/.test(line)) return false;
  if (PHONE_RE.test(line)) return false;
  /* 行首键值行（如"订单号:LQ..."）不是发言人行；
   * 注意不能排除冒号本身——时间 HH:MM 必含冒号 */
  if (KEY_VALUE_RE.test(line)) return false;
  if (/[【】]/.test(line)) return false;
  return true;
}

/** 块起始标记行（该行本身是标记，不进入块内容） */
function isBlockMarker(line: string): boolean {
  return (
    line === "【订单信息】" ||
    line === "公告" ||
    line === "群公告" ||
    /^【.*(订单|公告).*】$/.test(line)
  );
}

/** 纯分隔线行（---- / ==== / **** 等）：多单手贴常用分隔，视为硬边界 */
const SEPARATOR_LINE_RE = /^[-—–=＊*·•~#\s]{3,}$/;
/** "第N单/第N条"标记行（该行本身是标记，不进入块内容） */
const ORDER_INDEX_LINE_RE = /^第\s*\d+\s*[单条笔]\s*$/;

/** 订单起始键：块内同一键重复出现即视为新订单开始（连贴公告防吞单） */
const ORDER_START_KEYS = new Set([
  "订单号", "安装订单号", "安装工单号", "服务编号",
  "用户信息", "订单姓名", "客户姓名",
]);
/** 电话类起始键：值中出现第二个不同手机号时视为新订单开始
 * （"联系人电话/联系电话"不算——那是同一单的第二联系人） */
const PHONE_START_KEYS = new Set([
  "用户信息", "真实号码", "客户手机", "用户电话",
]);

/** 订单号类起始键：软边界预判专用（"用户信息/客户姓名"是公告续键，
 * 不能作为新订单起始，否则公告内部空行会把一单切碎） */
const ORDER_NO_KEYS = new Set([
  "订单号", "安装订单号", "安装工单号", "服务编号",
]);

/** 行像"新订单起始"（软边界预判用）：
 * 订单号类键值行 / 【…】标题行 / 含手机号的非键值行（流式单起始） */
function looksLikeOrderStart(line: string): boolean {
  const kv = line.match(KEY_VALUE_RE);
  if (kv) return ORDER_NO_KEYS.has(kv[1]);
  if (/^【.+】$/.test(line)) return true;
  return extractPhone(line) !== "";
}

/** 疑似订单块（预览数量对账口径）：含手机号，或含订单起始键 */
function isOrderLikeBlock(block: string): boolean {
  if (extractPhone(block)) return true;
  return block.split("\n").some((line) => {
    const m = line.match(KEY_VALUE_RE);
    return m ? ORDER_START_KEYS.has(m[1]) : false;
  });
}

/**
 * pass2：键值块内再切分（连贴公告防吞单）
 * 触发条件：①订单起始键在块内重复出现；②电话类起始键出现第二个不同手机号
 */
function splitRepeatedKeyBlock(block: string): string[] {
  const lines = block.split("\n");
  const kvCount = lines.filter((l) => KEY_VALUE_RE.test(l)).length;
  if (kvCount < 2) return [block];

  const result: string[] = [];
  let cur: string[] = [];
  let seenStartKeys = new Set<string>();
  let seenPhones = new Set<string>();
  const flush = () => {
    if (cur.length > 0) {
      result.push(cur.join("\n"));
      cur = [];
    }
  };

  for (const line of lines) {
    const kv = line.match(KEY_VALUE_RE);
    const phone = extractPhone(line);
    let startNew = false;
    if (kv) {
      if (ORDER_START_KEYS.has(kv[1]) && seenStartKeys.has(kv[1])) {
        startNew = true;
      }
      if (
        PHONE_START_KEYS.has(kv[1]) &&
        phone !== "" &&
        seenPhones.size > 0 &&
        !seenPhones.has(phone)
      ) {
        startNew = true;
      }
    }
    if (startNew) {
      flush();
      seenStartKeys = new Set<string>();
      seenPhones = new Set<string>();
    }
    cur.push(line);
    if (kv && ORDER_START_KEYS.has(kv[1])) seenStartKeys.add(kv[1]);
    if (phone) seenPhones.add(phone);
  }
  flush();
  return result;
}

/**
 * pass3：流式块（键值行<2）内多个不同手机号跨行 → 按"含手机号的行"逐行成块；
 * 不含手机号的行（地址/品牌等续行）附属于前一块
 */
function splitFlowBlockByPhone(block: string): string[] {
  const lines = block.split("\n");
  const kvCount = lines.filter((l) => KEY_VALUE_RE.test(l)).length;
  if (kvCount >= 2) return [block];

  const phones = new Set<string>();
  for (const line of lines) {
    const p = extractPhone(line);
    if (p) phones.add(p);
  }
  if (phones.size < 2) return [block];

  const result: string[] = [];
  let cur: string[] = [];
  for (const line of lines) {
    const hasPhone = extractPhone(line) !== "";
    if (hasPhone && cur.some((l) => extractPhone(l) !== "")) {
      result.push(cur.join("\n"));
      cur = [];
    }
    cur.push(line);
  }
  if (cur.length > 0) result.push(cur.join("\n"));
  return result;
}

/**
 * 将原始文本拆分为订单块数组（三遍式，防吞单）：
 * pass1 行级切块——硬边界：发言人时间行/块标记行/分隔线行/第N单行；
 *       软边界：空行仅当下一条内容行像新订单起始才切断
 *       （防止"每行之间都有空行"的文本被切碎，也防止多单连贴被并块）；
 * pass2 键值块内起始键重复/第二个主电话再切；
 * pass3 流式块内多手机号跨行逐行成块
 */
function splitOrderBlocks(rawText: string): string[] {
  const lines = rawText.split(/\r?\n/);
  const rough: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length > 0) {
      rough.push(current.join("\n"));
      current = [];
    }
  };
  /** 软边界预判：从 from 起找下一条内容行，像订单起始/边界则 true */
  const nextStartsOrder = (from: number): boolean => {
    for (let j = from; j < lines.length; j++) {
      const t = lines[j].trim();
      if (!t) continue;
      if (
        isSpeakerLine(t) ||
        isBlockMarker(t) ||
        SEPARATOR_LINE_RE.test(t) ||
        ORDER_INDEX_LINE_RE.test(t)
      ) {
        return true;
      }
      return looksLikeOrderStart(t);
    }
    return false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      /* 空行 = 软边界：下一条内容行像新订单起始才切断 */
      if (current.length > 0 && nextStartsOrder(i + 1)) flush();
      continue;
    }
    /* 噪声行：日期分隔 / 聊天记录说明 / Dear 开头（同软边界处理，不直接吞掉边界语义） */
    if (DATE_SEP_RE.test(line) || /微信群上的聊天记录|请查收/.test(line) || /^Dear[:：]?$/i.test(line)) {
      if (current.length > 0 && nextStartsOrder(i + 1)) flush();
      continue;
    }
    /* 硬边界：发言人时间行 / 块标记行 / 分隔线行 / 第N单行 */
    if (
      isSpeakerLine(line) ||
      isBlockMarker(line) ||
      SEPARATOR_LINE_RE.test(line) ||
      ORDER_INDEX_LINE_RE.test(line)
    ) {
      flush();
      continue;
    }
    current.push(line);
  }
  flush();

  const blocks: string[] = [];
  for (const block of rough) {
    for (const sub of splitRepeatedKeyBlock(block)) {
      blocks.push(...splitFlowBlockByPhone(sub));
    }
  }
  return blocks;
}

/* ------------------------------------------------------------
 * 5.3 键值块解析（领充公告 / 【订单信息】/ 维修工单 共用）
 * ------------------------------------------------------------ */

function parseKeyValueBlock(block: string): ParsedOrderItem {
  const item = emptyItem();
  const kv = new Map<string, string>();
  const freeLines: string[] = [];
  const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(KEY_VALUE_RE);
    if (m) {
      const key = m[1];
      let value = m[2].trim();
      /* 键值两行式："客户姓名:" 后值在下一行 */
      if (!value && i + 1 < lines.length && !KEY_VALUE_RE.test(lines[i + 1])) {
        value = lines[i + 1].trim();
        i++;
      }
      if (value && !kv.has(key)) kv.set(key, value);
    } else {
      freeLines.push(line);
    }
  }

  /* "用户信息"键特殊处理：姓名与手机号同值（"葛先生 13966443732"） */
  const userInfo = kv.get("用户信息") ?? "";
  let userInfoName = "";
  let userInfoPhone = "";
  if (userInfo) {
    const pm = userInfo.match(PHONE_RE);
    if (pm) {
      userInfoPhone = pm[2];
      userInfoName = userInfo.replace(pm[2], "").trim();
    } else {
      userInfoName = userInfo;
    }
  }

  item.orderNo = pickKv(kv, KV_FIELD_KEYS.orderNo);
  item.customerName = pickKv(kv, KV_FIELD_KEYS.customerName) || userInfoName;
  item.phone = pickKv(kv, KV_FIELD_KEYS.phone) || userInfoPhone;
  item.address = cleanAddressText(pickKv(kv, KV_FIELD_KEYS.address));
  item.brandName = pickKv(kv, KV_FIELD_KEYS.brandName);
  item.powerKw = pickKv(kv, KV_FIELD_KEYS.powerKw);
  item.packageMeters = pickKv(kv, KV_FIELD_KEYS.packageMeters);
  item.vin = pickKv(kv, KV_FIELD_KEYS.vin);
  item.serviceType = pickKv(kv, KV_FIELD_KEYS.serviceType);
  item.platformName = pickKv(kv, KV_FIELD_KEYS.platformName);

  /* 备注池：备注类键 + 自由行（去时间戳前缀、丢弃无效行） */
  const remarkParts: string[] = [];
  for (const key of KV_REMARK_KEYS) {
    const value = kv.get(key);
    if (value && value !== "--") remarkParts.push(value);
  }
  for (const rawLine of freeLines) {
    if (STANDALONE_DISCARD.has(rawLine)) continue;
    const line = rawLine.replace(TIMESTAMP_PREFIX_RE, "").trim();
    if (!line || STANDALONE_DISCARD.has(line)) continue;
    remarkParts.push(line);
  }
  item.remark = remarkParts.join(" ");

  fillFallbacks(item, block);
  return item;
}

/* ------------------------------------------------------------
 * 5.4 流式块解析（空格分隔单行流）
 * ------------------------------------------------------------ */

function parseFlowBlock(block: string): ParsedOrderItem {
  const item = emptyItem();

  /* 括号内空格保护：括号内容是整体语义单元，切词后还原 */
  const protectedText = block.replace(/（[^）]*）|\([^)]*\)/g, (s) =>
    s.replace(/\s/g, "\u0001").replace(/[，,。；;]/g, "\u0002"),
  );
  const tokens = protectedText
    .split(/[\n，,。；;]+|\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => t.replace(/\u0001/g, " ").replace(/\u0002/g, "，"));

  const remarkTokens: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    /* 括号整体 token（如"（30米套包，A型漏保）"）：直接进备注，
     * 避免被地址提示词（号/栋等）误判为地址或被服务类型切断 */
    if (/^[（(]/.test(token)) {
      remarkTokens.push(token);
      continue;
    }

    /* 行首序号 token（"1" / "2." / "3、"）：接龙编号噪声，直接丢弃 */
    if (/^\d{1,2}[.、)]?$/.test(token)) {
      continue;
    }

    /* 日期+时间 token 对（车辆销售日期等）：成对跳过 */
    if (DATE_TOKEN_RE.test(token)) {
      if (i + 1 < tokens.length && TIME_TOKEN_RE.test(tokens[i + 1])) i++;
      continue;
    }

    /* 含手机号的 token（可带"用户电话："等前后缀） */
    const tokenPhone = extractPhone(token);
    if (tokenPhone) {
      if (!item.phone) {
        item.phone = tokenPhone;
        /* 纯手机号 token：取前一个 token 尝试姓名（含公司名） */
        if (token === tokenPhone && i > 0) {
          const prev = tokens[i - 1];
          if (
            /^[一-龥]{2,20}$/.test(prev) &&
            !STRONG_ADDRESS_HINTS.test(prev) &&
            !NAME_EXCLUDE_RE.test(prev)
          ) {
            item.customerName = prev;
            const ri = remarkTokens.indexOf(prev);
            if (ri >= 0) remarkTokens.splice(ri, 1);
          }
        }
      } else {
        /* 第二及以后的手机号（联系人电话等）：整体进备注 */
        remarkTokens.push(token);
      }
      continue;
    }

    /* 车架号：17 位且含字母（必须在编号判定之前） */
    if (VIN_FULL_RE.test(token)) {
      if (!item.vin) item.vin = token;
      continue;
    }

    /* 服务类型：含 服务/套包/套餐 的片段（取最长） */
    if (/服务|套包|套餐/.test(token)) {
      if (token.length > item.serviceType.length) item.serviceType = token;
      continue;
    }

    /* 功率 token：独立成词的 7kW/7千瓦 */
    const powerToken = token.match(/^(\d+(?:\.\d+)?)\s*(?:kw|千瓦)$/i);
    if (powerToken) {
      if (!item.powerKw) item.powerKw = powerToken[1];
      continue;
    }

    /* 地址 token：含特征词且够长（取最长）；
     * 含括号的 token 是施工要求类备注（如"挚达长城（A型漏保…信号测试…）"），不当地址 */
    if (token.length >= 6 && !/[（(]/.test(token) && ADDRESS_HINTS.test(token)) {
      if (token.length > item.address.length) item.address = token;
      continue;
    }

    /* 编号 token：纯数字≥9 位，或字母数字混合≥10 位 */
    if (
      /^\d{9,20}$/.test(token) ||
      (/^[A-Za-z0-9]{10,30}$/.test(token) && /[A-Za-z]/.test(token))
    ) {
      if (!item.orderNo) item.orderNo = token;
      else remarkTokens.push(token);
      continue;
    }

    /* 其余：进备注池 */
    remarkTokens.push(token);
  }

  /* 姓名兜底：备注池中第一个 2-4 字纯人名候选（排除品牌词/状态词） */
  if (!item.customerName) {
    const idx = remarkTokens.findIndex(
      (t) =>
        /^[一-龥]{2,4}$/.test(t) &&
        !NAME_EXCLUDE_RE.test(t) &&
        extractBrandName(t) === "",
    );
    if (idx >= 0) {
      item.customerName = remarkTokens[idx];
      remarkTokens.splice(idx, 1);
    }
  }

  item.remark = remarkTokens.join(" ");
  fillFallbacks(item, block);
  return item;
}

/* ------------------------------------------------------------
 * 5.5 对外入口
 * ------------------------------------------------------------ */

/** 块类型自动判定：键值行 ≥2 → 键值块；否则 → 流式块 */
function parseBlock(block: string): ParsedOrderItem {
  const kvLineCount = block
    .split("\n")
    .filter((l) => KEY_VALUE_RE.test(l.trim())).length;
  return kvLineCount >= 2 ? parseKeyValueBlock(block) : parseFlowBlock(block);
}

/** 有效订单判定：手机号/订单号/地址/姓名 至少识别出一个 */
function hasAnyField(item: ParsedOrderItem): boolean {
  return Boolean(
    item.phone || item.orderNo || item.address || item.customerName,
  );
}

/** 批量解析详细结果（parseOrderText 签名锁定，扩展信息走本结构） */
export interface ParseTextResult {
  /** 解析成功的订单 */
  items: ParsedOrderItem[];
  /** 原文中疑似订单块数量（含手机号或订单起始键的块）；
   * 与 items.length 对不上时预览层必须显著告警（防静默吞单） */
  blockCount: number;
}

/**
 * 多格式订单文本批量解析（详细版：附疑似块数量对账）
 * @param rawText 原始文本（可为微信聊天记录、单条或多条订单混合）
 */
export function parseOrderTextDetailed(rawText: string): ParseTextResult {
  const blocks = splitOrderBlocks(rawText);
  const items: ParsedOrderItem[] = [];
  let blockCount = 0;
  for (const block of blocks) {
    if (isOrderLikeBlock(block)) blockCount += 1;
    try {
      const item = parseBlock(block);
      if (hasAnyField(item)) {
        /* 原文随单走（数据安全：入库写 Order.originalText，可追溯） */
        item.rawText = block;
        items.push(item);
      }
    } catch {
      /* 单条解析失败不影响整体 */
    }
  }
  return { items, blockCount };
}

/**
 * 多格式订单文本批量解析（对外唯一入口）
 * 【签名锁定 · 永久兼容】parseOrderText(rawText: string): ParsedOrderItem[]
 * 本签名定死，禁止任何破坏性修改；后续功能扩展只允许在函数内部实现。
 * @param rawText 原始文本（可为微信聊天记录、单条或多条订单混合）
 * @returns 结构化订单数组；无法识别时返回空数组
 */
export function parseOrderText(rawText: string): ParsedOrderItem[] {
  return parseOrderTextDetailed(rawText).items;
}

/** 品牌名归一化：小写、去括号注记/空白、去装饰后缀
 * （"五菱汽车（7kW）"→"五菱"；"理想汽车"→"理想"），用于宽松等价比较 */
function normalizeBrandName(name: string): string {
  return name
    .toLowerCase()
    .replace(/（[^）]*）|\([^)]*\)/g, "")
    .replace(/\s+/g, "")
    .replace(/(有限责任公司|有限公司|新能源汽车|新能源|汽车|充电桩|科技|股份|集团)+$/, "")
    .trim();
}

/** 品牌匹配候选分层：传入 customBrands 时自定义品牌为第一层（优先命中），
 * 其余品牌（内置）为第二层；未传则单层（保持旧调用行为） */
function brandTiers(
  brands: ChargeBrand[],
  customBrands?: ChargeBrand[],
): ChargeBrand[][] {
  const usable = (list: ChargeBrand[]) =>
    list.filter((b) => b.name !== "其他品牌");
  if (customBrands && customBrands.length > 0) {
    const customIds = new Set(customBrands.map((b) => b.id));
    return [
      usable(customBrands),
      usable(brands.filter((b) => !customIds.has(b.id))),
    ];
  }
  return [usable(brands)];
}

/**
 * 服务品牌文本 → 品牌 ID（供表单回填；匹配不到返回 ""）
 * 匹配口径（分层进行，层内先精确后包含，"其他品牌"永不参与）：
 *   ① 自定义品牌优先于内置品牌（已知自定义品牌绝不被内置粗匹配截胡）；
 *   ② 归一化后全等 = 精确命中；
 *   ③ 双向包含 = 别名命中（"领充"命中"西安领充"），同层取品牌名最长者（最具体优先）
 */
export function matchBrandIdByName(
  brandName: string,
  brands: ChargeBrand[],
  customBrands?: ChargeBrand[],
): string {
  const text = normalizeBrandName(brandName);
  if (!text) return "";
  const tiers = brandTiers(brands, customBrands);
  /* 第一轮：逐层精确匹配 */
  for (const tier of tiers) {
    for (const brand of tier) {
      if (normalizeBrandName(brand.name) === text) return brand.id;
    }
  }
  /* 第二轮：逐层双向包含，同层取归一名最长者 */
  for (const tier of tiers) {
    let best: ChargeBrand | null = null;
    let bestLen = 0;
    for (const brand of tier) {
      const name = normalizeBrandName(brand.name);
      if (!name) continue;
      if (text.includes(name) || name.includes(text)) {
        if (name.length > bestLen) {
          best = brand;
          bestLen = name.length;
        }
      }
    }
    if (best) return best.id;
  }
  return "";
}

/** 品牌终极兜底：用真实品牌表（custom 优先、名称最长优先）直接扫描文本，
 * 仅在 服务品牌键缺失且内置词表未命中时启用（防"西安领充"类自定品牌漏识别） */
function scanBrandIdInText(
  text: string,
  brands: ChargeBrand[],
  customBrands?: ChargeBrand[],
): string {
  const hay = normalizeBrandName(text);
  if (!hay) return "";
  for (const tier of brandTiers(brands, customBrands)) {
    let best: ChargeBrand | null = null;
    let bestLen = 0;
    for (const brand of tier) {
      const name = normalizeBrandName(brand.name);
      if (name && hay.includes(name) && name.length > bestLen) {
        best = brand;
        bestLen = name.length;
      }
    }
    if (best) return best.id;
  }
  return "";
}

/* ------------------------------------------------------------
 * 5.6 批量入库辅助（解析结果 → 去重 → OrderDraft）
 * 说明：parseOrderText 签名锁定，批量入库的支撑逻辑全部收编于此
 * ------------------------------------------------------------ */

/** 从已入库订单的备注中提取订单号（批量入库时以"单号:xxx"写入） */
export function extractOrderNoFromRemark(remark: string): string {
  const m = remark.match(/(?:^|\s)单号[:：](\S+)/);
  return m ? m[1] : "";
}

/** 从已入库订单的备注中提取服务类型（订单卡片标签展示用；无则返回 ""） */
export function extractServiceTypeFromRemark(remark: string): string {
  const m = remark.match(
    /(?:^|\s)服务[:：](.+?)(?=\s(?:单号|服务|米数|VIN)[:：]|$)/,
  );
  return m ? m[1].trim() : "";
}

/**
 * 解析结果去重（与现有订单比对 + 解析结果内部互查）：
 * 有订单号按订单号去重；无订单号按"姓名+手机号"去重
 */
export function filterNewParsedItems(
  items: ParsedOrderItem[],
  existingOrders: Order[],
): { fresh: ParsedOrderItem[]; duplicated: number } {
  const existingNos = new Set(
    existingOrders
      .map((o) => extractOrderNoFromRemark(o.remark))
      .filter(Boolean),
  );
  const existingNamePhone = new Set(
    existingOrders.map((o) => `${o.customerName}|${o.customerPhone}`),
  );
  const seenNos = new Set<string>();
  const seenNamePhone = new Set<string>();
  const fresh: ParsedOrderItem[] = [];
  let duplicated = 0;

  for (const item of items) {
    if (item.orderNo) {
      if (existingNos.has(item.orderNo) || seenNos.has(item.orderNo)) {
        duplicated += 1;
        continue;
      }
      seenNos.add(item.orderNo);
    } else {
      const key = `${item.customerName}|${item.phone}`;
      if (existingNamePhone.has(key) || seenNamePhone.has(key)) {
        duplicated += 1;
        continue;
      }
      seenNamePhone.add(key);
    }
    fresh.push(item);
  }
  return { fresh, duplicated };
}

/** 平台候选词序列（归一匹配按此顺序逐个试，首个命中平台配置者胜）：
 * ①解析提取的平台原始词（运营商/平台键值或兜底扫描）优先；
 * ②其后按原文中"靠后出现的平台提示词"优先（流式报单平台词常在行尾，
 *   且可纠正"品牌词与平台词同名"（如 西安领充 既是品牌又是平台）时的误提取） */
function platformCandidates(item: ParsedOrderItem): string[] {
  const out: string[] = [];
  if (item.platformName) out.push(item.platformName);
  const text = `${item.serviceType} ${item.rawText ?? ""}`;
  const found: Array<{ word: string; pos: number }> = [];
  for (const word of PLATFORM_HINT_WORDS) {
    const pos = text.lastIndexOf(word);
    if (pos >= 0) found.push({ word, pos });
  }
  found.sort((a, b) => b.pos - a.pos);
  for (const f of found) {
    if (!out.includes(f.word)) out.push(f.word);
  }
  return out;
}

/**
 * 解析结果 → 入库草稿（订单号/服务类型/米数/VIN 有值才写入备注，保证可去重）
 * 【签名增量扩展】第三/四可选参数：platforms（平台配置，loadPlatforms() 读入）、
 * customBrands（自定义品牌，品牌匹配优先层）；旧两参调用行为不变。
 * 平台：平台候选词逐个归一到平台配置名，首个命中写入 platform 字段；
 * 命中后对应平台词带边界剔除出备注（禁止残留）；未匹配不写 platform，
 * 由预览层标黄提示补填。
 */
export function parsedItemToDraft(
  item: ParsedOrderItem,
  brands: ChargeBrand[],
  platforms?: PlatformConfig[],
  customBrands?: ChargeBrand[],
): OrderDraft {
  const parts: string[] = [];
  if (item.orderNo) parts.push(`单号:${item.orderNo}`);
  if (item.serviceType) parts.push(`服务:${item.serviceType}`);
  if (item.packageMeters) parts.push(`米数:${item.packageMeters}`);
  if (item.vin) parts.push(`VIN:${item.vin}`);
  if (item.remark) parts.push(item.remark);

  const power = Number(item.powerKw);
  const meters = Number(item.packageMeters);
  /* 平台归一：候选词逐个匹配平台配置，首个命中者胜（别名/双向 includes，
   * 口径在 platforms.ts matchPlatformName） */
  let matchedPlatform = "";
  if (platforms && platforms.length > 0) {
    for (const candidate of platformCandidates(item)) {
      matchedPlatform = matchPlatformName(candidate, platforms);
      if (matchedPlatform) break;
    }
  }
  const platformType: "jd" | "other" = /京东/.test(
    `${matchedPlatform} ${item.platformName} ${item.serviceType}`,
  )
    ? "jd"
    : "other";
  /* 备注终态清理：命中平台对应的所有候选词 + 配置名，带边界剔除（禁止平台残留备注） */
  let remark = parts.join(" ");
  if (matchedPlatform) {
    for (const candidate of platformCandidates(item)) {
      if (matchPlatformName(candidate, platforms ?? []) === matchedPlatform) {
        remark = stripWordFromText(remark, candidate);
      }
    }
    remark = stripWordFromText(remark, matchedPlatform);
  }
  return {
    customerName: item.customerName,
    customerPhone: item.phone,
    address: item.address,
    /* 品牌回退链：服务品牌键值匹配（custom 优先）→ 服务类型匹配 →
     * 真实品牌表扫原文 → "其他品牌" → 列表首项 */
    brandId:
      matchBrandIdByName(item.brandName, brands, customBrands) ||
      matchBrandIdByName(item.serviceType, brands, customBrands) ||
      scanBrandIdInText(
        `${item.serviceType} ${item.rawText ?? ""}`,
        brands,
        customBrands,
      ) ||
      brands.find((b) => b.name === "其他品牌")?.id ||
      brands[0]?.id ||
      "",
    powerKw: Number.isFinite(power) && power > 0 ? power : 7,
    /* 套包米数：仅当解析值为正数时写入独立字段 */
    ...(Number.isFinite(meters) && meters > 0
      ? { packageMeters: meters }
      : {}),
    /* 平台字段：归一成功才写入（未匹配不留垃圾值，预览层标黄提示） */
    ...(matchedPlatform ? { platform: matchedPlatform } : {}),
    /* 原始报单文本：有值才写（数据安全，丢失=重大事故） */
    ...(item.rawText ? { originalText: item.rawText } : {}),
    platformType,
    status: OrderStatus.Pending,
    remark,
  };
}

/* ------------------------------------------------------------
 * 5.7 识别预览（解析结果 → 预览行；存疑标黄口径统一在此，视图层只渲染）
 * ------------------------------------------------------------ */

/** 识别预览行：入库草稿 + 存疑标记（标黄提示补填，不阻塞入库） */
export interface ParsePreviewRow {
  /** 解析原项（姓名/电话/地址/原文等展示用） */
  item: ParsedOrderItem;
  /** 确认后直接入库的草稿 */
  draft: OrderDraft;
  /** 入库品牌名（匹配后的展示名） */
  brandName: string;
  /** 品牌是否未识别（落"其他品牌"兜底/品牌表为空） */
  brandFallback: boolean;
  /** 匹配到的平台配置名（""=未匹配） */
  platformName: string;
  /** 存疑字段标签（缺姓名/缺电话/缺地址/品牌待确认/平台未匹配） */
  issues: string[];
}

/**
 * 解析结果 → 预览行数组（业务口径收敛 lib，视图层零判断只渲染）
 * @param items 解析结果（建议先经 filterNewParsedItems 去重）
 * @param brands 品牌表（内置+自定义合并，useApp().brands）
 * @param platforms 平台配置（loadPlatforms() 读入）
 * @param customBrands 自定义品牌（品牌匹配优先层，useApp().customBrands）
 */
export function buildParsePreview(
  items: ParsedOrderItem[],
  brands: ChargeBrand[],
  platforms: PlatformConfig[],
  customBrands?: ChargeBrand[],
): ParsePreviewRow[] {
  const otherId = brands.find((b) => b.name === "其他品牌")?.id;
  return items.map((item) => {
    const draft = parsedItemToDraft(item, brands, platforms, customBrands);
    const brand = brands.find((b) => b.id === draft.brandId);
    const brandFallback =
      !brand || (otherId !== undefined && draft.brandId === otherId);
    const issues: string[] = [];
    if (!item.customerName) issues.push("缺姓名");
    if (!item.phone) issues.push("缺电话");
    if (!item.address) issues.push("缺地址");
    if (brandFallback) issues.push("品牌待确认");
    if (!draft.platform) issues.push("平台未匹配");
    return {
      item,
      draft,
      brandName: brand?.name ?? "",
      brandFallback,
      platformName: draft.platform ?? "",
      issues,
    };
  });
}
