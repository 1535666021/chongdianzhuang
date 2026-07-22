/* ============================================================
 * 设置区块 · 平台列表与扣点（任务B 多平台体系）
 * （挂载由 SettingsPage「平台扣点」二级页完成）
 * 职责：平台 CRUD（名称 + 扣点%）+ 旧两档迁移提示
 * 输入即存：去掉「保存平台」按钮，编辑/新增/删除后防抖（500ms）自动保存
 *      + toast「已保存」；落库逻辑不变——逐行校验后整体写回
 * 规范：全部读写走 storage 封装（loadPlatforms/savePlatforms/loadPlatformRates），
 *      本组件不碰 localStorage；扣点匹配/迁移口径收敛在 lib/platforms.ts，
 *      视图层不算扣点，仅做草稿编辑与自动保存
 * ============================================================ */

import { useState } from "react";
import type { PlatformConfig } from "@/types";
import { useApp } from "@/context/AppContext";
import {
  loadPlatformRates,
  loadPlatforms,
  savePlatforms,
} from "@/lib/storage";
import { migrateLegacyRates } from "@/lib/platforms";
import { useDebouncedCallback } from "@/components/settings/useDebouncedCallback";

/* ------------------------------------------------------------
 * 草稿模型与解析工具（百分比字符串态，保存时才转 number）
 * ------------------------------------------------------------ */

/** 平台行草稿：deductionPercent 以字符串暂存，允许输入中态（空串/小数点） */
interface PlatformRowDraft {
  name: string;
  percent: string;
}

const EMPTY_ROW_DRAFT: PlatformRowDraft = { name: "", percent: "" };

/** 百分比展示：清理浮点尾差（10.000000000000002 → "10"），非法值给空串 */
function formatPercent(n: number): string {
  if (!Number.isFinite(n)) return "";
  return String(Math.round(n * 100) / 100);
}

/** 百分比解析：trim 非空 + 有限数字 + 0-100，否则返回 null */
function parsePercent(raw: string): number | null {
  const text = raw.trim();
  if (text === "") return null;
  const num = Number(text);
  if (!Number.isFinite(num) || num < 0 || num > 100) return null;
  return num;
}

/** 从 storage 加载平台列表为草稿行（loadPlatforms 自带旧两档默认迁移） */
function readPlatformDrafts(): PlatformRowDraft[] {
  return loadPlatforms().map((p) => ({
    name: p.name,
    percent: formatPercent(p.deductionPercent),
  }));
}

/**
 * 旧两档迁移提示：当前平台列表与「旧 cp_platform_rates 迁移结果」完全一致，
 * 说明 cp_platforms 尚未被用户保存过（未初始化，loadPlatforms 走的是默认迁移），
 * 返回提示文案（默认即「已从旧配置迁移：京东10%/其他20%」）；否则返回 null。
 * 首次自动保存成功后（哪怕数值未改）以保存值为准，提示当次隐藏。
 */
function readMigrationHint(): string | null {
  const migrated = migrateLegacyRates(loadPlatformRates());
  const current = loadPlatforms();
  const unchanged =
    current.length === migrated.length &&
    current.every(
      (p, i) =>
        p.name === migrated[i].name &&
        Math.abs(p.deductionPercent - migrated[i].deductionPercent) < 1e-9,
    );
  if (!unchanged) return null;
  const detail = migrated
    .map((p) => `${p.name}${formatPercent(p.deductionPercent)}%`)
    .join("/");
  return `已从旧配置迁移：${detail}`;
}

/* ------------------------------------------------------------
 * 区块组件
 * ------------------------------------------------------------ */

export function PlatformSection() {
  const { showToast } = useApp();

  /* 平台行草稿 + 新增行草稿（编辑只改内存，防抖 500ms 后自动落库） */
  const [rows, setRows] = useState<PlatformRowDraft[]>(readPlatformDrafts);
  const [newRow, setNewRow] = useState<PlatformRowDraft>(EMPTY_ROW_DRAFT);

  /* 旧两档迁移提示（挂载时检测一次），首次自动保存成功后当次隐藏 */
  const [migrationHint] = useState<string | null>(readMigrationHint);
  const [hintDismissed, setHintDismissed] = useState(false);

  /* ---- 输入即存：防抖 500ms 自动保存（原「保存平台」逐行校验+整体落库
   *      逻辑不变；任一行非法则整批不落库并提示，与原保存行为一致） ---- */
  const persist = useDebouncedCallback(() => {
    const configs: PlatformConfig[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const name = row.name.trim();
      if (!name) {
        showToast("存在未填写平台名称的行，请补全或删除后再保存");
        return;
      }
      if (seen.has(name)) {
        showToast(`平台「${name}」重复，请合并后再保存`);
        return;
      }
      seen.add(name);
      const percent = parsePercent(row.percent);
      if (percent === null) {
        showToast(`「${name}」的扣点请填写 0-100 的数字`);
        return;
      }
      configs.push({ name, deductionPercent: percent });
    }
    if (!savePlatforms(configs)) {
      showToast("保存失败，请重试");
      return;
    }
    setHintDismissed(true);
    showToast("已保存");
  });

  /* ---- 行编辑 / 删除（改动后触发防抖自动保存） ---- */
  const handleRowChange = (index: number, patch: Partial<PlatformRowDraft>) => {
    setRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
    persist();
  };

  const handleDeleteRow = (index: number) => {
    setRows((prev) => prev.filter((_, i) => i !== index));
    persist();
  };

  /* ---- 新增行：名称必填、扣点 0-100、不与现有行重名（校验不变） ---- */
  const handleAddRow = () => {
    const name = newRow.name.trim();
    const percent = parsePercent(newRow.percent);
    if (!name) {
      showToast("请填写平台名称");
      return;
    }
    if (percent === null) {
      showToast("扣点请填写 0-100 的数字");
      return;
    }
    if (rows.some((row) => row.name.trim() === name)) {
      showToast(`平台「${name}」已存在`);
      return;
    }
    setRows((prev) => [...prev, { name, percent: String(percent) }]);
    setNewRow(EMPTY_ROW_DRAFT);
    persist();
  };

  return (
    <div className="card">
      <div className="card__title">平台列表与扣点</div>

      {/* 旧两档迁移提示：cp_platforms 未初始化（默认迁移态）时展示 */}
      {migrationHint && !hintDismissed ? (
        <p className="text-sm text-tertiary mt-sm">{migrationHint}</p>
      ) : null}

      <div className="flex-column gap-md mt-md">
        {rows.map((row, index) => (
          <div key={index} className="rate-row">
            <div className="rate-row__head">
              <span className="rate-row__brand">
                {row.name.trim() || "未命名平台"}
              </span>
              <button
                type="button"
                className="btn btn--danger-outline btn--sm"
                onClick={() => handleDeleteRow(index)}
              >
                删除
              </button>
            </div>
            <div className="rate-row__fields">
              <label className="rate-row__field">
                <span className="rate-row__label">平台名称</span>
                <input
                  className="input"
                  value={row.name}
                  placeholder="如：京东"
                  onChange={(e) =>
                    handleRowChange(index, { name: e.target.value })
                  }
                />
              </label>
              <label className="rate-row__field">
                <span className="rate-row__label">扣点（%）</span>
                <input
                  className="input"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max="100"
                  step="0.1"
                  value={row.percent}
                  placeholder="0-100"
                  onChange={(e) =>
                    handleRowChange(index, { percent: e.target.value })
                  }
                />
              </label>
            </div>
          </div>
        ))}

        {/* 新增平台行（加入列表后随防抖自动保存生效） */}
        <div className="cost-map-row cost-map-row--new">
          <div className="cost-map-row__main">
            <input
              className="input"
              value={newRow.name}
              placeholder="新平台名称"
              onChange={(e) =>
                setNewRow((prev) => ({ ...prev, name: e.target.value }))
              }
            />
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={handleAddRow}
            >
              添加
            </button>
          </div>
          <div className="rate-row__fields">
            <label className="rate-row__field">
              <span className="rate-row__label">扣点（%）</span>
              <input
                className="input"
                type="number"
                inputMode="decimal"
                min="0"
                max="100"
                step="0.1"
                value={newRow.percent}
                placeholder="0-100"
                onChange={(e) =>
                  setNewRow((prev) => ({ ...prev, percent: e.target.value }))
                }
              />
            </label>
          </div>
        </div>
      </div>

      <p className="text-sm text-tertiary mt-sm">
        按订单所属平台匹配扣点（名称互相包含即视为同一平台）；未命中的平台按「其他」扣点计算。
      </p>
    </div>
  );
}
