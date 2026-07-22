/* ============================================================
 * 筛选 chips 组（首页内置筛选使用）
 * 支持两种模式：
 * - multiple=false：单选（如品牌筛选，含"全部"项）
 * - multiple=true ：多选（如状态筛选，空选=全部）
 * ============================================================ */

export interface ChipOption<T extends string> {
  value: T;
  label: string;
}

interface FilterChipsProps<T extends string> {
  options: ChipOption<T>[];
  /** multiple=false：当前选中值（"" 表示全部） */
  value?: T | "";
  /** multiple=true：当前选中值数组（空数组表示全部） */
  values?: T[];
  multiple?: boolean;
  onChange: (next: T[] | T | "") => void;
}

export function FilterChips<T extends string>({
  options,
  value = "",
  values = [],
  multiple = false,
  onChange,
}: FilterChipsProps<T>) {
  const handleClick = (clicked: T) => {
    if (multiple) {
      const next = values.includes(clicked)
        ? values.filter((v) => v !== clicked)
        : [...values, clicked];
      onChange(next);
    } else {
      // 单选：再次点击已选项回到"全部"
      onChange(value === clicked ? "" : clicked);
    }
  };

  const isActive = (option: T): boolean =>
    multiple ? values.includes(option) : value === option;

  const allActive = multiple ? values.length === 0 : value === "";

  return (
    <div className="filter-chips" role="group" aria-label="筛选">
      <button
        type="button"
        className={allActive ? "chip chip--active" : "chip"}
        onClick={() => onChange(multiple ? [] : "")}
      >
        全部
      </button>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={isActive(option.value) ? "chip chip--active" : "chip"}
          onClick={() => handleClick(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
