/* ============================================================
 * 存储层：localStorage 唯一入口
 * 规范：全项目读写 localStorage 只能经过本模块，
 *      Key 统一使用 types/index.ts 中声明的 STORAGE_KEYS
 * ============================================================ */

import {
  STORAGE_KEYS,
  DATA_VERSION,
  DEFAULT_APP_SETTINGS,
  DEFAULT_PLATFORM_RATES,
  OrderStatus,
} from "@/types";
import type {
  AppSettings,
  BackupPayload,
  BrandPrice,
  BrandRateConfig,
  BrandScript,
  ChargeBrand,
  CostSheetItem,
  FormPresets,
  MaterialItemLib,
  MaterialTemplate,
  MaterialUsageRecord,
  Order,
  PlatformConfig,
  PlatformRateConfig,
  StockItem,
  StorageKey,
} from "@/types";
import {
  DEFAULT_BRAND_SCRIPTS,
  LEGACY_PLACEHOLDER_SCRIPTS,
} from "@/lib/scripts";
import { detectBackupVersion, migrateV7Backup } from "@/lib/migrate";
import { isBackupEnvelope, isPasswordVerifier } from "@/lib/backupCrypto";
import type { BackupEnvelope, BackupPasswordVerifier } from "@/lib/backupCrypto";
import { DEFAULT_LEAPMOTOR_ADDONS } from "@/lib/leapmotorAddons";
import type { LeapmotorAddon } from "@/types";

/* ------------------------------------------------------------
 * 一、底层读写（带异常保护，隐私模式/超限不崩溃）
 * ------------------------------------------------------------ */

/** 读取并反序列化；不存在或解析失败时返回 fallback */
function read<T>(key: StorageKey, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** 序列化写入；返回是否成功（配额超限等场景返回 false） */
function write<T>(key: StorageKey, value: T): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    if (e instanceof DOMException && (e as DOMException).name === "QuotaExceededError") {
      alert("⚠️ 存储空间已满！请前往「设置」→ 导出备份，然后清理旧订单或恢复出厂。");
    } else {
      console.warn("存储失败", e);
    }
    return false;
  }
}

/* ------------------------------------------------------------
 * 二、版本迁移
 * ------------------------------------------------------------ */

/**
 * 启动时校验数据版本：
 * - 无版本号（首次使用）→ 写入当前版本
 * - 版本低于当前 → 依次执行迁移函数
 *   1→2：触发 loadPlatforms 默认迁移（旧 cp_platform_rates 两档扣点 → PlatformConfig）并落库
 */
export function ensureDataVersion(): void {
  const stored = read<number>(STORAGE_KEYS.dataVersion, 0);
  if (stored >= DATA_VERSION) return;

  let version = stored;
  if (version < 2) {
    /* 1→2：老用户首次启动，platforms 默认迁移结果落库，后续 loadPlatforms 直读 cp_platforms */
    savePlatforms(loadPlatforms());
    version = 2;
  }

  version = DATA_VERSION;
  write(STORAGE_KEYS.dataVersion, version);
}

/* ------------------------------------------------------------
 * 三、业务读写：订单
 * ------------------------------------------------------------ */
export function loadOrders(): Order[] {
  return read<Order[]>(STORAGE_KEYS.orders, []);
}

export function saveOrders(orders: Order[]): boolean {
  return write(STORAGE_KEYS.orders, orders);
}

/* ------------------------------------------------------------
 * 四、业务读写：应用设置（缺字段自动回填默认值）
 * ------------------------------------------------------------ */
export function loadSettings(): AppSettings {
  const stored = read<Partial<AppSettings>>(STORAGE_KEYS.settings, {});
  return { ...DEFAULT_APP_SETTINGS, ...stored };
}

export function saveSettings(settings: AppSettings): boolean {
  return write(STORAGE_KEYS.settings, settings);
}

/* ------------------------------------------------------------
 * 五、业务读写：自定义品牌
 * ------------------------------------------------------------ */
export function loadCustomBrands(): ChargeBrand[] {
  return read<ChargeBrand[]>(STORAGE_KEYS.customBrands, []);
}

export function saveCustomBrands(brands: ChargeBrand[]): boolean {
  return write(STORAGE_KEYS.customBrands, brands);
}

/* ------------------------------------------------------------
 * 六、业务读写：地理编码缓存（geoCache.ts 使用）
 * 结构：{ [地址字符串]: { longitude, latitude } }
 * ------------------------------------------------------------ */
export interface GeoPoint {
  longitude: number;
  latitude: number;
}

export function loadGeoCache(): Record<string, GeoPoint> {
  return read<Record<string, GeoPoint>>(STORAGE_KEYS.geoCache, {});
}

export function saveGeoCache(cache: Record<string, GeoPoint>): boolean {
  return write(STORAGE_KEYS.geoCache, cache);
}

/* ------------------------------------------------------------
 * 七、备份导出 / 导入
 * ------------------------------------------------------------ */

/** 汇总当前全部数据为备份载荷 */
export function buildBackupPayload(): BackupPayload {
  return {
    version: DATA_VERSION,
    exportedAt: new Date().toISOString(),
    orders: loadOrders(),
    settings: loadSettings(),
    customBrands: loadCustomBrands(),
  };
}

/** 导出为 JSON 字符串（Settings 页下载为 .json 文件） */
export function exportBackup(): string {
  return JSON.stringify(buildBackupPayload(), null, 2);
}

/**
 * 导入备份 JSON（永久同时兼容 v7 / v1）：
 * - detectBackupVersion 探测："v7" 走 migrateV7Backup 全量入库；"v1" 走原逻辑
 * - 成功返回 null；失败返回错误文案（页面直接 Toast 展示）
 */
export function importBackup(json: string): string | null {
  let payload: unknown;
  try {
    payload = JSON.parse(json);
  } catch {
    return "备份文件不是有效的 JSON，请检查后重试";
  }

  if (typeof payload !== "object" || payload === null) {
    return "备份文件内容为空";
  }

  const versionKind = detectBackupVersion(payload);

  if (versionKind === "v7") {
    return importV7Backup(payload as Record<string, unknown>);
  }

  if (versionKind === "unknown") {
    return "备份格式无法识别";
  }

  /* ---- v1 备份：原逻辑 ---- */
  const v1 = payload as BackupPayload;
  if (typeof v1.version !== "number" || v1.version > DATA_VERSION) {
    return `备份文件版本（${String(v1.version)}）高于当前应用支持的版本（${DATA_VERSION}），请升级应用后再导入`;
  }
  if (!Array.isArray(v1.orders)) {
    return "备份文件缺少订单数据，导入中止";
  }

  const ordersOk = v1.orders.every(
    (o) =>
      typeof o === "object" &&
      o !== null &&
      typeof o.id === "string" &&
      typeof o.customerName === "string" &&
      typeof o.status === "string",
  );
  if (!ordersOk) {
    return "备份文件中的订单数据格式不正确，导入中止";
  }

  saveOrders(v1.orders);
  saveSettings({ ...DEFAULT_APP_SETTINGS, ...(v1.settings ?? {}) });
  saveCustomBrands(Array.isArray(v1.customBrands) ? v1.customBrands : []);
  write(STORAGE_KEYS.dataVersion, DATA_VERSION);
  return null;
}

/**
 * v7 老备份全量入库（migrateV7Backup 结果落库）：
 * orders 覆盖、settings 合并、customBrands 合并去重、geoCache 合并、
 * 新 8 键写入、dataVersion=2；成功返回 null
 */
/** v32.1 种子单结构校验：只收 status=appointed 且预约日期/时段齐备的单；
 *  其余一律丢弃（恢复出厂是底线功能，坏种子不可毁导入） */
function readSeedOrders(value: unknown): Order[] {
  if (!Array.isArray(value)) return [];
  return value.filter((o): o is Order => {
    if (typeof o !== "object" || o === null) return false;
    const order = o as Order;
    return (
      typeof order.id === "string" &&
      order.id !== "" &&
      typeof order.customerName === "string" &&
      order.customerName !== "" &&
      order.status === "appointed" &&
      typeof order.appointment === "object" &&
      order.appointment !== null &&
      typeof order.appointment.appointmentDate === "string" &&
      order.appointment.appointmentDate !== "" &&
      typeof order.appointment.timeSlot === "string" &&
      order.appointment.timeSlot !== ""
    );
  });
}

function importV7Backup(raw: Record<string, unknown>): string | null {
  const result = migrateV7Backup(raw);

  /* v34 P0 修复：v7 老系统「已预约」单翻正——老系统已预约 tab 的单存放于
   * orders 桶并带完整预约信息（appointmentDate+appointmentPeriod），migrate
   * 桶映射一律压成 Pending，致其"丢失"在已预约页（甲方实锤：3 单消失）。
   * 翻正：Pending 且 appointment 日期/时段均非空 → Appointed；日期/时段已由
   * migrate 原样迁入 order.appointment（逐字不动，PERIOD_TO_SLOT 映射与
   * 已完成桶 118 单同口径）；无预约信息的 pending 单不受影响；
   * 翻正为一对一 map，单数不变、不丢单 */
  const migratedOrders = result.orders.map((o) =>
    o.status === OrderStatus.Pending &&
    (o.appointment?.appointmentDate ?? "") !== "" &&
    (o.appointment?.timeSlot ?? "") !== ""
      ? { ...o, status: OrderStatus.Appointed }
      : o,
  );

  /* v32.1 种子补种：v7 明文顶层约定键 seedOrdersV1（migrate 不识别、
   * detectBackupVersion 不受影响），恢复出厂基线补「已预约」状态测试单
   * （备份还原丢预约单 bug 的标准测试对象）；
   * 逐单结构校验（坏种子宁可丢弃不可毁导入），只收 status=appointed 且
   * 带合法预约信息的单，追加不动原有 140 单 */
  const seedRaw = Array.isArray(raw.seedOrdersV1) ? raw.seedOrdersV1 : [];
  const seedOrders = readSeedOrders(raw.seedOrdersV1);
  /* v34 要求4：字段残缺数据严禁静默丢弃——丢弃数必须在导入结果中明示 */
  const droppedSeeds = seedRaw.length - seedOrders.length;
  saveOrders([...migratedOrders, ...seedOrders]);

  /* v32.2 补桩全链路恢复：恢复出厂后重置补桩首判标记——否则老设备
   * （已跑过 v31 首判）恢复出厂后不再重判，全单无补桩标记、「需补桩」
   * 标签消失。清空函数与导入管道是两条路径（本函数逐键覆盖、不经清空
   * 函数），故必须在此重置；write 走封装自带异常保护 */
  write(STORAGE_KEYS.restockEvaluated, false);

  /* v32.3 FAIL-1 修复：恢复出厂必须同步清除「用户可配模板类」键——
   * 导入管道逐键覆盖、不经 clearAllData，这些键若只挂在清空区则恢复出厂
   * 后残留用户改动（监理实测：零跑增项模板改价 501 恢复出厂后仍 501）。
   * 清除后 load 回默认：水印模板回默认格式、零跑增项模板回默认 36 条 */
  try {
    window.localStorage.removeItem(STORAGE_KEYS.watermarkTemplates);
    window.localStorage.removeItem(STORAGE_KEYS.leapmotorAddons);
  } catch {
    // 忽略异常：清除失败不影响导入主流程
  }

  /* settings 合并：以现有设置（含默认值回填）为底，v7 字段覆盖 */
  saveSettings({ ...loadSettings(), ...result.settings });

  /* customBrands 合并去重：id 或 name 命中即视为已有，禁止重复挂牌 */
  const existingBrands = loadCustomBrands();
  const seenIds = new Set(existingBrands.map((b) => b.id));
  const seenNames = new Set(existingBrands.map((b) => b.name));
  const mergedBrands = [...existingBrands];
  for (const brand of result.customBrands) {
    if (seenIds.has(brand.id) || seenNames.has(brand.name)) continue;
    seenIds.add(brand.id);
    seenNames.add(brand.name);
    mergedBrands.push(brand);
  }
  saveCustomBrands(mergedBrands);

  /* geoCache 合并：v7 解码结果覆盖同名地址，其余地址保留 */
  saveGeoCache({ ...loadGeoCache(), ...result.geoCache });

  /* 新 8 键写入（costBindings 结构待阶段2定义，原样数组承接） */
  saveMaterialsLib(result.materialsLib);
  saveBrandPrices(result.brandPrices);
  saveInventory(result.inventory);
  saveMaterialTemplates(result.materialTemplates);
  saveCostSheet(result.costSheet);
  savePlatforms(result.platforms);
  saveMaterialUsage(result.materialUsage);
  saveCostBindings(
    Array.isArray(raw.costBindings)
      ? (raw.costBindings as Record<string, unknown>[])
      : [],
  );

  write(STORAGE_KEYS.dataVersion, DATA_VERSION);
  /* v34 要求4：有残缺数据被丢弃时返回明示文案（调用方 Toast 展示）；
   * 无丢弃返回 null（成功） */
  if (droppedSeeds > 0) {
    return `导入完成，但有 ${droppedSeeds} 条数据因格式不完整（缺已预约状态或预约日期/时段）未导入，其余数据已全部还原`;
  }
  return null;
}

/* ------------------------------------------------------------
 * 八、业务读写：费率与成本配置（SettingsPage 维护）
 * ------------------------------------------------------------ */
export function loadRateConfigs(): BrandRateConfig[] {
  return read<BrandRateConfig[]>(STORAGE_KEYS.rateConfigs, []);
}

export function saveRateConfigs(configs: BrandRateConfig[]): boolean {
  return write(STORAGE_KEYS.rateConfigs, configs);
}

/** 与 loadSettings 同款：缺字段自动回填默认值 */
export function loadPlatformRates(): PlatformRateConfig {
  const stored = read<Partial<PlatformRateConfig>>(
    STORAGE_KEYS.platformRates,
    {},
  );
  return { ...DEFAULT_PLATFORM_RATES, ...stored };
}

export function savePlatformRates(rates: PlatformRateConfig): boolean {
  return write(STORAGE_KEYS.platformRates, rates);
}

/* ------------------------------------------------------------
 * 九、业务读写：品牌话术模板（SettingsPage 维护）
 * ------------------------------------------------------------ */
/** 从未保存过时返回默认模板；用户一旦保存（哪怕空数组）以保存值为准 */
/**
 * 读取品牌话术（任务Q 升级合并）：
 * - 本地无存档 → 直接返回新版默认模板；
 * - 本地有存档 → 逐条合并：存档内容与旧占位模板逐字一致（用户没改过）
 *   → 升级为新版真实模板；与旧占位不一致（用户改过）→ 保留用户内容不覆盖；
 *   存档缺失的新默认条目 → 补齐；存档里多出的自定义条目 → 原样保留
 */
export function loadBrandScripts(): BrandScript[] {
  const stored = read<BrandScript[] | null>(STORAGE_KEYS.brandScripts, null);
  if (!stored || stored.length === 0) return DEFAULT_BRAND_SCRIPTS;
  const merged = stored.map((s) => {
    const legacy = LEGACY_PLACEHOLDER_SCRIPTS.find(
      (p) => p.brandId === s.brandId && p.scene === s.scene,
    );
    if (legacy && s.content === legacy.content) {
      const fresh = DEFAULT_BRAND_SCRIPTS.find(
        (d) => d.brandId === s.brandId && d.scene === s.scene,
      );
      if (fresh) return fresh;
    }
    return s;
  });
  for (const d of DEFAULT_BRAND_SCRIPTS) {
    if (!merged.some((s) => s.brandId === d.brandId && s.scene === d.scene)) {
      merged.push(d);
    }
  }
  return merged;
}

export function saveBrandScripts(scripts: BrandScript[]): boolean {
  return write(STORAGE_KEYS.brandScripts, scripts);
}

/* ------------------------------------------------------------
 * 十、业务读写：v7 承接新模块（阶段1 追加，阶段2 只读调用）
 * ------------------------------------------------------------ */

export function loadMaterialsLib(): MaterialItemLib[] {
  return read<MaterialItemLib[]>(STORAGE_KEYS.materials, []);
}

export function saveMaterialsLib(m: MaterialItemLib[]): boolean {
  return write(STORAGE_KEYS.materials, m);
}

export function loadBrandPrices(): BrandPrice[] {
  return read<BrandPrice[]>(STORAGE_KEYS.brandPrices, []);
}

export function saveBrandPrices(p: BrandPrice[]): boolean {
  return write(STORAGE_KEYS.brandPrices, p);
}

export function loadInventory(): StockItem[] {
  return read<StockItem[]>(STORAGE_KEYS.inventory, []);
}

export function saveInventory(s: StockItem[]): boolean {
  return write(STORAGE_KEYS.inventory, s);
}

export function loadMaterialTemplates(): MaterialTemplate[] {
  return read<MaterialTemplate[]>(STORAGE_KEYS.materialTemplates, []);
}

export function saveMaterialTemplates(t: MaterialTemplate[]): boolean {
  return write(STORAGE_KEYS.materialTemplates, t);
}

export function loadCostSheet(): CostSheetItem[] {
  return read<CostSheetItem[]>(STORAGE_KEYS.costSheet, []);
}

export function saveCostSheet(c: CostSheetItem[]): boolean {
  return write(STORAGE_KEYS.costSheet, c);
}

/** 平台列表：cp_platforms 无存（从未迁移/保存过）时，由旧 cp_platform_rates
 * 两档扣点生成默认 京东/其他 两条（小数 × 100 → 0-100 口径）；
 * 一旦保存过（哪怕空数组）以保存值为准 */
export function loadPlatforms(): PlatformConfig[] {
  const stored = read<PlatformConfig[] | null>(STORAGE_KEYS.platforms, null);
  if (stored !== null) return stored;
  const rates = loadPlatformRates();
  return [
    { name: "京东", deductionPercent: rates.jd * 100 },
    { name: "其他", deductionPercent: rates.other * 100 },
  ];
}

export function savePlatforms(p: PlatformConfig[]): boolean {
  return write(STORAGE_KEYS.platforms, p);
}

export function loadMaterialUsage(): MaterialUsageRecord[] {
  return read<MaterialUsageRecord[]>(STORAGE_KEYS.materialUsage, []);
}

export function saveMaterialUsage(u: MaterialUsageRecord[]): boolean {
  return write(STORAGE_KEYS.materialUsage, u);
}

/** 成本绑定：结构待阶段2定义（v7 备份承接原样数组，空数组保留键位） */
export function loadCostBindings(): Record<string, unknown>[] {
  return read<Record<string, unknown>[]>(STORAGE_KEYS.costBindings, []);
}

export function saveCostBindings(b: Record<string, unknown>[]): boolean {
  return write(STORAGE_KEYS.costBindings, b);
}

/** 清空全部业务数据（设置页"恢复出厂"使用，保留版本号） */
export function clearAllData(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEYS.orders);
    window.localStorage.removeItem(STORAGE_KEYS.settings);
    window.localStorage.removeItem(STORAGE_KEYS.customBrands);
    window.localStorage.removeItem(STORAGE_KEYS.geoCache);
    window.localStorage.removeItem(STORAGE_KEYS.rateConfigs);
    window.localStorage.removeItem(STORAGE_KEYS.platformRates);
    window.localStorage.removeItem(STORAGE_KEYS.brandScripts);
    window.localStorage.removeItem(STORAGE_KEYS.materials);
    window.localStorage.removeItem(STORAGE_KEYS.brandPrices);
    window.localStorage.removeItem(STORAGE_KEYS.inventory);
    window.localStorage.removeItem(STORAGE_KEYS.materialTemplates);
    window.localStorage.removeItem(STORAGE_KEYS.costSheet);
    window.localStorage.removeItem(STORAGE_KEYS.platforms);
    window.localStorage.removeItem(STORAGE_KEYS.materialUsage);
    window.localStorage.removeItem(STORAGE_KEYS.costBindings);
    window.localStorage.removeItem(STORAGE_KEYS.watermarkTemplates);
    window.localStorage.removeItem(STORAGE_KEYS.leapmotorAddons);
    /* v32.2 补桩全链路恢复：恢复出厂必须清补桩首判标记——否则老设备
       恢复出厂后首判不重跑（v31 遗留隐患），143 单全部无补桩标记、
       「需补桩」标签消失；清掉后挂载首判重跑，非零跑库存0安装单重新挂标 */
    window.localStorage.removeItem(STORAGE_KEYS.restockEvaluated);
  } catch {
    // 忽略异常：清空失败不影响页面流程
  }
}

/* ------------------------------------------------------------
 * 十一、备份密码本地覆盖值（任务S · 隐私整改，尾部追加）
 * 自定义备份密码的两件本地状态：
 *   ① 校验值 verifier（PBKDF2 派生哈希，绝不存明文密码）
 *   ② 用自定义密码重加密的出厂备份信封
 *      （内置密文是打包进产物的只读资源，改密码只能改此本地覆盖值）
 * ------------------------------------------------------------ */

/** 读取自定义备份密码校验值；未设置或结构非法返回 null */
export function loadBackupPwdVerifier(): BackupPasswordVerifier | null {
  const v = read<unknown>(STORAGE_KEYS.backupPwdVerifier, null);
  return isPasswordVerifier(v) ? v : null;
}

/** 保存自定义备份密码校验值（配额超限等场景返回 false） */
export function saveBackupPwdVerifier(
  verifier: BackupPasswordVerifier,
): boolean {
  return write(STORAGE_KEYS.backupPwdVerifier, verifier);
}

/** 读取自定义密码重加密的出厂备份信封；未设置或结构非法返回 null */
export function loadBackupOverrideEnvelope(): BackupEnvelope | null {
  const v = read<unknown>(STORAGE_KEYS.backupOverride, null);
  return isBackupEnvelope(v) ? v : null;
}

/** 保存重加密信封（约 1MB 级，配额超限等场景返回 false） */
export function saveBackupOverrideEnvelope(envelope: BackupEnvelope): boolean {
  return write(STORAGE_KEYS.backupOverride, envelope);
}

/** 清除自定义备份密码（校验值 + 重加密信封一并清除，回到默认密码口径） */
export function clearCustomBackupPassword(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEYS.backupPwdVerifier);
    window.localStorage.removeItem(STORAGE_KEYS.backupOverride);
  } catch {
    // 忽略异常：清除失败不影响页面流程
  }
}

/* ------------------------------------------------------------
 * 十二、表单预设（任务R：默认值定义在 lib/formPresets，storage 单向引用，
 *      与 scripts/costMapping 同模式；有部分存档按字段合并，缺字段补默认）
 * ------------------------------------------------------------ */
import { DEFAULT_FORM_PRESETS } from "@/lib/formPresets";

/** 读取表单预设：无存档返回默认值；有部分存档按字段合并（向后兼容增量字段） */
export function loadFormPresets(): FormPresets {
  const stored = read<Partial<FormPresets> | null>(
    STORAGE_KEYS.formPresets,
    null,
  );
  return { ...DEFAULT_FORM_PRESETS, ...(stored ?? {}) };
}

/** 保存表单预设（设置页「表单预设」区） */
export function saveFormPresets(presets: FormPresets): boolean {
  return write(STORAGE_KEYS.formPresets, presets);
}

/* ------------------------------------------------------------
 * 十三、补桩首判标记（任务U：遗留安装单上线后统一判定一次，只判一次）
 * ------------------------------------------------------------ */

/** 遗留安装单是否已完成补桩首判（未标记返回 false） */
export function loadRestockEvaluated(): boolean {
  return read<boolean>(STORAGE_KEYS.restockEvaluated, false);
}

/** 标记补桩首判已完成 */
export function saveRestockEvaluated(): boolean {
  return write(STORAGE_KEYS.restockEvaluated, true);
}

/* ------------------------------------------------------------
 * 十四、水印模板配置（任务v32：按平台可配水印相机客户名模板，
 *      键=平台名；空串/缺省=回退默认模板，由 lib/watermark 兜底）
 * ------------------------------------------------------------ */

/** 读取全平台水印模板映射（未设置返回 {}） */
export function loadWatermarkTemplates(): Record<string, string> {
  return read<Record<string, string>>(STORAGE_KEYS.watermarkTemplates, {});
}

/** 写全平台水印模板映射（整存整取，单平台改动由调用方合并后写入） */
export function saveWatermarkTemplates(t: Record<string, string>): boolean {
  return write(STORAGE_KEYS.watermarkTemplates, t);
}

/* ------------------------------------------------------------
 * 十五、零跑增项模板（任务v33：设置页可改价/增删；
 *      键不存在=回默认36条（含恢复出厂清空后）；用户存空数组=尊重空列表）
 * ------------------------------------------------------------ */

/** 读取零跑增项模板（键不存在回默认36条；默认数据在 lib/leapmotorAddons） */
export function loadLeapmotorAddons(): LeapmotorAddon[] {
  return read<LeapmotorAddon[]>(
    STORAGE_KEYS.leapmotorAddons,
    DEFAULT_LEAPMOTOR_ADDONS,
  );
}

/** 写零跑增项模板（整存整取，改价/增删由调用方合并后写入） */
export function saveLeapmotorAddons(list: LeapmotorAddon[]): boolean {
  return write(STORAGE_KEYS.leapmotorAddons, list);
}
