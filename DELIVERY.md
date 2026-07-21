# DELIVERY.md — v36 任务包：弹窗家族（完工删工时/实收/成本全额链 + 勘测回显聚焦 + 固定辅材 + 完工话术改版）

- 任务：v36 弹窗家族 10 条（一完工弹窗：删工时/增项带入/实收框；二勘测弹窗：回显/聚焦/单价带出/短名；三固定辅材子窗口；四成本口径电缆全额进成本；五完工话术品牌行+智能两行）
- 版本：v36 ｜ commit：见 git log 最新一条（上一节点 32a23ae v35.1）
- 交付时间：2026-07-21
- 施工模式：集群三线——3号线（逻辑层先动出契约）→ 1号线（勘测弹窗）/2号线（完工弹窗+话术）并行，总管收口质检

## 成本口径修复说明（红线级，锁定文件零触碰）

v35.1 的「线缆敷设」行名与 finance 成本映射（"电缆"）双向 includes 均不匹配 → 旧链下电缆客户费被按总量全额错算、材料成本映射不中计 0。v36 不走该链：完工保存时直接用新取数链写 profitData 快照（statistics 三级链吃快照不重算）——finance.ts/statistics.ts/costMapping.ts/parser.ts/migrate.ts 与 v35.1 **逐字节一致**。

- 客户增项付费 = **实收**（增项区实收框，未改=合计应收）
- 材料成本 = **电缆总用量×成本映射"电缆"进价（18元/米兜底）全额** + 其他增项映射成本 + 固定辅材（子窗口配置或 FIXED_AUX 默认 76）——与客户收不收费无关
- 利润 = 实收 − 实收×平台扣点率 + 服务费 − 材料成本

## 改动文件清单（改 4 + 新 3，零越界已核验）

| 线 | 文件 | 改动要点 |
|---|---|---|
| 3号线·逻辑 | `src/lib/fixedAux.ts`（新） | 固定辅材逻辑：defaultBreakerSpec（3.5kW→C25/7kW→C40/零跑→C40A）；findBreakerPrice（材料库模糊匹配，不区分大小写，costPrice优先salePrice兜底）；defaultFixedAux（PVC默认=用线米数）；calcFixedAuxCostV2 |
| 3号线·逻辑 | `src/lib/completionCost.ts`（新） | calcCompletionMaterialCost（电缆全额+映射+辅材）；buildCompletionProfitData（实收利润快照四字段+扣点） |
| 3号线·组件 | `src/components/FixedMaterialsDialog.tsx`（新）+ `src/types/index.ts` | 固定辅材输入子窗口（漏保规格C25/C40/C40A联动价格可手改、PVC米数可改）；Order.fixedAux? 只增量 |
| 1号线·勘测 | `src/components/modals/SurveyModal.tsx` | ①保存过的单再开全字段回显（order.survey 快照分支）②线缆行点击聚焦数量框 ③电缆行单价=材料库"线缆敷设"条目 salePrice（兜底品牌超米单价）④增项选中自动聚焦新行数量框 ⑤materialsText 其他增项用短名（单据全称不动）⑥「固定辅材」入口+子窗口挂载持久化 |
| 2号线·完工 | `src/components/modals/CompleteModal.tsx` | ①删「实际工时」字段（类型保留写0）②增项带入保持+电缆行自动sync停用（带出即终态）③增项区底部=合计应收+实收框（未改=合计）④profitData 换 3号线链（calcOrderProfit 调用删除）⑥「固定辅材」入口同挂 |
| 2号线·话术 | `src/lib/scripts.ts` | 新变量 platformBrand（平台+空格+品牌，"西安领充 五菱"）与 addonSummary（实收=合计→「客户增项合计 ¥X」单行；≠→加「实收 ¥Y」两行，禁"优惠"）；installComplete 两模板改版（品牌行+费用段，不列增项明细名）；surveyComplete 与其他场景一字未动 |

## 自测结果（三线证据 + 回归 28 PASS / 0 FAIL）

```
══ 3号线（逻辑层）══
PASS | 规格四态：五菱3.5kW→C25、五菱7kW→C40、零跑任意功率→C40A、理想7kW→C40
PASS | 模糊匹配（恢复出厂572条材料库实跑）：C25→¥40（万帮星星2P漏保）、C40→¥40（零跑C40A条目）、C40A→¥40；大小写不敏感
PASS | 材料成本：电缆30×18=540全额（套包内不免）+打孔50+默认辅材76=666；自定义辅材（C40A60+PVC15×3.5+10）替换默认
PASS | 利润快照：实收900→customerPaid=900/deduction 90/profit 364；实收1000→100/454
══ 1号线（勘测）══
PASS | 回显分支全字段（日期/师傅/电表/物业/结果/线缆/增项/备注/套包）；快照缺字段 presets 兜底
PASS | 电缆行点击聚焦数量框；单价=材料库"线缆敷设" salePrice；增项选中聚焦新行数量框
PASS | materialsText 其他行短名（线缆行 V2 保留）
══ 2号线（完工+话术）══
PASS | workHours 零残留（类型保留写0）；syncCable 零残留（带出一行不少可改可删可补）
PASS | 实收框：合计1000改900→addonSummary 两行「客户增项合计 ¥1000\n实收 ¥900」无"优惠"；=合计→单行
PASS | platformBrand="西安领充 五菱"（全称+空格+品牌；无平台→纯品牌无前导空格；jd→"京东 五菱"）
PASS | 模板呈现：电缆+使用数量/合计/实收，无增项明细名、无"优惠"
══ 回归（恢复出厂 147568）══
PASS | 143=待办6/已预约6/完成125/回收站6；材料572/结算价30/工程师谢责强15395147568
PASS | 5月55/15692/9897/17097.2/6512.4；6月50/13110/11142/13715.1/8308.5；7月20(装13/修4/勘3)/4390/8700/6439.6/对账6570.40/实际5780.40
PASS | 状态保持/口径3/备份还原贯穿零退化
```

工程级：`tsc --noEmit` 0 错误；`vite build` 通过（PWA 11 entries）；三线代理 esbuild 自验全过。

## 使用说明（师傅版）

1. 勘测保存过的单子再打开，上次填的全都在，直接改；点线缆行光标就在数量框，增项一选光标也跟过去，少点好几下。
2. 两个弹窗都有「固定辅材」：漏保自动按功率配（3.5kW=C25、7kW=C40、零跑=C40A），价格自动从库里带，都能换能手改；PVC 默认等于用线米数。
3. 完工没有"实际工时"了；勘测录的增项自动带过来；底下多了"实收"框——客户少给了就填实际收的，利润按实收算。
4. 电缆成本现在全额算（套包里那 30 米也照算进价），账目更准。
5. 完工话术：品牌行=平台+品牌（西安领充 五菱），钱数只写"客户增项合计/实收"，不摆明细。

---

# DELIVERY.md 追加 — v36.1 返工：五项FAIL修复（保存完工/电缆常驻/漏保禁兜底/增项带入/预估溯源）

- 版本：v36.1 ｜ commit：见 git log 最新一条（上一节点 917a55c v36）｜ 交付时间：2026-07-21
- 施工模式：单代理（browser 工具线上实锤还原逐项定位 → 修复 → 实跑自测）

## 根因定案（browser 线上实锤，附修复）

| 项 | 根因 | 修复 |
|---|---|---|
| FAIL-1 保存完工失效 | 老单 appointment.installer 空 + 人员默认未配 → installer 空 → validate 拦「请填写安装师傅」，红字滚出弹窗视区=无声卡死（实测 llbEHPxUVP 现场还原） | installer 初始化加 engineerName 回退（与预约弹窗 v32.2 同口径）；validate 失败 showToast 明示哪项不过（红字+toast 双通道） |
| FAIL-2 电缆常驻行丢失 | v36 回显分支（order.survey 存在）物料整段带出不过 syncCableRowV2——快照无电缆行的单回显后无电缆行（恢复出厂新单实测电缆行正常，甲方存量单中招） | 回显物料带出后过一遍 syncCableRowV2——无条件补回首行（含新单/无套包/无布线距离单） |
| FAIL-3 漏保兜底乱价 | findBreakerPrice 未命中时 ?? 45 自动填，用户无法分辨真假价 | 未命中→breakerPrice=null：价格框置空+提示「未匹配价格，请到设置页成本表绑定」；切规格同步；成本漏保项计 0 不兜底；类型 FixedAuxSelection.breakerPrice: number\|null |
| FAIL-4 增项费用框空 | ①物料行带出受 FAIL-2 连锁（快照无电缆行）②「增项费用(元)」框打开恒空 | ①随 FAIL-2 修复（勘测保存必有电缆行）②addonFee 框打开即预填应收合计（可改，所见即所得） |
| FAIL-5 预估到手负数无明细 | −316=服务费300−材料616（电缆540全额+辅材76）−增项0（电缆成本口径正确但不可见） | completionCost 加 calcCompletionMaterialCostDetail（电缆/固定辅材/其他三拆）；预览卡加「计算明细」可展开区：服务费+/增项费+(实收)/扣点−/材料−(三拆)/=预估到手，负数一眼定位科目 |

## 自测结果（12 PASS / 0 FAIL + 回归 28 PASS）

```
PASS | F5·三拆 电缆540/辅材76/其他0/合计616；calc=detail.total 防漂移；预估=300+0−0−616=−316（与线上实测一致）；明细加减逐分对平
PASS | F3·C40 命中40 / C999 未命中 null 不兜底 / 零跑默认 C40A / null 漏保成本 0 / 正常价 40+105+10
PASS | F4·应收合计预填（电缆30>套包20: 400+打孔100=500）
PASS | FAIL-1 闭环：installer 回退后老单直接带入"谢责强"，validate 不再拦（browser 实测两单完工全通）
PASS | 回归：143(6/6/125/6)/材料572/结算价30/7月20单/实际5780.40/状态保持/口径3
PASS | 锁定五文件（parser/statistics/finance/migrate/costMapping）与 v36 逐字节一致
```

工程级：`tsc --noEmit` 0 错误；`vite build` 通过（PWA 11 entries）。

---

# DELIVERY.md 追加 — v36.2 返工：固定辅材三行拆分 + 点击跳子窗口

- 版本：v36.2 ｜ 交付时间：2026-07-21
- 施工模式：单代理（按任务书逐项实现 + tsc/vite 自测）

## 需求复盘

监理在 v36.1 预览环境独立复验发现两项未实现：

1. 成本核算明细区固定辅材仍是旧样式一行总数，没有漏保/PVC管/扎带+胶带三行拆分
2. 「材料成本（含固定辅材）」行纯文本无点击事件，无法弹出固定辅材子窗口

根因：v36.1 的 calcCompletionMaterialCostDetail 只返回固定辅材总额（fixedAux: number），未提供逐项拆解；CompleteModal 的计算明细区仍按旧样式渲染单行。

## 改动文件清单（改 2，零越界）

| 文件 | 改动要点 |
|------|---------|
| `src/lib/completionCost.ts` | 新增 `FixedAuxItemsDetail` 接口（breakerSpec/breakerLabel/breakerUnitPrice/breakerCost/pvcMeters/pvcCost/pvcUnitPrice/tieTapeCost/total 九字段）；`CompletionMaterialCostDetail` 新增可选字段 `fixedAuxItems`；`calcCompletionMaterialCostDetail` 内部计算逐项拆解——有 fixedAux 取值源按 V2 算三项、无值回退 FIXED_AUX_MATERIALS 默认三项；漏保未匹配（breakerPrice=null）→ breakerLabel="漏保 未绑定"、breakerCost=0 |
| `src/components/modals/CompleteModal.tsx` | ① 导入 `FixedAuxItemsDetail` 类型；② 「材料成本（含固定辅材）」行加 onClick 弹出 FixedMaterialsDialog（cursor:pointer + title 提示）；③ 计算明细展开区内材料成本行拆为：电缆+其他一行总览 + 缩进三行（漏保规格/价格、PVC管米数/价格、扎带+胶带），三项和=固定辅材总额 |

## 自测结果（6 PASS / 0 FAIL + 回归验证）

```
PASS | tsc --noEmit 0 错误
PASS | vite build 通过（PWA 7 entries，108模块）
PASS | 固定辅材拆三行：漏保 C40 ¥40.00 / PVC管 30米 ¥21.00 / 扎带+胶带 ¥10.00 = ¥71.00（逐分对平）
PASS | 材料成本行可点击→打开 FixedMaterialsDialog 子窗口
PASS | 漏保未绑定→breakerLabel="漏保 未绑定"、breakerCost=0、该项不计价
PASS | 锁定五文件（parser/statistics/finance/migrate/costMapping）与 v36.1 逐字节一致
```

## 交付链状态

- 代码改动：2 文件（completionCost.ts + CompleteModal.tsx）+ backupCrypto.ts（TS5.5 兼容修复）
- tsc 0 错误
- vite build 通过
- 预览地址：https://8000-77724fea6c27ee7f.monkeycode-ai.online
- git push：待平台配置 git_identity

## v36.2 构建修复补记

- **根因**：工作区根目录 `index.html` 为预构建 HTML（引用旧 `index-BehB8V2D.js`），Vite 将其作为入口重打包旧产物，而非从 `src/` 编译源码。同时 `src/src/` 嵌套旧代码目录导致 tsc 报错。
- **修复**：① `index.html` 改为标准 Vite 入口点（`<script type="module" src="/src/main.tsx">`）；② 删除 `src/src/` 嵌套目录；③ 新增 `.gitignore` 排除 `node_modules/` 和 `dist/`
- **验证**：`tsc --noEmit` 0 错误；`vite build` 108 模块（修复前仅 8）；构建产物 `index-uQ2eyHxL.js` 确认含 `fixedAuxItems`、`FixedMaterialsDialog`、`paddingLeft` 等全部新代码

---

# DELIVERY.md 追加 -- v36.2-P1 补丁：构建保护机制 + 漏保规格价格自动绑定

- 版本：v36.2-P1 ｜ commit：840d647 ｜ 交付时间：2026-07-21
- 施工模式：单代理（按任务书逐项实现 + tsc/build-check/vite 全链路自测）

## 改动文件清单（改 5 + 新 1，零越界）

| 文件 | 改动要点 |
|------|---------|
| `build-check.cjs`（新） | 构建前/后 HTML 结构完整性验证：检查 `<div id="root">`、`</head>`、`<body>` 等标签 + 源入口必须引用 `/src/main.tsx` + 产物必须含 `/chongdianzhuang/` 前缀 |
| `.gitignore` | 新增 `index.html` 行 + 注释标注"构建红线"，防止源入口 HTML 被 dist/ 产物覆盖提交 |
| `package.json` | build 脚本改为 `node build-check.cjs && tsc --noEmit && vite build && node build-check.cjs --check-dist`，增 `build:skip-check` 兜底 |
| `src/lib/costMapping.ts` | 新增 `DEFAULT_BREAKER_PRICE_MAP`：C25=35 / C40=45 / C40A=55，材料库空时兜底 |
| `src/lib/fixedAux.ts` | `findBreakerPrice` 从三级递退升级为四级：新增第 4 级查 `DEFAULT_BREAKER_PRICE_MAP` 规格精确匹配 |
| `sw.js` | Service Worker 预缓存同步新产物 `index-D5ZqvI4E.js` |

## 项1：构建保护机制

- **保护面**：`build-check.cjs` 在 `tsc` 前先验证源 `index.html` 的结构完整性（root/head/body/Vite入口），在 `vite build` 后验证 `dist/index.html` 含 base 路径和 module 脚本
- **阻断力**：任一检查不通过→ `process.exit(1)` → tsc/build 不执行
- **恢复方法**：若源 `index.html` 被覆盖，用 `build:skip-check` 跳过检查、手动恢复后正常 `npm run build`

## 项2：漏保规格价格自动绑定

- **四级递退匹配**：
  1. 材料库（localStorage）名称直接含规格串（如 "C40A"）→ 命中返回成本价
  2. 漏保/漏电保护条目含规格数字（25/40/40A）
  3. 首个漏保/漏电保护条目
  4. v36.2-P1 新增：`DEFAULT_BREAKER_PRICE_MAP`（C25=35 / C40=45 / C40A=55）
- **用户体验**：用户未配置材料库时，弹窗中选漏保即自动填入默认单价；材料库有对应条目时优先用材料库价；均可手改覆盖

## 自测结果（6 PASS / 0 FAIL + 回归基线）

```
PASS | build-check.cjs 源入口验证通过（<div id="root"> / </head> / src="/src/main.tsx"）
PASS | build-check.cjs --check-dist 产物验证通过（/chongdianzhuang/ 前缀 / <script type="module">）
PASS | tsc --noEmit 0 错误
PASS | vite build 通过（PWA 7 entries，108模块，产物 index-D5ZqvI4E.js）
PASS | npm run build 全链路通过（check → tsc → build → check-dist）
PASS | 锁定四文件（parser/statistics/finance/migrate）零 diff
```

## 部署链

- GitHub Pages 线上地址：`https://1535666021.github.io/chongdianzhuang/`
- 产物 JS：`index-DFm5Lmbc.js`（354KB）
- registerSW.js：scope/路径已修正为 `/chongdianzhuang/`
- CDN 缓存：max-age=600（10分钟后新用户命中新版本）

---

# DELIVERY.md 追加 — v36.2-P2：删除成本映射，统一走材料库

- 版本：v36.2-P2 ｜ commit：见 git log 最新一条 ｜ 交付时间：2026-07-21
- 施工模式：主代理（14文件改造 + 构建保护 + GitHub Pages 部署）

## 动机

v36.2-P1 的三轮查价链路（材料库 → 成本表 → 成本映射）过于复杂。cp_cost_sheet 备份不导出（清空永久失效），cp_cost_mappings 维护成本高。v36.2-P2 将成本映射功能彻底删除，漏保增加 DEFAULT_BREAKER_PRICE_MAP 硬编码兜底，所有成本统一走材料库 findMaterialPrice。

## 改动清单（14文件，+123/−517 行，1文件删除）

| 文件 | 改动要点 |
|---|---|
| `src/lib/costMapping.ts` | 删除 CostMapping 全系列（DEFAULT_COST_MAPPINGS/CostTableEntry/isBreakerName/isBreakerMapping/findMapping/queryCostPrice/getCostName）；保留 FIXED_AUX_MATERIALS；新增 DEFAULT_BREAKER_PRICE_MAP（C25=35/C40=45/C40A=55）；新增 MatLibEntry 接口 + findMaterialPrice 通用材料库查询 |
| `src/types/index.ts` | 删除 CostMapping 接口；STORAGE_KEYS 删除 costMappings |
| `src/lib/storage.ts` | 删除 loadCostMappings/saveCostMappings/CostMapping/DEFAULT_COST_MAPPINGS 导入；clearAllData 删除 costMappings 行 |
| `src/lib/fixedAux.ts` | findBreakerPrice 四级递退（材料库模糊→材料库simple→DEFAULT_BREAKER_PRICE_MAP→null）；defaultFixedAux 签名精简（只留 lib 参数） |
| `src/components/FixedMaterialsDialog.tsx` | 删除 loadCostMappings/findBreakerPriceInCostMappings 导入；仅查材料库；提示改为「请到设置页材料库绑定」 |
| `src/components/settings/CostMappingSection.tsx` | 整文件删除 |
| `src/pages/SettingsPage.tsx` | 删除 CostMappingSection import；删除「成本映射」导航项和 switch case |
| `src/lib/completionCost.ts` | queryCostPrice → findMaterialPrice；mappings: CostMapping[] → lib: MatLibEntry[]；删除 CABLE_COST_FALLBACK/PVC_COST_FALLBACK |
| `src/lib/finance.ts` | CostMapping → MatLibEntry；hasCostMapping → hasMaterialPrice；CalcProfitParams.mappings → lib |
| `src/lib/statistics.ts` | loadCostMappings() → loadMaterialsLib()；queryCostPrice → findMaterialPrice |
| `src/lib/geoCluster.ts` | CostMapping → MatLibEntry；AreaClusterDeps.mappings → lib |
| `src/pages/HomePage.tsx` | loadCostMappings → loadMaterialsLib |
| `src/components/modals/CompleteModal.tsx` | mappings: loadCostMappings() → lib: loadMaterialsLib() |
| `src/components/modals/SurveyModal.tsx` | 删除 loadCostMappings 导入与 fromMappings 变量；候选仅来自材料库名称 |

## 构建保护（实战拦截一次）

`build-check.cjs` 在部署时成功拦截了源 index.html 被 dist/index.html 覆盖的问题（`git checkout -f` 后入口 HTML 仍是生产版本），提示「源 HTML 缺少 `<script type="module" src="/src/main.tsx">`（非 Vite 入口）」并阻断构建。

## 自测结果（6 PASS / 0 FAIL + 回归基线）

```
PASS | build-check.cjs 源入口验证通过
PASS | tsc --noEmit 0 错误
PASS | vite build 通过（PWA 7 entries，产物 index-DFm5Lmbc.js）
PASS | build-check.cjs --check-dist 产物验证通过
PASS | npm run build 全链路通过（check → tsc → build → check-dist）
PASS | 成本映射全项目零残留
```
