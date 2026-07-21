/* ============================================================
 * 增项短名压缩规则（任务v35.1 三 · 选择列表减肥的数据底座）
 * 职责：增项全称 → 短名启发式压缩（autoShortName，有序规则，目标一行短小）
 *      / 条目显示短名取值（addonShortNameOf：shortName 非空优先，否则自动压缩）
 * 口径：显示取 shortName ?? autoShortName(name)；默认36条人工精修短名见
 *      lib/leapmotorAddons.ts，autoShortName 对其中 ≥70% 可原样产出
 * ============================================================
 * 有序规则：
 *  1. 型号缩写：YJV-3*6mm² / YJV 3×6mm² → 3×6（通用：数字×数字+mm² → 数字×数字）
 *  2. 括号压平：半角→全角、多层括号逐层消解；内容按 3-5 提取关键信息保留，
 *     其余删除，保留段以「·」接在主干后
 *  3. 关键词替换：电缆敷设→线缆 / 穿墙打孔→钻孔 / 开沟开槽→开沟 /
 *     漏电保护开关→漏保开关 / 充电桩→(删) / 用户提供·客户自购→自购 /
 *     （人工）·（含安装）·（含箱体设备及安装）·仅安装·更换及安装→(删)
 *  4. 厚度档：墙体厚度≤20cm→墙≤20cm / 20cm<墙体厚度≤40cm→墙20-40cm /
 *     40cm<墙体厚度≤60cm→墙>40cm / 60cm<墙体厚度≤80cm→墙>60cm
 *  5. 场景前缀精简：承重路·非承重路→(删) / 移桩·桩体X→移桩·X /
 *     规格尺寸串（500×600×250mm 类）保留首个维度组
 *  6. 兜底：规则后仍 >12 字→先丢尾部「·」补充段，再截 12 字
 * ============================================================ */

/** 短名最大长度（超出走兜底截断） */
export const SHORT_NAME_MAX_LEN = 12;

/** 关键词替换（有序；括号内外通用） */
const KEYWORD_RULES: ReadonlyArray<readonly [string, string]> = [
  ["电缆敷设", "线缆"],
  ["穿墙打孔", "钻孔"],
  ["开沟开槽", "开沟"],
  ["漏电保护开关", "漏保开关"],
  ["充电桩", ""],
  ["用户提供", "自购"],
  ["客户自购", "自购"],
];

/** 括号内直接删除的修饰短语（安装/人工类附加说明） */
const PAREN_DROP_PHRASES: readonly string[] = [
  "含箱体设备及安装",
  "更换及安装",
  "仅安装",
  "含安装",
  "人工",
  "A型",
  "或以下",
];

/** 括号分段命中即整段删除的限定词（封顶/及以上/不含 类描述性补充） */
const PAREN_DROP_SEGMENT = /封顶|及以上|不含/;

/** 规格尺寸串（500×600×250mm / 76×600mm 类） */
const DIMENSION_CHAIN = /(\d+(?:\.\d+)?(?:[×xX*]\d+(?:\.\d+)?)+)\s*mm/;

/** 关键词替换顺序应用 */
function applyKeywords(s: string): string {
  let out = s;
  for (const [from, to] of KEYWORD_RULES) out = out.split(from).join(to);
  return out;
}

/**
 * 括号内容 → 保留的关键信息（空串=整对括号删除）：
 * 厚度档转换 → 关键词替换 → 删修饰短语 → 分段过滤（无数字/字母/自购的
 * 纯描述段删除；规格尺寸串只留首个维度组）→ 中文相邻空白清除
 */
function transformParenContent(raw: string): string {
  let c = raw.trim();
  if (!c) return "";
  /* 厚度档（先区间后单档；20-40 档按规格书原样保留区间写法） */
  c = c.replace(
    /(\d+)\s*cm\s*<\s*墙体厚度≤\s*(\d+)\s*cm/g,
    (_m, lo: string, hi: string) =>
      lo === "20" && hi === "40" ? "墙20-40cm" : `墙>${lo}cm`,
  );
  c = c.replace(/墙体厚度≤\s*(\d+)\s*cm/g, "墙≤$1cm");
  c = c.split("~").join("-").split("～").join("-");
  c = applyKeywords(c);
  for (const p of PAREN_DROP_PHRASES) c = c.split(p).join("");
  const kept: string[] = [];
  for (const seg0 of c.split(/[，,、;；]/)) {
    let seg = seg0.trim().replace(/^[和及含\s]+|[和及含\s]+$/g, "");
    if (!seg || PAREN_DROP_SEGMENT.test(seg)) continue;
    const dim = seg.match(DIMENSION_CHAIN);
    if (dim) {
      seg = dim[1];
    } else if (!/[0-9A-Za-z×]/.test(seg) && !seg.includes("自购")) {
      continue;
    }
    seg = seg
      .replace(/([一-鿿])\s+/g, "$1")
      .replace(/\s+([一-鿿])/g, "$1")
      .trim();
    if (seg) kept.push(seg);
  }
  return kept.join(" ").trim();
}

/**
 * 增项全称 → 短名启发式压缩（有序规则见文件头；纯函数不读存储）。
 * 返回保证非空（入参全空白时原样返回 trim 后串）。
 */
export function autoShortName(name: string): string {
  let s = name.trim();
  if (!s) return "";

  /* 1. 型号缩写：YJV-3*6mm² / YJV 3×6mm² → 3×6（仅 mm² 电缆型号，
   *    普通尺寸串 500×500×200mm 不在此列，走括号维度组规则） */
  s = s.replace(/YJV[-\s]*/gi, "");
  s = s.replace(/(\d+)\s*[*xX×]\s*(\d+)\s*mm[²2]/g, "$1×$2");

  /* 2. 括号压平：半角→全角，多层括号由内向外逐层消解 */
  s = s.split("(").join("（").split(")").join("）");
  const keptParts: string[] = [];
  let prev = "";
  while (prev !== s) {
    prev = s;
    s = s.replace(/（([^（）]*)）/g, (_m, inner: string) => {
      const k = transformParenContent(inner);
      if (k) keptParts.push(k);
      return "";
    });
  }

  /* 3-5. 主干：关键词替换 → 场景前缀精简 → 空白/重复分隔清理 → 型号前补「·」 */
  s = applyKeywords(s);
  s = s.split("非承重路").join("").split("承重路").join("");
  s = s.split("移桩·桩体").join("移桩·");
  s = s.replace(/\s+/g, "");
  s = s.replace(/([一-鿿])(?=\d+×\d)/g, "$1·");
  s = s.replace(/·{2,}/g, "·").replace(/^·+|·+$/g, "");

  /* 主干逐段拼接括号保留信息（加上会超长的括号段直接丢弃，保主干完整） */
  let out = s;
  for (const k of keptParts) {
    const cand = out ? `${out}·${k}` : k;
    if ([...cand].length <= SHORT_NAME_MAX_LEN) out = cand;
  }

  /* 6. 兜底：仍 >12 字→先截到最后一个「·」前；无「·」可截再硬截 12 字 */
  if ([...out].length > SHORT_NAME_MAX_LEN) {
    const idx = out.lastIndexOf("·");
    if (idx > 0) out = out.slice(0, idx);
  }
  if ([...out].length > SHORT_NAME_MAX_LEN) {
    out = [...out].slice(0, SHORT_NAME_MAX_LEN).join("").replace(/[·×xX\-~\s]+$/g, "");
  }
  return out || name.trim();
}

/** 条目显示短名：shortName 非空用它，否则 autoShortName(name) */
export function addonShortNameOf(item: {
  name: string;
  shortName?: string;
}): string {
  const s = item.shortName?.trim();
  return s ? s : autoShortName(item.name);
}
