# DELIVERY.md — 任务Q：话术模板库内置（5条真实模板）

- 任务：任务Q 话术模板库内置（5条真实模板替换占位）
- 版本：v28 ｜ commit：见 git log（本文件随 commit 提交）
- 交付时间：2026-07-20

## 完整改动清单（8 文件）

| 文件 | 改动 |
|---|---|
| `src/lib/scripts.ts` | 5 条真实模板逐字内置（通用·勘测/完工=brandId default，理想·上门前/勘测/完工=brandId lixiang，含"直在"原字）；渲染引擎新增条件块 `{#if key}` / `{#if key="值"}`（lib 层实现）；新增 `parseCityFromAddress`、`buildAddonItemsText`、`LEGACY_PLACEHOLDER_SCRIPTS`；`buildScriptVars` 扩展（场景化超米计费/工程师/勘测完工新字段），导出签名全部向后兼容 |
| `src/lib/storage.ts` | `loadBrandScripts` 升级合并：旧占位逐字一致→自动升级新模板；用户改过的→保留不覆盖；缺失默认条目→补齐 |
| `src/types/index.ts` | 可选追加：SurveyInfo+6（powerSource/installType/meterStatus/needPlanDoc/surveyResult/propertyAllow）、CompletionInfo+3（actualCable/addonFee/installDetail）、BrandRateConfig+overMeterPrice（默认45元/米） |
| `src/components/ScriptDialog.tsx` | extras 富化：自动注入设置页工程师姓名/电话、品牌套包米数/超米单价、品牌显示名 |
| `src/components/modals/SurveyModal.tsx` | 新增 6 个可选字段（电表状态/用电方式/安装方式/物业允许/方案图/勘测结果），保存入库并代入话术 |
| `src/components/modals/CompleteModal.tsx` | 新增 3 个可选字段（实际线缆/增项费用/安装详情），保存入库并代入话术 |
| `src/pages/AppointmentPage.tsx` | 上门话术入口按 preVisit 模板存在性门控（默认仅理想有 → 非理想订单无入口） |
| `DELIVERY.md` | 本文件 |

## 设计要点

- 模板原文逐字内置，变量 {} 占位；条件块为引擎语法不属于展示文本：
  - 理想勘测 `{#if hasOverFee}`：overMeters=cableDistance−套包30米，≤0 增项行整行不显示
  - 理想勘测 `{#if meterStatus="未安装"}`：温馨提示整段条件出现
- 超米单价默认 45 元/米，品牌费率配置可加 overMeterPrice 按品牌覆盖
- 增项明细规则：套包内行只列"名称 数量"，收费行列"= ¥小计"，合计只汇总收费行
- 设置页话术编辑/自动保存/恢复默认行为不变；用户已改模板不被覆盖（占位才升级）

## 自测结果（node 直跑 lib 渲染，19/19 通过）

```
PASS | 模板含原有字样「直在」
PASS | 理想安装完成模板原文
PASS | 默认模板共5条
PASS | 通用无上门前模板（非理想无入口依据）
PASS | 通用=除理想外全部品牌回退default
PASS | cableDistance=45 → 增项行渲染正确（预估线缆45m超15m，每米45元，合计675元。）
PASS | 电表=已安装 → 温馨提示不出现
PASS | cableDistance=25 → 增项行整行不显示
PASS | 电表=未安装 → 温馨提示整段出现
PASS | 城市从地址解析 安徽-合肥-巢湖
PASS | 实际线缆代入
PASS | 完工超米费用 18×45=810
PASS | parseCity 标准三段 / 无省两段
PASS | 上门前日期时段代入 / 无残留未代入变量
PASS | 套包内行只列名称数量 / 收费行列小计 / 合计只汇总收费行(135)
```

工程级：`tsc --noEmit` 0 错误；`vite build` 通过。
