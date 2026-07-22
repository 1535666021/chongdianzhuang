/* ============================================================
 * 模块：备份加密（任务S · 隐私安全整改）
 * 职责：v7 明文备份 ⇆ AES-GCM 密文信封 的加密 / 解密，
 *      以及"自定义备份密码"校验值（verifier）的创建与比对。
 * 算法：PBKDF2(SHA-256) 派生 256 位 AES 密钥 + AES-GCM 加密；
 *      salt / iv / 迭代次数随信封自描述存储（JSON envelope），
 *      密文文件本体即信封 JSON，向后升级只增版本号。
 * 约束：仅用浏览器原生 Web Crypto（crypto.subtle），禁止引入 npm 加密包；
 *      本模块不存任何明文密码，不碰 localStorage。
 * ============================================================ */

/* ------------------------------------------------------------
 * 一、数据结构
 * ------------------------------------------------------------ */

/** 加密信封（自描述格式 v1）：public/src/assets 两处 legacy-backup.json 的本体 */
export interface BackupEnvelope {
  /** 信封格式版本 */
  v: 1;
  kdf: "PBKDF2";
  hash: "SHA-256";
  /** PBKDF2 迭代次数 */
  iter: number;
  /** 随机盐（base64，16 字节） */
  salt: string;
  /** AES-GCM 随机 IV（base64，12 字节） */
  iv: string;
  /** 密文（base64，AES-GCM 输出，尾部含 16 字节认证标签） */
  data: string;
}

/** 自定义备份密码校验值（localStorage 持久化）：仅可比对、不可反推，绝不存明文密码 */
export interface BackupPasswordVerifier {
  v: 1;
  kdf: "PBKDF2";
  hash: "SHA-256";
  iter: number;
  /** 随机盐（base64，16 字节） */
  salt: string;
  /** PBKDF2 派生值（base64，32 字节） */
  digest: string;
}

/** 密码错误 / 密文被篡改（AES-GCM 认证失败）——调用方据此提示"密码不对"，禁止明文兜底 */
export class BackupDecryptError extends Error {
  constructor(message = "备份密码不对，请重试") {
    super(message);
    this.name = "BackupDecryptError";
  }
}

/** 加密默认迭代次数（信封自描述，后续可调而不破坏旧密文） */
export const BACKUP_ENCRYPT_ITERATIONS = 150000;
/** 校验值派生迭代次数 */
export const BACKUP_VERIFIER_ITERATIONS = 150000;

/* ------------------------------------------------------------
 * 二、内部工具
 * ------------------------------------------------------------ */

/** Web Crypto 可用性守卫：非安全上下文（http 非 localhost）下 subtle 不存在 */
function ensureSubtle(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error(
      "当前环境不支持加密解密（需 HTTPS 或 localhost 访问），无法处理加密备份",
    );
  }
  return subtle;
}

/** 字节组 → base64（分块防栈溢出，762KB 级数据安全） */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** base64 → 字节组；非法 base64 抛出 Error（视为信封损坏） */
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** PBKDF2(SHA-256) 派生 AES-GCM 256 位密钥（不可导出，仅加解密用） */
async function deriveAesKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const subtle = ensureSubtle();
  const baseKey = await subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return subtle.deriveKey(
    { name: "PBKDF2", salt: salt as any, iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/* ------------------------------------------------------------
 * 三、信封加解密
 * ------------------------------------------------------------ */

/**
 * 明文备份 JSON → AES-GCM 密文信封。
 * salt / iv 每次随机生成，iter 随信封自描述存储。
 */
export async function encryptBackupText(
  plaintext: string,
  password: string,
  iterations: number = BACKUP_ENCRYPT_ITERATIONS,
): Promise<BackupEnvelope> {
  const subtle = ensureSubtle();
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(password, salt, iterations);
  const cipherBuf = await subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return {
    v: 1,
    kdf: "PBKDF2",
    hash: "SHA-256",
    iter: iterations,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(cipherBuf)),
  };
}

/** 结构校验：是否为合法信封（不验密码） */
export function isBackupEnvelope(value: unknown): value is BackupEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const o = value as Record<string, unknown>;
  return (
    o.v === 1 &&
    o.kdf === "PBKDF2" &&
    o.hash === "SHA-256" &&
    typeof o.iter === "number" &&
    Number.isInteger(o.iter) &&
    o.iter > 0 &&
    typeof o.salt === "string" &&
    typeof o.iv === "string" &&
    typeof o.data === "string"
  );
}

/**
 * 密文信封 + 密码 → 明文备份 JSON。
 * 信封结构非法 / base64 损坏 → 抛 Error（格式问题）；
 * 密码错误或密文被篡改（GCM 认证失败）→ 抛 BackupDecryptError。
 */
export async function decryptBackupEnvelope(
  envelope: unknown,
  password: string,
): Promise<string> {
  if (!isBackupEnvelope(envelope)) {
    throw new Error("备份密文格式不正确（非有效加密信封）");
  }
  const subtle = ensureSubtle();
  let salt: Uint8Array;
  let iv: Uint8Array;
  let data: Uint8Array;
  try {
    salt = base64ToBytes(envelope.salt);
    iv = base64ToBytes(envelope.iv);
    data = base64ToBytes(envelope.data);
  } catch {
    throw new Error("备份密文格式不正确（信封内容损坏）");
  }
  const key = await deriveAesKey(password, salt, envelope.iter);
  let plainBuf: ArrayBuffer;
  try {
    plainBuf = await subtle.decrypt({ name: "AES-GCM", iv: iv as any }, key, data as any);
  } catch {
    /* AES-GCM 认证失败 = 密码错误或密文被篡改，一律按"密码不对"上报，禁止明文兜底 */
    throw new BackupDecryptError();
  }
  return new TextDecoder().decode(plainBuf);
}

/* ------------------------------------------------------------
 * 四、自定义备份密码校验值（verifier）：仅存派生哈希，绝不存明文
 * ------------------------------------------------------------ */

/** 创建密码校验值（随机盐 + PBKDF2 派生值，可安全落 localStorage） */
export async function createPasswordVerifier(
  password: string,
): Promise<BackupPasswordVerifier> {
  const subtle = ensureSubtle();
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const baseKey = await subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: BACKUP_VERIFIER_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    256,
  );
  return {
    v: 1,
    kdf: "PBKDF2",
    hash: "SHA-256",
    iter: BACKUP_VERIFIER_ITERATIONS,
    salt: bytesToBase64(salt),
    digest: bytesToBase64(new Uint8Array(bits)),
  };
}

/** 结构校验：是否为合法校验值 */
export function isPasswordVerifier(
  value: unknown,
): value is BackupPasswordVerifier {
  if (typeof value !== "object" || value === null) return false;
  const o = value as Record<string, unknown>;
  return (
    o.v === 1 &&
    o.kdf === "PBKDF2" &&
    o.hash === "SHA-256" &&
    typeof o.iter === "number" &&
    Number.isInteger(o.iter) &&
    o.iter > 0 &&
    typeof o.salt === "string" &&
    typeof o.digest === "string"
  );
}

/** 比对密码与校验值（恒定内容比较，不匹配返回 false） */
export async function verifyBackupPassword(
  password: string,
  verifier: BackupPasswordVerifier,
): Promise<boolean> {
  if (!isPasswordVerifier(verifier)) return false;
  const subtle = ensureSubtle();
  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = base64ToBytes(verifier.salt);
    expected = base64ToBytes(verifier.digest);
  } catch {
    return false;
  }
  const baseKey = await subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await subtle.deriveBits(
    { name: "PBKDF2", salt: salt as any, iterations: verifier.iter, hash: "SHA-256" },
    baseKey,
    expected.length * 8,
  );
  const actual = new Uint8Array(bits);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}
