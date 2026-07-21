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

---

# DELIVERY.md 追加 — v35.1 勘测弹窗专场：短名/折叠/默认值/下拉/删预览/电缆行联动

- 版本：v35.1 ｜ commit：见 git log 最新一条（上一节点 cf0bf50 v35）｜ 交付时间：2026-07-21
- 施工模式：集群三线——2号线（逻辑层先动出契约）→ 1号线（SurveyModal 全线）/3号线（设置页短名入口）并行，总管收口质检

## 改动清单（改 6 + 新 1；parser/statistics/finance/migrate 与 v35 逐字节一致；index.css/storage/AppContext 零改动）

| 线 | 文件 | 改动要点 |
|---|---|---|
| 2号线·计费 | `src/lib/packageMeters.ts` | 新增 syncCableRowV2（线缆行常驻首行：数量=总量，unitPrice=总量>套包才有）/ cableChargeAmount（计费=(总量−套包)×单价）/ addonTotalWithCable（合计特判电缆行）/ buildCableOverFeeTextV2（超出「布线X米，套包免费Y米，超出Z米×¥单价=¥W」；未超出「布线X米，套包内，无线缆增项」）；v35 旧导出签名行为一字未动 |
| 2号线·短名 | `src/lib/addonShortName.ts`（新）+ `src/types/index.ts` + `src/lib/leapmotorAddons.ts` | autoShortName 启发式压缩（型号YJV-3*6mm²→3×6/穿墙打孔→钻孔/厚度档/前缀精简/兜底12字）；addonShortNameOf（shortName ?? auto）；LeapmotorAddon+shortName?；36 条默认数据逐条精修短名（auto 命中 80.6%） |
| 2号线·话术 | `src/lib/scripts.ts` | buildAddonItemsText cable 参扩 packageMeters（带→V2 格式，不带→V1 兼容）；buildScriptVars 取数链接入；其余模板/导出一字未动 |
| 1号线·弹窗 | `src/components/modals/SurveyModal.tsx` | ①增项两下拉改「短名 ¥单价/单位」+删「用过N次」（排序照跑）②线缆信息/位置信息两卡默认收起（点标题展开）③物业允许施工默认「是」④勘测结果改下拉（默认「勘测完成符合安装」备选「…不符合安装条件」）⑤删「生成预估清单预览」按钮+生成逻辑（TextPreviewDialog 组件保留）⑥电缆行常驻首行（数量=总用量主输入，布线距离自动同步；≤套包不计费，>套包按超出计费；他行照旧） |
| 3号线·设置页 | `src/components/settings/LeapmotorAddonsSection.tsx` | 每行加「短名」input（placeholder=自动压缩值，失焦保存，空串回自动）；添加区短名可选；说明文案（短名只用于选择列表，单据/话术仍全称） |

## 自测结果（2号线契约 39 PASS + 回归 28 PASS / 0 FAIL）

```
PASS | 计费：总量30套包30→不计费（行常驻无单价）；总量30套包20→计费10×¥40=¥400；改总量重算；他行合计450
PASS | 话术V2 逐字：超出「布线30米，套包免费20米，超出10米×¥40=¥400」；未超出「布线25米，套包内，无线缆增项」
PASS | 短名：36 条对照表全核（线缆·3×6/钻孔·墙>40cm/保护箱·自购/开沟·A2水泥路/漏保·2P C40 等），auto 命中 29/36
PASS | 弹窗六条：折叠两卡/物业默认是/结果下拉两项/预估按钮零残留/电缆行常驻联动/其他增项不受影响
PASS | 回归：143(6/6/125/6)/材料572/结算价30/工程师谢责强15395147568/三个月全科目/状态保持/口径3
```

工程级：`tsc --noEmit` 0 错误；`vite build` 通过（PWA 11 entries）；三线代理 esbuild 自验全过。

## 使用说明（师傅版）

1. 勘测弹窗清爽了：位置/线缆两块默认折起来，点标题才展开；增项列表一行一条短名带价格，没有"用过几次"啰嗦字。
2. 电缆行固定在增项第一行，填个总米数就行——布线距离自动跟，不超过套包不收钱，超了自动按超出算钱；打孔开沟这些照旧手填。
3. 物业允许施工默认"是"；勘测结果改下拉二选一。
4. 设置页零跑增项模板里每条都能改"短名"，改完选择列表就按新短名显示；发给客户的单据和话术还是全称。
