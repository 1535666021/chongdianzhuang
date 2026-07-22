/* ============================================================
 * 设置区块 · 水印模板（挂载由 SettingsPage「水印模板」二级页完成）
 * 功能：按平台分别配置水印相机客户名模板，支持变量 {平台} {品牌} {姓名}；
 *      留空回默认模板（{平台}{品牌}连写+4 个半角空格+{姓名}），失焦即存
 * 规范：平台列表与模板读写走 storage 封装（loadPlatforms /
 *      loadWatermarkTemplates / saveWatermarkTemplates），生效回退展示走
 *      watermark 模块（watermarkTemplateFor / DEFAULT_WATERMARK_TEMPLATE），
 *      本组件只渲染，不直触本地存储、不自拼回退逻辑
 * ============================================================ */

import { useEffect, useState } from "react";
import { useApp } from "@/context/AppContext";
import {
  loadPlatforms,
  loadWatermarkTemplates,
  saveWatermarkTemplates,
} from "@/lib/storage";
import {
  DEFAULT_WATERMARK_TEMPLATE,
  watermarkTemplateFor,
} from "@/lib/watermark";
import type { PlatformConfig } from "@/types";

export function WatermarkSection() {
  const { showToast } = useApp();
  /* 各平台模板草稿（字符串态，空串 = 未配置回默认），键 = 平台名 */
  const [templates, setTemplates] = useState<Record<string, string>>({});
  /* 平台库快照（挂载时读取一次，二级页切换即重挂载重读，与其他区块同规） */
  const [platforms, setPlatforms] = useState<PlatformConfig[]>([]);

  /* 挂载时自 storage 初始化一次 */
  useEffect(() => {
    setPlatforms(loadPlatforms());
    setTemplates(loadWatermarkTemplates());
  }, []);

  /* ---- 失焦保存：空串删该键（回默认）；非空写入该键 ---- */
  const handleBlur = (platformName: string) => {
    const raw = templates[platformName] ?? "";
    const next: Record<string, string> = { ...templates };
    if (raw.trim() === "") {
      delete next[platformName];
    } else {
      next[platformName] = raw;
    }
    saveWatermarkTemplates(next);
    setTemplates(next);
    showToast("水印模板已保存");
  };

  return (
    <div className="card">
      <div className="card__title">水印模板</div>
      <div className="flex-column gap-md">
        {platforms.length === 0 ? (
          <p className="text-sm text-tertiary">
            平台库为空，请先在设置页「平台扣点」配置平台
          </p>
        ) : (
          platforms.map((platform) => (
            <div key={platform.name} className="rate-row">
              <div className="rate-row__head">
                <span className="rate-row__brand">{platform.name}</span>
                <span className="text-sm text-tertiary">
                  生效：{watermarkTemplateFor(platform.name, templates)}
                </span>
              </div>
              <div className="rate-row__fields">
                <label className="rate-row__field">
                  <span className="rate-row__label">模板</span>
                  <input
                    className="input"
                    type="text"
                    value={templates[platform.name] ?? ""}
                    placeholder={DEFAULT_WATERMARK_TEMPLATE}
                    onChange={(e) =>
                      setTemplates((prev) => ({
                        ...prev,
                        [platform.name]: e.target.value,
                      }))
                    }
                    onBlur={() => handleBlur(platform.name)}
                  />
                </label>
              </div>
            </div>
          ))
        )}
        <p className="text-sm text-tertiary mt-sm">
          {
            "支持变量 {平台} {品牌} {姓名}；留空回默认模板：{平台}{品牌}连写＋4 个空格＋{姓名}（例：京东零跑    张三）。旧模板里没有 {品牌} 的按旧模板原样生成不受影响。水印相机拍照报备时从订单卡点「水印名」复制。"
          }
        </p>
      </div>
    </div>
  );
}
