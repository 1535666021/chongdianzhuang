# DELIVERY.md — 任务R：表单预设化+勘测完工数据贯通+首页片区智能预约

- 任务：任务R（R1 勘测表单预设 / R2 完工贯通 / R3 首页片区+批量预约 / R4 话术全链路入口）
- 版本：v29 ｜ commit：见 git log 最新一条
- 交付时间：2026-07-20
- 历史交付：v28 任务Q（话术模板库内置 5 条真实模板），详见 git 历史

## 完整改动清单（13 文件，3 代理并行 + 1号收口，越界检查通过）

| 文件 | 归属 | 改动 |
|---|---|---|
| `src/types/index.ts` | 1号 | 追加 FormPresets 接口、SurveyInfo.cableSpec、STORAGE_KEYS.formPresets |
| `src/lib/storage.ts` | 1号 | 追加 loadFormPresets/saveFormPresets（部分存档按字段合并） |
| `src/lib/addonOptions.ts` | 1号（冻结） | 新建：增项下拉共享逻辑 getAddonOptions（品牌清单×历史频率降序） |
| `src/lib/geoCluster.ts` | 4号+1号 | 追加 BatchAppointmentDraft/时段常量/getAppointableOrders；1号修复 extractAreaName 跨市界吞字（"市巢湖市烔炀镇"→"烔炀镇"） |
| `src/lib/formPresets.ts` | 2号 | 新建：DEFAULT_FORM_PRESETS 六项默认（国网取电/3*6/壁挂安装/已安装/否/车位是符合安装） |
| `src/lib/overFeeSync.ts` | 3号 | 新建：syncOverFeeRow 实际用线→超米费增项行自动同步 |
| `src/components/modals/SurveyModal.tsx` | 2号 | 重排：分区卡片（线缆信息/位置信息）+双列网格；全预设（勘测人=设置页工程师姓名联动）；增项下拉（可增删改金额）；米数→预估增项实时显示（费率读配置）；备注随单保存进话术 |
| `src/components/settings/FormPresetSection.tsx` | 2号 | 新建：设置页「表单预设」区，6 项可改，防抖自动保存 |
| `src/pages/SettingsPage.tsx` | 2号 | 挂载表单预设分区 |
| `src/components/modals/CompleteModal.tsx` | 3号 | 勘测数据全贯通（米数/增项/备注/安装详情带入）；增项下拉同一共享函数；实际用线→超米费行联动；删除扣点输入框（保存时读平台扣点配置，profitData 口径不变） |
| `src/pages/HomePage.tsx` | 4号 | 删除状态筛选排；原位片区分组（总单数+各片区单数，点片区过滤）；片区批量预约入口 |
| `src/components/BatchAppointmentDialog.tsx` | 4号 | 新建：片区选日期+时段+师傅一键批量转已预约（逐单 saveAppointment，已预约跳过） |
| `src/components/order/OrderCard.tsx` | 4号 | ⋯菜单自闭环话术入口：已预约/已勘测→勘测话术（无勘测数据灰显），已完成→勘测话术+完工话术；ScriptDialog 复用无长按 |
| `src/index.css` | 1号 | 尾部追加 .form-grid-2col（双列网格，全局间距变量） |

## 自测结果

**2号 R1**：预设读取/部分合并/持久化/增项频率排序全过；话术红线 45m→675 行、未安装→温馨提示、备注"测试备注X"→话术含备注 全过。
**3号 R2**：syncOverFeeRow 6 用例全 PASS（45→超15×45 增行、改 25→移除、手调保留、重算覆盖、未填无行、去重）。
**4号 R3+R4**：聚类 8 单构造用例全过（烔炀镇3/槐林镇2 成组、批量预约跳过已预约、时段常量一致）；OrderCard 菜单三状态话术项齐全。
**1号收口回归（9 PASS / 0 FAIL）**：
```
PASS | 恢复出厂（密码147568）140 单
PASS | 7月 20 单 / 实际利润 5780.40（验收8 基线不变）
PASS | 5月 55单/6512.40 不回归
PASS | 6月 50单/8308.50 不回归
PASS | extractAreaName：烔炀镇 / 槐林镇 / 黄麓镇 / 迎江区
```
工程级：`tsc --noEmit` 0 错误；`vite build` 通过。

## 遗留说明
- 旧「片区推荐」展开卡（含预估利润展示）被新片区分组设计替代，预估利润展示随之移除（新需求未含）；如需保留请甲方确认后补。
- 勘测人联动源改为设置页「工程师姓名」（engineerName），原 defaultSurveyor 不再驱动勘测表单（按需求 2 执行）。
- 「超米费」行以名称识别，手动改名后退出自动同步（设计语义，代码头注释已注明）。
