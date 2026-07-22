/* ============================================================
 * 表单预设默认值（任务R：勘测表单打开即按此预填，师傅只需输米数选增项）
 * 规范：默认值唯一定义在本模块；storage.ts 单向引用本常量
 *      （与 scripts/costMapping 同模式），组件一律经 storage 读写，
 *      设置页「表单预设」区可改并持久化
 * ============================================================ */

import type { FormPresets } from "@/types";

/** 表单预设默认值（无存档时 loadFormPresets 原样返回本常量） */
export const DEFAULT_FORM_PRESETS: FormPresets = {
  /** 取电方式默认 */
  powerSource: "国网取电",
  /** 线缆规格默认 */
  cableSpec: "3*6",
  /** 勘测详情/安装方式默认 */
  installType: "壁挂安装",
  /** 电表状态默认 */
  meterStatus: "已安装",
  /** 物业需要施工方案图默认 */
  needPlanDoc: "否",
  /** 勘测结果默认 */
  surveyResult: "车位是符合安装",
};
