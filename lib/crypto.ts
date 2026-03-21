import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ENCRYPTION_PREFIX = "enc:v1:";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

let cachedKey: Buffer | null = null;

function getSecretKey() {
  const secret = process.env.DATA_ENCRYPTION_KEY ?? process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("DATA_ENCRYPTION_KEY is not configured");
  }

  if (!cachedKey) {
    cachedKey = createHash("sha256").update(secret).digest();
  }

  return cachedKey;
}

export function isEncryptedValue(value: string) {
  return value.startsWith(ENCRYPTION_PREFIX);
}

export function encryptText(value: string) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", getSecretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, authTag, encrypted]).toString("base64url");
  return `${ENCRYPTION_PREFIX}${payload}`;
}

export function decryptText(value: string) {
  if (!isEncryptedValue(value)) {
    return value;
  }

  const payload = value.slice(ENCRYPTION_PREFIX.length);

  try {
    const decoded = Buffer.from(payload, "base64url");
    if (decoded.length <= IV_BYTES + AUTH_TAG_BYTES) {
      throw new Error("Invalid encrypted payload");
    }

    const iv = decoded.subarray(0, IV_BYTES);
    const authTag = decoded.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
    const encrypted = decoded.subarray(IV_BYTES + AUTH_TAG_BYTES);

    const decipher = createDecipheriv("aes-256-gcm", getSecretKey(), iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Failed to decrypt protected data");
  }
}

export function encryptNullableText(value: string | null | undefined) {
  if (value === null || value === undefined) return null;
  return encryptText(value);
}

export function decryptNullableText(value: string | null | undefined) {
  if (value === null || value === undefined) return null;
  return decryptText(value);
}

export function encryptOptionalText(value: string | undefined) {
  if (value === undefined) return undefined;
  return encryptText(value);
}

export function encryptStringArray(values: string[] | null | undefined) {
  if (!values || values.length === 0) return [];
  return values.map(value => encryptText(value));
}

export function decryptStringArray(values: string[] | null | undefined) {
  if (!values || values.length === 0) return [];
  return values.map(value => decryptText(value));
}

// ============================================
// User-Specific Encryption (Private Key)
// ============================================

export function generateUserPrivateKey(): string {
  // Generate a distinct 32-byte private key for a user
  return randomBytes(32).toString("hex");
}

export function encryptUserText(value: string, userKeyHex: string) {
  const iv = randomBytes(IV_BYTES);
  const key = Buffer.from(userKeyHex, "hex");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, authTag, encrypted]).toString("base64url");
  return `${ENCRYPTION_PREFIX}${payload}`;
}

export function decryptUserText(value: string, userKeyHex: string) {
  if (!isEncryptedValue(value)) {
    return value;
  }

  const payload = value.slice(ENCRYPTION_PREFIX.length);

  try {
    const decoded = Buffer.from(payload, "base64url");
    if (decoded.length <= IV_BYTES + AUTH_TAG_BYTES) {
      throw new Error("Invalid encrypted payload");
    }

    const iv = decoded.subarray(0, IV_BYTES);
    const authTag = decoded.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
    const encrypted = decoded.subarray(IV_BYTES + AUTH_TAG_BYTES);
    const key = Buffer.from(userKeyHex, "hex");

    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Failed to decrypt protected data");
  }
}

export function encryptNullableUserText(value: string | null | undefined, userKeyHex: string) {
  if (value === null || value === undefined) return null;
  return encryptUserText(value, userKeyHex);
}

export function decryptNullableUserText(value: string | null | undefined, userKeyHex: string) {
  if (value === null || value === undefined) return null;
  return decryptUserText(value, userKeyHex);
}

export function encryptOptionalUserText(value: string | undefined, userKeyHex: string) {
  if (value === undefined) return undefined;
  return encryptUserText(value, userKeyHex);
}

export function encryptUserStringArray(values: string[] | null | undefined, userKeyHex: string) {
  if (!values || values.length === 0) return [];
  return values.map(value => encryptUserText(value, userKeyHex));
}

export function decryptUserStringArray(values: string[] | null | undefined, userKeyHex: string) {
  if (!values || values.length === 0) return [];
  return values.map(value => decryptUserText(value, userKeyHex));
}
