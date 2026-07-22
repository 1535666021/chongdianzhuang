/* ============================================================
 * 设置区块 · 话术模板（挂载由 SettingsPage「话术模板」二级页完成）
 * 职责：按 品牌 + 场景 编辑发给客户的话术；「通用」用于未单独配置的品牌
 * 输入即存：去掉「保存话术」按钮，编辑后防抖（500ms）自动保存
 *      + toast「已保存」；落库逻辑不变——读最新数组 upsert 后整体写回；
 *      保存参数（品牌/场景/内容）随调用显式传入，切换品牌/场景在 500ms
 *      窗口内也不串档
 * 规范：所有读写走 storage 封装，本组件不碰 localStorage
 * ============================================================ */

import { useState } from "react";
import type { BrandScript, ScriptScene } from "@/types";
import { useApp } from "@/context/AppContext";
import { loadBrandScripts, saveBrandScripts } from "@/lib/storage";
import {
  DEFAULT_BRAND_SCRIPTS,
  SCRIPT_SCENES,
  SCRIPT_VARIABLES,
} from "@/lib/scripts";
import { mergeBrands } from "@/lib/brandMaterials";
import { useDebouncedCallback } from "@/components/settings/useDebouncedCallback";

/* ------------------------------------------------------------
 * 草稿模型与加载工具
 * 一条话术由 品牌 + 场景 唯一确定，草稿 key 为 "brandId:scene"
 * ------------------------------------------------------------ */

/** 「通用（其他品牌）」话术的占位 brandId，未单独配置话术的品牌共用 */
const GENERIC_SCRIPT_BRAND_ID = "default";

function scriptDraftKey(brandId: string, scene: ScriptScene): string {
  return `${brandId}:${scene}`;
}

/** 从 storage 读已保存话术，转为 "brandId:scene" → 内容 的映射 */
function readScriptDrafts(): Record<string, string> {
  const drafts: Record<string, string> = {};
  for (const script of loadBrandScripts()) {
    drafts[scriptDraftKey(script.brandId, script.scene)] = script.content;
  }
  return drafts;
}

export function ScriptSection() {
  const { customBrands, showToast } = useApp();

  /* 当前编辑的品牌/场景 + 全量草稿（切品牌/场景不丢未保存修改） */
  const [scriptBrandId, setScriptBrandId] = useState(GENERIC_SCRIPT_BRAND_ID);
  const [scriptScene, setScriptScene] = useState<ScriptScene>("preVisit");
  const [scriptDrafts, setScriptDrafts] =
    useState<Record<string, string>>(readScriptDrafts);

  /* 内置 + 自定义品牌；话术品牌列表：通用（其他品牌）+ 内置/自定义品牌 */
  const scriptBrands = [
    { id: GENERIC_SCRIPT_BRAND_ID, name: "通用（其他品牌）" },
    ...mergeBrands(customBrands),
  ];
  const scriptDraft =
    scriptDrafts[scriptDraftKey(scriptBrandId, scriptScene)] ?? "";

  /* ---- 输入即存：防抖 500ms 自动保存（原「保存话术」upsert 落库逻辑不变，
   *      品牌/场景/内容显式传参，防抖窗口内切换页签也不串档） ---- */
  const persistScript = useDebouncedCallback(
    (brandId: string, scene: ScriptScene, content: string) => {
      const next: BrandScript = { brandId, scene, content };
      const scripts = loadBrandScripts();
      const index = scripts.findIndex(
        (s) => s.brandId === brandId && s.scene === scene,
      );
      if (index >= 0) {
        scripts[index] = next;
      } else {
        scripts.push(next);
      }
      if (!saveBrandScripts(scripts)) {
        showToast("保存失败，请重试");
        return;
      }
      showToast("已保存");
    },
  );

  /* ---- 编辑草稿（改内存 + 触发防抖自动保存） ---- */
  const handleScriptChange = (content: string) => {
    setScriptDrafts((prev) => ({
      ...prev,
      [scriptDraftKey(scriptBrandId, scriptScene)]: content,
    }));
    persistScript(scriptBrandId, scriptScene, content);
  };

  /* ---- 恢复默认：回填 DEFAULT_BRAND_SCRIPTS 对应条目（随后随防抖自动保存） ---- */
  const handleRestoreDefaultScript = () => {
    const preset = DEFAULT_BRAND_SCRIPTS.find(
      (s) => s.brandId === scriptBrandId && s.scene === scriptScene,
    );
    if (!preset) {
      showToast("当前品牌与场景暂无默认模板");
      return;
    }
    handleScriptChange(preset.content);
    showToast("已回填默认模板");
  };

  return (
    <div className="card">
      <div className="card__title">话术模板</div>
      <div className="flex-column gap-md">
        {/* 品牌：通用（其他品牌）+ 内置/自定义品牌 */}
        <div className="filter-chips" role="group" aria-label="话术品牌">
          {scriptBrands.map((brand) => (
            <button
              key={brand.id}
              type="button"
              className={
                brand.id === scriptBrandId ? "chip chip--active" : "chip"
              }
              onClick={() => setScriptBrandId(brand.id)}
            >
              {brand.name}
            </button>
          ))}
        </div>
        {/* 场景：上门前 / 勘测完成 / 安装完成 */}
        <div
          className="script-editor__tabs"
          role="group"
          aria-label="话术场景"
        >
          {SCRIPT_SCENES.map((scene) => (
            <button
              key={scene.key}
              type="button"
              className={
                scene.key === scriptScene
                  ? "script-editor__tab script-editor__tab--active"
                  : "script-editor__tab"
              }
              onClick={() => setScriptScene(scene.key)}
            >
              {scene.label}
            </button>
          ))}
        </div>
        <textarea
          className="textarea"
          rows={6}
          value={scriptDraft}
          placeholder="暂无模板，输入后自动保存创建"
          onChange={(e) => handleScriptChange(e.target.value)}
        />
        {/* 可用变量：发送时替换为订单实际信息 */}
        <div className="script-editor__vars text-sm text-secondary">
          <span>可用变量：</span>
          {SCRIPT_VARIABLES.map((variable) => (
            <span key={variable.key}>
              {`{${variable.key}} ${variable.label}`}
            </span>
          ))}
        </div>
        <div className="flex-column gap-sm">
          <button
            type="button"
            className="btn btn--outline btn--sm"
            onClick={handleRestoreDefaultScript}
          >
            恢复默认
          </button>
        </div>
      </div>
      <p className="text-sm text-tertiary mt-sm">
        按品牌与场景分别编辑发给客户的话术，「通用」用于未单独配置的品牌；修改后自动保存生效。
      </p>
    </div>
  );
}
