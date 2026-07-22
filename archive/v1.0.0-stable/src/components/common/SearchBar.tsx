/* ============================================================
 * 搜索输入栏（首页内置搜索使用，受控组件）
 * 规范：搜索功能全部集成首页，本组件为唯一搜索输入实现
 * ============================================================ */

import { Icon } from "@/components/common/Icon";

interface SearchBarProps {
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}

export function SearchBar({
  value,
  placeholder = "搜索 姓名 / 电话 / 地址",
  onChange,
}: SearchBarProps) {
  return (
    <div className="search-bar">
      <span aria-hidden="true" className="text-tertiary">
        <Icon name="search" size={18} />
      </span>
      <input
        className="search-bar__input"
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {value ? (
        <button
          type="button"
          className="modal__close"
          aria-label="清空搜索"
          onClick={() => onChange("")}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}
