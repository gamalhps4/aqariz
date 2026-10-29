import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const ENCRYPTED_PREFIX = "enc:v1:";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

function encryptionKey(): Buffer {
  const configured = process.env.DATA_ENCRYPTION_KEY?.trim();
  if (!configured) {
    throw new Error("DATA_ENCRYPTION_KEY is required for sensitive data");
  }

  const key = /^[a-f0-9]{64}$/i.test(configured)
    ? Buffer.from(configured, "hex")
    : Buffer.from(configured, "base64");
  if (key.length !== 32) {
    throw new Error(
      "DATA_ENCRYPTION_KEY must be 32 bytes encoded as base64 or 64 hex characters",
    );
  }
  return key;
}

export function isEncryptedSensitiveValue(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(ENCRYPTED_PREFIX);
}

export function encryptSensitiveValue(value: string | null | undefined): string | null | undefined {
  if (!value || isEncryptedSensitiveValue(value)) return value;

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    ENCRYPTED_PREFIX.slice(0, -1),
    iv.toString("base64url"),
    authTag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

export function decryptSensitiveValue(value: string | null | undefined): string | null | undefined {
  if (!value || !isEncryptedSensitiveValue(value)) return value;

  const parts = value.split(":");
  if (parts.length !== 5 || parts[0] !== "enc" || parts[1] !== "v1") {
    throw new Error("Sensitive data has an unsupported encryption envelope");
  }

  const iv = Buffer.from(parts[2], "base64url");
  const authTag = Buffer.from(parts[3], "base64url");
  const encrypted = Buffer.from(parts[4], "base64url");
  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString("utf8");
}
