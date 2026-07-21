/* ============================================================
 * 充电桩订单助手 · 全业务 TS 类型定义（类型地基）
 * 阶段3：所有 lib / context / components / pages 的类型统一从这里导出
 * ============================================================ */

/* ------------------------------------------------------------
 * 一、订单状态枚举（与 index.css 的 tag--* 样式一一对应）
 * ------------------------------------------------------------ */
export const OrderStatus = {
  /** 待勘测：已录单，尚未上门勘测 */
  Pending: "pending",
  /** 已勘测：勘测完成，待预约安装 */
  Surveyed: "surveyed",
  /** 已预约：已约安装时间，待上门施工 */
  Appointed: "appointed",
  /** 已完成：施工完工 */
  Completed: "completed",
  /** 已取消 */
  Cancelled: "cancelled",
  /** 回收站：软删除订单（v7 trashOrders 承接，可恢复/彻底删除） */
  Trash: "trash",
} as const;

export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

/** 状态中文文案（展示层统一使用，避免各页面重复定义） */
export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  [OrderStatus.Pending]: "待勘测",
  [OrderStatus.Surveyed]: "已勘测",
  [OrderStatus.Appointed]: "已预约",
  [OrderStatus.Completed]: "已完成",
  [OrderStatus.Cancelled]: "已取消",
  [OrderStatus.Trash]: "回收站",
};

/** 状态流转规则：key 状态允许流转到 value 中的状态 */
export const ORDER_STATUS_FLOW: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.Pending]: [OrderStatus.Surveyed, OrderStatus.Cancelled],
  [OrderStatus.Surveyed]: [OrderStatus.Appointed, OrderStatus.Cancelled],
  [OrderStatus.Appointed]: [OrderStatus.Completed, OrderStatus.Cancelled],
  [OrderStatus.Completed]: [],
  [OrderStatus.Cancelled]: [],
  /* 回收站不参与常规流转：恢复/彻底删除由 context 显式处理 */
  [OrderStatus.Trash]: [],
};

/* ------------------------------------------------------------
 * 二、充电桩品牌与物料
 * ------------------------------------------------------------ */
/** 充电桩品牌 */
export interface ChargeBrand {
  /** 品牌唯一标识 */
  id: string;
  /** 品牌名称，如 特斯拉 / 比亚迪 / 公牛 / 普诺得 */
  name: string;
  /** 常见功率（kW），用于快速录入 */
  defaultPowerKw: number;
}

/** 单个物料项（勘测/完工共用同一物料模型，复用规范） */
export interface MaterialItem {
  /** 物料名称，如 电缆 / 漏保开关 / PVC管 */
  name: string;
  /** 规格，如 YJV-3×6mm² */
  spec: string;
  /** 数量 */
  quantity: number;
  /** 单位，如 米 / 个 / 套 */
  unit: string;
  /** 单价（元），可选 */
  unitPrice?: number;
}

/** 品牌默认物料包：brandMaterials.ts 内置，勘测弹窗可一键带入 */
export interface BrandMaterialPack {
  brandId: string;
  items: MaterialItem[];
}

/** 零跑增项模板条目（任务v33：cp_leapmotor_addons，默认36条见 lib/leapmotorAddons；
 *  录入时勾选带出为 MaterialItem：name→name、price→unitPrice、unit→unit、spec 留空） */
export interface LeapmotorAddon {
  /** 稳定 ID（维护区改价/增删定位用；默认模板 leap-01 ~ leap-36） */
  id: string;
  /** 增项名称（含规格关键信息，图面措辞） */
  name: string;
  /** 短名（任务v35.1：选择列表显示用；缺省回退 lib/addonShortName.autoShortName(name)） */
  shortName?: string;
  /** 单位（米 / 个 / 项 / 次 / 根 / 组） */
  unit: string;
  /** 单价（元） */
  price: number;
}

/* ------------------------------------------------------------
 * 三、勘测信息
 * ------------------------------------------------------------ */
export interface SurveyInfo {
  /** 勘测日期，YYYY-MM-DD */
  surveyDate: string;
  /** 勘测人 */
  surveyor: string;
  /** 电表到桩位距离（米） */
  cableDistance: number;
  /** 勘测结论备注（走线路径、施工难点等） */
  note: string;
  /** 勘测所用物料清单 */
  materials: MaterialItem[];
  /** 现场照片（base64 或本地 blob 索引，可选） */
  photos?: string[];
  /** 用电方式/电源点性质（话术变量，可选） */
  powerSource?: string;
  /** 安装方式/勘测详情（话术变量，可选） */
  installType?: string;
  /** 电表状态（如 已安装/未安装；话术条件块用，可选） */
  meterStatus?: string;
  /** 物业需要施工方案图（是/否，可选） */
  needPlanDoc?: string;
  /** 勘测结果（可选） */
  surveyResult?: string;
  /** 物业是否允许施工（是/否，可选） */
  propertyAllow?: string;
  /** 线缆规格（如 3*6；任务R 表单预设字段，可选） */
  cableSpec?: string;
}

/* ------------------------------------------------------------
 * 四、预约与完工信息
 * ------------------------------------------------------------ */
/** 预约安装信息（订单状态进入 Appointed 时填写） */
export interface AppointmentInfo {
  /** 预约安装日期，YYYY-MM-DD */
  appointmentDate: string;
  /** 预约时间段，如 09:00-12:00 */
  timeSlot: string;
  /** 安装师傅 */
  installer: string;
  /** 预约备注 */
  note: string;
}

/** 完工利润快照（新完工单写入；v7 老单快照在 legacyProfit） */
export interface ProfitSnapshot {
  /** 结算费 */
  baseFee: number;
  /** 客户增项付费 */
  customerPaid: number;
  /** 材料成本 */
  materialCost: number;
  /** 利润 */
  profit: number;
}

/** 完工信息 */
export interface CompletionInfo {
  /** 完工日期，YYYY-MM-DD */
  completeDate: string;
  /** 实际安装师傅 */
  installer: string;
  /** 实际使用物料清单 */
  materials: MaterialItem[];
  /** 实际工时（小时） */
  workHours: number;
  /** 完工备注 */
  note: string;
  /** 完工照片（可选） */
  photos?: string[];
  /** 平台扣点金额（元，正数；新完工单由 CompleteModal 写入，v7 老单 7 月有部分有、5/6 月无，统计缺省按 0） */
  platformDeduction?: number;
  /** 完工利润快照（新完工单写入；v7 老单快照在 legacyProfit） */
  profitData?: ProfitSnapshot;
  /** v7 profitData 利润快照（整体原样保留，数值禁止重算） */
  legacyProfit?: Record<string, unknown>;
  /** 实际线缆用量（米，话术变量，可选） */
  actualCable?: number;
  /** 增项费用（元，话术变量，可选） */
  addonFee?: number;
  /** 安装详情（话术变量，可选） */
  installDetail?: string;
}

/* ------------------------------------------------------------
 * 五、订单主模型
 * ------------------------------------------------------------ */
/** 固定辅材选择（任务v36：完工快照算成本时的取值源；
 *  录入见 components/FixedMaterialsDialog，成本计算见 lib/fixedAux + lib/completionCost） */
export interface FixedAuxSelection {
  /** 漏保规格（C25 / C40 / C40A，档位见 lib/fixedAux.BREAKER_SPECS） */
  breakerSpec: string;
  /** 漏保单价（元；null=材料库未匹配——价格框置空并提示去设置页成本表绑定，
   *  成本计算按 0 计，严禁自动填兜底数（任务v36.1 FAIL-3）） */
  breakerPrice: number | null;
  /** PVC 管米数（默认=用线米数，桥架混用场景可手改） */
  pvcMeters: number;
}

export interface Order {
  /** 订单唯一 ID（utils 生成） */
  id: string;
  /** 客户姓名 */
  customerName: string;
  /** 客户电话 */
  customerPhone: string;
  /** 安装地址（结构化文本） */
  address: string;
  /** 地址经纬度（geoCache 地理编码缓存，可选） */
  longitude?: number;
  latitude?: number;
  /** 充电桩品牌 ID（关联 ChargeBrand） */
  brandId: string;
  /** 充电桩功率（kW） */
  powerKw: number;
  /** 当前状态 */
  status: OrderStatus;
  /** 勘测信息（进入 Surveyed 后存在） */
  survey?: SurveyInfo;
  /** 预约信息（进入 Appointed 后存在） */
  appointment?: AppointmentInfo;
  /** 完工信息（进入 Completed 后存在） */
  completion?: CompletionInfo;
  /** 订单备注 */
  remark: string;
  /** 套包米数（智能识别从"米数:xx"提取，可选） */
  packageMeters?: number;
  /** 平台类型：jd=京东 / other=其他（智能识别自动判定，可选） */
  platformType?: "jd" | "other";
  /** 平台名称全称（v7 承接，如"京东"/"挚达"，与 PlatformConfig.name 对应） */
  platform?: string;
  /** 原始报单文本（v7 承接，完整保留，丢失=重大事故） */
  originalText?: string;
  /** 补桩标记（任务U：仅安装单；needed=需补桩 / done=已补桩；无值=不显示标签） */
  restockStatus?: "needed" | "done";
  /** 回款标记（v7 承接） */
  payment?: PaymentInfo;
  /** 固定辅材选择（任务v36：完工快照算成本时的取值源，FixedMaterialsDialog 录入，可选） */
  fixedAux?: FixedAuxSelection;
  /** 回收站删除时间（ISO 字符串，status=trash 时存在） */
  deletedAt?: string;
  /** v7 扩展字段原样保留容器（freeCableMeters/serviceType 等，有值才写） */
  legacyExtra?: Record<string, unknown>;
  /** 创建时间（ISO 字符串） */
  createdAt: string;
  /** 最后更新时间（ISO 字符串） */
  updatedAt: string;
}

/** 新增/编辑订单弹窗提交的草稿（id/时间戳由 context 补齐） */
export type OrderDraft = Omit<
  Order,
  "id" | "createdAt" | "updatedAt" | "survey" | "appointment" | "completion"
>;

/* ------------------------------------------------------------
 * 六、首页搜索与筛选（搜索功能全部集成首页）
 * ------------------------------------------------------------ */
export interface OrderFilter {
  /** 关键词：匹配姓名/电话/地址 */
  keyword: string;
  /** 状态筛选，空数组 = 全部 */
  statuses: OrderStatus[];
  /** 品牌筛选，空字符串 = 全部 */
  brandId: string;
  /** 日期范围（创建日期），空字符串 = 不限 */
  dateFrom: string;
  dateTo: string;
}

/** 默认筛选条件（HomePage 与 context 复用） */
export const DEFAULT_ORDER_FILTER: OrderFilter = {
  keyword: "",
  statuses: [],
  brandId: "",
  dateFrom: "",
  dateTo: "",
};

/* ------------------------------------------------------------
 * 七、统计模型（StatsPage 使用）
 * ------------------------------------------------------------ */
/** 状态维度统计 */
export interface StatusStat {
  status: OrderStatus;
  count: number;
}

/** 品牌维度统计 */
export interface BrandStat {
  brandId: string;
  brandName: string;
  count: number;
  /** 已完成订单数 */
  completedCount: number;
}

/** 月度趋势项 */
export interface MonthStat {
  /** 月份，YYYY-MM */
  month: string;
  /** 新增订单数 */
  created: number;
  /** 完工订单数 */
  completed: number;
}

/** 物料用量汇总项 */
export interface MaterialUsageStat {
  name: string;
  spec: string;
  unit: string;
  totalQuantity: number;
  /** 总金额（元），无单价的物料不计入 */
  totalAmount: number;
}

/** 统计页总模型（utils 从订单列表计算得出） */
export interface OrderStats {
  totalCount: number;
  byStatus: StatusStat[];
  byBrand: BrandStat[];
  byMonth: MonthStat[];
  materialUsage: MaterialUsageStat[];
  /** 平均完工周期（天）：创建→完工，仅已完成订单 */
  avgCompleteDays: number;
}

/* ------------------------------------------------------------
 * 八、应用设置（Settings 页 + storage 持久化）
 * ------------------------------------------------------------ */
export interface AppSettings {
  /** 默认勘测人 */
  defaultSurveyor: string;
  /** 默认安装师傅 */
  defaultInstaller: string;
  /** 高德地图 Key（geoCache 地理编码使用，用户自行填写） */
  amapKey: string;
  /** 数据自动备份提醒开关 */
  backupReminder: boolean;
  /** 高德安全密钥（与 amapKey 配对，缺一坐标解析必失败，v7 承接） */
  amapSecurity?: string;
  /** 工程师姓名（v7 承接） */
  engineerName?: string;
  /** 工程师电话（v7 承接） */
  engineerPhone?: string;
  /** 收货地址（v7 承接） */
  receiveAddr?: string;
  /** 自动备份开关（v7 承接） */
  autoBackup?: boolean;
  /** 我的位置（v7 承接：打卡定位快照） */
  myPosition?: { lat: number; lng: number; date: string };
  /** 今日已拨打电话（v7 承接：按日期去重） */
  todayCalls?: { date: string; phones: string[] };
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  defaultSurveyor: "",
  defaultInstaller: "",
  amapKey: "",
  backupReminder: true,
};

/* ------------------------------------------------------------
 * 八之二、表单预设（任务R：设置页「表单预设」区可改，storage 持久化；
 *        勘测/完工表单打开即按此预填，师傅只需输米数选增项）
 * ------------------------------------------------------------ */
export interface FormPresets {
  /** 取电方式默认（如 国网取电） */
  powerSource: string;
  /** 线缆规格默认（如 3*6） */
  cableSpec: string;
  /** 勘测详情/安装方式默认（如 壁挂安装） */
  installType: string;
  /** 电表状态默认（如 已安装） */
  meterStatus: string;
  /** 物业需要施工方案图默认（是/否） */
  needPlanDoc: string;
  /** 勘测结果默认（如 车位是符合安装） */
  surveyResult: string;
}

/* ------------------------------------------------------------
 * 九、存储层契约（storage.ts 实现，Key 统一在此声明）
 * ------------------------------------------------------------ */
export const STORAGE_KEYS = {
  /** 订单列表 */
  orders: "cp_orders",
  /** 应用设置 */
  settings: "cp_settings",
  /** 自定义品牌列表（用户新增品牌） */
  customBrands: "cp_custom_brands",
  /** 地理编码缓存 */
  geoCache: "cp_geo_cache",
  /** 存储数据版本（迁移用） */
  dataVersion: "cp_data_version",
  /** 品牌费率配置 */
  rateConfigs: "cp_rate_configs",
  /** 平台扣点率 */
  platformRates: "cp_platform_rates",
  /** 品牌话术模板 */
  brandScripts: "cp_brand_scripts",
  /** 材料库（v7 承接 572 条） */
  materials: "cp_materials",
  /** 品牌结算价（v7 承接 30 条） */
  brandPrices: "cp_brand_prices",
  /** 桩库存（v7 承接，含负数） */
  inventory: "cp_inventory",
  /** 安装模板（v7 承接 4 套） */
  materialTemplates: "cp_material_templates",
  /** 成本价目（v7 承接 37 条） */
  costSheet: "cp_cost_sheet",
  /** 平台列表+扣点（v7 13 平台合并 11 扣点） */
  platforms: "cp_platforms",
  /** 材料领用记录（v7 承接 21 条） */
  materialUsage: "cp_material_usage",
  /** 成本绑定（v7 承接，空数组保留键位） */
  costBindings: "cp_cost_bindings",
  /** 自定义备份密码校验值（任务S：PBKDF2 派生哈希，绝不存明文密码） */
  backupPwdVerifier: "cp_backup_pwd_verifier",
  /** 自定义密码重加密的出厂备份信封（任务S：改密码只改本地覆盖值，内置密文只读） */
  backupOverride: "cp_backup_override",
  /** 表单预设（任务R：勘测/完工表单默认值，设置页可改） */
  formPresets: "cp_form_presets",
  /** 遗留安装单补桩首判完成标记（任务U：上线后统一判一遍，只判一次） */
  restockEvaluated: "cp_restock_evaluated",
  /** 水印模板配置（任务v32：键=平台名，值=模板串，支持 {平台} {姓名}；
   *  未配置的平台回退默认模板，恢复出厂清空回默认） */
  watermarkTemplates: "cp_watermark_templates",
  /** 零跑增项模板（任务v33：LeapmotorAddon[]，设置页可改价/增删；
   *  键不存在=回默认36条，恢复出厂清空回默认） */
  leapmotorAddons: "cp_leapmotor_addons",
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

/** 当前数据版本号：结构变更时递增，storage 层做版本迁移
 * v2：新增 Trash 状态 + 8 个 v7 承接键位（cp_materials 等） */
export const DATA_VERSION = 2;

/** 备份文件结构（导出/导入 JSON 用） */
export interface BackupPayload {
  version: number;
  exportedAt: string;
  orders: Order[];
  settings: AppSettings;
  customBrands: ChargeBrand[];
}

/* ------------------------------------------------------------
 * 十、弹窗参数模型（components 与 pages 之间的传参契约）
 * ------------------------------------------------------------ */
/** 订单弹窗：新增 = 无 order；编辑 = 传入 order */
export interface OrderModalProps {
  open: boolean;
  order?: Order;
  onClose: () => void;
}

/** 勘测弹窗 */
export interface SurveyModalProps {
  open: boolean;
  order: Order | null;
  onClose: () => void;
}

/** 完工弹窗 */
export interface CompleteModalProps {
  open: boolean;
  order: Order | null;
  onClose: () => void;
}

/** 二次确认弹窗 */
export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  content: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/* ------------------------------------------------------------
 * 十一、底部导航（App.tsx / TabBar 使用）
 * ------------------------------------------------------------ */
export const TabKey = {
  Home: "home",
  Appointment: "appointment",
  Completed: "completed",
  Stats: "stats",
  Settings: "settings",
  /** 材料库（任务D） */
  Materials: "materials",
} as const;

export type TabKey = (typeof TabKey)[keyof typeof TabKey];

export const TAB_LABEL: Record<TabKey, string> = {
  [TabKey.Home]: "首页",
  [TabKey.Appointment]: "已预约",
  [TabKey.Completed]: "已完成",
  [TabKey.Stats]: "统计",
  [TabKey.Settings]: "设置",
  [TabKey.Materials]: "材料库",
};

/* ------------------------------------------------------------
 * 十二、月度财务统计（src/lib/statistics.ts 专用模型）
 * 铁则：财务计算唯一入口是 statistics.ts，页面/组件只消费这里的类型与数据
 * ------------------------------------------------------------ */

/** 月度财务总览（getMonthlyFinanceStats 返回的 overview） */
export interface MonthlyFinanceStats {
  /** 统计月份，YYYY-MM */
  yearMonth: string;
  /** 当月完成订单数 */
  totalCompleted: number;
  /** 安装单数 */
  installCount: number;
  /** 维修单数 */
  repairCount: number;
  /** 勘测单数 */
  surveyCount: number;
  /** 客户付费合计（元）：结算费 + 客户增项付费 */
  customerTotalPaid: number;
  /** 扣点后收入（元）：客户增项付费 - 平台扣点 */
  incomeAfterDeduction: number;
  /** 对账利润（元）：结算费 + 客户增项付费 - 平台扣点 - 材料成本（明面对账口径） */
  reconciliationProfit: number;
  /** 实际利润（元）：Σ 各单利润快照（快照实算口径，含空开/漏保/PVC 等辅材隐性成本，与对账利润口径不同） */
  actualProfit: number;
  /** 平均利润（元/台） */
  averageProfit: number;
  /** 台均增项（元/台） */
  averageAddon: number;
  /** 维修收入（元） */
  repairIncome: number;
  /** 勘测收入（元） */
  surveyIncome: number;
}

/** 收入拆解（对账/实际两套利润共用同一份收入结构） */
export interface IncomeBreakdown {
  /** 客户增项费（元） */
  customerAddonFee: number;
  /** 维修费（元） */
  repairFee: number;
  /** 维修单数 */
  repairCount: number;
  /** 安装费（元） */
  installFee: number;
  /** 勘测费（元） */
  surveyFee: number;
  /** 勘测单数 */
  surveyCount: number;
  /** 收入合计（元）：增项费 + 维修费 + 安装费 + 勘测费 */
  totalIncome: number;
}

/** 平台扣点 */
export interface PlatformDeduction {
  /** 扣点金额（元，负数表示扣点） */
  amount: number;
}

/** 成本拆解 */
export interface CostBreakdown {
  /** 材料领用成本（元，负数表示成本） */
  materialCost: number;
  /** 成本来源说明 */
  description: string;
}

/** 利润计算过程单步（页面逐步展示公式与千分位明细） */
export interface CalculationStep {
  /** 步骤名称，如 扣点后收入 / 对账利润 */
  label: string;
  /** 公式描述，如 增项费 - 扣点 */
  formula: string;
  /** 逐行明细（formatMoney 千分位字符串，如 = ¥5,590.00 - ¥362.00） */
  details: string[];
  /** 本步计算结果（元） */
  result: number;
}

/** 利润拆解（对账口径 / 实际口径各一份） */
export interface ProfitBreakdown {
  /** 收入拆解 */
  income: IncomeBreakdown;
  /** 平台扣点 */
  platformDeduction: PlatformDeduction;
  /** 成本拆解 */
  cost: CostBreakdown;
  /** 额外成本/调整（元，可选） */
  additionalCosts?: number;
  /** 计算过程步骤 */
  calculationSteps: CalculationStep[];
}

/** 统计科目逐单明细行 */
export interface MonthSubjectEntry {
  orderId: string;
  customerName: string;
  date: string;
  amount: number;
  note?: string;
}

/** 统计页对账单科目 */
export interface MonthSubject {
  /** volume/settlement/addon/deduction/material/reconciliation/actual/average */
  key: string;
  label: string;
  /** 单量科目为单数，其余为金额 */
  amount: number;
  /** 单量科目用 "20 单（装13/修4/勘3）" 这种 */
  amountText?: string;
  /** 口径说明（弹窗展示） */
  formula: string;
  /** 逐单明细（平均利润等派生科目可为空） */
  entries: MonthSubjectEntry[];
}

/** 月度财务统计总模型（statistics.ts 唯一出口数据） */
export interface MonthlyFinanceData {
  /** 总览指标 */
  overview: MonthlyFinanceStats;
  /** 对账利润拆解 */
  reconciliationDetail: ProfitBreakdown;
  /** 实际利润拆解 */
  actualDetail: ProfitBreakdown;
  /** 八科目对账单（单量/结算费/增项/扣点/材料/对账利润/实际利润/平均利润） */
  subjects: MonthSubject[];
}

/* ------------------------------------------------------------
 * 十四、费率与成本配置（Phase 1 数据层扩展，SettingsPage 维护）
 * ------------------------------------------------------------ */
/** 品牌费率配置：套包米数与各服务类型费用 */
export interface BrandRateConfig {
  /** 品牌 ID（关联 ChargeBrand） */
  brandId: string;
  /** 套包米数（套包内电缆米数，超出部分另计） */
  packageMeters: number;
  /** 安装费（元/台） */
  installFee: number;
  /** 维修费（元/台） */
  repairFee: number;
  /** 勘测费（元/台） */
  surveyFee: number;
  /** 超套包米数单价（元/米，话术超米计费用；缺省按 45 元/米） */
  overMeterPrice?: number;
}

/** 平台扣点率（小数，0.10 = 10%） */
export interface PlatformRateConfig {
  /** 京东平台扣点率，默认 0.10 */
  jd: number;
  /** 其他平台扣点率，默认 0.20 */
  other: number;
}

/** 平台扣点默认值 */
export const DEFAULT_PLATFORM_RATES: PlatformRateConfig = {
  jd: 0.10,
  other: 0.20,
};

/* ------------------------------------------------------------
 * 十五、话术模板（SettingsPage 可编辑，storage 持久化）
 * ------------------------------------------------------------ */
/** 话术场景：上门前 / 勘测完成 / 安装完成 */
export type ScriptScene = "preVisit" | "surveyComplete" | "installComplete";

/** 品牌话术模板（SettingsPage 可编辑，storage 持久化） */
export interface BrandScript {
  /** 品牌 ID（"default" 为通用兜底模板） */
  brandId: string;
  scene: ScriptScene;
  /** 模板内容，支持变量：{customerName} {address} {cableDistance} {materials} {totalCost} {installerName} {brandName} {appointmentDate} {timeSlot} */
  content: string;
}

/* ------------------------------------------------------------
 * 十六、v7承接与新模块（阶段0 迁移器承接 v7 老备份，阶段2 新模块消费）
 * ------------------------------------------------------------ */

/** 回款信息（Order.payment，v7 paid/paidAmount/paymentStatus 承接） */
export interface PaymentInfo {
  /** 是否已回款 */
  paid: boolean;
  /** 回款金额（元） */
  amount?: number;
  /** 回款状态原文（v7: "paid" / "unpaid"） */
  status?: string;
}

/** 材料库条目（cp_materials，v7 materials 承接 572 条） */
export interface MaterialItemLib {
  id: string;
  /** 适用品牌名（v7 按品牌名管理，非 brandId） */
  brand: string;
  name: string;
  unit: string;
  /** 销售单价（元） */
  salePrice: number;
  /** 成本单价（元） */
  costPrice: number;
  /** 是否有套包内免费额度 */
  hasFreeQuota: boolean;
  /** 免费额度（如 30 米内免费） */
  freeQuota: number;
}

/** 品牌结算价（cp_brand_prices，v7 brandPrices 承接 30 条） */
export interface BrandPrice {
  /** 品牌名（v7 按品牌名管理） */
  brand: string;
  /** 20 米套包安装结算价（元/台） */
  install20m: number;
  /** 30 米套包安装结算价（元/台） */
  install30m: number;
  /** 维修结算价（元/台） */
  repairSettlement: number;
}

/** 桩库存（cp_inventory，v7 inventory 承接；total 允许负数=超发挂账） */
export interface StockItem {
  /** 品牌名（v7 按品牌名管理） */
  brand: string;
  total: number;
}

/** 安装模板（cp_material_templates，v7 templates 承接 4 套） */
export interface MaterialTemplate {
  id: string;
  /** 适用品牌名（v7 按品牌名管理） */
  brand: string;
  name: string;
  /** 材料名列表（与 MaterialItemLib.name 对应） */
  items: string[];
}

/** 成本价目（cp_cost_sheet，v7 costSheet 承接 37 条） */
export interface CostSheetItem {
  id: string;
  name: string;
  unit: string;
  costPrice: number;
}

/** 平台配置（cp_platforms，v7 platforms 13 平台 ∪ platformDeductions 11 扣点合并） */
export interface PlatformConfig {
  /** 平台名称全称（与 Order.platform 对应） */
  name: string;
  /** 扣点百分比，0-100（10 = 10%） */
  deductionPercent: number;
}

/** 材料领用记录（cp_material_usage，v7 materialUsage 承接 21 条） */
export interface MaterialUsageRecord {
  id: string;
  /** 领用日期，YYYY-MM-DD */
  date: string;
  name: string;
  unit: string;
  costPrice: number;
  quantity: number;
  /** 金额合计（元）= costPrice × quantity */
  total: number;
}
