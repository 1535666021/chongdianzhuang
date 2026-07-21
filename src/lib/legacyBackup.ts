/* ------------------------------------------------------------
 * 模块：内置老备份（v7 出厂数据 · 全链路加密，任务S 隐私整改）
 * 职责：出厂备份以 AES-GCM 密文信封随应用包携带
 *      （public/legacy-backup.json 与 src/assets/legacy-backup.json 内容一致），
 *      设置页【恢复出厂老数据】须输入备份密码，解密后复用现有
 *      importBackup（内部走 migrate 流程），不再出现任何明文。
 * 密码规则（任务S 约定，源码不落明文数字）：
 *   · 默认密码 = 工程师手机号后 6 位。手机号见备份内 userSettings.engineerPhone，
 *     导入后即设置页「工程师信息」中的工程师电话。
 *   · 用户可在「数据管理」设置自定义备份密码：内置密文是打包只读资源，
 *     改密码 = 本地保存校验值（PBKDF2 派生哈希，不存明文）+
 *     用新密码重加密的备份信封（localStorage 覆盖值）。
 * 解密顺序（与约定一致）：先试自定义密码信封（存在时），失败再试内置
 *   默认密码信封；两者均失败 → 明确报"密码不对"，禁止任何明文兜底。
 * 说明：信封 JSON 约 1MB，使用动态 import 独立分包，仅点击恢复时才加载。
 * ------------------------------------------------------------ */
import {
  clearCustomBackupPassword,
  importBackup,
  loadBackupOverrideEnvelope,
  loadBackupPwdVerifier,
  saveBackupOverrideEnvelope,
  saveBackupPwdVerifier,
} from "@/lib/storage";
import {
  BackupDecryptError,
  createPasswordVerifier,
  decryptBackupEnvelope,
  encryptBackupText,
  isBackupEnvelope,
} from "@/lib/backupCrypto";
import type { BackupEnvelope } from "@/lib/backupCrypto";

/** 密码错误统一文案（ decrypt 失败即失败，不给任何明文兜底） */
const WRONG_PASSWORD_MSG = "备份密码不对，请重试";

/** 加载内置密文信封（动态 import 独立分包）；结构非法返回 null */
async function loadBuiltInEnvelope(): Promise<BackupEnvelope | null> {
  const mod = (await import("@/assets/legacy-backup.json")) as {
    default: unknown;
  };
  return isBackupEnvelope(mod.default) ? mod.default : null;
}

/** 用给定密码解密指定信封并导入；密码不对返回 WRONG_PASSWORD_MSG */
async function decryptAndImport(
  envelope: BackupEnvelope,
  password: string,
): Promise<string | null> {
  try {
    const plaintext = await decryptBackupEnvelope(envelope, password);
    return importBackup(plaintext);
  } catch (err) {
    if (err instanceof BackupDecryptError) return WRONG_PASSWORD_MSG;
    throw err;
  }
}

/**
 * 恢复出厂老数据：密码解密内置/自定义信封后执行迁移导入。
 * 入参 password 为用户在弹窗中输入的备份密码（trim 由调用方完成）。
 * 返回 null 表示成功，否则为错误消息（与 importBackup 口径一致）。
 * 顺序：自定义密码信封（存在时）优先 → 内置默认密码信封兜底；
 * 均失败返回"备份密码不对，请重试"。
 * 注意：会覆盖现有订单/设置/品牌等全部数据，调用方须先确认。
 */
export async function restoreFactoryLegacyData(
  password: string,
): Promise<string | null> {
  try {
    /* ① 自定义密码重加密信封（本地覆盖值）：存在则优先尝试 */
    const override = loadBackupOverrideEnvelope();
    if (override) {
      const result = await decryptAndImport(override, password);
      if (result !== WRONG_PASSWORD_MSG) return result;
      /* 密码对不上自定义信封 → 继续试默认密码信封 */
    }

    /* ② 内置默认密码信封（默认密码 = 工程师手机号后 6 位） */
    const builtIn = await loadBuiltInEnvelope();
    if (!builtIn) return "内置备份密文格式不正确，请联系开发者";
    return await decryptAndImport(builtIn, password);
  } catch (err) {
    return `内置备份加载失败：${err instanceof Error ? err.message : String(err)}`;
  }
}

/** 是否已设置自定义备份密码（校验值与重加密信封齐备才算有效） */
export function hasCustomBackupPassword(): boolean {
  return loadBackupPwdVerifier() !== null && loadBackupOverrideEnvelope() !== null;
}

/**
 * 设置 / 修改自定义备份密码：
 * 1. 用当前密码解密"当前生效信封"（自定义覆盖值优先，否则内置默认信封）验证身份；
 * 2. 用新密码重加密同一明文，信封 + 校验值落 localStorage（不存明文密码）。
 * 返回 null 表示成功，否则为错误消息（页面直接 Toast 展示）。
 */
export async function changeBackupPassword(
  currentPassword: string,
  newPassword: string,
): Promise<string | null> {
  if (!newPassword) return "新密码不能为空";
  if (newPassword.length < 6) return "新密码至少 6 位";
  try {
    const override = loadBackupOverrideEnvelope();
    const current = override ?? (await loadBuiltInEnvelope());
    if (!current) return "内置备份密文格式不正确，请联系开发者";

    let plaintext: string;
    try {
      plaintext = await decryptBackupEnvelope(current, currentPassword);
    } catch (err) {
      if (err instanceof BackupDecryptError) return "当前密码不对，请重试";
      throw err;
    }

    const envelope = await encryptBackupText(plaintext, newPassword);
    const verifier = await createPasswordVerifier(newPassword);
    if (!saveBackupOverrideEnvelope(envelope)) {
      return "本地存储空间不足，自定义备份密码设置失败";
    }
    if (!saveBackupPwdVerifier(verifier)) {
      /* 半成功回滚：信封与校验值必须成对存在，避免状态撕裂 */
      clearCustomBackupPassword();
      return "本地存储空间不足，自定义备份密码设置失败";
    }
    return null;
  } catch (err) {
    return `备份密码修改失败：${err instanceof Error ? err.message : String(err)}`;
  }
}

/**
 * 清除自定义备份密码，恢复为默认密码（工程师手机号后 6 位）：
 * 先用当前自定义密码解密覆盖信封验证身份，通过则清除本地覆盖值；
 * 内置默认密码信封不受影响。返回 null 表示成功。
 */
export async function resetBackupPasswordToDefault(
  currentPassword: string,
): Promise<string | null> {
  if (!hasCustomBackupPassword()) return null;
  try {
    const override = loadBackupOverrideEnvelope();
    if (!override) return null;
    try {
      await decryptBackupEnvelope(override, currentPassword);
    } catch (err) {
      if (err instanceof BackupDecryptError) return "当前密码不对，请重试";
      throw err;
    }
    clearCustomBackupPassword();
    return null;
  } catch (err) {
    return `恢复默认密码失败：${err instanceof Error ? err.message : String(err)}`;
  }
}
