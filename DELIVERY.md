# DELIVERY.md — v31 任务U：补桩体系 + 订单卡五标签 + 全局弹窗统一

- 任务：任务U 六模块（A订单卡标签重排 / B充电桩仓库 / C补桩状态机 / D一键补桩 / E原文弹窗 / F全局弹窗统一）
- 版本：v31 ｜ commit：见 git log 最新一条
- 交付时间：2026-07-20
- 历史交付：v30.1 删库重建恢复、v30 片区口径、v29 任务R、v28 任务Q，详见 git 历史

## 改动文件清单（改 7 + 新 3，禁越界已核验：parser.ts / statistics.ts / finance.ts / migrate.ts 与 v30 逐字节一致）

| 文件 | 改动 |
|---|---|
| `src/types/index.ts` | Order 追加 `restockStatus?: "needed" \| "done"`；STORAGE_KEYS 追加 `restockEvaluated`（只增量） |
| `src/lib/storage.ts` | 第十三节：loadRestockEvaluated / saveRestockEvaluated（遗留单一次性首判守卫） |
| `src/lib/restock.ts`（新） | 模块C/D 业务逻辑唯一收敛处：serviceKindOf（与 statistics 同口径）/ isInstallOrder / getPileStock / shouldTagRestock / SERVICE_KIND_LABEL / platformNameOf / buildRestockShipmentText（发货单：X月X日发货明细 + 同平台同品牌同功率合并 N台 + 辅材区可整区不填 + 落款收货地址原样） |
| `src/context/AppContext.tsx` | 契约§4：addOrder/importOrders 新安装单库存=0 自动挂「需补桩」（录入不拦截）；saveCompletion 仅安装单库存-1（维修/勘测不扣桩）；updateRestockStatus / markRestockDone；遗留单挂载时一次性全判（判完存标记，一个不漏） |
| `src/components/settings/StockSection.tsx`（新） | 模块B：设置页「充电桩仓库」——各品牌库存手填（空=0），失焦即存，复用 cp_inventory（getStock/adjustStock） |
| `src/pages/SettingsPage.tsx` | 仅挂载：菜单组「充电桩仓库」+ case "stock" |
| `src/components/RestockDialog.tsx`（新） | 模块D：一键补桩弹窗——全部「需补桩」安装单合并发货单（实时预览），辅材下拉（材料库名称去重）+数量手填可增删，一键复制后 markRestockDone 全翻「已补桩」 |
| `src/pages/HomePage.tsx` | 仅加入口：片区分组区附近「一键补桩 · 需补桩 N 单」入口栏（0 单点击仅提示；回收站视图不显示）+ 弹窗挂载 |
| `src/components/order/OrderCard.tsx` | 模块A 五槽标签排：①平台 ②品牌 ③功率 ④服务类型（仅类型文字，"30米套包"废除出标签排）⑤补桩状态（仅安装单：需补桩⇄已补桩 点击互转走 updateRestockStatus）；模块E 备注小字行可点击→「订单原文」弹窗（originalText 只读 pre-wrap + 复制，空则不可点） |
| `src/index.css` | 模块F：.modal 容器规格统一——max-width min(页宽,100vw)、max-height calc(100dvh−底部导航−安全区)、遮罩溢出隐藏+滚动链阻断（375px 实测不超屏，全弹窗走基座自动生效）；追加 shipment-preview（发货单/原文预览）与 tag--clickable（补桩标签点击态） |

`src/components/common/Modal.tsx` 零改动（基座结构 header/body/footer 本已统一，props 签名未动，全系统十几处调用方无感）。

## 自测结果（node+esbuild 直跑 lib，localStorage stub，共 47 PASS / 0 FAIL）

补桩状态机 + 发货单（30 PASS）：

```
PASS | 服务类型判定：legacyExtra 维修/勘测/安装 + remark 前缀 + 默认，7 口径全对
PASS | 安装单+库存0→需补桩 / 库存2→不挂 / 维修单→不挂 / 已有标记→不再判
PASS | 发货单逐行：行1「7月20日发货明细」行2「京东 理想 7kW 2台」行3「天猫 公牛 11kW 1台」
       行4「辅材：」行5「6平方电缆 30米」行6 落款收货地址原样
PASS | 空名/空数量辅材行不落文本；无辅材无地址两区不出现
PASS | platformNameOf：platform 全称优先 / jd→京东 / other→其他
PASS | adjustStock 复用：新建/累加/允许负数（超发挂账）
```

恢复出厂基线（密码 147568 真实数据，17 PASS）：

```
PASS | 140 单 / 待勘测 9 / 已完成 125 / 回收站 6
PASS | 7月 20单 / 结算4390 / 增项8700 / 材料6439.6 / 对账6570.40 / 实际5780.40
PASS | 5月 55单 / 实际6512.40 ；6月 50单 / 实际8308.50（三个月复核数字零回归）
PASS | 模块C 遗留单实弹：140 无标记单中 127 安装单全判「需补桩」，维修/勘测 0 误挂
```

工程级：`tsc --noEmit` 0 错误 ×2；`vite build` 通过；375px 视口推演 max-width=375px、max-height=611px（667−56−0）不超屏。

## 使用说明（师傅版）

1. 设置页 → 充电桩仓库：填各品牌手头桩数，失焦自动保存。
2. 某品牌库存为 0 时，新进来的安装单自动挂红标签「需补桩」；老单子首次打开 App 时已一次性全部判好。
3. 点「需补桩」⇄「已补桩」可手动互转；首页「一键补桩」→ 核对发货单（可加辅材）→ 一键复制发给供货商，复制后这些单全部自动翻「已补桩」。
4. 订单卡上点备注小字行可看该单原文并复制；完工安装单自动扣 1 台库存。
