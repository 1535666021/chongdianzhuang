/* ============================================================
 * 设置页（微信式分组列表 + 二级页）
 * 一级页：分组条目（图标 + 名称 + 右箭头），顺序——人员默认 / 工程师信息 /
 *      地图服务 / 数据管理 / 自定义品牌 / 费率配置（含品牌结算价）/
 *      成本价目表 / 平台扣点 / 话术模板 / 表单预设 / 危险操作
 * 二级页：页内状态切换（无路由），顶部 arrow-left 返回 + 分组名；
 *      各区块组件挂载时自 storage 读草稿，输入即存（防抖 500ms 自动保存）
 * 规范：所有读写走 storage / parser 封装，本页不碰 localStorage
 * ============================================================ */

import { useEffect, useState } from "react";
import { Icon } from "@/components/common/Icon";
import type { IconName } from "@/components/common/Icon";
import { PersonnelSection } from "@/components/settings/PersonnelSection";
import { EngineerSection } from "@/components/settings/EngineerSection";
import { AmapSection } from "@/components/settings/AmapSection";
import { DataSection } from "@/components/settings/DataSection";
import { BrandSection } from "@/components/settings/BrandSection";
import { RatesSection } from "@/components/settings/RatesSection";
import { PlatformSection } from "@/components/settings/PlatformSection";
import { ScriptSection } from "@/components/settings/ScriptSection";
import { FormPresetSection } from "@/components/settings/FormPresetSection";
import { StockSection } from "@/components/settings/StockSection";
import { WatermarkSection } from "@/components/settings/WatermarkSection";
import { LeapmotorAddonsSection } from "@/components/settings/LeapmotorAddonsSection";
import { DangerSection } from "@/components/settings/DangerSection";
import { CostSheetSection } from "@/components/settings/CostSheetSection";

/* ------------------------------------------------------------
 * 分组注册表：一级页条目顺序即二级页内容映射（顺序固定，见头注释）
 * ------------------------------------------------------------ */
type SettingsGroupKey =
  | "personnel"
  | "engineer"
  | "amap"
  | "data"
  | "brand"
  | "rate"
  | "costSheet"
  | "platform"
  | "script"
  | "formPreset"
  | "stock"
  | "watermark"
  | "leapmotorAddons"
  | "danger";

interface SettingsGroupMeta {
  key: SettingsGroupKey;
  title: string;
  icon: IconName;
  /** 危险操作组：条目文字与图标用危险色标识 */
  danger?: boolean;
}

const SETTINGS_GROUPS: SettingsGroupMeta[] = [
  { key: "personnel", title: "人员默认", icon: "user" },
  { key: "engineer", title: "工程师信息", icon: "tool" },
  { key: "amap", title: "地图服务", icon: "map-pin" },
  { key: "data", title: "数据管理", icon: "box" },
  { key: "brand", title: "自定义品牌", icon: "edit" },
  { key: "rate", title: "费率配置", icon: "wallet" },
  { key: "costSheet", title: "成本价目表", icon: "dollar-sign" },
  { key: "platform", title: "平台扣点", icon: "settings" },
  { key: "script", title: "话术模板", icon: "copy" },
  { key: "formPreset", title: "表单预设", icon: "file-text" },
  { key: "stock", title: "充电桩仓库", icon: "box" },
  { key: "watermark", title: "水印模板", icon: "copy" },
  { key: "leapmotorAddons", title: "零跑增项模板", icon: "file-text" },
  { key: "danger", title: "危险操作", icon: "alert", danger: true },
];

/** 二级页内容：各区块自加载自保存，页内切换即重新挂载重读 storage */
function SettingsGroupContent({ groupKey }: { groupKey: SettingsGroupKey }) {
  switch (groupKey) {
    case "personnel":
      return <PersonnelSection />;
    case "engineer":
      return <EngineerSection />;
    case "amap":
      return <AmapSection />;
    case "data":
      return <DataSection />;
    case "brand":
      return <BrandSection />;
    case "rate":
      return <RatesSection />;
    case "costSheet":
      return <CostSheetSection />;
    case "platform":
      return <PlatformSection />;
    case "script":
      return <ScriptSection />;
    case "formPreset":
      return <FormPresetSection />;
    case "stock":
      return <StockSection />;
    case "watermark":
      return <WatermarkSection />;
    case "leapmotorAddons":
      return <LeapmotorAddonsSection />;
    case "danger":
      return <DangerSection />;
  }
}

export function SettingsPage() {
  /* 当前打开的二级页；null = 一级分组列表（页内状态切换，无路由） */
  const [activeGroup, setActiveGroup] = useState<SettingsGroupKey | null>(
    null,
  );

  /* 一/二级页切换时回到顶部（二级页卸载即存防抖会 flush 挂起保存） */
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [activeGroup]);

  const activeMeta = SETTINGS_GROUPS.find((g) => g.key === activeGroup);

  /* ---- 二级页：顶部 arrow-left 返回 + 分组名 ---- */
  if (activeMeta) {
    return (
      <div className="page">
        <div className="page-header">
          <div className="page-header__extra">
            <button
              type="button"
              className="btn btn--icon"
              aria-label="返回"
              onClick={() => setActiveGroup(null)}
            >
              <Icon name="arrow-left" />
            </button>
            <span className="page-header__title">{activeMeta.title}</span>
          </div>
        </div>
        <div className="page-body">
          <SettingsGroupContent groupKey={activeMeta.key} />
        </div>
      </div>
    );
  }

  /* ---- 一级页：分组列表（条目 = 图标 + 名称 + 右箭头） ---- */
  return (
    <div className="page">
      <div className="page-header">
        <span className="page-header__title">设置</span>
      </div>
      <div className="page-body">
        {SETTINGS_GROUPS.map((group) => (
          <div key={group.key} className="card">
            <button
              type="button"
              className="list-item copyable"
              onClick={() => setActiveGroup(group.key)}
            >
              <span className={group.danger ? "text-danger" : "text-secondary"}>
                <Icon name={group.icon} size={20} />
              </span>
              <span className="list-item__main">
                <span
                  className={
                    group.danger
                      ? "list-item__title text-danger"
                      : "list-item__title"
                  }
                >
                  {group.title}
                </span>
              </span>
              <span className="list-item__extra text-tertiary">
                <Icon name="chevron-right" size={20} />
              </span>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
