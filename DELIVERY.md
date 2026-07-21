# DELIVERY.md — v35 任务包：套包账目逻辑 + 外发文本预览总规矩

- 任务：v35 两大块（一套包账目逻辑：识别/手填/超出自动算/增项自动带/话术只摆超出；二外发文本预览+可编辑总规矩：五类文本复制前先预览可编辑）
- 版本：v35 ｜ commit：见 git log 最新一条（上一节点 1180364 v32.4）
- 交付时间：2026-07-21
- 施工模式：集群三线——1号线（总管）先落冻结契约（lib/scripts/types/预览组件），2号线（勘测+完工弹窗）、3号线（预览接入三处）并行，2号线补充任务（materialsText 换格式+预估清单接预览）串行补给，总管收口质检（tsc 打回 1 次复验过）

## 改动文件清单（改 7 + 新 2，零越界已核验：parser/statistics/finance/migrate 与 v32.4 逐字节一致；types/storage/AppContext 零改动——复用 Order.packageMeters 既有字段）

| 线 | 文件 | 改动要点 |
|---|---|---|
| 1号线·逻辑 | `src/lib/packageMeters.ts`（新） | 套包业务唯一收敛处：parsePackageMetersFromText（7 模式识别：套包米数:30米/30米套包/30米套餐/套包30米/含40米线/免费30米/30米免费）；resolveOrderPackageMeters（持久化→识别→null）；getOverMeters（超出=布线-套包，≤0=0）；syncCableAddonRow（v29 同语义 v35 行名「线缆敷设」，超出自动入行/重算覆盖/≤0 移除/他行保留）；buildCableOverFeeText（`布线X米，超出套餐Y米×¥单价=¥Z`） |
| 1号线·话术 | `src/lib/scripts.ts` | buildAddonItemsText 加 cable 可选参（线缆敷设行输出 v35 格式，他行/无参原格式兼容）；buildScriptVars 套包取数链=extras ?? resolveOrderPackageMeters(order) ?? 30；默认模板 lixiang 两段改 v35 格式（恢复出厂/新设备生效；老用户存档模板按 v28 合并机制保留原文） |
| 1号线·组件 | `src/components/TextPreviewDialog.tsx`（新）+ `index.css` | 外发文本统一预览编辑器（open/title/text/onClose/onCopy(edited)，每次打开重置草稿）；text-preview-editor 样式（全 CSS 变量） |
| 2号线·勘测 | `src/components/modals/SurveyModal.tsx` | 「套包米数」字段（打开预填=持久化值→原文识别→空；保存时 updateOrder 持久化，非法不拦截）；布线距离变更/初始化时 syncCableAddonRow 联动（单价=品牌 overMeterPrice 缺省 45）；materialsText 与预估清单的线缆行换 v35 格式；预估清单接 TextPreviewDialog（复制前预览可编辑） |
| 2号线·完工 | `src/components/modals/CompleteModal.tsx` | syncOverFeeRow→syncCableAddonRow 换芯（套包=resolveOrderPackageMeters ?? 品牌费率；打开时识别值写回持久化）；materialsText 线缆行换 v35 格式；界面文案对齐「线缆敷设行」 |
| 3号线·话术预览 | `src/components/ScriptDialog.tsx` | 话术文本区只读→受控可编辑 textarea（text-preview-editor），复制取编辑后值 |
| 3号线·发货单 | `src/components/RestockDialog.tsx` | 预览 pre 只读→textarea 可编辑（previewText+dirty 标记：未手改随计算值同步，手改不覆盖）；复制取编辑后值 |
| 3号线·订单卡 | `src/components/order/OrderCard.tsx` | 水印名按钮（已预约页）点击直复制→弹 TextPreviewDialog 预览可编辑再复制；勘测信息行尾追加「· 套包{N}米」（order.packageMeters 有值时，师傅视角） |

## 自测结果（node+esbuild 直跑 lib，共 60 PASS / 0 FAIL）

```
══ v35 契约层（24+7 项）══
PASS | 识别 9 模式：套包米数:30米 / 30米套包 / 30米套餐+3.5kw / 含40米线 / 免费30米 / 30米免费 / 套包40米 / 无信息→null / 真实v7原文多字段混合
PASS | 取数链：持久化优先 / 识别兜底 / 都无→null；种子单原文端到端识别=30
PASS | 超出：套包30布线33→3 / 布线25→0 / 未填→0
PASS | 增项行：超出3×¥40自动入行 / =0不生成 / 他行保留 / 改米数重算覆盖 / 缩到套包内行消失
PASS | 话术格式逐字「布线33米，超出套餐3米×¥40=¥120」；materialsText/addonItems 透传同格式；overFee=120 与行单价 40 口径一致
PASS | 渲染 default 模板：含 v35 逐字行、无套包内明细（无 YJV/线缆明细残留）
══ 回归基线（v32.4 全量 28 项）══
PASS | 143=待办6/已预约6(种子逐字)/完成125/回收站6（v34口径）；材料572/结算价30/工程师谢责强15395147568
PASS | 5月55/15692/9897/17097.2/6512.4；6月50/13110/11142/13715.1/8308.5；7月20(装13/修4/勘3)/4390/8700/6439.6/对账6570.40/实际5780.40
PASS | 状态保持/口径3/完工链路/备份还原贯穿（v32.4 功能零退化）
```

工程级：`tsc --noEmit` 0 错误（初查 2 处 TS2345 打回 2号线返修，复验 0）；`vite build` 通过（PWA 11 entries）；三线代理 esbuild 自验全过。

## 使用说明（师傅版）

1. 勘测弹窗多了「套包米数」：原文写着"30米套包"的单子自动带出来，没有的手填一次就记住；布线米数一填，超出的部分自动算进增项（线缆敷设行，单价可改）。
2. 发给客户的话术里，线缆只显示"布线33米，超出套餐3米×¥40=¥120"，套包里的东西不给客户摆。
3. 所有要发出去的文本（话术/预估清单/发货单/水印名）现在都是先弹出来给你看、能改，改好再复制。
4. 订单卡上勘测那行能看到这单套包多少米。
