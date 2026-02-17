import crypto from "crypto";
import { requireBankTokenEncryptionKey } from "./env";

type EncryptedPayload = {
  iv: string;
  tag: string;
  ciphertext: string;
};

function getKey(): Buffer {
  const BANK_TOKEN_ENCRYPTION_KEY = requireBankTokenEncryptionKey();
  const key = Buffer.from(BANK_TOKEN_ENCRYPTION_KEY, "base64");
  if (key.length !== 32) {
    throw new Error("BANK_TOKEN_ENCRYPTION_KEY must be 32 bytes (base64-encoded)");
  }
  return key;
}

export function encryptString(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  const payload: EncryptedPayload = {
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };

  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

export function decryptString(payloadB64: string): string {
  const key = getKey();
  const json = Buffer.from(payloadB64, "base64").toString("utf8");
  const payload = JSON.parse(json) as EncryptedPayload;

  const iv = Buffer.from(payload.iv, "base64");
  const tag = Buffer.from(payload.tag, "base64");
  const ciphertext = Buffer.from(payload.ciphertext, "base64");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}
