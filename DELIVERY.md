# DELIVERY.md — v32.2 任务包：补桩全链路恢复 + 水印格式 + 已预约角标 + 师傅带入 + 首页按钮口径A

- 任务：任务包v32.2 五条（一补桩恢复 / 二水印格式 / 三已预约角标 / 四师傅带入 / 五首页按钮+口径A）
- 版本：v32.2 ｜ commit：见 git log 最新一条（上一节点 2f8cacc v33；本轮基于含 v32.1 全部内容的 v33 增量）
- 交付时间：2026-07-21
- 施工模式：集群四线——总管兼 3号线（根因定案+逻辑层修正+契约），1号线（OrderCard 页面化+TabBar）/2号线（口径A+师傅带入+已预约承接）/4号线（水印文案）并行，总管收口质检

## 根因定案（任务一/四，diff 定位）

- **任务一·补桩标签消失**：双根因。①v31 首判机制为一次性（cp_restock_evaluated 标记），恢复出厂管道（importV7Backup 逐键覆盖）不经清空函数，标记残留 → 老设备恢复出厂后首判不重跑、全单无标记；②v7 承接库存有负数超发挂账（五菱 -4/长城 -1/比亚迪 -1），v31 库存判定 `===0` 漏判负库存 → 生产口径（mergeBrands 解析品牌名后）五菱单不挂标。v32 的零跑守卫/清洗 effect 经 diff 自证对非零跑零触碰。
- **任务四·师傅不带入**：预约弹窗读 `settings.defaultInstaller`（人员默认区，空），用户配的是「工程师信息」`engineerName`——字段错位。

## 改动文件清单（改 10 + 新 0，零越界已核验：parser/statistics/finance/migrate 与 v33 逐字节一致；index.css/types 零改动）

| 线 | 文件 | 改动要点 |
|---|---|---|
| 3号线·总管 | `src/lib/restock.ts` | 补桩守卫修正：库存判定 `===0`→`<=0`（负库存超发=更缺货必须挂标；库存>0 不挂原口径不变） |
| 3号线·总管 | `src/lib/storage.ts` | importV7Backup 重置首判标记（write restockEvaluated=false，恢复出厂后挂载首判重跑全判）；清空区同步补 removeItem（清空按钮场景双保险） |
| 3号线·总管 | `src/lib/watermark.ts` | 默认模板=`{平台}{品牌}＋4个半角空格＋{姓名}`；buildWatermarkName 四参（+brand）；旧模板无{品牌}按旧渲染不受影响 |
| 1号线 | `src/components/order/OrderCard.tsx` | 页面化渲染（新 prop page="home"|"appointment"）：home=主[预约]（全单型统一）+⋯菜单只收[查看原文/删除]、无水印名；appointment=主[登记勘测]+次[登记完工]+[水印名]（新四参）+⋯菜单 v32 现状；电话/导航/五标签/原文弹窗全保留 |
| 1号线 | `src/components/common/TabBar.tsx` | 已预约 tab 角标=Appointed 单数（tab-bar__badge 与首页同款，0 单不显示） |
| 2号线 | `src/pages/HomePage.tsx` | 口径A：homePool（Pending+Surveyed）单源驱动 todoCount/areaClusters/filtered 底池三处（已预约单不进首页任何列表与计数）；OrderCard 传 page="home" 并摘除 onSurvey/onComplete |
| 2号线 | `src/pages/AppointmentPage.tsx` | 三处 OrderCard 传 page="appointment"+onSurvey（新增 SurveyModal 承接挂载）+onComplete——接得住[登记勘测][完工][水印名] |
| 2号线 | `src/components/AppointmentFormDialog.tsx` + `BatchAppointmentDialog.tsx` | 师傅带入=defaultInstaller \|\| engineerName \|\| ""（回退链，可手改，未配=空+placeholder）；批量预约弹窗同款 bug 同口径修复 |
| 4号线 | `src/components/settings/WatermarkSection.tsx` | 文案三变量口径：{平台}{品牌}{姓名}，默认「{平台}{品牌}连写＋4空格＋{姓名}（例：京东零跑    张三）」，旧模板无{品牌}不受影响（仅 3 行文案） |

## 自测结果（node+esbuild 直跑 lib 真实恢复出厂管道，共 58 PASS / 0 FAIL）

```
══ 任务一·补桩四环（生产口径模拟）══
PASS | 老设备现场还原：预置首判标记=true → 恢复出厂后标记重置=false（首判重跑）
PASS | 环1挂标：吉利安装单全挂（库存无记录=0）；五菱36安装单全挂（生产口径库存=-4≤0）；
       零跑16单全部仅上门不误挂；needed=115/仅上门=15
PASS | 环2互转：需补桩⇄已补桩双向
PASS | 环3汇总：发货单含吉利/五菱、不含零跑仅上门、条数=挂标数、文本生成正确
PASS | 环4完工：吉利完工库存-1（2→1）；零跑仅上门完工库存不变（2→2）
══ 任务二·水印新格式 ══
PASS | 默认模板={平台}{品牌}+4×0x20+{姓名}；渲染「京东零跑    张三」逐字符（恰4空格）
PASS | 自定义含{品牌}模板渲染；旧模板无{品牌}按旧渲染不受影响；空品牌不伪造
══ 任务三/四/五（代理自验+联调）══
PASS | TabBar appointedCount 角标（恢复出厂=3，0单不显示）
PASS | 师傅回退链两处（defaultInstaller||engineerName||""）
PASS | OrderCard page 三分支；home ⋯菜单两项；appointment 三按钮+水印名四参
PASS | 口径A：homePool 三处同源（todoCount/聚类/底池），首页=9、片区全部=9、已预约3单不出现
══ 回归基线（34项）══
PASS | 143=待办9/已预约3(种子逐字)/完成125/回收站6；材料572/结算价30/工程师谢责强15395147568
PASS | 5月55/15692/9897/17097.2/6512.4；6月50/13110/11142/13715.1/8308.5
PASS | 7月20(装13/修4/勘3)/4390/8700/6439.6/对账6570.40/实际5780.40；原140单一单未动
```

工程级：`tsc --noEmit` 0 错误（1号线 prop × 2号线传参联调过）；`vite build` 通过（PWA 11 entries）；三线代理 esbuild 自验全过（4号线含 4×0x20 字节级核验）。

## 使用说明（师傅版）

1. 补桩标回来了：吉利、五菱这些牌子库存没了（含超发欠货）的安装单照样挂「需补桩」，照优点按互转、照进一键补桩；零跑不写"带桩上门"的还是「仅上门安装」。
2. 水印名升级：点「水印名」复制的是「京东零跑    张三」（平台品牌连写+4个空格+姓名），贴水印相机正好；设置页模板多了个 {品牌} 变量。
3. 底部「已预约」有数字角标了，几个待上门一眼看到。
4. 预约弹窗的师傅自动带你的名字（工程师信息里配的那个），可改。
5. 首页清净了：卡上就一个「预约」按钮，电话导航图标照旧；登记勘测、完工挪到「已预约」页去点，水印名也在那边。

---

# DELIVERY.md 追加 — v32.3 返工：FAIL-1 恢复出厂回默认 + FAIL-2 完工话术入口恢复 + 顺手修补桩计数口径

- 版本：v32.3 ｜ commit：见 git log 最新一条（上一节点 5b0863b v32.2）｜ 交付时间：2026-07-21
- 施工模式：单代理返修（禁越界）

## 改动清单（改 4 + 新 0；parser/statistics/finance/migrate 与 v32.2 逐字节一致）

| 项 | 文件 | 改动要点 |
|---|---|---|
| FAIL-1 | `src/lib/storage.ts` | importV7Backup 补清 watermarkTemplates + leapmotorAddons（导入管道不经 clearAllData，恢复出厂后残留用户改价；清后回默认：水印回默认格式、增项回默认 36 条；水印键同类隐患顺带同修） |
| FAIL-2 | `src/components/order/OrderCard.tsx` + `src/pages/CompletedPage.tsx` | page 扩三分化："completed" 分支⋯菜单=[勘测话术][完工话术]（无快照灰显 disabled）+[查看原文]，footer 删除保留；首页 home 分支一字未动（仍只有[预约]）；CompletedPage 传 page="completed" |
| 顺手修 | `src/components/RestockDialog.tsx` | 弹窗纳入口径剔回收站（status!==Trash），与首页入口计数（activeOrders 口径）同源一致 |

## 自测结果（22 PASS / 0 FAIL）

```
PASS | FAIL-1：leap-26 改价 501 → 恢复出厂 → 回默认 500/36 条；水印模板顺带同回默认
PASS | 顺手修：回收站挂标=5（与监理 116-111 差数吻合）；剔后弹窗纳入=首页计数口径一致
PASS | FAIL-2：completed 分支含[勘测话术][完工话术][查看原文]、无编辑/取消、ScriptDialog 场景正确、CompletedPage 传 page
PASS | 永恒回归：143(9/3/125/6) / 7月20单/实际5780.40 / 片区chip=7 / 材料572/结算价30/工程师谢责强15395147568
PASS | 锁定四文件逐字节一致（v32.2 基准 diff）
```

工程级：`tsc --noEmit` 0 错误；`vite build` 通过（PWA 11 entries）。
