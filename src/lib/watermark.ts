/* ============================================================
 * 水印相机客户名（任务v32 功能三 · 业务逻辑唯一收敛处）
 * 背景：安装工用微信水印相机拍照发群报备，水印上写客户名，
 *      从订单一键复制「平台名+4个半角空格+客户姓名」贴进水印相机
 * 规范：模板串按平台可配（storage cp_watermark_templates），
 *      变量 {平台} {姓名}；未配置/空串回退默认模板；
 *      视图层只渲染本模块输出，禁止自拼字符串
 * ============================================================ */

/** 默认水印模板：{平台}{品牌} 连写 + 4 个半角空格 + {姓名}
 * （例：京东零跑    张三——任务v32.2 格式修正） */
export const DEFAULT_WATERMARK_TEMPLATE = "{平台}{品牌}    {姓名}";

/**
 * 取某平台生效的水印模板：
 * 已配置且非空白 → 该配置；否则 → 默认模板
 */
export function watermarkTemplateFor(
  platform: string,
  templates: Record<string, string>,
): string {
  const t = templates[platform];
  return typeof t === "string" && t.trim() !== ""
    ? t
    : DEFAULT_WATERMARK_TEMPLATE;
}

/**
 * 渲染水印字符串：模板中 {平台} {品牌} {姓名} 全部替换为实际值
 * （其余文字原样保留；空串按空串代入，不兜底伪造；
 *  旧模板无 {品牌} 占位 → replaceAll 无匹配，按旧模板渲染不受影响——v32.2 兼容条款）
 */
export function buildWatermarkName(
  template: string,
  platform: string,
  brand: string,
  customerName: string,
): string {
  return template
    .replaceAll("{平台}", platform)
    .replaceAll("{品牌}", brand)
    .replaceAll("{姓名}", customerName);
}
