# DELIVERY.md — v32 任务包：首页过滤修复 + 零跑补桩规则 + 平台标签手选 + 水印名复制

- 任务：任务包v32 四功能点（〇首页过滤修复 / 一零跑补桩规则 / 二平台标签手选 / 三水印名复制）
- 版本：v32 ｜ commit：见 git log 最新一条（上一节点 d0b6878 v31）
- 交付时间：2026-07-20
- 施工模式：集群 2 线代理并行（1号线订单卡 / 2号线设置页）+ 总管契约与收口；历史交付见 git 历史

## 改动文件清单（改 7 + 新 2，零越界已核验：parser.ts / statistics.ts / finance.ts / migrate.ts 与 v31 逐字节一致）

| 模块 | 文件 | 改动要点（业务逻辑全部收敛 src/lib，视图层只渲染） |
|---|---|---|
| 契约（总管） | `src/types/index.ts` | STORAGE_KEYS 追加 watermarkTemplates="cp_watermark_templates"（只增量） |
| 契约（总管） | `src/lib/storage.ts` | 十四节 load/saveWatermarkTemplates（Record<平台名,模板串>，缺省 {}）；恢复出厂清空区追加该键（恢复出厂回默认模板 ✓） |
| 契约（总管） | `src/lib/watermark.ts`（新） | 水印业务唯一收敛处：DEFAULT_WATERMARK_TEMPLATE="{平台}＋4个半角空格＋{姓名}"；watermarkTemplateFor（未配置/空串→默认）；buildWatermarkName（replaceAll 双变量，空平台不伪造） |
| 功能一（3号逻辑层） | `src/lib/restock.ts` | isLeapmotorOnsiteOnly（品牌名含"零跑" && originalText 不含"带桩上门"）；shouldTagRestock 加零跑守卫（仅上门永不打标）；SERVICE_KIND_LABEL 等 v31 导出未动 |
| 功能〇（4号首页线） | `src/pages/HomePage.tsx` | 首页过滤修复：默认底池=待勘测+已勘测（未预约待办；根因=DEFAULT_ORDER_FILTER.statuses 空数组全放行）；显式点状态迷你条可临时查看他状态；只修过滤逻辑，订单数据与状态机零触碰 |
| 功能一接线（总管） | `src/context/AppContext.tsx` | participatesPileStock（安装单且非零跑仅上门）统一接线 saveCompletion(-1)/deleteOrder(+1)/restoreOrder(-1) 三处对称（完工不扣⇄删除不回库⇄恢复不回扣）；updateOrderPlatform 契约（只写 platform 单字段，originalText 不动）；零跑误标清洗 effect（幂等：凡带 needed/done 的零跑仅上门单挂载时清标，v31 首判误标设备一次清完） |
| 1号线（订单卡） | `src/components/order/OrderCard.tsx` | ①零跑：标签槽⑤最前分支静态「仅上门安装」（不可点）；②平台手选：仅"其他"标签可点（tag--clickable）→Modal 列出平台库全平台→选中 updateOrderPlatform 持久化+toast，非"其他"不可点；③「水印名」次按钮：copyText(buildWatermarkName(watermarkTemplateFor(platform, loadWatermarkTemplates()), platform, customerName)) 与操作区同生死 |
| 2号线（设置页） | `src/components/settings/WatermarkSection.tsx`（新）+ `src/pages/SettingsPage.tsx` | 「水印模板」分区：平台库全平台逐行可配模板（placeholder=默认模板，生效模板实时回显），失焦保存（空串删键回默认），恢复出厂回默认；SettingsPage 仅挂载四处（import/联合类型/菜单项/case） |

`src/index.css` 本轮零改动（tag--clickable/tag--info/btn--outline/rate-row 等全复用）；`Modal.tsx` 零改动。

## 自测结果（node+esbuild 直跑 lib，localStorage stub，共 49 PASS / 0 FAIL）

```
══ 功能三·水印契约（10项）══
PASS | 默认模板={平台}+4个半角空格+{姓名}（逐字符核验，4×0x20）
PASS | buildWatermarkName 默认渲染「京东    张三」逐字符一致
PASS | 自定义模板渲染 / 未配置→默认 / 空串→默认 / 已配置→配置 / 他平台不受影响
PASS | storage 缺省={} / 写读回环
══ 功能一·零跑判定矩阵（10项）══
PASS | 零跑+无原文→仅上门 / 原文无「带桩上门」→仅上门 / 含「带桩上门」→否
PASS | 非零跑(理想)→否（v31一致）/ 品牌名含零跑(零跑汽车)→仅上门
PASS | 仅上门+库存0→不打标 / 带桩上门+库存0→打标 / 带桩上门+库存2→不打标
PASS | 非零跑+库存0→打标（v31一致）/ 勘测单→不打标
══ 功能〇+恢复出厂回归（29项）══
PASS | 恢复出厂(147568) 140单/待勘测9/已完成125/回收站6
PASS | 首页底池=9（与角标 Pending 一致）/ 无已完成混入 / 无已预约混入
PASS | v31误标零跑单清洗模拟→标记清零（基线数据16个零跑单，原始数据无标记，幂等安全）
PASS | 5月55单/结算15692/增项9897/材料17097.2/利润6512.4
PASS | 6月50单/13110/11142/13715.1/8308.5
PASS | 7月20单(装13/修4/勘3)/4390/8700/6439.6/对账6570.40/实际5780.40（双利润不同值正常）
```

工程级：`tsc --noEmit` 0 错误；`vite build` 通过（PWA 11 entries）；两线代理 esbuild 自验全过。

## 使用说明（师傅版）

1. 首页现在只显示待办的单子（待勘测/已勘测待预约）；预约后自动消失去「已预约」页，完工去「已完成」页。想看已完成单，点首页数字条的「已完成」可临时查看。
2. 零跑的单子：原文没写"带桩上门"的，卡片上显示「仅上门安装」，不算补桩、不进发货单、完工不扣库存；写了"带桩上门"的照旧「需补桩」。
3. 平台显示"其他"的单子：点那个标签→选正确平台→以后水印、发货单都按新平台走。
4. 点订单卡「水印名」→ 自动复制「平台    姓名」（中间4个空格），直接贴进水印相机。模板不对？设置页→水印模板，按平台改，留空回默认。
